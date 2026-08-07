import { requireSession, recordAudit } from './auth.js';
import { json, nowIso, verifyCsrf } from './security.js';

const FIELD_PERMISSIONS = Object.freeze({
  admin: Object.freeze(['*']),
  gestor: Object.freeze(['field_service.read', 'field_service.write', 'field_service.status', 'field_service.record']),
  atendimento: Object.freeze(['field_service.read', 'field_service.write', 'field_service.status']),
  tecnico: Object.freeze(['field_service.read', 'field_service.status', 'field_service.record']),
  estoque: Object.freeze([]),
  financeiro: Object.freeze([]),
});

const VISIT_STATUSES = Object.freeze(['planned', 'en_route', 'on_site', 'completed', 'cancelled']);
const VISIT_TRANSITIONS = Object.freeze({
  planned: Object.freeze(['en_route', 'on_site', 'cancelled']),
  en_route: Object.freeze(['on_site', 'cancelled']),
  on_site: Object.freeze(['completed', 'cancelled']),
  completed: Object.freeze([]),
  cancelled: Object.freeze([]),
});
const CHECKLIST_STATUSES = Object.freeze(['pending', 'ok', 'not_ok', 'na']);
const DEFAULT_CHECKLIST = Object.freeze([
  ['safety', 'Segurança e EPI'],
  ['visual', 'Inspeção visual do equipamento'],
  ['electrical', 'Medições elétricas'],
  ['functional', 'Teste funcional'],
]);

export function fieldPermissionsForRole(role) {
  return [...(FIELD_PERMISSIONS[String(role || '').toLowerCase()] || [])];
}

export function canField(role, permission) {
  const permissions = FIELD_PERMISSIONS[String(role || '').toLowerCase()] || [];
  return permissions.includes('*') || permissions.includes(permission);
}

function assertFieldPermission(role, permission) {
  if (!canField(role, permission)) throw new Error('AUTH_FORBIDDEN');
}

function cleanText(value, maxLength, { nullable = true } = {}) {
  const text = String(value ?? '').trim();
  if (!text) return nullable ? null : '';
  return text.slice(0, maxLength);
}

function cleanIso(value, { required = false } = {}) {
  const text = cleanText(value, 64);
  if (!text) {
    if (required) throw new Error('FIELD_SCHEDULE_REQUIRED');
    return null;
  }
  const timestamp = Date.parse(text);
  if (!Number.isFinite(timestamp)) throw new Error('FIELD_DATE_INVALID');
  return new Date(timestamp).toISOString();
}

function normalizePagination(searchParams) {
  const limitRaw = Number.parseInt(String(searchParams.get('limit') || '50'), 10);
  const offsetRaw = Number.parseInt(String(searchParams.get('offset') || '0'), 10);
  return {
    limit: Number.isFinite(limitRaw) ? Math.min(100, Math.max(1, limitRaw)) : 50,
    offset: Number.isFinite(offsetRaw) ? Math.max(0, offsetRaw) : 0,
  };
}

export function normalizeVisitInput(input, { partial = false } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('API_VALIDATION');
  const has = (key) => Object.prototype.hasOwnProperty.call(input, key);
  const output = {};
  if (!partial || has('workOrderId')) {
    output.workOrderId = cleanText(input.workOrderId, 100, { nullable: false });
    if (!output.workOrderId) throw new Error('FIELD_WORK_ORDER_REQUIRED');
  }
  if (!partial || has('technicianUserId')) {
    output.technicianUserId = cleanText(input.technicianUserId, 100, { nullable: false });
    if (!output.technicianUserId) throw new Error('FIELD_TECHNICIAN_REQUIRED');
  }
  if (!partial || has('scheduledStart')) output.scheduledStart = cleanIso(input.scheduledStart, { required: !partial });
  if (!partial || has('scheduledEnd')) output.scheduledEnd = cleanIso(input.scheduledEnd);
  if (!partial || has('notes')) output.notes = cleanText(input.notes, 3000);
  if (has('status')) throw new Error('FIELD_STATUS_ENDPOINT_REQUIRED');
  if (output.scheduledStart && output.scheduledEnd && Date.parse(output.scheduledEnd) < Date.parse(output.scheduledStart)) {
    throw new Error('FIELD_SCHEDULE_INVALID');
  }
  if (partial && !Object.keys(output).length) throw new Error('API_VALIDATION');
  return output;
}

export function normalizeVisitTransition(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('API_VALIDATION');
  const status = String(input.status || '').toLowerCase();
  if (!VISIT_STATUSES.includes(status)) throw new Error('FIELD_STATUS_INVALID');
  return { status, note: cleanText(input.note, 2000) };
}

export function canTransitionVisit(fromStatus, toStatus) {
  return (VISIT_TRANSITIONS[String(fromStatus || '')] || []).includes(String(toStatus || ''));
}

export function normalizeChecklistItems(input) {
  if (!input || typeof input !== 'object' || !Array.isArray(input.items) || input.items.length > 50) {
    throw new Error('FIELD_CHECKLIST_INVALID');
  }
  return input.items.map((item, index) => {
    const key = cleanText(item?.key, 80, { nullable: false });
    const label = cleanText(item?.label, 200, { nullable: false });
    const status = String(item?.status || 'pending').toLowerCase();
    const note = cleanText(item?.note, 2000);
    if (!key || !label || !CHECKLIST_STATUSES.includes(status)) throw new Error('FIELD_CHECKLIST_INVALID');
    if (status === 'not_ok' && (!note || note.length < 3)) throw new Error('FIELD_CHECKLIST_NOTE_REQUIRED');
    return { key, label, status, note, position: index };
  });
}

export function normalizeMeasurement(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('API_VALIDATION');
  const name = cleanText(input.name, 160, { nullable: false });
  const unit = cleanText(input.unit, 40);
  const hasNumber = input.valueNumber !== '' && input.valueNumber !== null && input.valueNumber !== undefined;
  const number = hasNumber ? Number(input.valueNumber) : null;
  const text = cleanText(input.valueText, 500);
  if (!name || (hasNumber && !Number.isFinite(number)) || (!hasNumber && !text)) throw new Error('FIELD_MEASUREMENT_INVALID');
  return { name, valueNumber: hasNumber ? number : null, valueText: hasNumber ? null : text, unit };
}

async function ensureVisit(env, session, visitId) {
  const visit = await env.DB.prepare(
    `SELECT v.*, w.code AS work_order_code, w.status AS work_order_status,
            w.customer_id, w.equipment_id, c.name AS customer_name,
            u.name AS technician_name, u.email AS technician_email
     FROM service_visits v
     JOIN work_orders w ON w.id = v.work_order_id AND w.tenant_id = v.tenant_id
     JOIN customers c ON c.id = w.customer_id AND c.tenant_id = v.tenant_id
     JOIN users u ON u.id = v.technician_user_id
     WHERE v.id = ? AND v.tenant_id = ?`
  ).bind(visitId, session.activeMembership.tenant_id).first();
  if (!visit) throw new Error('FIELD_VISIT_NOT_FOUND');
  if (session.activeMembership.role === 'tecnico' && visit.technician_user_id !== session.user_id) {
    throw new Error('AUTH_FORBIDDEN');
  }
  return visit;
}

async function ensureWorkOrderAssignment(env, tenantId, workOrderId, technicianUserId) {
  const row = await env.DB.prepare(
    `SELECT w.id, w.code, w.status, w.technician_user_id, c.name AS customer_name
     FROM work_orders w JOIN customers c ON c.id = w.customer_id AND c.tenant_id = w.tenant_id
     WHERE w.id = ? AND w.tenant_id = ? AND w.deleted_at IS NULL`
  ).bind(workOrderId, tenantId).first();
  if (!row || ['completed', 'cancelled'].includes(row.status)) throw new Error('FIELD_WORK_ORDER_INVALID');
  if (!row.technician_user_id || row.technician_user_id !== technicianUserId) throw new Error('FIELD_WORK_ORDER_ASSIGNMENT_MISMATCH');
  return row;
}

async function ensureTechnician(env, tenantId, userId) {
  const row = await env.DB.prepare(
    `SELECT m.user_id, u.name, u.email
     FROM memberships m JOIN users u ON u.id = m.user_id
     WHERE m.tenant_id = ? AND m.user_id = ? AND m.role = 'tecnico'
       AND m.status = 'active' AND u.status = 'active'`
  ).bind(tenantId, userId).first();
  if (!row) throw new Error('FIELD_TECHNICIAN_INVALID');
  return row;
}

async function appendVisitEvent(env, session, visitId, eventType, details = {}) {
  await env.DB.prepare(
    `INSERT INTO service_visit_events
      (id, tenant_id, visit_id, actor_user_id, event_type, from_status, to_status, note, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    crypto.randomUUID(), session.activeMembership.tenant_id, visitId, session.user_id, eventType,
    details.fromStatus || null, details.toStatus || null, cleanText(details.note, 2000),
    JSON.stringify(details.metadata || {}).slice(0, 8000), nowIso(),
  ).run();
}

async function seedChecklist(env, session, visitId) {
  const current = nowIso();
  const statements = DEFAULT_CHECKLIST.map(([key, label], position) => env.DB.prepare(
    `INSERT OR IGNORE INTO visit_checklist_items
      (id, tenant_id, visit_id, item_key, label, position, status, updated_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
  ).bind(crypto.randomUUID(), session.activeMembership.tenant_id, visitId, key, label, position, session.user_id, current));
  if (statements.length) await env.DB.batch(statements);
}

async function handleLookups(request, env) {
  const session = await requireSession(env, request);
  assertFieldPermission(session.activeMembership.role, 'field_service.read');
  const tenantId = session.activeMembership.tenant_id;
  const [orders, technicians] = await Promise.all([
    env.DB.prepare(
      `SELECT w.id, w.code, w.title, w.technician_user_id, c.name AS customer_name
       FROM work_orders w JOIN customers c ON c.id = w.customer_id AND c.tenant_id = w.tenant_id
       WHERE w.tenant_id = ? AND w.deleted_at IS NULL AND w.status NOT IN ('completed', 'cancelled')
         AND w.technician_user_id IS NOT NULL ORDER BY w.updated_at DESC LIMIT 200`
    ).bind(tenantId).all(),
    env.DB.prepare(
      `SELECT m.user_id, u.name, u.email FROM memberships m JOIN users u ON u.id = m.user_id
       WHERE m.tenant_id = ? AND m.role = 'tecnico' AND m.status = 'active' AND u.status = 'active'
       ORDER BY u.name, u.email`
    ).bind(tenantId).all(),
  ]);
  return json({ workOrders: orders.results || [], technicians: technicians.results || [] });
}

async function handleVisitList(request, env) {
  const session = await requireSession(env, request);
  assertFieldPermission(session.activeMembership.role, 'field_service.read');
  const url = new URL(request.url);
  const { limit, offset } = normalizePagination(url.searchParams);
  const status = String(url.searchParams.get('status') || '').toLowerCase();
  const from = cleanIso(url.searchParams.get('from'));
  const to = cleanIso(url.searchParams.get('to'));
  if (status && !VISIT_STATUSES.includes(status)) throw new Error('FIELD_STATUS_INVALID');
  const where = ['v.tenant_id = ?'];
  const values = [session.activeMembership.tenant_id];
  if (session.activeMembership.role === 'tecnico') { where.push('v.technician_user_id = ?'); values.push(session.user_id); }
  if (status) { where.push('v.status = ?'); values.push(status); }
  if (from) { where.push('v.scheduled_start >= ?'); values.push(from); }
  if (to) { where.push('v.scheduled_start <= ?'); values.push(to); }
  const base = `FROM service_visits v
    JOIN work_orders w ON w.id = v.work_order_id AND w.tenant_id = v.tenant_id
    JOIN customers c ON c.id = w.customer_id AND c.tenant_id = v.tenant_id
    LEFT JOIN equipment e ON e.id = w.equipment_id AND e.tenant_id = v.tenant_id
    JOIN users u ON u.id = v.technician_user_id`;
  const count = await env.DB.prepare(`SELECT COUNT(*) AS total ${base} WHERE ${where.join(' AND ')}`).bind(...values).first();
  const rows = await env.DB.prepare(
    `SELECT v.id, v.work_order_id, v.technician_user_id, v.status, v.scheduled_start, v.scheduled_end,
            v.arrival_at, v.departure_at, v.notes, v.created_at, v.updated_at,
            w.code AS work_order_code, w.title AS work_order_title, w.priority AS work_order_priority,
            c.name AS customer_name, e.code AS equipment_code, u.name AS technician_name, u.email AS technician_email
     ${base} WHERE ${where.join(' AND ')} ORDER BY v.scheduled_start ASC LIMIT ? OFFSET ?`
  ).bind(...values, limit, offset).all();
  return json({ items: rows.results || [], page: { limit, offset, total: Number(count?.total || 0) } });
}

async function handleVisitCreate(request, env) {
  const session = await requireSession(env, request);
  assertFieldPermission(session.activeMembership.role, 'field_service.write');
  await verifyCsrf(request, session);
  const input = normalizeVisitInput(await request.json().catch(() => ({})));
  const tenantId = session.activeMembership.tenant_id;
  await ensureTechnician(env, tenantId, input.technicianUserId);
  const order = await ensureWorkOrderAssignment(env, tenantId, input.workOrderId, input.technicianUserId);
  const id = crypto.randomUUID();
  const current = nowIso();
  await env.DB.prepare(
    `INSERT INTO service_visits
      (id, tenant_id, work_order_id, technician_user_id, status, scheduled_start, scheduled_end, notes,
       created_by, updated_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'planned', ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, tenantId, input.workOrderId, input.technicianUserId, input.scheduledStart, input.scheduledEnd,
    input.notes, session.user_id, session.user_id, current, current).run();
  await seedChecklist(env, session, id);
  await appendVisitEvent(env, session, id, 'visit.created', { toStatus: 'planned', metadata: { workOrderId: order.id } });
  await recordAudit(env, request, session, 'field_visit.create', 'service_visit', id, { workOrderId: order.id });
  return json({ ok: true, visit: await ensureVisit(env, session, id) }, 201);
}

async function handleVisitUpdate(request, env, visitId) {
  const session = await requireSession(env, request);
  assertFieldPermission(session.activeMembership.role, 'field_service.write');
  await verifyCsrf(request, session);
  const existing = await ensureVisit(env, session, visitId);
  if (['completed', 'cancelled'].includes(existing.status)) throw new Error('FIELD_VISIT_TERMINAL');
  const input = normalizeVisitInput(await request.json().catch(() => ({})), { partial: true });
  const workOrderId = input.workOrderId ?? existing.work_order_id;
  const technicianUserId = input.technicianUserId ?? existing.technician_user_id;
  await ensureTechnician(env, session.activeMembership.tenant_id, technicianUserId);
  await ensureWorkOrderAssignment(env, session.activeMembership.tenant_id, workOrderId, technicianUserId);
  const columns = { workOrderId: 'work_order_id', technicianUserId: 'technician_user_id', scheduledStart: 'scheduled_start', scheduledEnd: 'scheduled_end', notes: 'notes' };
  const entries = Object.entries(input).filter(([key]) => columns[key]);
  const assignments = entries.map(([key]) => `${columns[key]} = ?`);
  const values = entries.map(([, value]) => value);
  assignments.push('updated_by = ?', 'updated_at = ?');
  values.push(session.user_id, nowIso(), visitId, session.activeMembership.tenant_id);
  await env.DB.prepare(`UPDATE service_visits SET ${assignments.join(', ')} WHERE id = ? AND tenant_id = ?`).bind(...values).run();
  await appendVisitEvent(env, session, visitId, 'visit.updated', { metadata: { fields: entries.map(([key]) => key) } });
  await recordAudit(env, request, session, 'field_visit.update', 'service_visit', visitId, { fields: entries.map(([key]) => key) });
  return json({ ok: true, visit: await ensureVisit(env, session, visitId) });
}

async function handleVisitTransition(request, env, visitId) {
  const session = await requireSession(env, request);
  assertFieldPermission(session.activeMembership.role, 'field_service.status');
  await verifyCsrf(request, session);
  const visit = await ensureVisit(env, session, visitId);
  const input = normalizeVisitTransition(await request.json().catch(() => ({})));
  if (!canTransitionVisit(visit.status, input.status)) throw new Error('FIELD_TRANSITION_INVALID');
  if (session.activeMembership.role === 'tecnico' && input.status === 'cancelled') throw new Error('AUTH_FORBIDDEN');
  if (input.status === 'cancelled' && (!input.note || input.note.length < 3)) throw new Error('FIELD_CANCEL_NOTE_REQUIRED');
  if (input.status === 'completed') {
    const pending = await env.DB.prepare(
      `SELECT COUNT(*) AS total FROM visit_checklist_items WHERE tenant_id = ? AND visit_id = ? AND status = 'pending'`
    ).bind(session.activeMembership.tenant_id, visitId).first();
    if (Number(pending?.total || 0) > 0) throw new Error('FIELD_CHECKLIST_PENDING');
  }
  const current = nowIso();
  const arrivalAt = input.status === 'on_site' && !visit.arrival_at ? current : visit.arrival_at;
  const departureAt = input.status === 'completed' ? current : visit.departure_at;
  await env.DB.prepare(
    `UPDATE service_visits SET status = ?, arrival_at = ?, departure_at = ?, updated_by = ?, updated_at = ?
     WHERE id = ? AND tenant_id = ?`
  ).bind(input.status, arrivalAt, departureAt, session.user_id, current, visitId, session.activeMembership.tenant_id).run();
  await appendVisitEvent(env, session, visitId, 'visit.status_changed', { fromStatus: visit.status, toStatus: input.status, note: input.note });
  await recordAudit(env, request, session, 'field_visit.status', 'service_visit', visitId, { fromStatus: visit.status, toStatus: input.status });
  return json({ ok: true, visit: await ensureVisit(env, session, visitId) });
}

async function handleVisitDetail(request, env, visitId) {
  const session = await requireSession(env, request);
  assertFieldPermission(session.activeMembership.role, 'field_service.read');
  const visit = await ensureVisit(env, session, visitId);
  const tenantId = session.activeMembership.tenant_id;
  const [checklist, measurements, events] = await Promise.all([
    env.DB.prepare(`SELECT id, item_key, label, position, status, note, updated_at FROM visit_checklist_items WHERE tenant_id = ? AND visit_id = ? ORDER BY position, item_key`).bind(tenantId, visitId).all(),
    env.DB.prepare(`SELECT id, name, value_number, value_text, unit, recorded_by, created_at FROM visit_measurements WHERE tenant_id = ? AND visit_id = ? ORDER BY created_at DESC`).bind(tenantId, visitId).all(),
    env.DB.prepare(`SELECT e.id, e.event_type, e.from_status, e.to_status, e.note, e.metadata_json, e.created_at, u.name AS actor_name FROM service_visit_events e LEFT JOIN users u ON u.id = e.actor_user_id WHERE e.tenant_id = ? AND e.visit_id = ? ORDER BY e.created_at DESC`).bind(tenantId, visitId).all(),
  ]);
  return json({ visit, checklist: checklist.results || [], measurements: measurements.results || [], events: (events.results || []).map((event) => ({ ...event, metadata: JSON.parse(event.metadata_json || '{}'), metadata_json: undefined })) });
}

async function handleChecklistSave(request, env, visitId) {
  const session = await requireSession(env, request);
  assertFieldPermission(session.activeMembership.role, 'field_service.record');
  await verifyCsrf(request, session);
  const visit = await ensureVisit(env, session, visitId);
  if (['completed', 'cancelled'].includes(visit.status)) throw new Error('FIELD_VISIT_TERMINAL');
  const items = normalizeChecklistItems(await request.json().catch(() => ({})));
  const current = nowIso();
  const statements = items.map((item) => env.DB.prepare(
    `INSERT INTO visit_checklist_items
      (id, tenant_id, visit_id, item_key, label, position, status, note, updated_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(tenant_id, visit_id, item_key) DO UPDATE SET
       label = excluded.label, position = excluded.position, status = excluded.status, note = excluded.note,
       updated_by = excluded.updated_by, updated_at = excluded.updated_at`
  ).bind(crypto.randomUUID(), session.activeMembership.tenant_id, visitId, item.key, item.label, item.position,
    item.status, item.note, session.user_id, current));
  if (statements.length) await env.DB.batch(statements);
  await appendVisitEvent(env, session, visitId, 'visit.checklist_updated', { metadata: { items: items.length } });
  await recordAudit(env, request, session, 'field_visit.checklist', 'service_visit', visitId, { items: items.length });
  return handleVisitDetail(request, env, visitId);
}

async function handleMeasurementCreate(request, env, visitId) {
  const session = await requireSession(env, request);
  assertFieldPermission(session.activeMembership.role, 'field_service.record');
  await verifyCsrf(request, session);
  const visit = await ensureVisit(env, session, visitId);
  if (['completed', 'cancelled'].includes(visit.status)) throw new Error('FIELD_VISIT_TERMINAL');
  const input = normalizeMeasurement(await request.json().catch(() => ({})));
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO visit_measurements (id, tenant_id, visit_id, name, value_number, value_text, unit, recorded_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, session.activeMembership.tenant_id, visitId, input.name, input.valueNumber, input.valueText,
    input.unit, session.user_id, nowIso()).run();
  await appendVisitEvent(env, session, visitId, 'visit.measurement_recorded', { metadata: { measurementId: id, name: input.name, unit: input.unit } });
  await recordAudit(env, request, session, 'field_visit.measurement', 'service_visit', visitId, { measurementId: id, name: input.name });
  return json({ ok: true, measurement: { id, ...input } }, 201);
}

function visitRoute(pathname) {
  let match = pathname.match(/^\/api\/v1\/field\/visits\/([^/]+)$/);
  if (match) return { id: decodeURIComponent(match[1]), action: null };
  match = pathname.match(/^\/api\/v1\/field\/visits\/([^/]+)\/(status|checklist|measurements)$/);
  return match ? { id: decodeURIComponent(match[1]), action: match[2] } : null;
}

export async function routeFieldServiceApi(request, env, pathname) {
  if (pathname === '/api/v1/field/lookups' && request.method === 'GET') return handleLookups(request, env);
  if (pathname === '/api/v1/field/visits' && request.method === 'GET') return handleVisitList(request, env);
  if (pathname === '/api/v1/field/visits' && request.method === 'POST') return handleVisitCreate(request, env);
  const route = visitRoute(pathname);
  if (route && !route.action && request.method === 'GET') return handleVisitDetail(request, env, route.id);
  if (route && !route.action && request.method === 'PATCH') return handleVisitUpdate(request, env, route.id);
  if (route?.action === 'status' && request.method === 'POST') return handleVisitTransition(request, env, route.id);
  if (route?.action === 'checklist' && request.method === 'PUT') return handleChecklistSave(request, env, route.id);
  if (route?.action === 'measurements' && request.method === 'POST') return handleMeasurementCreate(request, env, route.id);
  return null;
}

export function fieldServiceErrorResponse(error) {
  const code = error instanceof Error ? error.message : 'UNKNOWN';
  const mapping = {
    AUTH_REQUIRED: [401, 'Sessão expirada ou inexistente.'],
    AUTH_FORBIDDEN: [403, 'Você não possui permissão para esta ação.'],
    AUTH_CSRF: [403, 'A validação de segurança da solicitação falhou.'],
    API_VALIDATION: [400, 'Os dados enviados são inválidos.'],
    FIELD_WORK_ORDER_REQUIRED: [400, 'Selecione a ordem de serviço.'],
    FIELD_TECHNICIAN_REQUIRED: [400, 'Selecione o técnico.'],
    FIELD_SCHEDULE_REQUIRED: [400, 'Informe o início da visita.'],
    FIELD_DATE_INVALID: [400, 'Uma das datas da visita é inválida.'],
    FIELD_SCHEDULE_INVALID: [400, 'O fim da visita não pode ocorrer antes do início.'],
    FIELD_ACTUAL_TIME_INVALID: [409, 'A saída não pode ocorrer antes da chegada.'],
    FIELD_TECHNICIAN_INVALID: [400, 'O técnico não possui vínculo ativo com esta empresa.'],
    FIELD_WORK_ORDER_INVALID: [409, 'A ordem não está disponível para uma nova visita.'],
    FIELD_WORK_ORDER_ASSIGNMENT_MISMATCH: [409, 'A visita precisa usar o técnico atualmente atribuído à ordem.'],
    FIELD_STATUS_ENDPOINT_REQUIRED: [400, 'Altere o status pelo fluxo da visita.'],
    FIELD_STATUS_INVALID: [400, 'O status da visita é inválido.'],
    FIELD_TRANSITION_INVALID: [409, 'Esta mudança de status da visita não é permitida.'],
    FIELD_CANCEL_NOTE_REQUIRED: [400, 'Informe o motivo do cancelamento.'],
    FIELD_VISIT_NOT_FOUND: [404, 'Visita técnica não encontrada nesta empresa.'],
    FIELD_VISIT_TERMINAL: [409, 'Uma visita concluída ou cancelada não pode mais ser alterada.'],
    FIELD_CHECKLIST_INVALID: [400, 'O checklist enviado é inválido.'],
    FIELD_CHECKLIST_NOTE_REQUIRED: [400, 'Itens não conformes precisam de observação.'],
    FIELD_CHECKLIST_PENDING: [409, 'Conclua o checklist antes de finalizar a visita.'],
    FIELD_MEASUREMENT_INVALID: [400, 'A medição informada é inválida.'],
  };
  if (code.includes('FIELD_TECHNICIAN_INVALID')) return json({ ok: false, code: 'FIELD_TECHNICIAN_INVALID', message: mapping.FIELD_TECHNICIAN_INVALID[1] }, 400);
  if (code.includes('FIELD_WORK_ORDER_INVALID')) return json({ ok: false, code: 'FIELD_WORK_ORDER_INVALID', message: mapping.FIELD_WORK_ORDER_INVALID[1] }, 409);
  const [status, message] = mapping[code] || [500, 'Não foi possível concluir a operação de campo.'];
  return json({ ok: false, code, message }, status);
}
