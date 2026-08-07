import { readFile, writeFile } from 'node:fs/promises';

async function patch(path, replacements) {
  let content = await readFile(path, 'utf8');
  let changed = false;
  for (const [before, after] of replacements) {
    if (content.includes(before)) {
      content = content.replace(before, after);
      changed = true;
    } else if (!content.includes(after)) {
      throw new Error(`Trecho esperado não encontrado em ${path}: ${before.slice(0, 100)}`);
    }
  }
  if (changed) await writeFile(path, content);
}

await patch('worker/index.js', [
  [
    "import {\n  normalizeEmail,\n  parseCookies,\n  safeReturnTo,\n  serializeCookie,\n} from './auth-core.js';",
    "import {\n  constantTimeEqual,\n  normalizeEmail,\n  parseCookies,\n  safeReturnTo,\n  serializeCookie,\n} from './auth-core.js';",
  ],
  [
    "  appendCookie(headers, serializeCookie(LOGIN_CSRF_COOKIE, csrf, {\n    httpOnly: false,",
    "  appendCookie(headers, serializeCookie(LOGIN_CSRF_COOKIE, csrf, {\n    httpOnly: true,",
  ],
  [
    "  if (!csrfCookie || csrfCookie !== csrfBody || csrfCookie !== csrfHeader) throw new Error('AUTH_CSRF');",
    "  if (\n    !csrfCookie ||\n    !constantTimeEqual(csrfCookie, csrfBody) ||\n    !constantTimeEqual(csrfCookie, csrfHeader)\n  ) throw new Error('AUTH_CSRF');",
  ],
  [
    "async function handleTenantCreate(request, env) {\n  const session = await requireSession(env, request);\n  await verifyCsrf(request, session);",
    "async function handleTenantCreate(request, env) {\n  const session = await requireSession(env, request);\n  assertPermission(session.activeMembership.role, 'tenant.create');\n  await verifyCsrf(request, session);",
  ],
  [
    "function errorResponse(error) {\n  const code = error instanceof Error ? error.message : 'UNKNOWN';\n  const mapping = {",
    "function errorResponse(error) {\n  const code = error instanceof Error ? error.message : 'UNKNOWN';\n  if (/UNIQUE constraint failed: customers\\./i.test(code)) {\n    return json({ ok: false, code: 'CUSTOMER_DUPLICATE', message: 'Já existe um cliente com este código ou documento nesta empresa.' }, 409);\n  }\n  if (/UNIQUE constraint failed: tenants\\.slug/i.test(code)) {\n    return json({ ok: false, code: 'TENANT_SLUG_CONFLICT', message: 'Já existe uma empresa com este identificador.' }, 409);\n  }\n  const mapping = {",
  ],
  [
    "    AUTH_SECRETS_NOT_CONFIGURED: [503, 'As credenciais Google ainda não foram configuradas.'],\n    DATABASE_NOT_CONFIGURED:",
    "    AUTH_SECRETS_NOT_CONFIGURED: [503, 'As credenciais Google ainda não foram configuradas.'],\n    GOOGLE_TOKEN_MISSING: [401, 'A credencial Google não foi recebida.'],\n    GOOGLE_TOKEN_MALFORMED: [401, 'A credencial Google é inválida.'],\n    GOOGLE_TOKEN_ALGORITHM: [401, 'O algoritmo da credencial Google não é permitido.'],\n    GOOGLE_TOKEN_SIGNATURE: [401, 'A assinatura da credencial Google é inválida.'],\n    GOOGLE_TOKEN_AUDIENCE: [401, 'A credencial Google não pertence a esta aplicação.'],\n    GOOGLE_TOKEN_AUTHORIZED_PARTY: [401, 'A aplicação autorizada pela credencial Google é inválida.'],\n    GOOGLE_TOKEN_ISSUER: [401, 'O emissor da credencial Google é inválido.'],\n    GOOGLE_TOKEN_EXPIRED: [401, 'A credencial Google expirou.'],\n    GOOGLE_TOKEN_ISSUED_AT: [401, 'O horário da credencial Google é inválido.'],\n    GOOGLE_TOKEN_NONCE: [401, 'A tentativa de login Google não corresponde à sessão atual.'],\n    GOOGLE_TOKEN_PROFILE: [401, 'O perfil da conta Google está incompleto.'],\n    GOOGLE_KEY_NOT_FOUND: [503, 'Não foi possível validar a chave pública do Google.'],\n    DATABASE_NOT_CONFIGURED:",
  ],
]);

await patch('auth/admin-access.js', [
  [
    "  let client;",
    "  let client;\n  let canWrite = false;",
  ],
  [
    "      const save = document.createElement('button');\n      save.type = 'button';",
    "      role.disabled = !canWrite;\n      memberStatus.disabled = !canWrite;\n      appUserKey.disabled = !canWrite;\n\n      const save = document.createElement('button');\n      save.type = 'button';",
  ],
  [
    "      save.textContent = 'Salvar';\n      save.addEventListener",
    "      save.textContent = 'Salvar';\n      save.hidden = !canWrite;\n      save.addEventListener",
  ],
  [
    "      const cancel = document.createElement('button');\n      cancel.type = 'button';",
    "      const cancel = document.createElement('button');\n      cancel.type = 'button';\n      cancel.hidden = !canWrite;",
  ],
  [
    "    const permissions = client.session.permissions || [];\n    if (!permissions.includes('*') && !permissions.includes('members.read')) {",
    "    const permissions = client.session.permissions || [];\n    canWrite = permissions.includes('*') || permissions.includes('members.write');\n    inviteForm.closest('section').hidden = !canWrite;\n    if (!permissions.includes('*') && !permissions.includes('members.read')) {",
  ],
]);

await patch('auth/customers-saas.html', [
  [
    '<a href="/admin-access.html">Acessos</a>',
    '<a id="accessNavLink" href="/admin-access.html">Acessos</a>',
  ],
]);

await patch('auth/customers-saas.js', [
  [
    "    tenantLabel: document.getElementById('tenantLabel'),",
    "    tenantLabel: document.getElementById('tenantLabel'),\n    accessNavLink: document.getElementById('accessNavLink'),",
  ],
  [
    "    state.canWrite = permissions.includes('*') || permissions.includes('customers.write');\n    state.canDelete = permissions.includes('*') || permissions.includes('customers.delete');",
    "    state.canWrite = permissions.includes('*') || permissions.includes('customers.write');\n    state.canDelete = permissions.includes('*') || permissions.includes('customers.delete');\n    elements.accessNavLink.hidden = !permissions.includes('*') && !permissions.includes('members.read');",
  ],
]);

await patch('.github/workflows/release-quality.yml', [
  [
    "          grep -q '/api/v1/customers' public/customers-saas.js",
    "          grep -q '/api/v1/customers' public/auth-client.js",
  ],
]);

console.log('Phase 1 hardening patch applied.');
