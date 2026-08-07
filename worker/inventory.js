import { requireSession, recordAudit } from './auth.js';
import { assertPermission } from './policy.js';
import { json, nowIso, verifyCsrf } from './security.js';

const MOVEMENT_TYPES = Object.freeze([
  'opening', 'receipt', 'issue', 'return', 'adjustment_in', 'adjustment_out', 'work_order_issue', 'work_order_return',
]);
const INBOUND_TYPES = new Set(['opening', 'receipt', 'return', 'adjustment_in', 'work_order_return']);
const ADJUSTMENT_TYPES = new Set(['adjustment_in', 'adjustment_out']);
const TECH_TYPES = new Set(['work_order_issue', 'work_order_return']);

function cleanText(value, maxLength, { nullable = true } = {}) {
  const text = String(value ?? '').trim();
  if (!text) return nullable ? null : '';
  return text.slice(0, maxLength);
}

function normalizePagination(searchParams) {
  const limitRaw = Number.parseInt(String(searchParams.get('limit') || '50'), 10);
  const offsetRaw = Number.parseInt(String(searchParams.get('offset') || '0'), 10);
  return {
    limit: Number.isFinite(limitRaw) ? Math.min(100, Math.max(1, limitRaw)) : 50,
    offset: Number.isFinite(offsetRaw) ? Math.max(0, offsetRaw) : 0,
  };
}

export function normalizeStockItemInput(input, { partial = false } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('API_VALIDATION');
  const has = (key) => Object.prototype.hasOwnProperty.call(input, key);
  const output = {};
  if (!partial || has('sku')) {
    const sku = cleanText(input.sku, 80, { nullable: false })?.toUpperCase();
    if (!sku || !/^[A-Z0-9][A-Z0-9._/-]{1,79}$/.test(sku)) throw new Error('INVENTORY_SKU_INVALID');
    output.sku = sku;
  }
  if (!partial || has('name')) {
    const name = cleanText(input.name, 200, { nullable: false });
    if (!name || name.length < 2) throw new Error('INVENTORY_ITEM_NAME_REQUIRED');
    output.name = name;
  }
  if (!partial || has('description')) output.description = cleanText(input.description, 2000);
  if (!partial || has('unit')) {
    const unit = cleanText(input.unit || 'un', 20, { nullable: false })?.toLowerCase();
    if (!unit || !/^[a-z0-9._/-]{1,20}$/.test(unit)) throw new Error('INVENTORY_UNIT_INVALID');
    output.unit = unit;
  }
  if (!partial || has('minimumQuantity')) {
    const value = Number(input.minimumQuantity ?? 0);
    if (!Number.isFinite(value) || value < 0) throw new Error('INVENTORY_MINIMUM_INVALID');
    output.minimumQuantity = value;
  }
  if (!partial || has('referenceCostCents')) {
    const value = Number(input.referenceCostCents ?? 0);
    if (!Number.isInteger(value) || value < 0) throw new Error('INVENTORY_COST_INVALID');
    output.referenceCostCents = value;
  }
  if (!partial || has('status')) {
    const status = String(input.status || 'active').toLowerCase();
    if (!['active', 'inactive'].includes(status)) throw new Error('INVENTORY_STATUS_INVALID');
    output.status = status;
  }
  if (partial && !Object.keys(output).length) throw new Error('API_VALIDATION');
  return output;
}

export function normalizeStockLocationInput(input, { partial = false } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('API_VALIDATION');
  const has = (key) => Object.prototype.hasOwnProperty.call(input, key);
  const output = {};
  if (!partial || has('code')) {
    const code = cleanText(input.code, 60, { nullable: false })?.toUpperCase();
    if (!code || !/^[A-Z0-9][A-Z0-9._/-]{1,59}$/.test(code)) throw new Error('INVENTORY_LOCATION_CODE_INVALID');
    output.code = code;
  }
  if (!partial || has('name')) {
    const name = cleanText(input.name, 160, { nullable: false });
    if (!name || name.length < 2) throw new Error('INVENTORY_LOCATION_NAME_REQUIRED');
    output.name = name;
  }
  if (!partial || has('status')) {
    const status = String(input.status || 'active').toLowerCase();
    if (!['active', 'inactive'].includes(status)) throw new Error('INVENTORY_STATUS_INVALID');
    output.status = status;
  }
  if (partial && !Object.keys(output).length) throw new Error('API_VALIDATION');
  return output;
}

export function normalizeStockMovementInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('API_VALIDATION');
  const itemId = cleanText(input.itemId, 100, { nullable: false });
  const locationId = cleanText(input.locationId, 100, { nullable: false });
  const movementType = String(input.movementType || '').toLowerCase();
  const quantity = Number(input.quantity);
  const cost = input.unitCostCents === '' || input.unitCostCents === null || input.unitCostCents === undefined
    ? null : Number(input.unitCostCents);
  const referenceType = cleanText(input.referenceType, 80);
  const referenceId = cleanText(input.referenceId, 100);
  const notes = cleanText(input.notes, 2000);
  if (!itemId) throw new Error('INVENTORY_ITEM_REQUIRED');
  if (!locationId) throw new Error('INVENTORY_LOCATION_REQUIRED');
  if (!MOVEMENT_TYPES.includes(movementType)) throw new Error('INVENTORY_MOVEMENT_TYPE_INVALID');
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1_000_000_000) throw new Error('INVENTORY_QUANTITY_INVALID');
  if (cost !== null && (!Number.isInteger(cost) || cost < 0)) throw new Error('INVENTORY_COST_INVALID');
  if (TECH_TYPES.has(movementType) && (!referenceId || referenceType !== 'work_order')) throw new Error('INVENTORY_WORK_ORDER_REQUIRED');
  return {
    itemId,
    locationId,
    movementType,
    quantity,
    quantityDelta: INBOUND_TYPES.has(movementType) ? quantity : -quantity,
    unitCostCents: cost,
    referenceType,
    referenceId,
    notes,
  };
}

async function ensureItem(env, tenantId, itemId) {
  const item = await env.DB.prepare(
    `SELECT id, sku, name, unit, minimum_quantity, reference_cost_cents, status
     FROM stock_items WHERE tenant_id = ? AND id = ?`
  ).bind(tenantId, itemId).first();
  if (!item) throw new Error('INVENTORY_ITEM_NOT_FOUND');
  return item;
}

async function ensureLocation(env, tenantId, locationId) {
  const location = await env.DB.prepare(
    `SELECT id, code, name, status FROM stock_locations WHERE tenant_id = ? AND id = ?`
  ).bind(tenantId, locationId).first();
  if (!location) throw new Error('INVENTORY_LOCATION_NOT_FOUND');
  return location;
}

async function ensureTechnicianWorkOrder(env, session, workOrderId) {
  const row = await env.DB.prepare(
    `SELECT id, code, technician_user_id, status
     FROM work_orders WHERE tenant_id = ? AND id = ? AND deleted_at IS NULL`
  ).bind(session.activeMembership.tenant_id, workOrderId).first();
  if (!row) throw new Error('INVENTORY_WORK_ORDER_INVALID');
  if (session.activeMembership.role === 'tecnico' && row.technician_user_id !== session.user_id) throw new Error('AUTH_FORBIDDEN');
  if (row.status === 'cancelled') throw new Error('INVENTORY_WORK_ORDER_INVALID');
  return row;
}

async function handleItemList(request, env) {
  const session = await requireSession(env, request);
  assertPermission(session.activeMembership.role, 'inventory.read');
  const url = new URL(request.url);
  const { limit, offset } = normalizePagination(url.searchParams);
  const search = cleanText(url.searchParams.get('q'), 120);
  const status = String(url.searchParams.get('status') || '').toLowerCase();
  const low = url.searchParams.get('low') === '1';
  if (status && !['active', 'inactive'].includes(status)) throw new Error('INVENTORY_STATUS_INVALID');
  const tenantId = session.activeMembership.tenant_id;
  const where = ['i.tenant_id = ?'];
  const values = [tenantId];
  if (search) { where.push('(i.sku LIKE ? OR i.name LIKE ? OR i.description LIKE ?)'); const q = `%${search}%`; values.push(q, q, q); }
  if (status) { where.push('i.status = ?'); values.push(status); }
  const having = low ? 'HAVING COALESCE(SUM(b.quantity), 0) <= i.minimum_quantity' : '';
  const rows = await env.DB.prepare(
    `SELECT i.id, i.sku, i.name, i.description, i.unit, i.minimum_quantity, i.reference_cost_cents, i.status,
            i.created_at, i.updated_at, COALESCE(SUM(b.quantity), 0) AS total_quantity
     FROM stock_items i LEFT JOIN stock_balances b ON b.tenant_id = i.tenant_id AND b.item_id = i.id
     WHERE ${where.join(' AND ')} GROUP BY i.id ${having}
     ORDER BY i.name, i.sku LIMIT ? OFFSET ?`
  ).bind(...values, limit, offset).all();
  return json({ items: rows.results || [], page: { limit, offset } });
}

async function handleItemCreate(request, env) {
  const session = await requireSession(env, request);
  assertPermission(session.activeMembership.role, 'inventory.write');
  await verifyCsrf(request, session);
  const input = normalizeStockItemInput(await request.json().catch(() => ({})));
  const id = crypto.randomUUID();
  const current = nowIso();
  await env.DB.prepare(
    `INSERT INTO stock_items
      (id, tenant_id, sku, name, description, unit, minimum_quantity, reference_cost_cents, status,
       created_by, updated_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, session.activeMembership.tenant_id, input.sku, input.name, input.description, input.unit,
    input.minimumQuantity, input.referenceCostCents, input.status, session.user_id, session.user_id, current, current).run();
  await recordAudit(env, request, session, 'inventory.item.create', 'stock_item', id, { sku: input.sku });
  return json({ ok: true, item: await ensureItem(env, session.activeMembership.tenant_id, id) }, 201);
}

async function handleItemUpdate(request, env, itemId) {
  const session = await requireSession(env, request);
  assertPermission(session.activeMembership.role, 'inventory.write');
  await verifyCsrf(request, session);
  await ensureItem(env, session.activeMembership.tenant_id, itemId);
  const input = normalizeStockItemInput(await request.json().catch(() => ({})), { partial: true });
  const columns = { sku: 'sku', name: 'name', description: 'description', unit: 'unit', minimumQuantity: 'minimum_quantity', referenceCostCents: 'reference_cost_cents', status: 'status' };
  const entries = Object.entries(input).filter(([key]) => columns[key]);
  const assignments = entries.map(([key]) => `${columns[key]} = ?`);
  const values = entries.map(([, value]) => value);
  assignments.push('updated_by = ?', 'updated_at = ?');
  values.push(session.user_id, nowIso(), itemId, session.activeMembership.tenant_id);
  await env.DB.prepare(`UPDATE stock_items SET ${assignments.join(', ')} WHERE id = ? AND tenant_id = ?`).bind(...values).run();
  await recordAudit(env, request, session, 'inventory.item.update', 'stock_item', itemId, { fields: entries.map(([key]) => key) });
  return json({ ok: true, item: await ensureItem(env, session.activeMembership.tenant_id, itemId) });
}

async function handleLocationList(request, env) {
  const session = await requireSession(env, request);
  assertPermission(session.activeMembership.role, 'inventory.read');
  const rows = await env.DB.prepare(
    `SELECT id, code, name, status, created_at, updated_at FROM stock_locations
     WHERE tenant_id = ? ORDER BY status DESC, name, code`
  ).bind(session.activeMembership.tenant_id).all();
  return json({ items: rows.results || [] });
}

async function handleLocationCreate(request, env) {
  const session = await requireSession(env, request);
  assertPermission(session.activeMembership.role, 'inventory.write');
  await verifyCsrf(request, session);
  const input = normalizeStockLocationInput(await request.json().catch(() => ({})));
  const id = crypto.randomUUID();
  const current = nowIso();
  await env.DB.prepare(
    `INSERT INTO stock_locations (id, tenant_id, code, name, status, created_by, updated_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, session.activeMembership.tenant_id, input.code, input.name, input.status,
    session.user_id, session.user_id, current, current).run();
  await recordAudit(env, request, session, 'inventory.location.create', 'stock_location', id, { code: input.code });
  return json({ ok: true, location: await ensureLocation(env, session.activeMembership.tenant_id, id) }, 201);
}

async function handleLocationUpdate(request, env, locationId) {
  const session = await requireSession(env, request);
  assertPermission(session.activeMembership.role, 'inventory.write');
  await verifyCsrf(request, session);
  await ensureLocation(env, session.activeMembership.tenant_id, locationId);
  const input = normalizeStockLocationInput(await request.json().catch(() => ({})), { partial: true });
  const columns = { code: 'code', name: 'name', status: 'status' };
  const entries = Object.entries(input).filter(([key]) => columns[key]);
  const assignments = entries.map(([key]) => `${columns[key]} = ?`);
  const values = entries.map(([, value]) => value);
  assignments.push('updated_by = ?', 'updated_at = ?');
  values.push(session.user_id, nowIso(), locationId, session.activeMembership.tenant_id);
  await env.DB.prepare(`UPDATE stock_locations SET ${assignments.join(', ')} WHERE id = ? AND tenant_id = ?`).bind(...values).run();
  await recordAudit(env, request, session, 'inventory.location.update', 'stock_location', locationId, { fields: entries.map(([key]) => key) });
  return json({ ok: true, location: await ensureLocation(env, session.activeMembership.tenant_id, locationId) });
}

async function handleBalanceList(request, env) {
  const session = await requireSession(env, request);
  assertPermission(session.activeMembership.role, 'inventory.read');
  const url = new URL(request.url);
  const locationId = cleanText(url.searchParams.get('locationId'), 100);
  const itemId = cleanText(url.searchParams.get('itemId'), 100);
  const low = url.searchParams.get('low') === '1';
  const where = ['b.tenant_id = ?'];
  const values = [session.activeMembership.tenant_id];
  if (locationId) { where.push('b.location_id = ?'); values.push(locationId); }
  if (itemId) { where.push('b.item_id = ?'); values.push(itemId); }
  if (low) where.push('b.quantity <= i.minimum_quantity');
  const rows = await env.DB.prepare(
    `SELECT b.item_id, b.location_id, b.quantity, b.updated_at,
            i.sku, i.name AS item_name, i.unit, i.minimum_quantity, i.reference_cost_cents,
            l.code AS location_code, l.name AS location_name
     FROM stock_balances b
     JOIN stock_items i ON i.tenant_id = b.tenant_id AND i.id = b.item_id
     JOIN stock_locations l ON l.tenant_id = b.tenant_id AND l.id = b.location_id
     WHERE ${where.join(' AND ')} ORDER BY i.name, l.name`
  ).bind(...values).all();
  return json({ items: rows.results || [] });
}

async function handleMovementList(request, env) {
  const session = await requireSession(env, request);
  assertPermission(session.activeMembership.role, 'inventory.read');
  const url = new URL(request.url);
  const { limit, offset } = normalizePagination(url.searchParams);
  const itemId = cleanText(url.searchParams.get('itemId'), 100);
  const locationId = cleanText(url.searchParams.get('locationId'), 100);
  const referenceId = cleanText(url.searchParams.get('referenceId'), 100);
  const where = ['m.tenant_id = ?'];
  const values = [session.activeMembership.tenant_id];
  if (itemId) { where.push('m.item_id = ?'); values.push(itemId); }
  if (locationId) { where.push('m.location_id = ?'); values.push(locationId); }
  if (referenceId) { where.push('m.reference_id = ?'); values.push(referenceId); }
  const rows = await env.DB.prepare(
    `SELECT m.id, m.movement_type, m.quantity_delta, m.unit_cost_cents, m.reference_type, m.reference_id,
            m.notes, m.actor_user_id, m.created_at, i.sku, i.name AS item_name, i.unit,
            l.code AS location_code, l.name AS location_name, u.name AS actor_name
     FROM stock_movements m
     JOIN stock_items i ON i.tenant_id = m.tenant_id AND i.id = m.item_id
     JOIN stock_locations l ON l.tenant_id = m.tenant_id AND l.id = m.location_id
     LEFT JOIN users u ON u.id = m.actor_user_id
     WHERE ${where.join(' AND ')} ORDER BY m.created_at DESC LIMIT ? OFFSET ?`
  ).bind(...values, limit, offset).all();
  return json({ items: rows.results || [], page: { limit, offset } });
}

async function handleMovementCreate(request, env) {
  const session = await requireSession(env, request);
  await verifyCsrf(request, session);
  const input = normalizeStockMovementInput(await request.json().catch(() => ({})));
  const requestKey = cleanText(request.headers.get('Idempotency-Key'), 200, { nullable: false });
  if (!requestKey || requestKey.length < 8) throw new Error('IDEMPOTENCY_REQUIRED');

  if (session.activeMembership.role === 'tecnico') {
    assertPermission(session.activeMembership.role, 'inventory.issue');
    if (!TECH_TYPES.has(input.movementType)) throw new Error('AUTH_FORBIDDEN');
    await ensureTechnicianWorkOrder(env, session, input.referenceId);
  } else if (ADJUSTMENT_TYPES.has(input.movementType)) {
    assertPermission(session.activeMembership.role, 'inventory.adjust');
  } else {
    assertPermission(session.activeMembership.role, 'inventory.move');
    if (TECH_TYPES.has(input.movementType)) await ensureTechnicianWorkOrder(env, session, input.referenceId);
  }

  const tenantId = session.activeMembership.tenant_id;
  const existing = await env.DB.prepare(
    `SELECT id FROM stock_movements WHERE tenant_id = ? AND request_key = ?`
  ).bind(tenantId, requestKey).first();
  if (existing) {
    const movement = await env.DB.prepare(`SELECT * FROM stock_movements WHERE tenant_id = ? AND id = ?`).bind(tenantId, existing.id).first();
    return json({ ok: true, replayed: true, movement });
  }

  await ensureItem(env, tenantId, input.itemId);
  await ensureLocation(env, tenantId, input.locationId);
  const id = crypto.randomUUID();
  const current = nowIso();
  await env.DB.prepare(
    `INSERT INTO stock_movements
      (id, tenant_id, item_id, location_id, movement_type, quantity_delta, unit_cost_cents,
       reference_type, reference_id, notes, request_key, actor_user_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, tenantId, input.itemId, input.locationId, input.movementType, input.quantityDelta,
    input.unitCostCents, input.referenceType, input.referenceId, input.notes, requestKey, session.user_id, current).run();
  const [movement, balance] = await Promise.all([
    env.DB.prepare(`SELECT * FROM stock_movements WHERE tenant_id = ? AND id = ?`).bind(tenantId, id).first(),
    env.DB.prepare(`SELECT quantity FROM stock_balances WHERE tenant_id = ? AND item_id = ? AND location_id = ?`).bind(tenantId, input.itemId, input.locationId).first(),
  ]);
  await recordAudit(env, request, session, 'inventory.movement.create', 'stock_movement', id, {
    itemId: input.itemId, locationId: input.locationId, movementType: input.movementType,
    quantityDelta: input.quantityDelta, referenceType: input.referenceType, referenceId: input.referenceId,
  });
  return json({ ok: true, movement, balance: Number(balance?.quantity || 0) }, 201);
}

function entityId(pathname, entity) {
  const match = pathname.match(new RegExp(`^/api/v1/inventory/${entity}/([^/]+)$`));
  return match ? decodeURIComponent(match[1]) : null;
}

export async function routeInventoryApi(request, env, pathname) {
  if (pathname === '/api/v1/inventory/items' && request.method === 'GET') return handleItemList(request, env);
  if (pathname === '/api/v1/inventory/items' && request.method === 'POST') return handleItemCreate(request, env);
  const itemId = entityId(pathname, 'items');
  if (itemId && request.method === 'PATCH') return handleItemUpdate(request, env, itemId);

  if (pathname === '/api/v1/inventory/locations' && request.method === 'GET') return handleLocationList(request, env);
  if (pathname === '/api/v1/inventory/locations' && request.method === 'POST') return handleLocationCreate(request, env);
  const locationId = entityId(pathname, 'locations');
  if (locationId && request.method === 'PATCH') return handleLocationUpdate(request, env, locationId);

  if (pathname === '/api/v1/inventory/balances' && request.method === 'GET') return handleBalanceList(request, env);
  if (pathname === '/api/v1/inventory/movements' && request.method === 'GET') return handleMovementList(request, env);
  if (pathname === '/api/v1/inventory/movements' && request.method === 'POST') return handleMovementCreate(request, env);
  return null;
}

export function inventoryErrorResponse(error) {
  const code = error instanceof Error ? error.message : 'UNKNOWN';
  if (/UNIQUE constraint failed: stock_items\.tenant_id, stock_items\.sku/i.test(code)) return json({ ok: false, code: 'INVENTORY_SKU_CONFLICT', message: 'Já existe um item com este SKU na empresa.' }, 409);
  if (/UNIQUE constraint failed: stock_locations\.tenant_id, stock_locations\.code/i.test(code)) return json({ ok: false, code: 'INVENTORY_LOCATION_CONFLICT', message: 'Já existe um local com este código na empresa.' }, 409);
  if (code.includes('INVENTORY_NEGATIVE_BALANCE')) return json({ ok: false, code: 'INVENTORY_NEGATIVE_BALANCE', message: 'A movimentação deixaria o saldo negativo e foi bloqueada.' }, 409);
  if (code.includes('INVENTORY_ITEM_INACTIVE')) return json({ ok: false, code: 'INVENTORY_ITEM_INACTIVE', message: 'O item está inativo para movimentações.' }, 409);
  if (code.includes('INVENTORY_LOCATION_INACTIVE')) return json({ ok: false, code: 'INVENTORY_LOCATION_INACTIVE', message: 'O local está inativo para movimentações.' }, 409);
  const mapping = {
    AUTH_REQUIRED: [401, 'Sessão expirada ou inexistente.'],
    AUTH_FORBIDDEN: [403, 'Você não possui permissão para esta ação.'],
    AUTH_CSRF: [403, 'A validação de segurança da solicitação falhou.'],
    API_VALIDATION: [400, 'Os dados enviados são inválidos.'],
    IDEMPOTENCY_REQUIRED: [400, 'A movimentação precisa de uma chave idempotente.'],
    INVENTORY_SKU_INVALID: [400, 'Informe um SKU válido.'],
    INVENTORY_ITEM_NAME_REQUIRED: [400, 'Informe o nome do item.'],
    INVENTORY_UNIT_INVALID: [400, 'Informe uma unidade válida.'],
    INVENTORY_MINIMUM_INVALID: [400, 'O estoque mínimo é inválido.'],
    INVENTORY_COST_INVALID: [400, 'O custo informado é inválido.'],
    INVENTORY_STATUS_INVALID: [400, 'O status informado é inválido.'],
    INVENTORY_LOCATION_CODE_INVALID: [400, 'Informe um código válido para o local.'],
    INVENTORY_LOCATION_NAME_REQUIRED: [400, 'Informe o nome do local.'],
    INVENTORY_ITEM_REQUIRED: [400, 'Selecione o item.'],
    INVENTORY_LOCATION_REQUIRED: [400, 'Selecione o local.'],
    INVENTORY_MOVEMENT_TYPE_INVALID: [400, 'O tipo de movimentação é inválido.'],
    INVENTORY_QUANTITY_INVALID: [400, 'Informe uma quantidade positiva válida.'],
    INVENTORY_WORK_ORDER_REQUIRED: [400, 'Esta movimentação precisa estar vinculada a uma ordem de serviço.'],
    INVENTORY_ITEM_NOT_FOUND: [404, 'Item não encontrado nesta empresa.'],
    INVENTORY_LOCATION_NOT_FOUND: [404, 'Local de estoque não encontrado nesta empresa.'],
    INVENTORY_WORK_ORDER_INVALID: [409, 'A ordem de serviço informada não está disponível para esta movimentação.'],
    INVENTORY_DIRECTION_INVALID: [400, 'A direção da movimentação é incompatível com o tipo selecionado.'],
  };
  const [status, message] = mapping[code] || [500, 'Não foi possível concluir a operação de estoque.'];
  return json({ ok: false, code, message }, status);
}
