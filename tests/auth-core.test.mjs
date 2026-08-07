import test from 'node:test';
import assert from 'node:assert/strict';

import {
  constantTimeEqual,
  isDomainAllowed,
  isGoogleAuthoritativeAccount,
  parseCookies,
  safeReturnTo,
  serializeCookie,
  splitCsv,
} from '../worker/auth-core.js';

test('cookies de sessão recebem flags seguras', () => {
  const cookie = serializeCookie('__Host-session', 'abc', {
    httpOnly: true,
    maxAge: 3600,
    sameSite: 'Lax',
  });
  assert.match(cookie, /Path=\//);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Max-Age=3600/);
});

test('cookies são analisados sem perder valores codificados', () => {
  assert.deepEqual(parseCookies('a=1; nome=Let%C3%ADcia; vazio='), {
    a: '1',
    nome: 'Letícia',
    vazio: '',
  });
});

test('retorno seguro aceita apenas caminho interno', () => {
  assert.equal(safeReturnTo('/clientes?aba=ativos'), '/clientes?aba=ativos');
  assert.equal(safeReturnTo('https://evil.example'), '/');
  assert.equal(safeReturnTo('//evil.example'), '/');
  assert.equal(safeReturnTo('/ok\nLocation: https://evil.example'), '/');
});

test('comparação constante diferencia tamanho e conteúdo', () => {
  assert.equal(constantTimeEqual('abc', 'abc'), true);
  assert.equal(constantTimeEqual('abc', 'abd'), false);
  assert.equal(constantTimeEqual('abc', 'abc0'), false);
});

test('allowlists são normalizadas', () => {
  assert.deepEqual(splitCsv(' Admin@Empresa.com, empresa.com ,, '), ['admin@empresa.com', 'empresa.com']);
});

test('conta Google precisa ser autoritativa', () => {
  assert.equal(isGoogleAuthoritativeAccount({ email: 'a@gmail.com', email_verified: true }, []), true);
  assert.equal(isGoogleAuthoritativeAccount({ email: 'a@empresa.com', email_verified: true, hd: 'empresa.com' }, []), true);
  assert.equal(isGoogleAuthoritativeAccount({ email: 'a@terceiro.com', email_verified: true }, []), false);
  assert.equal(isGoogleAuthoritativeAccount({ email: 'permitido@terceiro.com', email_verified: true }, ['permitido@terceiro.com']), true);
  assert.equal(isGoogleAuthoritativeAccount({ email: 'a@gmail.com', email_verified: false }, []), false);
});

test('domínio Workspace é validado quando configurado', () => {
  assert.equal(isDomainAllowed({ hd: 'empresa.com' }, []), true);
  assert.equal(isDomainAllowed({ hd: 'empresa.com' }, ['empresa.com']), true);
  assert.equal(isDomainAllowed({ hd: 'outra.com' }, ['empresa.com']), false);
});
