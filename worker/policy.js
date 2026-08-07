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
    'work_orders.status',
    'work_orders.delete',
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
    'work_orders.status',
  ]),
  tecnico: Object.freeze([
    'tenant.read',
    'customers.read',
    'equipment.read',
    'work_orders.read',
    'work_orders.status',
  ]),
  estoque: Object.freeze([
    'tenant.read',
    'customers.read',
    'equipment.read',
    'work_orders.read',
  ]),
  financeiro: Object.freeze([
    'tenant.read',
    'customers.read',
    'equipment.read',
    'work_orders.read',
  ]),
});

export const PUBLIC_ASSET_PATHS = Object.freeze(new Set([
  '/login.html',
  '/login.js',
  '/auth.css',
  '/icon.svg',
  '/manifest.webmanifest',
]));

export const EQUIPMENT_STATUSES = Object.freeze(['active', 'inactive', 'retired']);
export const WORK_ORDER_PRIORITIES = Object.freeze(['low', 'normal', 'high', 'urgent']);
export const WORK_ORDER_STATUSES = Object.freeze([
  'open',
  'scheduled',
  'in_progress',
  'paused',
  'completed',
  'cancelled',
]);

const WORK_ORDER_TRANSITIONS = Object.freeze({
  open: Object.freeze(['scheduled', 'in_progress', 'cancelled']),
  scheduled: Object.freeze(['open', 'in_progress', 'cancelled']),
  in_progress: Object.freeze(['paused', 'completed', 'cancelled']),
  paused: Object.freeze(['in_progress', 'completed', 'cancelled']),
  completed: Object.freeze([]),
  cancelled: Object.freeze([]),
});

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

function cleanId(value, required = false) {
  const id = cleanText(value, 100);
  if (required && !id) throw new Error('API_VALIDATION');
  return id;
}

function cleanDateTime(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Date.parse(String(value));
  if (!Number.isFinite(parsed)) throw new Error('WORK_ORDER_DATE_INVALID');
  return new Date(parsed).toISOString();
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

export function normalizeEquipmentInput(input, { partial = false } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('API_VALIDATION');
  const output = {};
  const has = (key) => Object.prototype.hasOwnProperty.call(input, key);

  if (!partial || has('customerId')) {
    const customerId = cleanId(input.customerId, !partial);
    if (!customerId && !partial) throw new Error('EQUIPMENT_CUSTOMER_REQUIRED');
    output.customerId = customerId;
  }
  if (!partial || has('category')) {
    const category = cleanText(input.category, 120, { nullable: false });
    if (!category || category.length < 2) throw new Error('EQUIPMENT_CATEGORY_REQUIRED');
    output.category = category;
  }
  if (!partial || has('brand')) output.brand = cleanText(input.brand, 120);
  if (!partial || has('model')) output.model = cleanText(input.model, 160);
  if (!partial || has('serialNumber')) output.serialNumber = cleanText(input.serialNumber, 160);
  if (!partial || has('assetTag')) output.assetTag = cleanText(input.assetTag, 120);
  if (!partial || has('location')) output.location = cleanText(input.location, 240);
  if (!partial || has('notes')) output.notes = cleanText(input.notes, 2000);
  if (!partial || has('status')) {
    const status = String(input.status || 'active').toLowerCase();
    if (!EQUIPMENT_STATUSES.includes(status)) throw new Error('EQUIPMENT_STATUS_INVALID');
    output.status = status;
  }
  if (partial && !Object.keys(output).length) throw new Error('API_VALIDATION');
  return output;
}

export function normalizeWorkOrderInput(input, { partial = false } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('API_VALIDATION');
  const output = {};
  const has = (key) => Object.prototype.hasOwnProperty.call(input, key);

  if (!partial || has('customerId')) {
    const customerId = cleanId(input.customerId, !partial);
    if (!customerId && !partial) throw new Error('WORK_ORDER_CUSTOMER_REQUIRED');
    output.customerId = customerId;
  }
  if (!partial || has('equipmentId')) output.equipmentId = cleanId(input.equipmentId);
  if (!partial || has('assignedUserId')) output.assignedUserId = cleanId(input.assignedUserId);
  if (!partial || has('summary')) {
    const summary = cleanText(input.summary, 240, { nullable: false });
    if (!summary || summary.length < 3) throw new Error('WORK_ORDER_SUMMARY_REQUIRED');
    output.summary = summary;
  }
  if (!partial || has('description')) output.description = cleanText(input.description, 8000);
  if (!partial || has('priority')) {
    const priority = String(input.priority || 'normal').toLowerCase();
    if (!WORK_ORDER_PRIORITIES.includes(priority)) throw new Error('WORK_ORDER_PRIORITY_INVALID');
    output.priority = priority;
  }
  if (!partial || has('scheduledStart')) output.scheduledStart = cleanDateTime(input.scheduledStart);
  if (!partial || has('scheduledEnd')) output.scheduledEnd = cleanDateTime(input.scheduledEnd);
  if (!partial || has('slaDueAt')) output.slaDueAt = cleanDateTime(input.slaDueAt);
  if (has('status')) throw new Error('WORK_ORDER_STATUS_SEPARATE');
  if (partial && !Object.keys(output).length) throw new Error('API_VALIDATION');
  return output;
}

export function normalizeWorkOrderTransition(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('API_VALIDATION');
  const status = String(input.status || '').toLowerCase();
  if (!WORK_ORDER_STATUSES.includes(status)) throw new Error('WORK_ORDER_STATUS_INVALID');
  return {
    status,
    note: cleanText(input.note, 2000),
  };
}

export function canTransitionWorkOrder(fromStatus, toStatus) {
  return (WORK_ORDER_TRANSITIONS[String(fromStatus || '')] || []).includes(String(toStatus || ''));
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

export function equipmentCodeFromId(id) {
  return `EQP-${String(id).replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}

export function workOrderNumberFromId(id, date = new Date()) {
  const day = date.toISOString().slice(0, 10).replace(/-/g, '');
  const suffix = String(id).replace(/-/g, '').slice(0, 6).toUpperCase();
  return `OS-${day}-${suffix}`;
}
