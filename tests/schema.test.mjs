import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(new URL('../migrations/0001_saas_foundation.sql', import.meta.url), 'utf8');
const worker = await readFile(new URL('../worker/index.js', import.meta.url), 'utf8');
const serviceWorker = await readFile(new URL('../auth/secure-sw.js', import.meta.url), 'utf8');

test('schema contém as entidades mínimas da fundação SaaS', () => {
  for (const table of [
    'tenants',
    'users',
    'memberships',
    'tenant_invites',
    'sessions',
    'customers',
    'audit_log',
    'auth_events',
    'idempotency_keys',
  ]) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`));
  }
});

test('tabelas de negócio e segurança carregam tenant_id', () => {
  for (const table of ['memberships', 'tenant_invites', 'customers', 'audit_log', 'idempotency_keys']) {
    const pattern = new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\([\\s\\S]*?tenant_id TEXT NOT NULL`, 'm');
    assert.match(migration, pattern, `${table} precisa de tenant_id obrigatório`);
  }
});

test('clientes possuem unicidade e índices por tenant', () => {
  assert.match(migration, /UNIQUE \(tenant_id, code\)/);
  assert.match(migration, /UNIQUE \(tenant_id, document\)/);
  assert.match(migration, /idx_customers_tenant_status_name/);
  assert.match(migration, /idx_customers_tenant_updated/);
});

test('operações de clientes usam o tenant obtido da sessão', () => {
  assert.match(worker, /session\.activeMembership\.tenant_id/g);
  assert.match(worker, /INSERT INTO customers[\s\S]*tenant_id/);
  assert.match(worker, /FROM customers WHERE \$\{where\.join\(' AND '\)\}/);
  assert.match(worker, /UPDATE customers SET \$\{assignments\.join\(', '\)\}[\s\S]*tenant_id = \?/);
  assert.match(worker, /UPDATE customers[\s\S]*WHERE id = \? AND tenant_id = \? AND deleted_at IS NULL/);
});

test('último administrador não pode ser removido pelo endpoint', () => {
  assert.match(worker, /LAST_ADMIN_REQUIRED/);
  assert.match(worker, /role = 'admin' AND status = 'active'/);
});

test('service worker não armazena respostas de API', () => {
  assert.match(serviceWorker, /url\.pathname\.startsWith\('\/api\/'\)/);
  assert.match(serviceWorker, /cache: 'no-store'/);
  assert.doesNotMatch(serviceWorker, /cache\.put\(event\.request/);
});
