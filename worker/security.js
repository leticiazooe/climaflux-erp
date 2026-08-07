import {
  base64UrlToBytes,
  constantTimeEqual,
  decodeJwtSection,
  isDomainAllowed,
  isGoogleAuthoritativeAccount,
  parseCookies,
  serializeCookie,
  splitCsv,
} from './auth-core.js';

export const SESSION_COOKIE = '__Host-climaflux_session';
export const LOGIN_NONCE_COOKIE = '__Host-climaflux_login_nonce';
export const LOGIN_CSRF_COOKIE = 'climaflux_login_csrf';
export const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';

const encoder = new TextEncoder();
let jwksCache = { expiresAt: 0, keys: [] };

export function json(data, status = 200, extraHeaders = {}) {
  const headers = new Headers(extraHeaders);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  return new Response(JSON.stringify(data), { status, headers });
}

export function redirect(location, status = 302, headers = {}) {
  return new Response(null, {
    status,
    headers: { Location: location, 'Cache-Control': 'no-store', ...headers },
  });
}

export function nowIso() {
  return new Date().toISOString();
}

export function addSeconds(date, seconds) {
  return new Date(date.getTime() + seconds * 1000);
}

export function randomToken(bytes = 32) {
  const data = new Uint8Array(bytes);
  crypto.getRandomValues(data);
  return [...data].map((value) => value.toString(16).padStart(2, '0')).join('');
}

export async function sha256(value) {
  const data = typeof value === 'string' ? encoder.encode(value) : value;
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function getNumber(env, key, fallback) {
  const parsed = Number.parseInt(String(env[key] || ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function clientIp(request) {
  return request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
}

export async function hashedIp(request, env) {
  return sha256(`${env.SESSION_SECRET || 'missing'}:${clientIp(request)}`);
}

export function userAgent(request) {
  return (request.headers.get('User-Agent') || '').slice(0, 500);
}

export function validateSameOrigin(request) {
  const origin = request.headers.get('Origin');
  if (!origin) return false;
  return origin === new URL(request.url).origin;
}

export function clearCookie(name, httpOnly = false) {
  return serializeCookie(name, '', {
    httpOnly,
    maxAge: 0,
    expires: new Date(0),
  });
}

export function appendCookie(headers, value) {
  headers.append('Set-Cookie', value);
}

export function securityHeaders(response, { login = false, html = false, publicAsset = false } = {}) {
  const headers = new Headers(response.headers);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', login ? 'no-referrer' : 'strict-origin-when-cross-origin');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  headers.set('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  headers.set('X-Frame-Options', 'DENY');
  if (html) headers.set('Cache-Control', 'no-store, private');
  else if (publicAsset) headers.set('Cache-Control', 'public, max-age=300, must-revalidate');
  else headers.set('Cache-Control', 'no-store, private');

  if (login) {
    headers.set(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self' https://accounts.google.com/gsi/client; style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style; img-src 'self' data: https://*.googleusercontent.com; frame-src https://accounts.google.com; connect-src 'self' https://accounts.google.com; base-uri 'none'; form-action 'self'; frame-ancestors 'none';",
    );
  } else {
    headers.set(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self' data: https://*.googleusercontent.com; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none';",
    );
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function requireDatabase(env) {
  if (!env.DB) throw new Error('DATABASE_NOT_CONFIGURED');
  return env.DB;
}

async function getGoogleJwks() {
  const current = Date.now();
  if (jwksCache.keys.length && jwksCache.expiresAt > current) return jwksCache.keys;

  const response = await fetch(GOOGLE_JWKS_URL, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error('GOOGLE_JWKS_UNAVAILABLE');
  const body = await response.json();
  const cacheControl = response.headers.get('Cache-Control') || '';
  const match = cacheControl.match(/max-age=(\d+)/i);
  const ttl = match ? Number(match[1]) * 1000 : 60 * 60 * 1000;
  jwksCache = {
    keys: Array.isArray(body.keys) ? body.keys : [],
    expiresAt: current + Math.min(ttl, 24 * 60 * 60 * 1000),
  };
  return jwksCache.keys;
}

async function verifyGoogleIdTokenWithKey(parts, payload, jwk, env, expectedNonce) {
  const publicKey = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const signatureValid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    publicKey,
    base64UrlToBytes(parts[2]),
    encoder.encode(`${parts[0]}.${parts[1]}`),
  );
  if (!signatureValid) throw new Error('GOOGLE_TOKEN_SIGNATURE');

  const now = Math.floor(Date.now() / 1000);
  const audience = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audience.includes(env.GOOGLE_CLIENT_ID)) throw new Error('GOOGLE_TOKEN_AUDIENCE');
  if (payload.azp && payload.azp !== env.GOOGLE_CLIENT_ID) throw new Error('GOOGLE_TOKEN_AUTHORIZED_PARTY');
  if (!['accounts.google.com', 'https://accounts.google.com'].includes(payload.iss)) {
    throw new Error('GOOGLE_TOKEN_ISSUER');
  }
  if (!Number.isFinite(payload.exp) || payload.exp <= now) throw new Error('GOOGLE_TOKEN_EXPIRED');
  if (!Number.isFinite(payload.iat) || payload.iat > now + 120 || payload.iat < now - 24 * 60 * 60) {
    throw new Error('GOOGLE_TOKEN_ISSUED_AT');
  }
  if (!expectedNonce || payload.nonce !== expectedNonce) throw new Error('GOOGLE_TOKEN_NONCE');
  if (!payload.sub || !payload.email) throw new Error('GOOGLE_TOKEN_PROFILE');

  const explicit = [...splitCsv(env.BOOTSTRAP_ADMIN_EMAILS), ...splitCsv(env.ALLOWED_GOOGLE_EMAILS)];
  if (!isGoogleAuthoritativeAccount(payload, explicit)) throw new Error('GOOGLE_ACCOUNT_NOT_AUTHORITATIVE');
  if (!isDomainAllowed(payload, splitCsv(env.ALLOWED_GOOGLE_DOMAINS))) throw new Error('GOOGLE_DOMAIN_NOT_ALLOWED');
  return payload;
}

export async function verifyGoogleIdToken(idToken, env, expectedNonce) {
  if (!env.GOOGLE_CLIENT_ID) throw new Error('AUTH_SECRETS_NOT_CONFIGURED');
  if (!idToken || typeof idToken !== 'string') throw new Error('GOOGLE_TOKEN_MISSING');
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new Error('GOOGLE_TOKEN_MALFORMED');

  const header = decodeJwtSection(parts[0]);
  const payload = decodeJwtSection(parts[1]);
  if (header.alg !== 'RS256' || !header.kid) throw new Error('GOOGLE_TOKEN_ALGORITHM');

  let key = (await getGoogleJwks()).find((candidate) => candidate.kid === header.kid);
  if (!key) {
    jwksCache = { expiresAt: 0, keys: [] };
    key = (await getGoogleJwks()).find((candidate) => candidate.kid === header.kid);
  }
  if (!key) throw new Error('GOOGLE_KEY_NOT_FOUND');
  return verifyGoogleIdTokenWithKey(parts, payload, key, env, expectedNonce);
}

export async function verifyCsrf(request, session) {
  if (!validateSameOrigin(request)) throw new Error('AUTH_ORIGIN');
  const token = request.headers.get('X-CSRF-Token') || '';
  if (!token || !constantTimeEqual(await sha256(token), session.csrf_hash)) throw new Error('AUTH_CSRF');
}

export function sessionTokenFromRequest(request) {
  return parseCookies(request.headers.get('Cookie') || '')[SESSION_COOKIE] || '';
}
