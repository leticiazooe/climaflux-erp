import { isMembershipStatus, isRole, normalizeEmail } from './auth-core.js';

export const ROLE_PERMISSIONS = Object.freeze({
  admin: Object.freeze(['*']),
  gestor: Object.freeze([
    'tenant.read',
    'members.read',
    'customers.read',
    'customers.write',
    'customers.delete',
    'equipment.read',
    'equipment.write',
    'equipment.delete',
    'work_orders.read',
    'work_orders.write',
    'work_orders.assign',
    'work_orders.transition',
    'work_orders.delete',
    'field_service.read',
    'field_service.write',
    'field_service.status',
    'field_service.record',
    'audit.read',
  ]),
  atendimento: Object.freeze([
    'tenant.read',
    'customers.read',
    'customers.write',
    'equipment.read',
    'equipment.write',
    'work_orders.read',
    'work_orders.write',
    'work_orders.assign',
    'work_orders.transition',
    'field_service.read',
    'field_service.write',
    'field_service.status',
  ]),
  tecnico: Object.freeze([
    'tenant.read',
    'customers.read',
    'equipment.read',
    'work_orders.read',
    'work_orders.transition',
    'field_service.read',
    'field_service.status',
    'field_service.record',
  ]),
  estoque: Object.freeze(['tenant.read', 'customers.read', 'equipment.read', 'work_orders.read']),
  financeiro: Object.freeze(['tenant.read', 'customers.read', 'equipment.read', 'work_orders.read']),
});

export const PUBLIC_ASSET_PATHS = Object.freeze(new Set([
  '/login.html',
  '/login.js',
  '/auth.css',
  '/icon.svg',
  '/manifest.webmanifest',
]));

export function can(role, permission) {
  const permissions = ROLE_PERMISSIONS[String(role || '').toLowerCase()] || [];
  return permissions.includes('*') || permissions.includes(permission);
}

export function assertPermission(role, permission) {
  if (!can(role, permission)) throw new Error('AUTH_FORBIDDEN');
}

export function isPublicAssetPath(pathname) {
  return PUBLIC_ASSET_PATHS.has(pathname);
}

export function normalizeSlug(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export function normalizePagination(searchParams) {
  const rawLimit = Number.parseInt(String(searchParams.get('limit') || '25'), 10);
  const rawOffset = Number.parseInt(String(searchParams.get('offset') || '0'), 10);
  return {
    limit: Number.isFinite(rawLimit) ? Math.min(100, Math.max(1, rawLimit)) : 25,
    offset: Number.isFinite(rawOffset) ? Math.max(0, rawOffset) : 0,
  };
}

function cleanText(value, maxLength, { nullable = true } = {}) {
  const text = String(value ?? '').trim();
  if (!text) return nullable ? null : '';
  return text.slice(0, maxLength);
}

export function normalizeCustomerInput(input, { partial = false } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('API_VALIDATION');
  const output = {};
  const has = (key) => Object.prototype.hasOwnProperty.call(input, key);

  if (!partial || has('name')) {
    const name = cleanText(input.name, 200, { nullable: false });
    if (!name || name.length < 2) throw new Error('CUSTOMER_NAME_REQUIRED');
    output.name = name;
  }
  if (!partial || has('kind')) {
    const kind = String(input.kind || 'company').toLowerCase();
    if (!['person', 'company'].includes(kind)) throw new Error('CUSTOMER_KIND_INVALID');
    output.kind = kind;
  }
  if (!partial || has('document')) output.document = cleanText(input.document, 40);
  if (!partial || has('email')) {
    const email = normalizeEmail(input.email);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('CUSTOMER_EMAIL_INVALID');
    output.email = email || null;
  }
  if (!partial || has('phone')) output.phone = cleanText(input.phone, 40);
  if (!partial || has('notes')) output.notes = cleanText(input.notes, 2000);
  if (!partial || has('status')) {
    const status = String(input.status || 'active').toLowerCase();
    if (!['active', 'inactive'].includes(status)) throw new Error('CUSTOMER_STATUS_INVALID');
    output.status = status;
  }
  if (partial && !Object.keys(output).length) throw new Error('API_VALIDATION');
  return output;
}

export function normalizeInviteInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('API_VALIDATION');
  const email = normalizeEmail(input.email);
  const role = String(input.role || 'atendimento').toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('INVITE_EMAIL_INVALID');
  if (!isRole(role)) throw new Error('AUTH_ROLE_INVALID');
  return { email, role };
}

export function normalizeMembershipInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('API_VALIDATION');
  const role = String(input.role || '').toLowerCase();
  const status = String(input.status || '').toLowerCase();
  if (!isRole(role)) throw new Error('AUTH_ROLE_INVALID');
  if (!isMembershipStatus(status)) throw new Error('AUTH_MEMBERSHIP_STATUS_INVALID');
  return { role, status, appUserKey: cleanText(input.appUserKey, 100) };
}

export function customerCodeFromId(id) {
  return `CLI-${String(id).replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}
