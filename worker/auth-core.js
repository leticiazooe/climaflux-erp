export const ROLES = Object.freeze([
  'admin',
  'atendimento',
  'tecnico',
  'estoque',
  'financeiro',
  'gestor',
]);

export const MEMBERSHIP_STATUSES = Object.freeze(['active', 'pending', 'suspended']);

export function parseCookies(header = '') {
  const cookies = {};
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const name = part.slice(0, index).trim();
    if (!name) continue;
    const value = part.slice(index + 1).trim();
    try {
      cookies[name] = decodeURIComponent(value);
    } catch {
      cookies[name] = value;
    }
  }
  return cookies;
}

export function serializeCookie(name, value, options = {}) {
  const segments = [`${name}=${encodeURIComponent(value)}`];
  if (options.maxAge !== undefined) segments.push(`Max-Age=${Math.max(0, Math.floor(options.maxAge))}`);
  if (options.expires) segments.push(`Expires=${options.expires.toUTCString()}`);
  segments.push(`Path=${options.path || '/'}`);
  if (options.domain) segments.push(`Domain=${options.domain}`);
  if (options.httpOnly) segments.push('HttpOnly');
  if (options.secure !== false) segments.push('Secure');
  segments.push(`SameSite=${options.sameSite || 'Lax'}`);
  return segments.join('; ');
}

export function splitCsv(value = '') {
  return String(value)
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

export function isRole(value) {
  return ROLES.includes(String(value || '').toLowerCase());
}

export function isMembershipStatus(value) {
  return MEMBERSHIP_STATUSES.includes(String(value || '').toLowerCase());
}

export function safeReturnTo(value, fallback = '/') {
  if (!value || typeof value !== 'string') return fallback;
  if (!value.startsWith('/') || value.startsWith('//')) return fallback;
  if (value.includes('\n') || value.includes('\r')) return fallback;
  return value;
}

export function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

export function isGoogleAuthoritativeAccount(payload, explicitlyAllowedEmails = []) {
  const email = normalizeEmail(payload?.email);
  if (!email || payload?.email_verified !== true) return false;
  if (explicitlyAllowedEmails.includes(email)) return true;
  if (email.endsWith('@gmail.com')) return true;
  return typeof payload?.hd === 'string' && payload.hd.length > 0;
}

export function isDomainAllowed(payload, allowedDomains = []) {
  if (!allowedDomains.length) return true;
  const hostedDomain = String(payload?.hd || '').toLowerCase();
  return Boolean(hostedDomain && allowedDomains.includes(hostedDomain));
}

export function base64UrlToBytes(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(normalized + padding);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function decodeJwtSection(value) {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(value)));
}

export function constantTimeEqual(left, right) {
  const a = new TextEncoder().encode(String(left || ''));
  const b = new TextEncoder().encode(String(right || ''));
  const length = Math.max(a.length, b.length);
  let difference = a.length ^ b.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (a[index] || 0) ^ (b[index] || 0);
  }
  return difference === 0;
}
