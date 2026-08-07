import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const schema = await readFile(new URL('../migrations/0002_operational_core.sql', import.meta.url), 'utf8');
const source = await readFile(new URL('../worker/operations.js', import.meta.url), 'utf8');
const wrapper = await readFile(new URL('../worker/saas-worker.js', import.meta.url), 'utf8');

test('schema operacional possui equipamentos, ordens e histórico', () => {
  assert.match(schema, /CREATE TABLE IF NOT EXISTS equipment/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS work_orders/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS work_order_events/);
  assert.match(schema, /schema_version', '2'/);
});

test('relacionamentos operacionais são compostos por tenant', () => {
  assert.match(schema, /FOREIGN KEY \(tenant_id, customer_id\) REFERENCES customers\(tenant_id, id\)/);
  assert.match(schema, /FOREIGN KEY \(tenant_id, equipment_id\) REFERENCES equipment\(tenant_id, id\)/);
  assert.match(schema, /FOREIGN KEY \(tenant_id, work_order_id\) REFERENCES work_orders\(tenant_id, id\)/);
  assert.match(schema, /idx_work_orders_tenant_technician/);
});

test('banco impede equipamento de outro cliente em uma ordem', () => {
  assert.match(schema, /trg_work_order_equipment_customer_insert/);
  assert.match(schema, /e\.customer_id = NEW\.customer_id/);
  assert.match(schema, /WORK_ORDER_EQUIPMENT_CUSTOMER_MISMATCH/);
});

test('histórico não pode ser alterado e não possui endpoint de mutação', () => {
  assert.match(schema, /trg_work_order_events_immutable_update/);
  assert.doesNotMatch(source, /UPDATE work_order_events/);
  assert.doesNotMatch(source, /DELETE FROM work_order_events/);
});

test('queries operacionais derivam tenant da sessão', () => {
  assert.match(source, /session\.activeMembership\.tenant_id/);
  assert.doesNotMatch(source, /body\.tenantId/);
  assert.doesNotMatch(source, /searchParams\.get\('tenantId'\)/);
});

test('técnico recebe filtro obrigatório pela própria identidade', () => {
  assert.match(source, /session\.activeMembership\.role === 'tecnico'/);
  assert.match(source, /w\.technician_user_id = \?/);
  assert.match(source, /existing\.technician_user_id !== session\.user_id/);
});

test('router operacional envolve o Worker base sem expor assets', () => {
  assert.match(wrapper, /baseWorker\.fetch/);
  assert.match(wrapper, /routeOperationsApi/);
  assert.match(wrapper, /\/api\/v1\/work-orders/);
  assert.match(wrapper, /\/api\/v1\/equipment/);
});
