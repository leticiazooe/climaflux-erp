import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeStockItemInput,
  normalizeStockLocationInput,
  normalizeStockMovementInput,
} from '../worker/inventory.js';
import { can } from '../worker/policy.js';

test('RBAC de estoque separa gestão, estoque e técnico', () => {
  assert.equal(can('admin', 'inventory.adjust'), true);
  assert.equal(can('gestor', 'inventory.move'), true);
  assert.equal(can('estoque', 'inventory.write'), true);
  assert.equal(can('atendimento', 'inventory.read'), true);
  assert.equal(can('atendimento', 'inventory.move'), false);
  assert.equal(can('tecnico', 'inventory.issue'), true);
  assert.equal(can('tecnico', 'inventory.adjust'), false);
});

test('item normaliza SKU, unidade e valores financeiros', () => {
  const item = normalizeStockItemInput({
    sku: ' filtro-001 ', name: 'Filtro secador', unit: 'UN', minimumQuantity: '3.5', referenceCostCents: 1299,
  });
  assert.equal(item.sku, 'FILTRO-001');
  assert.equal(item.unit, 'un');
  assert.equal(item.minimumQuantity, 3.5);
  assert.equal(item.referenceCostCents, 1299);
  assert.throws(() => normalizeStockItemInput({ sku: '!', name: 'Teste' }), /INVENTORY_SKU_INVALID/);
});

test('local de estoque exige código e nome válidos', () => {
  assert.deepEqual(normalizeStockLocationInput({ code: ' almox-01 ', name: ' Principal ' }), {
    code: 'ALMOX-01', name: 'Principal', status: 'active',
  });
  assert.throws(() => normalizeStockLocationInput({ code: 'x', name: 'A' }), /INVENTORY_LOCATION_CODE_INVALID|INVENTORY_LOCATION_NAME_REQUIRED/);
});

test('movimentação transforma quantidade em delta conforme a direção', () => {
  const receipt = normalizeStockMovementInput({ itemId: 'i1', locationId: 'l1', movementType: 'receipt', quantity: 5 });
  const issue = normalizeStockMovementInput({ itemId: 'i1', locationId: 'l1', movementType: 'issue', quantity: 2.5 });
  assert.equal(receipt.quantityDelta, 5);
  assert.equal(issue.quantityDelta, -2.5);
});

test('consumo em OS exige referência de ordem', () => {
  assert.throws(() => normalizeStockMovementInput({ itemId: 'i1', locationId: 'l1', movementType: 'work_order_issue', quantity: 1 }), /INVENTORY_WORK_ORDER_REQUIRED/);
  const movement = normalizeStockMovementInput({ itemId: 'i1', locationId: 'l1', movementType: 'work_order_issue', quantity: 1, referenceType: 'work_order', referenceId: 'os1' });
  assert.equal(movement.referenceId, 'os1');
  assert.equal(movement.quantityDelta, -1);
});

test('quantidade e custo inválidos são rejeitados', () => {
  assert.throws(() => normalizeStockMovementInput({ itemId: 'i1', locationId: 'l1', movementType: 'receipt', quantity: 0 }), /INVENTORY_QUANTITY_INVALID/);
  assert.throws(() => normalizeStockMovementInput({ itemId: 'i1', locationId: 'l1', movementType: 'receipt', quantity: 1, unitCostCents: 1.5 }), /INVENTORY_COST_INVALID/);
});
