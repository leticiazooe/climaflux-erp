import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const worker = await readFile(new URL('../worker/index.js', import.meta.url), 'utf8');
const admin = await readFile(new URL('../auth/admin-access.js', import.meta.url), 'utf8');
const customers = await readFile(new URL('../auth/customers-saas.js', import.meta.url), 'utf8');

test('CSRF de login usa comparação constante e cookie HttpOnly', () => {
  assert.match(worker, /constantTimeEqual\(csrfCookie, csrfBody\)/);
  assert.match(worker, /constantTimeEqual\(csrfCookie, csrfHeader\)/);
  assert.match(worker, /serializeCookie\(LOGIN_CSRF_COOKIE[\s\S]*?httpOnly: true/);
});

test('criação de tenant exige permissão administrativa', () => {
  assert.match(worker, /handleTenantCreate[\s\S]*?assertPermission\(session\.activeMembership\.role, 'tenant\.create'\)/);
});

test('erros de token Google não são devolvidos como erro interno genérico', () => {
  for (const code of [
    'GOOGLE_TOKEN_SIGNATURE',
    'GOOGLE_TOKEN_AUDIENCE',
    'GOOGLE_TOKEN_ISSUER',
    'GOOGLE_TOKEN_EXPIRED',
    'GOOGLE_TOKEN_NONCE',
  ]) {
    assert.match(worker, new RegExp(`${code}: \\[401,`));
  }
});

test('conflitos de unicidade de cliente e tenant viram 409', () => {
  assert.match(worker, /CUSTOMER_DUPLICATE/);
  assert.match(worker, /TENANT_SLUG_CONFLICT/);
  assert.match(worker, /UNIQUE constraint failed: customers/);
});

test('gestor somente leitura não recebe controles administrativos de escrita', () => {
  assert.match(admin, /canWrite = permissions\.includes\('\*'\) \|\| permissions\.includes\('members\.write'\)/);
  assert.match(admin, /inviteForm\.closest\('section'\)\.hidden = !canWrite/);
  assert.match(admin, /save\.hidden = !canWrite/);
  assert.match(admin, /cancel\.hidden = !canWrite/);
});

test('atalho de acessos é ocultado quando o perfil não pode consultar membros', () => {
  assert.match(customers, /accessNavLink\.hidden/);
  assert.match(customers, /permissions\.includes\('members\.read'\)/);
});
