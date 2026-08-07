import { requireSession, recordAudit } from './auth.js';
import { json, nowIso, verifyCsrf } from './security.js';

const OPERATIONAL_ROLE_PERMISSIONS = Object.freeze({
  admin: Object.freeze(['*']),
  gestor: Object.freeze([
    'equipment.read',
    'equipment.write',
    'equipment.delete',
    'work_orders.read',
    'work_orders.write',
    'work_orders.assign',
    'work_orders.transition',
    'work_orders.delete',
  ]),
  atendimento: Object.freeze([
    'equipment.read',
    'equipment.write',
    'work_orders.read',
    'work_orders.write',
    'work_orders.assign',
    'work_orders.transition',
  ]),
  tecnico: Object.freeze([
    'equipment.read',
    'work_orders.read',
    'work_orders.transition',
  ]),
  estoque: Object.freeze(['equipment.read', 'work_orders.read']),
  financeiro: Object.freeze(['equipment.read', 'work_orders.read']),
});

const WORK_ORDER_STATUSES = Object.freeze([
  'draft',
  'open',
  'scheduled',
  'in_progress',
  'on_hold',
  'completed',
  'cancelled',
]);

const WORK_ORDER_PRIORITIES = Object.freeze(['low', 'normal', 'high', 'critical']);
const EQUIPMENT_STATUSES = Object.freeze(['active', 'inactive', 'retired']);

const STATUS_TRANSITIONS = Object.freeze({
  draft: Object.freeze(['open', 'cancelled']),
  open: Object.freeze(['scheduled', 'in_progress', 'cancelled']),
  scheduled: Object.freeze(['in_progress', 'on_hold', 'cancelled']),
  in_progress: Object.freeze(['on_hold', 'completed', 'cancelled']),
  on_hold: Object.freeze(['scheduled', 'in_progress', 'completed', 'cancelled']),
  completed: Object.freeze([]),
  cancelled: Object.freeze([]),
});

export function operationalPermissionsForRole(role) {
  return [...(OPERATIONAL_ROLE_PERMISSIONS[String(role || '').toLowerCase()] || [])];
}

export function canOperate(role, permission) {
  const permissions = OPERATIONAL_ROLE_PERMISSIONS[String(role || '').toLowerCase()] || [];
  return permissions.includes('*') || permissions.includes(permission);
}

function assertOperationalPermission(role, permission) {
  if (!canOperate(role, permission)) throw new Error('AUTH_FORBIDDEN');
}

function cleanText(value, maxLength, { nullable = true } = {}) {
  const text = String(value ?? '').trim();
  if (!text) return nullable ? null : '';
  return text.slice(0, maxLength);
}

function cleanInteger(value, { minimum = 0, maximum = Number.MAX_SAFE_INTEGER, nullable = true } = {}) {
  if (value === null || value === undefined || value === '') return nullable ? null : 0;
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) throw new Error('API_VALIDATION');
  return number;
}

function cleanIsoDate(value) {
  const text = cleanText(value, 64);
  if (!text) return null;
  const timestamp = Date.parse(text);
  if (!Number.isFinite(timestamp)) throw new Error('WORK_ORDER_DATE_INVALID');
  return new Date(timestamp).toISOString();
}

function normalizePagination(searchParams) {
  const rawLimit = Number.parseInt(String(searchParams.get('limit') || '25'), 10);
  const rawOffset = Number.parseInt(String(searchParams.get('offset') || '0'), 10);
  return {
    limit: Number.isFinite(rawLimit) ? Math.min(100, Math.max(1, rawLimit)) : 25,
    offset: Number.isFinite(rawOffset) ? Math.max(0, rawOffset) : 0,
  };
}

export function normalizeEquipmentInput(input, { partial = false } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('API_VALIDATION');
  const output = {};
  const has = (key) => Object.prototype.hasOwnProperty.call(input, key);

  if (!partial || has('customerId')) {
    const customerId = cleanText(input.customerId, 100, { nullable: false });
    if (!customerId) throw new Error('EQUIPMENT_CUSTOMER_REQUIRED');
    output.customerId = customerId;
  }
  if (!partial || has('category')) {
    const category = cleanText(input.category || 'air_conditioner', 80, { nullable: false });
    if (!category || category.length < 2) throw new Error('EQUIPMENT_CATEGORY_REQUIRED');
    output.category = category.toLowerCase();
  }
  if (!partial || has('brand')) output.brand = cleanText(input.brand, 120);
  if (!partial || has('model')) output.model = cleanText(input.model, 120);
  if (!partial || has('serialNumber')) output.serialNumber = cleanText(input.serialNumber, 120);
  if (!partial || has('assetTag')) output.assetTag = cleanText(input.assetTag, 120);
  if (!partial || has('capacityBtu')) output.capacityBtu = cleanInteger(input.capacityBtu, { minimum: 0, maximum: 10000000 });
  if (!partial || has('refrigerant')) output.refrigerant = cleanText(input.refrigerant, 80);
  if (!partial || has('location')) output.location = cleanText(input.location, 240);
  if (!partial || has('notes')) output.notes = cleanText(input.notes, 3000);
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
    const customerId = cleanText(input.customerId, 100, { nullable: false });
    if (!customerId) throw new Error('WORK_ORDER_CUSTOMER_REQUIRED');
    output.customerId = customerId;
  }
  if (!partial || has('equipmentId')) output.equipmentId = cleanText(input.equipmentId, 100);
  if (!partial || has('technicianUserId')) output.technicianUserId = cleanText(input.technicianUserId, 100);
  if (!partial || has('serviceType')) {
    const serviceType = cleanText(input.serviceType, 120, { nullable: false });
    if (!serviceType || serviceType.length < 2) throw new Error('WORK_ORDER_SERVICE_TYPE_REQUIRED');
    output.serviceType = serviceType;
  }
  if (!partial || has('title')) {
    const title = cleanText(input.title, 200, { nullable: false });
    if (!title || title.length < 3) throw new Error('WORK_ORDER_TITLE_REQUIRED');
    output.title = title;
  }
  if (!partial || has('description')) output.description = cleanText(input.description, 5000);
  if (!partial || has('priority')) {
    const priority = String(input.priority || 'normal').toLowerCase();
    if (!WORK_ORDER_PRIORITIES.includes(priority)) throw new Error('WORK_ORDER_PRIORITY_INVALID');
    output.priority = priority;
  }
  if (has('status')) throw new Error('WORK_ORDER_STATUS_ENDPOINT_REQUIRED');
  if (!partial || has('scheduledStart')) output.scheduledStart = cleanIsoDate(input.scheduledStart);
  if (!partial || has('scheduledEnd')) output.scheduledEnd = cleanIsoDate(input.scheduledEnd);
  if (!partial || has('slaDueAt')) output.slaDueAt = cleanIsoDate(input.slaDueAt);
  if (!partial || has('resolution')) output.resolution = cleanText(input.resolution, 5000);
  if (!partial || has('notes')) output.notes = cleanText(input.notes, 5000);

  const scheduledStart = output.scheduledStart;
  const scheduledEnd = output.scheduledEnd;
  if (scheduledStart && scheduledEnd && Date.parse(scheduledEnd) < Date.parse(scheduledStart)) {
    throw new Error('WORK_ORDER_SCHEDULE_INVALID');
  }
  if (partial && !Object.keys(output).length) throw new Error('API_VALIDATION');
  return output;
}

export function normalizeStatusTransition(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('API_VALIDATION');
  const status = String(input.status || '').toLowerCase();
  if (!WORK_ORDER_STATUSES.includes(status)) throw new Error('WORK_ORDER_STATUS_INVALID');
  return {
    status,
    note: cleanText(input.note, 2000),
    resolution: cleanText(input.resolution, 5000),
  };
}

export function canTransitionWorkOrder(fromStatus, toStatus) {
  return (STATUS_TRANSITIONS[fromStatus] || []).includes(toStatus);
}

export function equipmentCodeFromId(id) {
  return `EQP-${String(id).replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}

export function workOrderCodeFromId(id, date = new Date()) {
  return `OS-${date.getUTCFullYear()}-${String(id).replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}

function equipmentPathId(pathname) {
  const match = pathname.match(/^\/api\/v1\/equipment\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : null;
}

function workOrderPath(pathname) {
  let match = pathname.match(/^\/api\/v1\/work-orders\/([^/]+)$/);
  if (match) return { id: decodeURIComponent(match[1]), action: null };
  match = pathname.match(/^\/api\/v1\/work-orders\/([^/]+)\/(history|status)$/);
  return match ? { id: decodeURIComponent(match[1]), action: match[2] } : null;
}

async function ensureCustomer(env, tenantId, customerId) {
  const customer = await env.DB.prepare(
    `SELECT id, code, name, status FROM customers
     WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL`
  ).bind(customerId, tenantId).first();
  if (!customer) throw new Error('CUSTOMER_NOT_FOUND');
  return customer;
}

async function ensureEquipment(env, tenantId, equipmentId, customerId = null) {
  if (!equipmentId) return null;
  const equipment = await env.DB.prepare(
    `SELECT id, customer_id, code, category, brand, model, status
     FROM equipment WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL`
  ).bind(equipmentId, tenantId).first();
  if (!equipment) throw new Error('EQUIPMENT_NOT_FOUND');
  if (customerId && equipment.customer_id !== customerId) throw new Error('WORK_ORDER_EQUIPMENT_CUSTOMER_MISMATCH');
  return equipment;
}

async function ensureTechnician(env, tenantId, userId) {
  if (!userId) return null;
  const member = await env.DB.prepare(
    `SELECT m.user_id, m.role, m.status, u.name, u.email
     FROM memberships m JOIN users u ON u.id = m.user_id
     WHERE m.tenant_id = ? AND m.user_id = ? AND m.role = 'tecnico' AND m.status = 'active' AND u.status = 'active'`
  ).bind(tenantId, userId).first();
  if (!member) throw new Error('WORK_ORDER_TECHNICIAN_INVALID');
  return member;
}

async function readIdempotentResponse(env, session, request) {
  const key = cleanText(request.headers.get('Idempotency-Key'), 128);
  if (!key) return { key: null, response: null };
  const row = await env.DB.prepare(
    `SELECT response_status, response_json FROM idempotency_keys
     WHERE tenant_id = ? AND idempotency_key = ? AND method = ? AND path = ? AND expires_at > ?`
  ).bind(
    session.activeMembership.tenant_id,
    key,
    request.method,
    new URL(request.url).pathname,
    nowIso(),
  ).first();
  return {
    key,
    response: row ? json(JSON.parse(row.response_json), Number(row.response_status)) : null,
  };
}

async function storeIdempotentResponse(env, session, request, key, status, body) {
  if (!key) return;
  const current = new Date();
  await env.DB.prepare(
    `INSERT OR REPLACE INTO idempotency_keys
      (id, tenant_id, idempotency_key, method, path, response_status, response_json, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    crypto.randomUUID(),
    session.activeMembership.tenant_id,
    key,
    request.method,
    new URL(request.url).pathname,
    status,
    JSON.stringify(body),
    current.toISOString(),
    new Date(current.getTime() + 24 * 60 * 60 * 1000).toISOString(),
  ).run();
}

async function appendWorkOrderEvent(env, session, workOrderId, eventType, details = {}) {
  await env.DB.prepare(
    `INSERT INTO work_order_events
      (id, tenant_id, work_order_id, actor_user_id, event_type, from_status, to_status, note, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    crypto.randomUUID(),
    session.activeMembership.tenant_id,
    workOrderId,
    session.user_id,
    eventType,
    details.fromStatus || null,
    details.toStatus || null,
    cleanText(details.note, 2000),
    JSON.stringify(details.metadata || {}).slice(0, 8000),
    nowIso(),
  ).run();
}

async function handleEquipmentList(request, env) {
  const session = await requireSession(env, request);
  assertOperationalPermission(session.activeMembership.role, 'equipment.read');
  const url = new URL(request.url);
  const { limit, offset } = normalizePagination(url.searchParams);
  const search = cleanText(url.searchParams.get('search'), 120);
  const customerId = cleanText(url.searchParams.get('customerId'), 100);
  const status = String(url.searchParams.get('status') || '').toLowerCase();
  if (status && !EQUIPMENT_STATUSES.includes(status)) throw new Error('EQUIPMENT_STATUS_INVALID');

  const where = ['e.tenant_id = ?', 'e.deleted_at IS NULL', 'c.deleted_at IS NULL'];
  const values = [session.activeMembership.tenant_id];
  if (customerId) { where.push('e.customer_id = ?'); values.push(customerId); }
  if (status) { where.push('e.status = ?'); values.push(status); }
  if (search) {
    where.push('(e.code LIKE ? OR e.brand LIKE ? OR e.model LIKE ? OR e.serial_number LIKE ? OR e.asset_tag LIKE ? OR c.name LIKE ?)');
    const pattern = `%${search}%`;
    values.push(pattern, pattern, pattern, pattern, pattern, pattern);
  }

  const count = await env.DB.prepare(
    `SELECT COUNT(*) AS total FROM equipment e JOIN customers c ON c.id = e.customer_id AND c.tenant_id = e.tenant_id
     WHERE ${where.join(' AND ')}`
  ).bind(...values).first();
  const rows = await env.DB.prepare(
    `SELECT e.id, e.customer_id, e.code, e.category, e.brand, e.model, e.serial_number, e.asset_tag,
            e.capacity_btu, e.refrigerant, e.location, e.status, e.notes, e.created_at, e.updated_at,
            c.code AS customer_code, c.name AS customer_name
     FROM equipment e JOIN customers c ON c.id = e.customer_id AND c.tenant_id = e.tenant_id
     WHERE ${where.join(' AND ')}
     ORDER BY e.updated_at DESC, e.code ASC LIMIT ? OFFSET ?`
  ).bind(...values, limit, offset).all();
  return json({ items: rows.results || [], page: { limit, offset, total: Number(count?.total || 0) } });
}

async function handleEquipmentCreate(request, env) {
  const session = await requireSession(env, request);
  assertOperationalPermission(session.activeMembership.role, 'equipment.write');
  await verifyCsrf(request, session);
  const idempotent = await readIdempotentResponse(env, session, request);
  if (idempotent.response) return idempotent.response;
  const input = normalizeEquipmentInput(await request.json().catch(() => ({})));
  await ensureCustomer(env, session.activeMembership.tenant_id, input.customerId);
  const id = crypto.randomUUID();
  const code = equipmentCodeFromId(id);
  const current = nowIso();
  await env.DB.prepare(
    `INSERT INTO equipment
      (id, tenant_id, customer_id, code, category, brand, model, serial_number, asset_tag, capacity_btu,
       refrigerant, location, status, notes, created_by, updated_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id, session.activeMembership.tenant_id, input.customerId, code, input.category, input.brand, input.model,
    input.serialNumber, input.assetTag, input.capacityBtu, input.refrigerant, input.location, input.status, input.notes,
    session.user_id, session.user_id, current, current,
  ).run();
  const equipment = await env.DB.prepare(
    `SELECT * FROM equipment WHERE id = ? AND tenant_id = ?`
  ).bind(id, session.activeMembership.tenant_id).first();
  await recordAudit(env, request, session, 'equipment.create', 'equipment', id, { code, customerId: input.customerId });
  const body = { ok: true, equipment };
  await storeIdempotentResponse(env, session, request, idempotent.key, 201, body);
  return json(body, 201);
}

async function handleEquipmentUpdate(request, env, equipmentId) {
  const session = await requireSession(env, request);
  assertOperationalPermission(session.activeMembership.role, 'equipment.write');
  await verifyCsrf(request, session);
  const existing = await ensureEquipment(env, session.activeMembership.tenant_id, equipmentId);
  const input = normalizeEquipmentInput(await request.json().catch(() => ({})), { partial: true });
  if (input.customerId) await ensureCustomer(env, session.activeMembership.tenant_id, input.customerId);
  const columns = {
    customerId: 'customer_id', category: 'category', brand: 'brand', model: 'model', serialNumber: 'serial_number',
    assetTag: 'asset_tag', capacityBtu: 'capacity_btu', refrigerant: 'refrigerant', location: 'location', status: 'status', notes: 'notes',
  };
  const entries = Object.entries(input).filter(([key]) => columns[key]);
  const assignments = entries.map(([key]) => `${columns[key]} = ?`);
  const values = entries.map(([, value]) => value);
  assignments.push('updated_by = ?', 'updated_at = ?');
  values.push(session.user_id, nowIso(), equipmentId, session.activeMembership.tenant_id);
  await env.DB.prepare(
    `UPDATE equipment SET ${assignments.join(', ')} WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL`
  ).bind(...values).run();
  const equipment = await env.DB.prepare(
    `SELECT * FROM equipment WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL`
  ).bind(equipmentId, session.activeMembership.tenant_id).first();
  await recordAudit(env, request, session, 'equipment.update', 'equipment', equipmentId, {
    code: existing.code,
    fields: entries.map(([key]) => key),
  });
  return json({ ok: true, equipment });
}

async function handleEquipmentDelete(request, env, equipmentId) {
  const session = await requireSession(env, request);
  assertOperationalPermission(session.activeMembership.role, 'equipment.delete');
  await verifyCsrf(request, session);
  const equipment = await ensureEquipment(env, session.activeMembership.tenant_id, equipmentId);
  const activeOrders = await env.DB.prepare(
    `SELECT COUNT(*) AS total FROM work_orders
     WHERE tenant_id = ? AND equipment_id = ? AND deleted_at IS NULL AND status NOT IN ('completed', 'cancelled')`
  ).bind(session.activeMembership.tenant_id, equipmentId).first();
  if (Number(activeOrders?.total || 0) > 0) throw new Error('EQUIPMENT_IN_USE');
  const current = nowIso();
  await env.DB.prepare(
    `UPDATE equipment SET deleted_at = ?, status = 'retired', updated_at = ?, updated_by = ?
     WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL`
  ).bind(current, current, session.user_id, equipmentId, session.activeMembership.tenant_id).run();
  await recordAudit(env, request, session, 'equipment.delete', 'equipment', equipmentId, { code: equipment.code });
  return json({ ok: true });
}

async function handleWorkOrderLookups(request, env) {
  const session = await requireSession(env, request);
  assertOperationalPermission(session.activeMembership.role, 'work_orders.read');
  const tenantId = session.activeMembership.tenant_id;
  const [customers, equipment, technicians] = await Promise.all([
    env.DB.prepare(`SELECT id, code, name FROM customers WHERE tenant_id = ? AND deleted_at IS NULL AND status = 'active' ORDER BY name`).bind(tenantId).all(),
    env.DB.prepare(`SELECT id, customer_id, code, brand, model, location FROM equipment WHERE tenant_id = ? AND deleted_at IS NULL AND status = 'active' ORDER BY code`).bind(tenantId).all(),
    env.DB.prepare(
      `SELECT m.user_id, u.name, u.email FROM memberships m JOIN users u ON u.id = m.user_id
       WHERE m.tenant_id = ? AND m.role = 'tecnico' AND m.status = 'active' AND u.status = 'active' ORDER BY u.name`
    ).bind(tenantId).all(),
  ]);
  return json({ customers: customers.results || [], equipment: equipment.results || [], technicians: technicians.results || [] });
}

async function handleWorkOrderList(request, env) {
  const session = await requireSession(env, request);
  assertOperationalPermission(session.activeMembership.role, 'work_orders.read');
  const url = new URL(request.url);
  const { limit, offset } = normalizePagination(url.searchParams);
  const search = cleanText(url.searchParams.get('search'), 120);
  const customerId = cleanText(url.searchParams.get('customerId'), 100);
  const equipmentId = cleanText(url.searchParams.get('equipmentId'), 100);
  const status = String(url.searchParams.get('status') || '').toLowerCase();
  const priority = String(url.searchParams.get('priority') || '').toLowerCase();
  if (status && !WORK_ORDER_STATUSES.includes(status)) throw new Error('WORK_ORDER_STATUS_INVALID');
  if (priority && !WORK_ORDER_PRIORITIES.includes(priority)) throw new Error('WORK_ORDER_PRIORITY_INVALID');

  const where = ['w.tenant_id = ?', 'w.deleted_at IS NULL', 'c.deleted_at IS NULL'];
  const values = [session.activeMembership.tenant_id];
  if (session.activeMembership.role === 'tecnico') {
    where.push('w.technician_user_id = ?');
    values.push(session.user_id);
  }
  if (customerId) { where.push('w.customer_id = ?'); values.push(customerId); }
  if (equipmentId) { where.push('w.equipment_id = ?'); values.push(equipmentId); }
  if (status) { where.push('w.status = ?'); values.push(status); }
  if (priority) { where.push('w.priority = ?'); values.push(priority); }
  if (search) {
    where.push('(w.code LIKE ? OR w.title LIKE ? OR w.description LIKE ? OR c.name LIKE ? OR e.code LIKE ?)');
    const pattern = `%${search}%`;
    values.push(pattern, pattern, pattern, pattern, pattern);
  }

  const from = `FROM work_orders w
    JOIN customers c ON c.id = w.customer_id AND c.tenant_id = w.tenant_id
    LEFT JOIN equipment e ON e.id = w.equipment_id AND e.tenant_id = w.tenant_id
    LEFT JOIN users u ON u.id = w.technician_user_id`;
  const count = await env.DB.prepare(`SELECT COUNT(*) AS total ${from} WHERE ${where.join(' AND ')}`).bind(...values).first();
  const rows = await env.DB.prepare(
    `SELECT w.id, w.code, w.customer_id, w.equipment_id, w.technician_user_id, w.service_type, w.title,
            w.description, w.priority, w.status, w.scheduled_start, w.scheduled_end, w.sla_due_at,
            w.started_at, w.completed_at, w.resolution, w.notes, w.created_at, w.updated_at,
            c.code AS customer_code, c.name AS customer_name,
            e.code AS equipment_code, e.brand AS equipment_brand, e.model AS equipment_model,
            u.name AS technician_name, u.email AS technician_email
     ${from} WHERE ${where.join(' AND ')}
     ORDER BY CASE w.priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'normal' THEN 3 ELSE 4 END,
              COALESCE(w.sla_due_at, '9999-12-31T23:59:59.999Z') ASC, w.updated_at DESC
     LIMIT ? OFFSET ?`
  ).bind(...values, limit, offset).all();
  return json({ items: rows.results || [], page: { limit, offset, total: Number(count?.total || 0) } });
}

async function handleWorkOrderCreate(request, env) {
  const session = await requireSession(env, request);
  assertOperationalPermission(session.activeMembership.role, 'work_orders.write');
  await verifyCsrf(request, session);
  const idempotent = await readIdempotentResponse(env, session, request);
  if (idempotent.response) return idempotent.response;
  const input = normalizeWorkOrderInput(await request.json().catch(() => ({})));
  const tenantId = session.activeMembership.tenant_id;
  await ensureCustomer(env, tenantId, input.customerId);
  await ensureEquipment(env, tenantId, input.equipmentId, input.customerId);
  if (input.technicianUserId) {
    assertOperationalPermission(session.activeMembership.role, 'work_orders.assign');
    await ensureTechnician(env, tenantId, input.technicianUserId);
  }
  const id = crypto.randomUUID();
  const code = workOrderCodeFromId(id);
  const current = nowIso();
  await env.DB.prepare(
    `INSERT INTO work_orders
      (id, tenant_id, customer_id, equipment_id, technician_user_id, code, service_type, title, description,
       priority, status, scheduled_start, scheduled_end, sla_due_at, resolution, notes,
       created_by, updated_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id, tenantId, input.customerId, input.equipmentId, input.technicianUserId, code, input.serviceType, input.title,
    input.description, input.priority, input.scheduledStart, input.scheduledEnd, input.slaDueAt, input.resolution,
    input.notes, session.user_id, session.user_id, current, current,
  ).run();
  await appendWorkOrderEvent(env, session, id, 'work_order.created', {
    toStatus: 'open',
    metadata: { code, customerId: input.customerId, equipmentId: input.equipmentId, technicianUserId: input.technicianUserId },
  });
  await recordAudit(env, request, session, 'work_order.create', 'work_order', id, { code });
  const order = await env.DB.prepare(`SELECT * FROM work_orders WHERE id = ? AND tenant_id = ?`).bind(id, tenantId).first();
  const body = { ok: true, workOrder: order };
  await storeIdempotentResponse(env, session, request, idempotent.key, 201, body);
  return json(body, 201);
}

async function handleWorkOrderUpdate(request, env, workOrderId) {
  const session = await requireSession(env, request);
  assertOperationalPermission(session.activeMembership.role, 'work_orders.write');
  await verifyCsrf(request, session);
  const tenantId = session.activeMembership.tenant_id;
  const existing = await env.DB.prepare(
    `SELECT * FROM work_orders WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL`
  ).bind(workOrderId, tenantId).first();
  if (!existing) throw new Error('WORK_ORDER_NOT_FOUND');
  if (['completed', 'cancelled'].includes(existing.status)) throw new Error('WORK_ORDER_TERMINAL');
  const input = normalizeWorkOrderInput(await request.json().catch(() => ({})), { partial: true });
  const customerId = input.customerId ?? existing.customer_id;
  const equipmentId = Object.prototype.hasOwnProperty.call(input, 'equipmentId') ? input.equipmentId : existing.equipment_id;
  await ensureCustomer(env, tenantId, customerId);
  await ensureEquipment(env, tenantId, equipmentId, customerId);
  if (Object.prototype.hasOwnProperty.call(input, 'technicianUserId')) {
    assertOperationalPermission(session.activeMembership.role, 'work_orders.assign');
    await ensureTechnician(env, tenantId, input.technicianUserId);
  }

  const columns = {
    customerId: 'customer_id', equipmentId: 'equipment_id', technicianUserId: 'technician_user_id',
    serviceType: 'service_type', title: 'title', description: 'description', priority: 'priority',
    scheduledStart: 'scheduled_start', scheduledEnd: 'scheduled_end', slaDueAt: 'sla_due_at',
    resolution: 'resolution', notes: 'notes',
  };
  const entries = Object.entries(input).filter(([key]) => columns[key]);
  const assignments = entries.map(([key]) => `${columns[key]} = ?`);
  const values = entries.map(([, value]) => value);
  assignments.push('updated_by = ?', 'updated_at = ?');
  values.push(session.user_id, nowIso(), workOrderId, tenantId);
  await env.DB.prepare(
    `UPDATE work_orders SET ${assignments.join(', ')} WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL`
  ).bind(...values).run();

  const assignmentChanged = Object.prototype.hasOwnProperty.call(input, 'technicianUserId')
    && input.technicianUserId !== existing.technician_user_id;
  await appendWorkOrderEvent(env, session, workOrderId, assignmentChanged ? 'work_order.assigned' : 'work_order.updated', {
    metadata: { fields: entries.map(([key]) => key), previousTechnicianUserId: assignmentChanged ? existing.technician_user_id : undefined },
  });
  await recordAudit(env, request, session, assignmentChanged ? 'work_order.assign' : 'work_order.update', 'work_order', workOrderId, {
    fields: entries.map(([key]) => key),
  });
  const workOrder = await env.DB.prepare(`SELECT * FROM work_orders WHERE id = ? AND tenant_id = ?`).bind(workOrderId, tenantId).first();
  return json({ ok: true, workOrder });
}

async function handleWorkOrderStatus(request, env, workOrderId) {
  const session = await requireSession(env, request);
  assertOperationalPermission(session.activeMembership.role, 'work_orders.transition');
  await verifyCsrf(request, session);
  const tenantId = session.activeMembership.tenant_id;
  const existing = await env.DB.prepare(
    `SELECT * FROM work_orders WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL`
  ).bind(workOrderId, tenantId).first();
  if (!existing) throw new Error('WORK_ORDER_NOT_FOUND');
  const input = normalizeStatusTransition(await request.json().catch(() => ({})));
  if (!canTransitionWorkOrder(existing.status, input.status)) throw new Error('WORK_ORDER_TRANSITION_INVALID');

  if (session.activeMembership.role === 'tecnico') {
    if (existing.technician_user_id !== session.user_id) throw new Error('WORK_ORDER_NOT_ASSIGNED');
    if (input.status === 'cancelled' || input.status === 'scheduled') throw new Error('AUTH_FORBIDDEN');
  }
  if (['on_hold', 'cancelled'].includes(input.status) && (!input.note || input.note.length < 3)) {
    throw new Error('WORK_ORDER_TRANSITION_NOTE_REQUIRED');
  }
  const resolution = input.resolution || existing.resolution;
  if (input.status === 'completed' && (!resolution || resolution.length < 3)) {
    throw new Error('WORK_ORDER_RESOLUTION_REQUIRED');
  }

  const current = nowIso();
  const startedAt = input.status === 'in_progress' && !existing.started_at ? current : existing.started_at;
  const completedAt = input.status === 'completed' ? current : existing.completed_at;
  await env.DB.prepare(
    `UPDATE work_orders
     SET status = ?, resolution = ?, started_at = ?, completed_at = ?, updated_by = ?, updated_at = ?
     WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL`
  ).bind(input.status, resolution, startedAt, completedAt, session.user_id, current, workOrderId, tenantId).run();
  await appendWorkOrderEvent(env, session, workOrderId, 'work_order.status_changed', {
    fromStatus: existing.status,
    toStatus: input.status,
    note: input.note,
    metadata: { resolutionChanged: Boolean(input.resolution) },
  });
  await recordAudit(env, request, session, 'work_order.status', 'work_order', workOrderId, {
    fromStatus: existing.status,
    toStatus: input.status,
  });
  const workOrder = await env.DB.prepare(`SELECT * FROM work_orders WHERE id = ? AND tenant_id = ?`).bind(workOrderId, tenantId).first();
  return json({ ok: true, workOrder });
}

async function handleWorkOrderHistory(request, env, workOrderId) {
  const session = await requireSession(env, request);
  assertOperationalPermission(session.activeMembership.role, 'work_orders.read');
  const tenantId = session.activeMembership.tenant_id;
  const order = await env.DB.prepare(
    `SELECT id, technician_user_id FROM work_orders WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL`
  ).bind(workOrderId, tenantId).first();
  if (!order) throw new Error('WORK_ORDER_NOT_FOUND');
  if (session.activeMembership.role === 'tecnico' && order.technician_user_id !== session.user_id) {
    throw new Error('AUTH_FORBIDDEN');
  }
  const rows = await env.DB.prepare(
    `SELECT e.id, e.event_type, e.from_status, e.to_status, e.note, e.metadata_json, e.created_at,
            u.name AS actor_name, u.email AS actor_email
     FROM work_order_events e LEFT JOIN users u ON u.id = e.actor_user_id
     WHERE e.tenant_id = ? AND e.work_order_id = ? ORDER BY e.created_at DESC`
  ).bind(tenantId, workOrderId).all();
  return json({ items: (rows.results || []).map((row) => ({ ...row, metadata: JSON.parse(row.metadata_json || '{}'), metadata_json: undefined })) });
}

async function handleWorkOrderDelete(request, env, workOrderId) {
  const session = await requireSession(env, request);
  assertOperationalPermission(session.activeMembership.role, 'work_orders.delete');
  await verifyCsrf(request, session);
  const tenantId = session.activeMembership.tenant_id;
  const order = await env.DB.prepare(
    `SELECT id, code, status FROM work_orders WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL`
  ).bind(workOrderId, tenantId).first();
  if (!order) throw new Error('WORK_ORDER_NOT_FOUND');
  if (!['draft', 'cancelled'].includes(order.status)) throw new Error('WORK_ORDER_DELETE_STATE');
  const current = nowIso();
  await appendWorkOrderEvent(env, session, workOrderId, 'work_order.deleted', { fromStatus: order.status });
  await env.DB.prepare(
    `UPDATE work_orders SET deleted_at = ?, updated_at = ?, updated_by = ? WHERE id = ? AND tenant_id = ?`
  ).bind(current, current, session.user_id, workOrderId, tenantId).run();
  await recordAudit(env, request, session, 'work_order.delete', 'work_order', workOrderId, { code: order.code });
  return json({ ok: true });
}

export async function routeOperationsApi(request, env, pathname) {
  if (pathname === '/api/v1/equipment' && request.method === 'GET') return handleEquipmentList(request, env);
  if (pathname === '/api/v1/equipment' && request.method === 'POST') return handleEquipmentCreate(request, env);
  const equipmentId = equipmentPathId(pathname);
  if (equipmentId && request.method === 'PATCH') return handleEquipmentUpdate(request, env, equipmentId);
  if (equipmentId && request.method === 'DELETE') return handleEquipmentDelete(request, env, equipmentId);

  if (pathname === '/api/v1/work-orders/lookups' && request.method === 'GET') return handleWorkOrderLookups(request, env);
  if (pathname === '/api/v1/work-orders' && request.method === 'GET') return handleWorkOrderList(request, env);
  if (pathname === '/api/v1/work-orders' && request.method === 'POST') return handleWorkOrderCreate(request, env);
  const workOrder = workOrderPath(pathname);
  if (workOrder?.action === 'history' && request.method === 'GET') return handleWorkOrderHistory(request, env, workOrder.id);
  if (workOrder?.action === 'status' && request.method === 'POST') return handleWorkOrderStatus(request, env, workOrder.id);
  if (workOrder && !workOrder.action && request.method === 'PATCH') return handleWorkOrderUpdate(request, env, workOrder.id);
  if (workOrder && !workOrder.action && request.method === 'DELETE') return handleWorkOrderDelete(request, env, workOrder.id);
  return null;
}

export function operationalErrorResponse(error) {
  const code = error instanceof Error ? error.message : 'UNKNOWN';
  if (/UNIQUE constraint failed: equipment\./i.test(code)) {
    return json({ ok: false, code: 'EQUIPMENT_DUPLICATE', message: 'Já existe um equipamento com este código ou número de série nesta empresa.' }, 409);
  }
  if (/UNIQUE constraint failed: work_orders\./i.test(code)) {
    return json({ ok: false, code: 'WORK_ORDER_DUPLICATE', message: 'Já existe uma ordem de serviço com este código nesta empresa.' }, 409);
  }
  if (code.includes('WORK_ORDER_EQUIPMENT_CUSTOMER_MISMATCH')) {
    return json({ ok: false, code: 'WORK_ORDER_EQUIPMENT_CUSTOMER_MISMATCH', message: 'O equipamento selecionado não pertence ao cliente desta ordem.' }, 409);
  }
  const mapping = {
    AUTH_REQUIRED: [401, 'Sessão expirada ou inexistente.'],
    AUTH_FORBIDDEN: [403, 'Você não possui permissão para esta ação.'],
    AUTH_CSRF: [403, 'A validação de segurança da solicitação falhou.'],
    AUTH_ORIGIN: [403, 'Origem da solicitação não autorizada.'],
    API_VALIDATION: [400, 'Os dados enviados são inválidos.'],
    CUSTOMER_NOT_FOUND: [404, 'Cliente não encontrado nesta empresa.'],
    EQUIPMENT_CUSTOMER_REQUIRED: [400, 'Selecione o cliente proprietário do equipamento.'],
    EQUIPMENT_CATEGORY_REQUIRED: [400, 'Informe a categoria do equipamento.'],
    EQUIPMENT_STATUS_INVALID: [400, 'O status do equipamento é inválido.'],
    EQUIPMENT_NOT_FOUND: [404, 'Equipamento não encontrado nesta empresa.'],
    EQUIPMENT_IN_USE: [409, 'Este equipamento possui ordens de serviço abertas e não pode ser excluído.'],
    WORK_ORDER_CUSTOMER_REQUIRED: [400, 'Selecione o cliente da ordem de serviço.'],
    WORK_ORDER_SERVICE_TYPE_REQUIRED: [400, 'Informe o tipo de serviço.'],
    WORK_ORDER_TITLE_REQUIRED: [400, 'Informe um título para a ordem de serviço.'],
    WORK_ORDER_PRIORITY_INVALID: [400, 'A prioridade da ordem é inválida.'],
    WORK_ORDER_STATUS_INVALID: [400, 'O status da ordem é inválido.'],
    WORK_ORDER_STATUS_ENDPOINT_REQUIRED: [400, 'Altere o status pelo fluxo de transição da ordem.'],
    WORK_ORDER_DATE_INVALID: [400, 'Uma das datas da ordem é inválida.'],
    WORK_ORDER_SCHEDULE_INVALID: [400, 'O fim do agendamento não pode ocorrer antes do início.'],
    WORK_ORDER_TECHNICIAN_INVALID: [400, 'O técnico selecionado não possui vínculo ativo com esta empresa.'],
    WORK_ORDER_NOT_FOUND: [404, 'Ordem de serviço não encontrada nesta empresa.'],
    WORK_ORDER_TERMINAL: [409, 'Ordens concluídas ou canceladas não podem mais ser editadas.'],
    WORK_ORDER_TRANSITION_INVALID: [409, 'Esta mudança de status não é permitida.'],
    WORK_ORDER_TRANSITION_NOTE_REQUIRED: [400, 'Informe o motivo para pausar ou cancelar a ordem.'],
    WORK_ORDER_RESOLUTION_REQUIRED: [400, 'Informe a resolução antes de concluir a ordem.'],
    WORK_ORDER_NOT_ASSIGNED: [403, 'Esta ordem não está atribuída ao técnico autenticado.'],
    WORK_ORDER_DELETE_STATE: [409, 'Somente ordens em rascunho ou canceladas podem ser excluídas.'],
  };
  const [status, message] = mapping[code] || [500, 'Não foi possível concluir a operação operacional.'];
  return json({ ok: false, code, message }, status);
}
