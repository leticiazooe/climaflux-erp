import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canOperate,
  canTransitionWorkOrder,
  equipmentCodeFromId,
  normalizeEquipmentInput,
  normalizeStatusTransition,
  normalizeWorkOrderInput,
  operationalPermissionsForRole,
  workOrderCodeFromId,
} from '../worker/operations.js';

test('RBAC operacional separa escrita, transição e leitura', () => {
  assert.equal(canOperate('admin', 'work_orders.delete'), true);
  assert.equal(canOperate('gestor', 'equipment.delete'), true);
  assert.equal(canOperate('atendimento', 'work_orders.assign'), true);
  assert.equal(canOperate('atendimento', 'work_orders.delete'), false);
  assert.equal(canOperate('tecnico', 'work_orders.transition'), true);
  assert.equal(canOperate('tecnico', 'work_orders.write'), false);
  assert.equal(canOperate('financeiro', 'work_orders.read'), true);
  assert.equal(canOperate('financeiro', 'work_orders.write'), false);
  assert.ok(operationalPermissionsForRole('tecnico').includes('work_orders.read'));
});

test('equipamento exige cliente e normaliza campos técnicos', () => {
  const item = normalizeEquipmentInput({ customerId: 'c-1', category: ' Split ', brand: ' Daikin ', capacityBtu: '12000', status: 'active' });
  assert.equal(item.customerId, 'c-1');
  assert.equal(item.category, 'split');
  assert.equal(item.brand, 'Daikin');
  assert.equal(item.capacityBtu, 12000);
  assert.throws(() => normalizeEquipmentInput({ category: 'split' }), /EQUIPMENT_CUSTOMER_REQUIRED/);
  assert.throws(() => normalizeEquipmentInput({ customerId: 'c-1', category: 'split', status: 'broken' }), /EQUIPMENT_STATUS_INVALID/);
});

test('ordem valida agenda, prioridade e bloqueia status no PATCH comum', () => {
  const order = normalizeWorkOrderInput({
    customerId: 'c-1', serviceType: 'Corretiva', title: 'Falha no compressor', priority: 'critical',
    scheduledStart: '2026-08-07T10:00:00-03:00', scheduledEnd: '2026-08-07T11:00:00-03:00',
  });
  assert.equal(order.priority, 'critical');
  assert.match(order.scheduledStart, /Z$/);
  assert.throws(() => normalizeWorkOrderInput({ customerId: 'c-1', serviceType: 'Corretiva', title: 'Falha', status: 'completed' }), /WORK_ORDER_STATUS_ENDPOINT_REQUIRED/);
  assert.throws(() => normalizeWorkOrderInput({ customerId: 'c-1', serviceType: 'Corretiva', title: 'Falha', scheduledStart: '2026-08-07T12:00:00Z', scheduledEnd: '2026-08-07T11:00:00Z' }), /WORK_ORDER_SCHEDULE_INVALID/);
});

test('máquina de estados impede reabrir ordem terminal', () => {
  assert.equal(canTransitionWorkOrder('open', 'scheduled'), true);
  assert.equal(canTransitionWorkOrder('scheduled', 'in_progress'), true);
  assert.equal(canTransitionWorkOrder('in_progress', 'completed'), true);
  assert.equal(canTransitionWorkOrder('completed', 'open'), false);
  assert.equal(canTransitionWorkOrder('cancelled', 'in_progress'), false);
  assert.equal(canTransitionWorkOrder('open', 'completed'), false);
});

test('transição exige status conhecido e limpa observações', () => {
  const transition = normalizeStatusTransition({ status: 'on_hold', note: ' Aguardando peça ' });
  assert.equal(transition.status, 'on_hold');
  assert.equal(transition.note, 'Aguardando peça');
  assert.throws(() => normalizeStatusTransition({ status: 'unknown' }), /WORK_ORDER_STATUS_INVALID/);
});

test('códigos operacionais não expõem tenant', () => {
  const id = '12345678-aaaa-bbbb-cccc-123456789012';
  assert.equal(equipmentCodeFromId(id), 'EQP-12345678');
  assert.equal(workOrderCodeFromId(id, new Date('2026-01-01T00:00:00Z')), 'OS-2026-12345678');
});
