import test from 'node:test';
import assert from 'node:assert/strict';

import {
  canTransitionPurchase,
  normalizePurchaseOrderInput,
  normalizePurchaseTransition,
  normalizeReceiptInput,
  normalizeSupplierInput,
} from '../worker/purchasing.js';
import { can } from '../worker/policy.js';

test('RBAC de compras separa aprovação e recebimento', () => {
  assert.equal(can('admin', 'purchases.approve'), true);
  assert.equal(can('gestor', 'purchases.approve'), true);
  assert.equal(can('estoque', 'purchases.write'), true);
  assert.equal(can('estoque', 'purchases.receive'), true);
  assert.equal(can('estoque', 'purchases.approve'), false);
  assert.equal(can('financeiro', 'purchases.read'), true);
  assert.equal(can('financeiro', 'purchases.write'), false);
  assert.equal(can('tecnico', 'purchases.read'), false);
});

test('fornecedor valida identidade e contato', () => {
  const supplier = normalizeSupplierInput({ name: ' Frio Peças ', email: 'COMERCIAL@EXEMPLO.COM', status: 'active' });
  assert.equal(supplier.name, 'Frio Peças');
  assert.equal(supplier.email, 'comercial@exemplo.com');
  assert.throws(() => normalizeSupplierInput({ name: 'A', email: 'x' }), /PURCHASE_SUPPLIER_NAME_REQUIRED|PURCHASE_SUPPLIER_EMAIL_INVALID/);
});

test('pedido exige fornecedor e linhas únicas válidas', () => {
  const order = normalizePurchaseOrderInput({ supplierId: 'f1', expectedDate: '2026-08-20', lines: [
    { itemId: 'i1', quantity: 4, unitCostCents: 1990 },
    { itemId: 'i2', quantity: 2.5, unitCostCents: 850 },
  ] });
  assert.equal(order.lines.length, 2);
  assert.match(order.expectedDate, /Z$/);
  assert.throws(() => normalizePurchaseOrderInput({ supplierId: 'f1', lines: [] }), /PURCHASE_LINES_REQUIRED/);
  assert.throws(() => normalizePurchaseOrderInput({ supplierId: 'f1', lines: [
    { itemId: 'i1', quantity: 1, unitCostCents: 100 }, { itemId: 'i1', quantity: 2, unitCostCents: 100 },
  ] }), /PURCHASE_LINE_DUPLICATE_ITEM/);
});

test('máquina de estados de compra impede atalhos após recebimento', () => {
  assert.equal(canTransitionPurchase('draft', 'approved'), true);
  assert.equal(canTransitionPurchase('approved', 'ordered'), true);
  assert.equal(canTransitionPurchase('ordered', 'received'), false);
  assert.equal(canTransitionPurchase('partially_received', 'cancelled'), false);
  assert.equal(canTransitionPurchase('received', 'cancelled'), false);
  assert.deepEqual(normalizePurchaseTransition({ status: 'ordered', note: ' Enviado ao fornecedor ' }), { status: 'ordered', note: 'Enviado ao fornecedor' });
});

test('recebimento exige local e linhas sem duplicação', () => {
  const receipt = normalizeReceiptInput({ locationId: 'loc1', lines: [{ lineId: 'l1', quantity: 2 }, { lineId: 'l2', quantity: 1.5 }] });
  assert.equal(receipt.lines.length, 2);
  assert.throws(() => normalizeReceiptInput({ locationId: 'loc1', lines: [{ lineId: 'l1', quantity: 1 }, { lineId: 'l1', quantity: 2 }] }), /PURCHASE_RECEIPT_LINE_DUPLICATE/);
  assert.throws(() => normalizeReceiptInput({ locationId: '', lines: [{ lineId: 'l1', quantity: 1 }] }), /PURCHASE_RECEIPT_LOCATION_REQUIRED/);
});
