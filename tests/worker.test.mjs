import test from 'node:test';
import assert from 'node:assert/strict';

import worker from '../worker/index.js';

function env(overrides = {}) {
  return {
    ASSETS: {
      async fetch(request) {
        const url = new URL(request.url);
        return new Response(`asset:${url.pathname}`, {
          status: 200,
          headers: { 'Content-Type': url.pathname.endsWith('.html') ? 'text/html' : 'text/plain' },
        });
      },
    },
    ...overrides,
  };
}

test('health check informa degradação sem banco', async () => {
  const response = await worker.fetch(new Request('https://app.example/api/health'), env());
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    status: 'degraded',
    version: '0.7.0-phase1',
    database: false,
  });
});

test('tela de login e assets mínimos permanecem públicos', async () => {
  const login = await worker.fetch(new Request('https://app.example/login.html'), env());
  assert.equal(login.status, 200);
  assert.equal(await login.text(), 'asset:/login.html');
  assert.match(login.headers.get('content-security-policy'), /accounts\.google\.com/);

  const css = await worker.fetch(new Request('https://app.example/auth.css'), env());
  assert.equal(css.status, 200);
  assert.equal(await css.text(), 'asset:/auth.css');
});

test('código do ERP não é servido sem sessão', async () => {
  const html = await worker.fetch(new Request('https://app.example/'), env());
  assert.equal(html.status, 302);
  assert.match(html.headers.get('location'), /^\/login\.html\?returnTo=/);

  const script = await worker.fetch(new Request('https://app.example/app.js'), env());
  assert.equal(script.status, 401);
  const body = await script.json();
  assert.equal(body.code, 'AUTH_REQUIRED');
});

test('service worker público contém apenas shell seguro', async () => {
  const response = await worker.fetch(new Request('https://app.example/sw.js'), env());
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'asset:/sw.js');
});

test('API desconhecida devolve 404 sem cair no SPA', async () => {
  const response = await worker.fetch(new Request('https://app.example/api/v1/desconhecida'), env());
  assert.equal(response.status, 404);
  const body = await response.json();
  assert.equal(body.code, 'NOT_FOUND');
});
