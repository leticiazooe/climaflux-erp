import test from 'node:test';
import assert from 'node:assert/strict';
import { isPublicAuthAsset } from '../worker/router.js';

test('assets necessários ao login são públicos', () => {
  assert.equal(isPublicAuthAsset('/auth.css'), true);
  assert.equal(isPublicAuthAsset('/login.js'), true);
  assert.equal(isPublicAuthAsset('/icon.svg'), true);
  assert.equal(isPublicAuthAsset('/manifest.webmanifest'), true);
});

test('assets do ERP continuam protegidos', () => {
  assert.equal(isPublicAuthAsset('/app.js'), false);
  assert.equal(isPublicAuthAsset('/domain.js'), false);
  assert.equal(isPublicAuthAsset('/auth-client.js'), false);
  assert.equal(isPublicAuthAsset('/admin-access.js'), false);
});
