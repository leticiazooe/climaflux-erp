import test from 'node:test';
import assert from 'node:assert/strict';

import {
  canField,
  canTransitionVisit,
  fieldPermissionsForRole,
  normalizeChecklistItems,
  normalizeMeasurement,
  normalizeVisitInput,
  normalizeVisitTransition,
} from '../worker/field-service.js';

test('RBAC de campo separa planejamento e execução técnica', () => {
  assert.equal(canField('admin', 'field_service.record'), true);
  assert.equal(canField('gestor', 'field_service.write'), true);
  assert.equal(canField('atendimento', 'field_service.write'), true);
  assert.equal(canField('atendimento', 'field_service.record'), false);
  assert.equal(canField('tecnico', 'field_service.record'), true);
  assert.equal(canField('tecnico', 'field_service.write'), false);
  assert.equal(canField('estoque', 'field_service.read'), false);
  assert.ok(fieldPermissionsForRole('tecnico').includes('field_service.status'));
});

test('visita exige OS, técnico e início válidos', () => {
  const visit = normalizeVisitInput({
    workOrderId: 'os-1',
    technicianUserId: 'tech-1',
    scheduledStart: '2026-08-07T09:00:00-03:00',
    scheduledEnd: '2026-08-07T11:00:00-03:00',
    notes: 'Manutenção preventiva',
  });
  assert.equal(visit.workOrderId, 'os-1');
  assert.equal(visit.technicianUserId, 'tech-1');
  assert.match(visit.scheduledStart, /Z$/);
  assert.throws(() => normalizeVisitInput({ technicianUserId: 'tech-1', scheduledStart: '2026-08-07T09:00:00Z' }), /FIELD_WORK_ORDER_REQUIRED/);
  assert.throws(() => normalizeVisitInput({ workOrderId: 'os-1', technicianUserId: 'tech-1' }), /FIELD_SCHEDULE_REQUIRED/);
  assert.throws(() => normalizeVisitInput({
    workOrderId: 'os-1', technicianUserId: 'tech-1',
    scheduledStart: '2026-08-07T12:00:00Z', scheduledEnd: '2026-08-07T11:00:00Z',
  }), /FIELD_SCHEDULE_INVALID/);
});

test('status da visita usa máquina de estados terminal', () => {
  assert.equal(canTransitionVisit('planned', 'en_route'), true);
  assert.equal(canTransitionVisit('planned', 'on_site'), true);
  assert.equal(canTransitionVisit('en_route', 'on_site'), true);
  assert.equal(canTransitionVisit('on_site', 'completed'), true);
  assert.equal(canTransitionVisit('completed', 'on_site'), false);
  assert.equal(canTransitionVisit('cancelled', 'planned'), false);
  assert.deepEqual(normalizeVisitTransition({ status: 'on_site', note: ' Cheguei ao cliente ' }), {
    status: 'on_site', note: 'Cheguei ao cliente',
  });
  assert.throws(() => normalizeVisitTransition({ status: 'unknown' }), /FIELD_STATUS_INVALID/);
});

test('checklist exige observação para não conformidade', () => {
  const items = normalizeChecklistItems({ items: [
    { key: 'safety', label: 'Segurança', status: 'ok' },
    { key: 'electrical', label: 'Elétrica', status: 'not_ok', note: 'Corrente acima do nominal' },
  ] });
  assert.equal(items.length, 2);
  assert.equal(items[1].status, 'not_ok');
  assert.throws(() => normalizeChecklistItems({ items: [
    { key: 'electrical', label: 'Elétrica', status: 'not_ok' },
  ] }), /FIELD_CHECKLIST_NOTE_REQUIRED/);
});

test('medição aceita valor numérico ou texto, mas não valor vazio', () => {
  assert.deepEqual(normalizeMeasurement({ name: 'Corrente', valueNumber: '8.2', unit: 'A' }), {
    name: 'Corrente', valueNumber: 8.2, valueText: null, unit: 'A',
  });
  assert.deepEqual(normalizeMeasurement({ name: 'Ruído', valueText: 'Normal' }), {
    name: 'Ruído', valueNumber: null, valueText: 'Normal', unit: null,
  });
  assert.throws(() => normalizeMeasurement({ name: 'Temperatura' }), /FIELD_MEASUREMENT_INVALID/);
});
