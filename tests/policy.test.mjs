import test from 'node:test';
import assert from 'node:assert/strict';

import {
  can,
  customerCodeFromId,
  isPublicAssetPath,
  normalizeCustomerInput,
  normalizeInviteInput,
  normalizeMembershipInput,
  normalizePagination,
  normalizeSlug,
} from '../worker/policy.js';

test('administrador possui todas as permissões', () => {
  assert.equal(can('admin', 'customers.delete'), true);
  assert.equal(can('admin', 'members.write'), true);
});

test('perfis recebem apenas permissões declaradas', () => {
  assert.equal(can('atendimento', 'customers.write'), true);
  assert.equal(can('atendimento', 'customers.delete'), false);
  assert.equal(can('tecnico', 'customers.read'), true);
  assert.equal(can('tecnico', 'members.read'), false);
  assert.equal(can('gestor', 'audit.read'), true);
});

test('somente os assets mínimos de login são públicos', () => {
  assert.equal(isPublicAssetPath('/login.html'), true);
  assert.equal(isPublicAssetPath('/login.js'), true);
  assert.equal(isPublicAssetPath('/auth.css'), true);
  assert.equal(isPublicAssetPath('/app.js'), false);
  assert.equal(isPublicAssetPath('/domain.js'), false);
  assert.equal(isPublicAssetPath('/customers-saas.js'), false);
});

test('slug de tenant é previsível e seguro', () => {
  assert.equal(normalizeSlug('ClimaFlux Unidade São Paulo'), 'climaflux-unidade-sao-paulo');
  assert.equal(normalizeSlug('  -- Empresa!  '), 'empresa');
});

test('paginação aplica limites defensivos', () => {
  assert.deepEqual(normalizePagination(new URLSearchParams('limit=1000&offset=-2')), {
    limit: 100,
    offset: 0,
  });
  assert.deepEqual(normalizePagination(new URLSearchParams('limit=20&offset=40')), {
    limit: 20,
    offset: 40,
  });
});

test('cliente é normalizado e validado', () => {
  assert.deepEqual(normalizeCustomerInput({
    name: '  Oficina Central  ',
    kind: 'company',
    email: ' CONTATO@EMPRESA.COM ',
    status: 'active',
  }), {
    name: 'Oficina Central',
    kind: 'company',
    document: null,
    email: 'contato@empresa.com',
    phone: null,
    notes: null,
    status: 'active',
  });
  assert.throws(() => normalizeCustomerInput({ name: 'A', kind: 'company' }), /CUSTOMER_NAME_REQUIRED/);
  assert.throws(() => normalizeCustomerInput({ name: 'Cliente', kind: 'invalid' }), /CUSTOMER_KIND_INVALID/);
  assert.throws(() => normalizeCustomerInput({ name: 'Cliente', email: 'errado' }), /CUSTOMER_EMAIL_INVALID/);
});

test('atualização parcial não aceita corpo vazio', () => {
  assert.deepEqual(normalizeCustomerInput({ status: 'inactive' }, { partial: true }), { status: 'inactive' });
  assert.throws(() => normalizeCustomerInput({}, { partial: true }), /API_VALIDATION/);
});

test('convite e vínculo validam e-mail, perfil e status', () => {
  assert.deepEqual(normalizeInviteInput({ email: ' Pessoa@Empresa.com ', role: 'gestor' }), {
    email: 'pessoa@empresa.com',
    role: 'gestor',
  });
  assert.throws(() => normalizeInviteInput({ email: 'invalido', role: 'gestor' }), /INVITE_EMAIL_INVALID/);
  assert.throws(() => normalizeInviteInput({ email: 'a@b.com', role: 'root' }), /AUTH_ROLE_INVALID/);
  assert.deepEqual(normalizeMembershipInput({ role: 'tecnico', status: 'active', appUserKey: 'tec-01' }), {
    role: 'tecnico',
    status: 'active',
    appUserKey: 'tec-01',
  });
  assert.throws(() => normalizeMembershipInput({ role: 'tecnico', status: 'removed' }), /AUTH_MEMBERSHIP_STATUS_INVALID/);
});

test('código do cliente deriva de UUID sem expor tenant', () => {
  assert.equal(customerCodeFromId('12345678-abcd-ef00-1111-222233334444'), 'CLI-12345678');
});
