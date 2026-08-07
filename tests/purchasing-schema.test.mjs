import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const schema = await readFile(new URL('../migrations/0007_purchasing.sql', import.meta.url), 'utf8');
const source = await readFile(new URL('../worker/purchasing.js', import.meta.url), 'utf8');
const wrapper = await readFile(new URL('../worker/phase1-worker.js', import.meta.url), 'utf8');
const client = await readFile(new URL('../auth/auth-client.js', import.meta.url), 'utf8');

test('schema de compras possui fornecedores, pedidos, linhas e recebimentos', () => {
  for (const table of ['suppliers', 'purchase_orders', 'purchase_order_lines', 'purchase_receipts', 'purchase_receipt_lines']) {
    assert.match(schema, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`));
  }
  assert.match(schema, /schema_version', '7'/);
});

test('entidades de compras usam chaves compostas por tenant', () => {
  assert.match(schema, /FOREIGN KEY \(tenant_id, supplier_id\) REFERENCES suppliers\(tenant_id, id\)/);
  assert.match(schema, /FOREIGN KEY \(tenant_id, purchase_order_id\) REFERENCES purchase_orders\(tenant_id, id\)/);
  assert.match(schema, /FOREIGN KEY \(tenant_id, item_id\) REFERENCES stock_items\(tenant_id, id\)/);
  assert.match(schema, /FOREIGN KEY \(tenant_id, location_id\) REFERENCES stock_locations\(tenant_id, id\)/);
});

test('recebimento valida saldo pendente antes de gravar', () => {
  assert.match(schema, /trg_purchase_receipt_line_validate/);
  assert.match(schema, /NEW\.quantity_received <= \(pol\.quantity_ordered - pol\.quantity_received\)/);
  assert.match(schema, /PURCHASE_RECEIPT_QUANTITY_INVALID/);
});

test('cada linha recebida gera movimento de estoque automaticamente', () => {
  assert.match(schema, /trg_purchase_receipt_line_apply/);
  assert.match(schema, /INSERT INTO stock_movements/);
  assert.match(schema, /'receipt', NEW\.quantity_received/);
  assert.match(schema, /'purchase_receipt'/);
  assert.match(schema, /UPDATE purchase_order_lines/);
  assert.match(schema, /partially_received/);
  assert.match(schema, /received/);
});

test('recebimentos são imutáveis', () => {
  assert.match(schema, /trg_purchase_receipts_immutable_update/);
  assert.match(schema, /trg_purchase_receipts_immutable_delete/);
  assert.match(schema, /trg_purchase_receipt_lines_immutable_update/);
  assert.match(schema, /trg_purchase_receipt_lines_immutable_delete/);
  assert.doesNotMatch(source, /UPDATE purchase_receipts/);
  assert.doesNotMatch(source, /DELETE FROM purchase_receipts/);
});

test('pedido e recebimento usam D1 batch para sequência atômica', () => {
  const batches = source.match(/env\.DB\.batch\(statements\)/g) || [];
  assert.ok(batches.length >= 2);
  assert.match(source, /Idempotency-Key/);
  assert.match(schema, /UNIQUE \(tenant_id, request_key\)/);
});

test('API de compras deriva tenant da sessão', () => {
  assert.match(source, /session\.activeMembership\.tenant_id/g);
  assert.doesNotMatch(source, /body\.tenantId/);
  assert.doesNotMatch(source, /searchParams\.get\('tenantId'\)/);
});

test('worker e cliente expõem rotas autenticadas de compras', () => {
  assert.match(wrapper, /routePurchasingApi/);
  assert.match(wrapper, /\/api\/v1\/purchases\/orders/);
  assert.match(client, /purchaseLookups/);
  assert.match(client, /receivePurchaseOrder/);
});
