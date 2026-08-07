import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const schema = await readFile(new URL('../migrations/0003_field_service.sql', import.meta.url), 'utf8');
const integrity = await readFile(new URL('../migrations/0004_field_service_integrity.sql', import.meta.url), 'utf8');
const field = await readFile(new URL('../worker/field-service.js', import.meta.url), 'utf8');
const wrapper = await readFile(new URL('../worker/phase1-worker.js', import.meta.url), 'utf8');
const operationalWrapper = await readFile(new URL('../worker/saas-worker.js', import.meta.url), 'utf8');
const wrangler = await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
const client = await readFile(new URL('../auth/auth-client.js', import.meta.url), 'utf8');

test('schema de campo possui agenda, checklist, medições e histórico', () => {
  for (const table of ['service_visits', 'visit_checklist_items', 'visit_measurements', 'service_visit_events']) {
    assert.match(schema, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`));
  }
  assert.match(schema, /schema_version', '3'/);
  assert.match(integrity, /schema_version', '4'/);
});

test('relações da operação de campo carregam tenant composto', () => {
  assert.match(schema, /FOREIGN KEY \(tenant_id, work_order_id\) REFERENCES work_orders\(tenant_id, id\)/);
  assert.match(schema, /FOREIGN KEY \(tenant_id, technician_user_id\) REFERENCES memberships\(tenant_id, user_id\)/);
  assert.match(schema, /FOREIGN KEY \(tenant_id, visit_id\) REFERENCES service_visits\(tenant_id, id\)/);
  assert.match(schema, /idx_service_visits_tenant_technician/);
});

test('banco exige técnico ativo e a mesma atribuição da OS', () => {
  assert.match(schema, /trg_service_visit_technician_insert/);
  assert.match(schema, /trg_service_visit_work_order_insert/);
  assert.match(schema, /trg_service_visit_work_order_update/);
  assert.match(schema, /w\.technician_user_id = NEW\.technician_user_id/);
  assert.match(schema, /FIELD_TECHNICIAN_INVALID/);
  assert.match(schema, /FIELD_WORK_ORDER_INVALID/);
});

test('OS com visita ativa bloqueia troca de técnico e encerramento', () => {
  assert.match(schema, /trg_work_order_technician_active_visit_guard/);
  assert.match(integrity, /trg_work_order_terminal_active_visit_guard/);
  assert.match(schema, /WORK_ORDER_ACTIVE_VISIT_EXISTS/);
  assert.match(integrity, /WORK_ORDER_ACTIVE_VISIT_EXISTS/);
  assert.match(integrity, /NEW\.status IN \('completed', 'cancelled'\)/);
  assert.match(operationalWrapper, /WORK_ORDER_ACTIVE_VISIT_EXISTS/);
});

test('datas reais e planejadas possuem guardas no D1', () => {
  assert.match(schema, /trg_service_visit_schedule_insert/);
  assert.match(schema, /trg_service_visit_schedule_update/);
  assert.match(schema, /trg_service_visit_actual_time_update/);
  assert.match(schema, /FIELD_SCHEDULE_INVALID/);
  assert.match(schema, /FIELD_ACTUAL_TIME_INVALID/);
});

test('histórico da visita é imutável', () => {
  assert.match(schema, /trg_service_visit_events_immutable_update/);
  assert.match(schema, /trg_service_visit_events_immutable_delete/);
  assert.doesNotMatch(field, /UPDATE service_visit_events/);
  assert.doesNotMatch(field, /DELETE FROM service_visit_events/);
});

test('técnico recebe filtro obrigatório por identidade em visitas e lookups', () => {
  assert.match(field, /session\.activeMembership\.role === 'tecnico'/);
  assert.match(field, /v\.technician_user_id = \?/);
  assert.match(wrapper, /body\.workOrders = .*technician_user_id === session\.user_id/);
  assert.match(wrapper, /body\.technicians = .*user_id === session\.user_id/);
});

test('worker final e cliente expõem somente rotas autenticadas de campo', () => {
  assert.match(wrangler, /"main": "\.\/worker\/phase1-worker\.js"/);
  assert.match(wrapper, /routeFieldServiceApi/);
  assert.match(client, /\/api\/v1\/field\/visits/);
  assert.match(client, /saveVisitChecklist/);
  assert.match(client, /addVisitMeasurement/);
});
