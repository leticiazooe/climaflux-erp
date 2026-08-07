import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const schema = await readFile(new URL('../migrations/0005_inventory.sql', import.meta.url), 'utf8');
const integrity = await readFile(new URL('../migrations/0006_inventory_integrity.sql', import.meta.url), 'utf8');
const source = await readFile(new URL('../worker/inventory.js', import.meta.url), 'utf8');
const wrapper = await readFile(new URL('../worker/phase1-worker.js', import.meta.url), 'utf8');
const client = await readFile(new URL('../auth/auth-client.js', import.meta.url), 'utf8');

test('schema de estoque possui locais, itens, saldos e livro de movimentos', () => {
  for (const table of ['stock_locations', 'stock_items', 'stock_balances', 'stock_movements']) {
    assert.match(schema, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`));
  }
  assert.match(schema, /schema_version', '5'/);
  assert.match(integrity, /schema_version', '6'/);
});

test('saldo e movimentos usam chaves compostas por tenant', () => {
  assert.match(schema, /PRIMARY KEY \(tenant_id, item_id, location_id\)/);
  assert.match(schema, /FOREIGN KEY \(tenant_id, item_id\) REFERENCES stock_items\(tenant_id, id\)/);
  assert.match(schema, /FOREIGN KEY \(tenant_id, location_id\) REFERENCES stock_locations\(tenant_id, id\)/);
  assert.match(schema, /UNIQUE \(tenant_id, request_key\)/);
});

test('banco bloqueia saldo negativo e aplica saldo por trigger', () => {
  assert.match(schema, /trg_stock_movement_negative_guard/);
  assert.match(schema, /INVENTORY_NEGATIVE_BALANCE/);
  assert.match(schema, /trg_stock_movement_apply_balance/);
  assert.match(schema, /quantity = stock_balances\.quantity \+ excluded\.quantity/);
});

test('livro de movimentações é imutável', () => {
  assert.match(schema, /trg_stock_movements_immutable_update/);
  assert.match(schema, /trg_stock_movements_immutable_delete/);
  assert.doesNotMatch(source, /UPDATE stock_movements/);
  assert.doesNotMatch(source, /DELETE FROM stock_movements/);
});

test('saldo inicial não pode ser reaplicado', () => {
  assert.match(integrity, /trg_inventory_opening_once/);
  assert.match(integrity, /INVENTORY_OPENING_ALREADY_EXISTS/);
});

test('devolução de OS não pode fabricar saldo', () => {
  assert.match(integrity, /trg_inventory_work_order_return_limit/);
  assert.match(integrity, /-SUM\(m\.quantity_delta\)/);
  assert.match(integrity, /INVENTORY_RETURN_EXCEEDS_ISSUED/);
});

test('consumo em OS encerrada é bloqueado', () => {
  assert.match(integrity, /trg_inventory_work_order_issue_status/);
  assert.match(integrity, /w\.status NOT IN \('completed', 'cancelled'\)/);
});

test('API de estoque deriva tenant da sessão e exige idempotência', () => {
  assert.match(source, /session\.activeMembership\.tenant_id/g);
  assert.doesNotMatch(source, /body\.tenantId/);
  assert.match(source, /Idempotency-Key/);
  assert.match(source, /request_key = \?/);
});

test('técnico só movimenta material vinculado à própria OS', () => {
  assert.match(source, /session\.activeMembership\.role === 'tecnico'/);
  assert.match(source, /row\.technician_user_id !== session\.user_id/);
  assert.match(source, /TECH_TYPES\.has\(input\.movementType\)/);
});

test('worker e cliente expõem o módulo autenticado de estoque', () => {
  assert.match(wrapper, /routeInventoryApi/);
  assert.match(wrapper, /\/api\/v1\/inventory\/movements/);
  assert.match(client, /listStockBalances/);
  assert.match(client, /createStockMovement/);
});
