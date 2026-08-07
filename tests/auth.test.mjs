import test from 'node:test';
import assert from 'node:assert/strict';
import {
  constantTimeEqual,
  isDomainAllowed,
  isGoogleAuthoritativeAccount,
  isMembershipStatus,
  isRole,
  normalizeEmail,
  parseCookies,
  safeReturnTo,
  serializeCookie,
  splitCsv,
} from '../worker/auth-core.js';

test('parseCookies lê cookies codificados', () => {
  assert.deepEqual(parseCookies('a=1; user=Let%C3%ADcia%20Silva'), {
    a: '1',
    user: 'Letícia Silva',
  });
});

test('serializeCookie aplica atributos seguros', () => {
  const cookie = serializeCookie('__Host-session', 'token', { httpOnly: true, maxAge: 3600 });
  assert.match(cookie, /^__Host-session=token;/);
  assert.match(cookie, /Path=\//);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Lax/);
});

test('safeReturnTo bloqueia redirecionamentos externos', () => {
  assert.equal(safeReturnTo('/ordens'), '/ordens');
  assert.equal(safeReturnTo('https://evil.example'), '/');
  assert.equal(safeReturnTo('//evil.example'), '/');
});

test('roles e status são validados por allowlist', () => {
  assert.equal(isRole('admin'), true);
  assert.equal(isRole('root'), false);
  assert.equal(isMembershipStatus('active'), true);
  assert.equal(isMembershipStatus('deleted'), false);
});

test('contas Google autoritativas seguem regras do Google', () => {
  assert.equal(isGoogleAuthoritativeAccount({ email: 'a@gmail.com', email_verified: true }), true);
  assert.equal(isGoogleAuthoritativeAccount({ email: 'a@empresa.com', email_verified: true, hd: 'empresa.com' }), true);
  assert.equal(isGoogleAuthoritativeAccount({ email: 'a@externo.com', email_verified: true }), false);
  assert.equal(isGoogleAuthoritativeAccount({ email: 'permitido@externo.com', email_verified: true }, ['permitido@externo.com']), true);
});

test('restrição de domínio usa a claim hd', () => {
  assert.equal(isDomainAllowed({ hd: 'empresa.com' }, ['empresa.com']), true);
  assert.equal(isDomainAllowed({ email: 'a@empresa.com' }, ['empresa.com']), false);
  assert.equal(isDomainAllowed({}, []), true);
});

test('utilitários normalizam entradas', () => {
  assert.equal(normalizeEmail(' LETICIA@EXAMPLE.COM '), 'leticia@example.com');
  assert.deepEqual(splitCsv('A.com, b.com, ,C.com'), ['a.com', 'b.com', 'c.com']);
  assert.equal(constantTimeEqual('abc', 'abc'), true);
  assert.equal(constantTimeEqual('abc', 'abd'), false);
});
