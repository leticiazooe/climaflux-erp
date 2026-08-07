import {
  base64UrlToBytes,
  constantTimeEqual,
  decodeJwtSection,
  isDomainAllowed,
  isGoogleAuthoritativeAccount,
  isMembershipStatus,
  isRole,
  normalizeEmail,
  parseCookies,
  safeReturnTo,
  serializeCookie,
  splitCsv,
} from './auth-core.js';

const SESSION_COOKIE = '__Host-climaflux_session';
const LOGIN_NONCE_COOKIE = '__Host-climaflux_login_nonce';
const CSRF_COOKIE = 'climaflux_csrf';
const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const encoder = new TextEncoder();
let jwksCache = { expiresAt: 0, keys: [] };

function json(data, status = 200, extraHeaders = {}) {
  const headers = new Headers(extraHeaders);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  return new Response(JSON.stringify(data), { status, headers });
}

function redirect(location, status = 302, headers = {}) {
  return new Response(null, { status, headers: { Location: location, 'Cache-Control': 'no-store', ...headers } });
}

function nowIso() {
  return new Date().toISOString();
}

function addSeconds(date, seconds) {
  return new Date(date.getTime() + seconds * 1000);
}

function randomToken(bytes = 32) {
  const data = new Uint8Array(bytes);
  crypto.getRandomValues(data);
  return [...data].map((value) => value.toString(16).padStart(2, '0')).join('');
}

async function sha256(value) {
  const data = typeof value === 'string' ? encoder.encode(value) : value;
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function getNumber(env, key, fallback) {
  const parsed = Number.parseInt(String(env[key] || ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function clientIp(request) {
  return request.headers.get('CF-Connecting-IP') || 'unknown';
}

async function hashedIp(request, env) {
  return sha256(`${env.SESSION_SECRET || 'missing'}:${clientIp(request)}`);
}

function userAgent(request) {
  return (request.headers.get('User-Agent') || '').slice(0, 500);
}

function validateSameOrigin(request) {
  const origin = request.headers.get('Origin');
  if (!origin) return false;
  return origin === new URL(request.url).origin;
}

function clearCookie(name, httpOnly = false) {
  return serializeCookie(name, '', {
    httpOnly,
    maxAge: 0,
    expires: new Date(0),
  });
}

function appendCookie(headers, value) {
  headers.append('Set-Cookie', value);
}

function securityHeaders(response, { login = false, html = false } = {}) {
  const headers = new Headers(response.headers);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  headers.set('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  headers.set('X-Frame-Options', 'DENY');
  if (html) headers.set('Cache-Control', 'no-store, private');
  if (login) {
    headers.set(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self' https://accounts.google.com/gsi/client; style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style; img-src 'self' data: https://*.googleusercontent.com; frame-src https://accounts.google.com; connect-src 'self' https://accounts.google.com; base-uri 'none'; form-action 'self'; frame-ancestors 'none';",
    );
  } else {
    headers.set('Content-Security-Policy', "frame-ancestors 'none'; base-uri 'self'; object-src 'none'");
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function requireDatabase(env) {
  if (!env.DB) {
    throw new Error('AUTH_DATABASE_NOT_CONFIGURED');
  }
  return env.DB;
}

async function audit(env, request, event, details = {}, userId = null) {
  if (!env.DB) return;
  try {
    await env.DB.prepare(
      `INSERT INTO auth_audit (id, user_id, event, details_json, ip_hash, user_agent, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        crypto.randomUUID(),
        userId,
        event,
        JSON.stringify(details).slice(0, 8000),
        await hashedIp(request, env),
        userAgent(request),
        nowIso(),
      )
      .run();
  } catch (error) {
    console.error('Falha ao registrar auditoria', error);
  }
}

async function enforceLoginRateLimit(env, request) {
  const ipHash = await hashedIp(request, env);
  const threshold = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const result = await env.DB.prepare(
    `SELECT COUNT(*) AS attempts
     FROM auth_audit
     WHERE ip_hash = ? AND event IN ('login_failed', 'login_denied') AND created_at >= ?`
  )
    .bind(ipHash, threshold)
    .first();
  if (Number(result?.attempts || 0) >= 20) {
    throw new Error('AUTH_RATE_LIMITED');
  }
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
  jwksCache = { keys: Array.isArray(body.keys) ? body.keys : [], expiresAt: current + ttl };
  return jwksCache.keys;
}

async function verifyGoogleIdToken(idToken, env, expectedNonce) {
  if (!idToken || typeof idToken !== 'string') throw new Error('GOOGLE_TOKEN_MISSING');
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new Error('GOOGLE_TOKEN_MALFORMED');

  const header = decodeJwtSection(parts[0]);
  const payload = decodeJwtSection(parts[1]);
  if (header.alg !== 'RS256' || !header.kid) throw new Error('GOOGLE_TOKEN_ALGORITHM');

  const key = (await getGoogleJwks()).find((candidate) => candidate.kid === header.kid);
  if (!key) {
    jwksCache = { expiresAt: 0, keys: [] };
    const refreshed = (await getGoogleJwks()).find((candidate) => candidate.kid === header.kid);
    if (!refreshed) throw new Error('GOOGLE_KEY_NOT_FOUND');
    return verifyGoogleIdTokenWithKey(parts, payload, refreshed, env, expectedNonce);
  }
  return verifyGoogleIdTokenWithKey(parts, payload, key, env, expectedNonce);
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
  if (!['accounts.google.com', 'https://accounts.google.com'].includes(payload.iss)) {
    throw new Error('GOOGLE_TOKEN_ISSUER');
  }
  if (!Number.isFinite(payload.exp) || payload.exp <= now) throw new Error('GOOGLE_TOKEN_EXPIRED');
  if (payload.iat && payload.iat > now + 120) throw new Error('GOOGLE_TOKEN_ISSUED_IN_FUTURE');
  if (!expectedNonce || payload.nonce !== expectedNonce) throw new Error('GOOGLE_TOKEN_NONCE');
  if (!payload.sub || !payload.email) throw new Error('GOOGLE_TOKEN_PROFILE');

  const explicit = [...splitCsv(env.BOOTSTRAP_ADMIN_EMAILS), ...splitCsv(env.ALLOWED_GOOGLE_EMAILS)];
  if (!isGoogleAuthoritativeAccount(payload, explicit)) throw new Error('GOOGLE_ACCOUNT_NOT_AUTHORITATIVE');
  if (!isDomainAllowed(payload, splitCsv(env.ALLOWED_GOOGLE_DOMAINS))) throw new Error('GOOGLE_DOMAIN_NOT_ALLOWED');
  return payload;
}

async function upsertUser(env, payload) {
  const id = crypto.randomUUID();
  const email = normalizeEmail(payload.email);
  await env.DB.prepare(
    `INSERT INTO users (id, google_sub, email, email_verified, name, picture_url, hosted_domain, status, created_at, updated_at, last_login_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
     ON CONFLICT(google_sub) DO UPDATE SET
       email = excluded.email,
       email_verified = excluded.email_verified,
       name = excluded.name,
       picture_url = excluded.picture_url,
       hosted_domain = excluded.hosted_domain,
       updated_at = excluded.updated_at,
       last_login_at = excluded.last_login_at`
  )
    .bind(
      id,
      payload.sub,
      email,
      payload.email_verified ? 1 : 0,
      String(payload.name || email).slice(0, 200),
      String(payload.picture || '').slice(0, 1000),
      String(payload.hd || '').slice(0, 255) || null,
      nowIso(),
      nowIso(),
      nowIso(),
    )
    .run();
  return env.DB.prepare('SELECT * FROM users WHERE google_sub = ?').bind(payload.sub).first();
}

async function ensureDefaultCompany(env) {
  const companyId = String(env.DEFAULT_COMPANY_ID || 'climaflux-default').slice(0, 100);
  const companyName = String(env.DEFAULT_COMPANY_NAME || 'ClimaFlux').slice(0, 200);
  const companyKey = String(env.DEFAULT_APP_COMPANY_KEY || '').slice(0, 100) || null;
  await env.DB.prepare(
    `INSERT INTO companies (id, name, slug, app_company_key, status, created_at, updated_at)
     VALUES (?, ?, 'default', ?, 'active', ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, app_company_key = COALESCE(excluded.app_company_key, companies.app_company_key), updated_at = excluded.updated_at`
  )
    .bind(companyId, companyName, companyKey, nowIso(), nowIso())
    .run();
  return companyId;
}

async function provisionMembershipIfAllowed(env, user, payload) {
  const existing = await env.DB.prepare(
    `SELECT m.*, c.name AS company_name, c.slug AS company_slug, c.app_company_key
     FROM memberships m JOIN companies c ON c.id = m.company_id
     WHERE m.user_id = ? AND m.status = 'active' AND c.status = 'active'
     ORDER BY m.created_at ASC`
  )
    .bind(user.id)
    .all();
  if (existing.results?.length) return existing.results;

  const email = normalizeEmail(user.email);
  const bootstrapEmails = splitCsv(env.BOOTSTRAP_ADMIN_EMAILS);
  const autoRole = String(env.AUTO_PROVISION_ROLE || '').toLowerCase();
  const hostedDomain = String(payload.hd || '').toLowerCase();
  const domainAllowed = splitCsv(env.ALLOWED_GOOGLE_DOMAINS).includes(hostedDomain);
  let role = null;
  if (bootstrapEmails.includes(email)) role = 'admin';
  else if (isRole(autoRole) && domainAllowed) role = autoRole;
  if (!role) return [];

  const companyId = await ensureDefaultCompany(env);
  await env.DB.prepare(
    `INSERT INTO memberships (id, user_id, company_id, role, status, app_user_key, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'active', ?, ?, ?)
     ON CONFLICT(user_id, company_id) DO UPDATE SET role = excluded.role, status = 'active', updated_at = excluded.updated_at`
  )
    .bind(
      crypto.randomUUID(),
      user.id,
      companyId,
      role,
      String(env.BOOTSTRAP_APP_USER_KEY || '').slice(0, 100) || null,
      nowIso(),
      nowIso(),
    )
    .run();
  return provisionMembershipIfAllowed(env, user, payload);
}

async function listMemberships(env, userId) {
  const result = await env.DB.prepare(
    `SELECT m.id, m.company_id, m.role, m.status, m.app_user_key,
            c.name AS company_name, c.slug AS company_slug, c.app_company_key
     FROM memberships m JOIN companies c ON c.id = m.company_id
     WHERE m.user_id = ? AND m.status = 'active' AND c.status = 'active'
     ORDER BY c.name ASC`
  )
    .bind(userId)
    .all();
  return result.results || [];
}

async function createSession(env, request, user, memberships) {
  await env.DB.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(nowIso()).run();
  const token = randomToken(32);
  const csrf = randomToken(24);
  const sessionId = crypto.randomUUID();
  const createdAt = new Date();
  const expiresAt = addSeconds(createdAt, getNumber(env, 'SESSION_TTL_SECONDS', 8 * 60 * 60));
  const activeCompanyId = memberships[0].company_id;
  await env.DB.prepare(
    `INSERT INTO sessions (id, user_id, token_hash, csrf_hash, active_company_id, expires_at, last_seen_at, ip_hash, user_agent, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      sessionId,
      user.id,
      await sha256(token),
      await sha256(csrf),
      activeCompanyId,
      expiresAt.toISOString(),
      createdAt.toISOString(),
      await hashedIp(request, env),
      userAgent(request),
      createdAt.toISOString(),
    )
    .run();
  return { token, csrf, expiresAt, sessionId, activeCompanyId };
}

async function getSession(env, request) {
  if (!env.DB) return null;
  const token = parseCookies(request.headers.get('Cookie') || '')[SESSION_COOKIE];
  if (!token) return null;
  const tokenHash = await sha256(token);
  const session = await env.DB.prepare(
    `SELECT s.*, u.email, u.name, u.picture_url, u.status AS user_status
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ?`
  )
    .bind(tokenHash)
    .first();
  if (!session || session.user_status !== 'active') return null;

  const now = Date.now();
  const expiresAt = Date.parse(session.expires_at);
  const lastSeenAt = Date.parse(session.last_seen_at);
  const idleMs = getNumber(env, 'SESSION_IDLE_SECONDS', 2 * 60 * 60) * 1000;
  if (!Number.isFinite(expiresAt) || expiresAt <= now || !Number.isFinite(lastSeenAt) || lastSeenAt + idleMs <= now) {
    await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(session.id).run();
    return null;
  }

  const memberships = await listMemberships(env, session.user_id);
  const activeMembership = memberships.find((item) => item.company_id === session.active_company_id) || memberships[0];
  if (!activeMembership) return null;
  if (activeMembership.company_id !== session.active_company_id) {
    await env.DB.prepare('UPDATE sessions SET active_company_id = ? WHERE id = ?')
      .bind(activeMembership.company_id, session.id)
      .run();
  }
  if (now - lastSeenAt > 5 * 60 * 1000) {
    await env.DB.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').bind(nowIso(), session.id).run();
  }
  return { ...session, memberships, activeMembership };
}

async function requireSession(env, request) {
  const session = await getSession(env, request);
  if (!session) throw new Error('AUTH_REQUIRED');
  return session;
}

async function verifyCsrf(request, session) {
  if (!validateSameOrigin(request)) throw new Error('AUTH_ORIGIN');
  const token = request.headers.get('X-CSRF-Token') || '';
  if (!token || !constantTimeEqual(await sha256(token), session.csrf_hash)) throw new Error('AUTH_CSRF');
}

function publicSession(session) {
  return {
    user: {
      id: session.user_id,
      email: session.email,
      name: session.name,
      picture: session.picture_url,
    },
    activeCompany: session.activeMembership,
    memberships: session.memberships,
    csrfToken: session.csrf_token,
  };
}

async function handleConfig(request, env) {
  requireDatabase(env);
  if (!env.GOOGLE_CLIENT_ID || !env.SESSION_SECRET) throw new Error('AUTH_SECRETS_NOT_CONFIGURED');
  const nonce = randomToken(24);
  const csrf = randomToken(24);
  const headers = new Headers();
  appendCookie(headers, serializeCookie(LOGIN_NONCE_COOKIE, nonce, { httpOnly: true, maxAge: 10 * 60 }));
  appendCookie(headers, serializeCookie(CSRF_COOKIE, csrf, { httpOnly: false, maxAge: 10 * 60, sameSite: 'Strict' }));
  return json({ clientId: env.GOOGLE_CLIENT_ID, nonce, csrf }, 200, headers);
}

async function handleGoogleLogin(request, env) {
  requireDatabase(env);
  if (!validateSameOrigin(request)) throw new Error('AUTH_ORIGIN');
  await enforceLoginRateLimit(env, request);
  const body = await request.json().catch(() => ({}));
  const cookies = parseCookies(request.headers.get('Cookie') || '');
  const csrfCookie = cookies[CSRF_COOKIE] || '';
  const csrfBody = String(body.csrf || '');
  const csrfHeader = request.headers.get('X-CSRF-Token') || '';
  if (!csrfCookie || !constantTimeEqual(csrfCookie, csrfBody) || !constantTimeEqual(csrfCookie, csrfHeader)) {
    throw new Error('AUTH_CSRF');
  }

  const payload = await verifyGoogleIdToken(String(body.credential || ''), env, cookies[LOGIN_NONCE_COOKIE]);
  const user = await upsertUser(env, payload);
  if (!user || user.status !== 'active') throw new Error('AUTH_USER_SUSPENDED');
  let memberships = await listMemberships(env, user.id);
  if (!memberships.length) memberships = await provisionMembershipIfAllowed(env, user, payload);
  if (!memberships.length) {
    await audit(env, request, 'login_denied', { reason: 'pending_membership', email: user.email }, user.id);
    return json({ ok: false, code: 'ACCESS_PENDING', message: 'Conta autenticada. O acesso ao ERP ainda precisa ser aprovado por um administrador.' }, 403);
  }

  const session = await createSession(env, request, user, memberships);
  await audit(env, request, 'login_success', { companyId: session.activeCompanyId }, user.id);
  const headers = new Headers();
  appendCookie(
    headers,
    serializeCookie(SESSION_COOKIE, session.token, {
      httpOnly: true,
      maxAge: getNumber(env, 'SESSION_TTL_SECONDS', 8 * 60 * 60),
      sameSite: 'Lax',
    }),
  );
  appendCookie(headers, clearCookie(LOGIN_NONCE_COOKIE, true));
  appendCookie(headers, clearCookie(CSRF_COOKIE, false));
  return json({ ok: true, returnTo: safeReturnTo(body.returnTo) }, 200, headers);
}

async function handleMe(request, env) {
  const session = await requireSession(env, request);
  const csrf = randomToken(24);
  await env.DB.prepare('UPDATE sessions SET csrf_hash = ? WHERE id = ?').bind(await sha256(csrf), session.id).run();
  session.csrf_token = csrf;
  return json(publicSession(session));
}

async function handleLogout(request, env) {
  const session = await requireSession(env, request);
  await verifyCsrf(request, session);
  await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(session.id).run();
  await audit(env, request, 'logout', { companyId: session.activeMembership.company_id }, session.user_id);
  const headers = new Headers();
  appendCookie(headers, clearCookie(SESSION_COOKIE, true));
  return json({ ok: true }, 200, headers);
}

async function handleCompanySwitch(request, env) {
  const session = await requireSession(env, request);
  await verifyCsrf(request, session);
  const body = await request.json().catch(() => ({}));
  const companyId = String(body.companyId || '');
  const membership = session.memberships.find((item) => item.company_id === companyId);
  if (!membership) throw new Error('AUTH_COMPANY_FORBIDDEN');
  await env.DB.prepare('UPDATE sessions SET active_company_id = ?, last_seen_at = ? WHERE id = ?')
    .bind(companyId, nowIso(), session.id)
    .run();
  await audit(env, request, 'company_switch', { companyId }, session.user_id);
  return json({ ok: true, activeCompany: membership });
}

function requireAdmin(session) {
  if (session.activeMembership.role !== 'admin') throw new Error('AUTH_FORBIDDEN');
}

async function handleAdminUsers(request, env) {
  const session = await requireSession(env, request);
  requireAdmin(session);
  const users = await env.DB.prepare(
    `SELECT u.id, u.email, u.name, u.picture_url, u.status, u.last_login_at, u.created_at,
            m.id AS membership_id, m.company_id, m.role, m.status AS membership_status, m.app_user_key,
            c.name AS company_name, c.app_company_key
     FROM users u
     LEFT JOIN memberships m ON m.user_id = u.id
     LEFT JOIN companies c ON c.id = m.company_id
     ORDER BY u.created_at DESC, c.name ASC`
  ).all();
  const companies = await env.DB.prepare(
    `SELECT id, name, slug, app_company_key, status FROM companies ORDER BY name ASC`
  ).all();
  return json({ users: users.results || [], companies: companies.results || [] });
}

async function handleAdminMembership(request, env) {
  const session = await requireSession(env, request);
  requireAdmin(session);
  await verifyCsrf(request, session);
  const body = await request.json().catch(() => ({}));
  const userId = String(body.userId || '');
  const companyId = String(body.companyId || '');
  const role = String(body.role || '').toLowerCase();
  const status = String(body.status || '').toLowerCase();
  const appUserKey = String(body.appUserKey || '').slice(0, 100) || null;
  if (!userId || !companyId || !isRole(role) || !isMembershipStatus(status)) throw new Error('AUTH_VALIDATION');
  const targetUser = await env.DB.prepare('SELECT id, email FROM users WHERE id = ?').bind(userId).first();
  const company = await env.DB.prepare('SELECT id, name FROM companies WHERE id = ?').bind(companyId).first();
  if (!targetUser || !company) throw new Error('AUTH_NOT_FOUND');

  await env.DB.prepare(
    `INSERT INTO memberships (id, user_id, company_id, role, status, app_user_key, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, company_id) DO UPDATE SET role = excluded.role, status = excluded.status, app_user_key = excluded.app_user_key, updated_at = excluded.updated_at`
  )
    .bind(crypto.randomUUID(), userId, companyId, role, status, appUserKey, nowIso(), nowIso())
    .run();
  await audit(env, request, 'membership_updated', { targetUserId: userId, companyId, role, status }, session.user_id);
  return json({ ok: true });
}

async function serveAsset(request, env, { login = false, html = false } = {}) {
  const response = await env.ASSETS.fetch(request);
  return securityHeaders(response, { login, html });
}

function errorResponse(error) {
  const code = error instanceof Error ? error.message : 'UNKNOWN';
  const mapping = {
    AUTH_REQUIRED: [401, 'Sessão expirada ou inexistente.'],
    AUTH_FORBIDDEN: [403, 'Você não possui permissão para esta ação.'],
    AUTH_COMPANY_FORBIDDEN: [403, 'Você não possui acesso a esta empresa.'],
    AUTH_CSRF: [403, 'A validação de segurança da solicitação falhou.'],
    AUTH_ORIGIN: [403, 'Origem da solicitação não autorizada.'],
    AUTH_RATE_LIMITED: [429, 'Muitas tentativas. Aguarde alguns minutos.'],
    AUTH_USER_SUSPENDED: [403, 'Sua conta está suspensa.'],
    AUTH_VALIDATION: [400, 'Dados inválidos.'],
    AUTH_NOT_FOUND: [404, 'Registro não encontrado.'],
    AUTH_DATABASE_NOT_CONFIGURED: [503, 'O banco de autenticação ainda não foi configurado.'],
    AUTH_SECRETS_NOT_CONFIGURED: [503, 'As credenciais de autenticação ainda não foram configuradas.'],
    GOOGLE_DOMAIN_NOT_ALLOWED: [403, 'Esta conta Google não pertence a um domínio autorizado.'],
    GOOGLE_ACCOUNT_NOT_AUTHORITATIVE: [403, 'Esta conta precisa ser autorizada explicitamente pelo administrador.'],
  };
  const [status, message] = mapping[code] || [401, 'Não foi possível autenticar a conta Google.'];
  return json({ ok: false, code, message }, status);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    try {
      if (path === '/api/auth/config' && request.method === 'GET') return handleConfig(request, env);
      if (path === '/api/auth/google' && request.method === 'POST') return handleGoogleLogin(request, env);
      if (path === '/api/auth/me' && request.method === 'GET') return handleMe(request, env);
      if (path === '/api/auth/logout' && request.method === 'POST') return handleLogout(request, env);
      if (path === '/api/auth/company' && request.method === 'POST') return handleCompanySwitch(request, env);
      if (path === '/api/admin/users' && request.method === 'GET') return handleAdminUsers(request, env);
      if (path === '/api/admin/membership' && request.method === 'POST') return handleAdminMembership(request, env);

      if (path === '/login.html') {
        const session = await getSession(env, request);
        if (session) return redirect(safeReturnTo(url.searchParams.get('returnTo')));
        return serveAsset(request, env, { login: true, html: true });
      }

      if (path === '/admin-access.html') {
        const session = await getSession(env, request);
        if (!session) return redirect(`/login.html?returnTo=${encodeURIComponent(path)}`);
        requireAdmin(session);
        return serveAsset(request, env, { html: true });
      }

      if (path === '/sw.js') {
        const session = await getSession(env, request);
        if (!session) return new Response('', { status: 401, headers: { 'Cache-Control': 'no-store' } });
        return serveAsset(request, env);
      }

      if (path.startsWith('/api/')) return json({ ok: false, message: 'Rota não encontrada.' }, 404);

      const session = await getSession(env, request);
      if (!session) {
        const returnTo = safeReturnTo(`${path}${url.search}${url.hash}`);
        return redirect(`/login.html?returnTo=${encodeURIComponent(returnTo)}`);
      }
      return serveAsset(request, env, { html: path === '/' || path.endsWith('.html') });
    } catch (error) {
      console.error(error);
      if (path === '/api/auth/google') {
        await audit(env, request, 'login_failed', { reason: error instanceof Error ? error.message : 'UNKNOWN' });
      }
      const response = errorResponse(error);
      if (path.endsWith('.html') || path === '/') {
        if (response.status === 401) return redirect(`/login.html?returnTo=${encodeURIComponent(safeReturnTo(path))}`);
      }
      return response;
    }
  },
};
