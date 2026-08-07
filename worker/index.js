import {
  constantTimeEqual,
  normalizeEmail,
  parseCookies,
  safeReturnTo,
  serializeCookie,
} from './auth-core.js';
import {
  acceptPendingInvites,
  createSession,
  enforceLoginRateLimit,
  getSession,
  listMemberships,
  provisionBootstrapMembership,
  publicSession,
  recordAudit,
  recordAuthEvent,
  requireSession,
  upsertUser,
} from './auth.js';
import {
  assertPermission,
  can,
  customerCodeFromId,
  isPublicAssetPath,
  normalizeCustomerInput,
  normalizeInviteInput,
  normalizeMembershipInput,
  normalizePagination,
  normalizeSlug,
} from './policy.js';
import {
  LOGIN_CSRF_COOKIE,
  LOGIN_NONCE_COOKIE,
  SESSION_COOKIE,
  appendCookie,
  clearCookie,
  getNumber,
  json,
  nowIso,
  randomToken,
  redirect,
  requireDatabase,
  securityHeaders,
  sha256,
  validateSameOrigin,
  verifyCsrf,
  verifyGoogleIdToken,
} from './security.js';

const VERSION = '0.7.0-phase1';

async function serveAsset(request, env, options = {}) {
  if (!env.ASSETS) throw new Error('ASSETS_NOT_CONFIGURED');
  const response = await env.ASSETS.fetch(request);
  return securityHeaders(response, options);
}

async function handleHealth(env) {
  if (!env.DB) {
    return json({ status: 'degraded', version: VERSION, database: false }, 503);
  }
  try {
    const row = await env.DB.prepare(
      `SELECT value FROM schema_metadata WHERE key = 'schema_version'`
    ).first();
    return json({
      status: 'ok',
      version: VERSION,
      database: true,
      schemaVersion: row?.value || 'unknown',
      timestamp: nowIso(),
    });
  } catch (error) {
    console.error('Health check failed', error);
    return json({ status: 'degraded', version: VERSION, database: false }, 503);
  }
}

async function handleAuthConfig(request, env) {
  requireDatabase(env);
  if (!env.GOOGLE_CLIENT_ID || !env.SESSION_SECRET) throw new Error('AUTH_SECRETS_NOT_CONFIGURED');
  const nonce = randomToken(24);
  const csrf = randomToken(24);
  const headers = new Headers();
  appendCookie(headers, serializeCookie(LOGIN_NONCE_COOKIE, nonce, {
    httpOnly: true,
    maxAge: 10 * 60,
    sameSite: 'Strict',
  }));
  appendCookie(headers, serializeCookie(LOGIN_CSRF_COOKIE, csrf, {
    httpOnly: true,
    maxAge: 10 * 60,
    sameSite: 'Strict',
  }));
  return json({ clientId: env.GOOGLE_CLIENT_ID, nonce, csrf }, 200, headers);
}

async function handleGoogleLogin(request, env) {
  requireDatabase(env);
  if (!validateSameOrigin(request)) throw new Error('AUTH_ORIGIN');
  await enforceLoginRateLimit(env, request);

  const body = await request.json().catch(() => ({}));
  const cookies = parseCookies(request.headers.get('Cookie') || '');
  const csrfCookie = cookies[LOGIN_CSRF_COOKIE] || '';
  const csrfBody = String(body.csrf || '');
  const csrfHeader = request.headers.get('X-CSRF-Token') || '';
  if (
    !csrfCookie ||
    !constantTimeEqual(csrfCookie, csrfBody) ||
    !constantTimeEqual(csrfCookie, csrfHeader)
  ) throw new Error('AUTH_CSRF');

  const payload = await verifyGoogleIdToken(
    String(body.credential || ''),
    env,
    cookies[LOGIN_NONCE_COOKIE],
  );
  const user = await upsertUser(env, payload);
  if (!user || user.status !== 'active') throw new Error('AUTH_USER_SUSPENDED');

  await acceptPendingInvites(env, user);
  let memberships = await listMemberships(env, user.id);
  if (!memberships.length) memberships = await provisionBootstrapMembership(env, user, payload);
  if (!memberships.length) {
    await recordAuthEvent(env, request, 'login_denied', { reason: 'membership_required' }, user.id);
    return json({
      ok: false,
      code: 'ACCESS_PENDING',
      message: 'Conta Google confirmada. Solicite um convite a um administrador da empresa.',
    }, 403);
  }

  const session = await createSession(env, request, user, memberships);
  await recordAuthEvent(env, request, 'login_success', { tenantId: session.activeTenantId }, user.id);
  const headers = new Headers();
  appendCookie(headers, serializeCookie(SESSION_COOKIE, session.token, {
    httpOnly: true,
    maxAge: getNumber(env, 'SESSION_TTL_SECONDS', 8 * 60 * 60),
    sameSite: 'Lax',
  }));
  appendCookie(headers, clearCookie(LOGIN_NONCE_COOKIE, true));
  appendCookie(headers, clearCookie(LOGIN_CSRF_COOKIE, false));
  return json({ ok: true, returnTo: safeReturnTo(body.returnTo) }, 200, headers);
}

async function handleMe(request, env) {
  const session = await requireSession(env, request);
  const csrf = randomToken(24);
  await env.DB.prepare('UPDATE sessions SET csrf_hash = ? WHERE id = ?')
    .bind(await sha256(csrf), session.id)
    .run();
  return json(publicSession(session, csrf));
}

async function handleLogout(request, env) {
  const session = await requireSession(env, request);
  await verifyCsrf(request, session);
  await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(session.id).run();
  await recordAuthEvent(env, request, 'logout', {
    tenantId: session.activeMembership.tenant_id,
  }, session.user_id);
  const headers = new Headers();
  appendCookie(headers, clearCookie(SESSION_COOKIE, true));
  return json({ ok: true }, 200, headers);
}

async function handleListTenants(request, env) {
  const session = await requireSession(env, request);
  assertPermission(session.activeMembership.role, 'tenant.read');
  return json({ items: session.memberships, activeTenantId: session.activeMembership.tenant_id });
}

async function handleTenantSwitch(request, env) {
  const session = await requireSession(env, request);
  await verifyCsrf(request, session);
  const body = await request.json().catch(() => ({}));
  const tenantId = String(body.tenantId || body.companyId || '');
  const membership = session.memberships.find((item) => item.tenant_id === tenantId);
  if (!membership) throw new Error('AUTH_TENANT_FORBIDDEN');
  await env.DB.prepare('UPDATE sessions SET active_tenant_id = ?, last_seen_at = ? WHERE id = ?')
    .bind(tenantId, nowIso(), session.id)
    .run();
  await recordAudit(env, request, session, 'tenant.switch', 'tenant', tenantId, {
    fromTenantId: session.activeMembership.tenant_id,
  });
  return json({ ok: true, activeTenant: membership, activeCompany: membership });
}

async function handleTenantCreate(request, env) {
  const session = await requireSession(env, request);
  assertPermission(session.activeMembership.role, 'tenant.create');
  await verifyCsrf(request, session);
  if (String(env.ENABLE_TENANT_CREATION || '').toLowerCase() !== 'true') {
    throw new Error('TENANT_CREATION_DISABLED');
  }
  const body = await request.json().catch(() => ({}));
  const name = String(body.name || '').trim().slice(0, 200);
  const slug = normalizeSlug(body.slug || name);
  if (name.length < 2 || slug.length < 2) throw new Error('TENANT_VALIDATION');

  const id = crypto.randomUUID();
  const current = nowIso();
  await env.DB.prepare(
    `INSERT INTO tenants
      (id, slug, name, legal_name, document, timezone, currency, plan_code, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pilot', 'active', ?, ?)`
  )
    .bind(
      id,
      slug,
      name,
      String(body.legalName || '').trim().slice(0, 200) || null,
      String(body.document || '').trim().slice(0, 40) || null,
      String(body.timezone || 'America/Sao_Paulo').slice(0, 80),
      String(body.currency || 'BRL').slice(0, 10),
      current,
      current,
    )
    .run();
  await env.DB.prepare(
    `INSERT INTO memberships (id, tenant_id, user_id, role, status, created_at, updated_at)
     VALUES (?, ?, ?, 'admin', 'active', ?, ?)`
  )
    .bind(crypto.randomUUID(), id, session.user_id, current, current)
    .run();
  await env.DB.prepare('UPDATE sessions SET active_tenant_id = ? WHERE id = ?')
    .bind(id, session.id)
    .run();

  const memberships = await listMemberships(env, session.user_id);
  const activeMembership = memberships.find((item) => item.tenant_id === id);
  const tenantSession = { ...session, activeMembership, memberships };
  await recordAudit(env, request, tenantSession, 'tenant.create', 'tenant', id, { name, slug });
  return json({ ok: true, tenant: activeMembership }, 201);
}

function customerPathId(pathname) {
  const match = pathname.match(/^\/api\/v1\/customers\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : null;
}

async function handleCustomersList(request, env) {
  const session = await requireSession(env, request);
  assertPermission(session.activeMembership.role, 'customers.read');
  const url = new URL(request.url);
  const { limit, offset } = normalizePagination(url.searchParams);
  const search = String(url.searchParams.get('search') || '').trim().slice(0, 120);
  const status = String(url.searchParams.get('status') || '').toLowerCase();
  if (status && !['active', 'inactive'].includes(status)) throw new Error('CUSTOMER_STATUS_INVALID');

  const where = ['tenant_id = ?', 'deleted_at IS NULL'];
  const values = [session.activeMembership.tenant_id];
  if (status) {
    where.push('status = ?');
    values.push(status);
  }
  if (search) {
    where.push('(name LIKE ? OR code LIKE ? OR email LIKE ? OR document LIKE ?)');
    const pattern = `%${search}%`;
    values.push(pattern, pattern, pattern, pattern);
  }

  const count = await env.DB.prepare(
    `SELECT COUNT(*) AS total FROM customers WHERE ${where.join(' AND ')}`
  )
    .bind(...values)
    .first();
  const rows = await env.DB.prepare(
    `SELECT id, code, kind, name, document, email, phone, status, notes, created_at, updated_at
     FROM customers
     WHERE ${where.join(' AND ')}
     ORDER BY updated_at DESC, name ASC
     LIMIT ? OFFSET ?`
  )
    .bind(...values, limit, offset)
    .all();
  return json({
    items: rows.results || [],
    page: { limit, offset, total: Number(count?.total || 0) },
  });
}

async function readIdempotentResponse(env, session, request) {
  const key = String(request.headers.get('Idempotency-Key') || '').trim().slice(0, 128);
  if (!key) return null;
  const row = await env.DB.prepare(
    `SELECT response_status, response_json
     FROM idempotency_keys
     WHERE tenant_id = ? AND idempotency_key = ? AND method = ? AND path = ? AND expires_at > ?`
  )
    .bind(
      session.activeMembership.tenant_id,
      key,
      request.method,
      new URL(request.url).pathname,
      nowIso(),
    )
    .first();
  if (!row) return { key, response: null };
  return {
    key,
    response: json(JSON.parse(row.response_json), Number(row.response_status)),
  };
}

async function storeIdempotentResponse(env, session, request, key, status, body) {
  if (!key) return;
  const current = new Date();
  await env.DB.prepare(
    `INSERT OR REPLACE INTO idempotency_keys
      (id, tenant_id, idempotency_key, method, path, response_status, response_json, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      crypto.randomUUID(),
      session.activeMembership.tenant_id,
      key,
      request.method,
      new URL(request.url).pathname,
      status,
      JSON.stringify(body),
      current.toISOString(),
      new Date(current.getTime() + 24 * 60 * 60 * 1000).toISOString(),
    )
    .run();
}

async function handleCustomerCreate(request, env) {
  const session = await requireSession(env, request);
  assertPermission(session.activeMembership.role, 'customers.write');
  await verifyCsrf(request, session);
  const idempotent = await readIdempotentResponse(env, session, request);
  if (idempotent?.response) return idempotent.response;

  const input = normalizeCustomerInput(await request.json().catch(() => ({})));
  const id = crypto.randomUUID();
  const current = nowIso();
  const code = customerCodeFromId(id);
  await env.DB.prepare(
    `INSERT INTO customers
      (id, tenant_id, code, kind, name, document, email, phone, status, notes,
       created_by, updated_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      session.activeMembership.tenant_id,
      code,
      input.kind,
      input.name,
      input.document,
      input.email,
      input.phone,
      input.status,
      input.notes,
      session.user_id,
      session.user_id,
      current,
      current,
    )
    .run();
  const customer = await env.DB.prepare(
    `SELECT id, code, kind, name, document, email, phone, status, notes, created_at, updated_at
     FROM customers WHERE id = ? AND tenant_id = ?`
  )
    .bind(id, session.activeMembership.tenant_id)
    .first();
  await recordAudit(env, request, session, 'customer.create', 'customer', id, { code });
  const body = { ok: true, customer };
  await storeIdempotentResponse(env, session, request, idempotent?.key, 201, body);
  return json(body, 201);
}

async function handleCustomerUpdate(request, env, customerId) {
  const session = await requireSession(env, request);
  assertPermission(session.activeMembership.role, 'customers.write');
  await verifyCsrf(request, session);
  const input = normalizeCustomerInput(await request.json().catch(() => ({})), { partial: true });
  const existing = await env.DB.prepare(
    `SELECT id FROM customers WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL`
  )
    .bind(customerId, session.activeMembership.tenant_id)
    .first();
  if (!existing) throw new Error('CUSTOMER_NOT_FOUND');

  const allowedColumns = ['name', 'kind', 'document', 'email', 'phone', 'status', 'notes'];
  const entries = Object.entries(input).filter(([key]) => allowedColumns.includes(key));
  const assignments = entries.map(([key]) => `${key} = ?`);
  const values = entries.map(([, value]) => value);
  assignments.push('updated_by = ?', 'updated_at = ?');
  values.push(session.user_id, nowIso(), customerId, session.activeMembership.tenant_id);
  await env.DB.prepare(
    `UPDATE customers SET ${assignments.join(', ')}
     WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL`
  )
    .bind(...values)
    .run();
  const customer = await env.DB.prepare(
    `SELECT id, code, kind, name, document, email, phone, status, notes, created_at, updated_at
     FROM customers WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL`
  )
    .bind(customerId, session.activeMembership.tenant_id)
    .first();
  await recordAudit(env, request, session, 'customer.update', 'customer', customerId, {
    fields: entries.map(([key]) => key),
  });
  return json({ ok: true, customer });
}

async function handleCustomerDelete(request, env, customerId) {
  const session = await requireSession(env, request);
  assertPermission(session.activeMembership.role, 'customers.delete');
  await verifyCsrf(request, session);
  const current = nowIso();
  const result = await env.DB.prepare(
    `UPDATE customers
     SET deleted_at = ?, updated_at = ?, updated_by = ?
     WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL`
  )
    .bind(current, current, session.user_id, customerId, session.activeMembership.tenant_id)
    .run();
  if (!Number(result.meta?.changes || 0)) throw new Error('CUSTOMER_NOT_FOUND');
  await recordAudit(env, request, session, 'customer.delete', 'customer', customerId);
  return json({ ok: true });
}

async function handleAuditList(request, env) {
  const session = await requireSession(env, request);
  assertPermission(session.activeMembership.role, 'audit.read');
  const { limit, offset } = normalizePagination(new URL(request.url).searchParams);
  const rows = await env.DB.prepare(
    `SELECT a.id, a.action, a.resource_type, a.resource_id, a.metadata_json, a.created_at,
            u.email AS actor_email, u.name AS actor_name
     FROM audit_log a
     LEFT JOIN users u ON u.id = a.actor_user_id
     WHERE a.tenant_id = ?
     ORDER BY a.created_at DESC
     LIMIT ? OFFSET ?`
  )
    .bind(session.activeMembership.tenant_id, limit, offset)
    .all();
  return json({
    items: (rows.results || []).map((item) => ({
      ...item,
      metadata: JSON.parse(item.metadata_json || '{}'),
      metadata_json: undefined,
    })),
    page: { limit, offset },
  });
}

async function handleAdminMembers(request, env) {
  const session = await requireSession(env, request);
  assertPermission(session.activeMembership.role, 'members.read');
  const members = await env.DB.prepare(
    `SELECT m.id AS membership_id, m.user_id, m.role, m.status, m.app_user_key,
            u.email, u.name, u.picture_url, u.last_login_at, u.status AS user_status
     FROM memberships m
     JOIN users u ON u.id = m.user_id
     WHERE m.tenant_id = ?
     ORDER BY u.name ASC, u.email ASC`
  )
    .bind(session.activeMembership.tenant_id)
    .all();
  const invites = await env.DB.prepare(
    `SELECT id, email, role, status, expires_at, created_at
     FROM tenant_invites
     WHERE tenant_id = ? AND status = 'pending'
     ORDER BY created_at DESC`
  )
    .bind(session.activeMembership.tenant_id)
    .all();
  return json({
    tenant: session.activeMembership,
    members: members.results || [],
    invites: invites.results || [],
  });
}

async function handleAdminInvite(request, env) {
  const session = await requireSession(env, request);
  assertPermission(session.activeMembership.role, 'members.write');
  await verifyCsrf(request, session);
  const input = normalizeInviteInput(await request.json().catch(() => ({})));
  const existingMember = await env.DB.prepare(
    `SELECT m.id FROM memberships m JOIN users u ON u.id = m.user_id
     WHERE m.tenant_id = ? AND u.email = ?`
  )
    .bind(session.activeMembership.tenant_id, input.email)
    .first();
  if (existingMember) throw new Error('INVITE_ALREADY_MEMBER');

  const current = new Date();
  const expiresAt = new Date(current.getTime() + getNumber(env, 'INVITE_TTL_SECONDS', 7 * 24 * 60 * 60) * 1000);
  const existingInvite = await env.DB.prepare(
    `SELECT id FROM tenant_invites
     WHERE tenant_id = ? AND email = ? AND status = 'pending'`
  )
    .bind(session.activeMembership.tenant_id, input.email)
    .first();
  let inviteId = existingInvite?.id;
  if (inviteId) {
    await env.DB.prepare(
      `UPDATE tenant_invites SET role = ?, invited_by = ?, expires_at = ?, updated_at = ? WHERE id = ?`
    )
      .bind(input.role, session.user_id, expiresAt.toISOString(), current.toISOString(), inviteId)
      .run();
  } else {
    inviteId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO tenant_invites
        (id, tenant_id, email, role, status, invited_by, expires_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?)`
    )
      .bind(
        inviteId,
        session.activeMembership.tenant_id,
        input.email,
        input.role,
        session.user_id,
        expiresAt.toISOString(),
        current.toISOString(),
        current.toISOString(),
      )
      .run();
  }
  await recordAudit(env, request, session, 'member.invite', 'tenant_invite', inviteId, input);
  return json({ ok: true, invite: { id: inviteId, ...input, expiresAt: expiresAt.toISOString() } }, 201);
}

async function handleAdminMembershipUpdate(request, env, userId) {
  const session = await requireSession(env, request);
  assertPermission(session.activeMembership.role, 'members.write');
  await verifyCsrf(request, session);
  const input = normalizeMembershipInput(await request.json().catch(() => ({})));
  const target = await env.DB.prepare(
    `SELECT m.id, m.role, m.status, u.email
     FROM memberships m JOIN users u ON u.id = m.user_id
     WHERE m.tenant_id = ? AND m.user_id = ?`
  )
    .bind(session.activeMembership.tenant_id, userId)
    .first();
  if (!target) throw new Error('MEMBERSHIP_NOT_FOUND');

  if (target.role === 'admin' && target.status === 'active' && (input.role !== 'admin' || input.status !== 'active')) {
    const count = await env.DB.prepare(
      `SELECT COUNT(*) AS total FROM memberships
       WHERE tenant_id = ? AND role = 'admin' AND status = 'active'`
    )
      .bind(session.activeMembership.tenant_id)
      .first();
    if (Number(count?.total || 0) <= 1) throw new Error('LAST_ADMIN_REQUIRED');
  }

  await env.DB.prepare(
    `UPDATE memberships
     SET role = ?, status = ?, app_user_key = ?, updated_at = ?
     WHERE tenant_id = ? AND user_id = ?`
  )
    .bind(
      input.role,
      input.status,
      input.appUserKey,
      nowIso(),
      session.activeMembership.tenant_id,
      userId,
    )
    .run();
  if (input.status !== 'active') {
    await env.DB.prepare(
      `DELETE FROM sessions WHERE user_id = ? AND active_tenant_id = ?`
    )
      .bind(userId, session.activeMembership.tenant_id)
      .run();
  }
  await recordAudit(env, request, session, 'member.update', 'membership', target.id, {
    targetUserId: userId,
    targetEmail: target.email,
    role: input.role,
    status: input.status,
  });
  return json({ ok: true });
}

async function handleAdminInviteCancel(request, env, inviteId) {
  const session = await requireSession(env, request);
  assertPermission(session.activeMembership.role, 'members.write');
  await verifyCsrf(request, session);
  const result = await env.DB.prepare(
    `UPDATE tenant_invites SET status = 'cancelled', updated_at = ?
     WHERE id = ? AND tenant_id = ? AND status = 'pending'`
  )
    .bind(nowIso(), inviteId, session.activeMembership.tenant_id)
    .run();
  if (!Number(result.meta?.changes || 0)) throw new Error('INVITE_NOT_FOUND');
  await recordAudit(env, request, session, 'member.invite_cancel', 'tenant_invite', inviteId);
  return json({ ok: true });
}

function errorResponse(error) {
  const code = error instanceof Error ? error.message : 'UNKNOWN';
  if (/UNIQUE constraint failed: customers\./i.test(code)) {
    return json({ ok: false, code: 'CUSTOMER_DUPLICATE', message: 'Já existe um cliente com este código ou documento nesta empresa.' }, 409);
  }
  if (/UNIQUE constraint failed: tenants\.slug/i.test(code)) {
    return json({ ok: false, code: 'TENANT_SLUG_CONFLICT', message: 'Já existe uma empresa com este identificador.' }, 409);
  }
  const mapping = {
    AUTH_REQUIRED: [401, 'Sessão expirada ou inexistente.'],
    AUTH_FORBIDDEN: [403, 'Você não possui permissão para esta ação.'],
    AUTH_TENANT_FORBIDDEN: [403, 'Você não possui acesso a esta empresa.'],
    AUTH_CSRF: [403, 'A validação de segurança da solicitação falhou.'],
    AUTH_ORIGIN: [403, 'Origem da solicitação não autorizada.'],
    AUTH_RATE_LIMITED: [429, 'Muitas tentativas. Aguarde alguns minutos.'],
    AUTH_USER_SUSPENDED: [403, 'Sua conta está suspensa.'],
    AUTH_SECRETS_NOT_CONFIGURED: [503, 'As credenciais Google ainda não foram configuradas.'],
    GOOGLE_TOKEN_MISSING: [401, 'A credencial Google não foi recebida.'],
    GOOGLE_TOKEN_MALFORMED: [401, 'A credencial Google é inválida.'],
    GOOGLE_TOKEN_ALGORITHM: [401, 'O algoritmo da credencial Google não é permitido.'],
    GOOGLE_TOKEN_SIGNATURE: [401, 'A assinatura da credencial Google é inválida.'],
    GOOGLE_TOKEN_AUDIENCE: [401, 'A credencial Google não pertence a esta aplicação.'],
    GOOGLE_TOKEN_AUTHORIZED_PARTY: [401, 'A aplicação autorizada pela credencial Google é inválida.'],
    GOOGLE_TOKEN_ISSUER: [401, 'O emissor da credencial Google é inválido.'],
    GOOGLE_TOKEN_EXPIRED: [401, 'A credencial Google expirou.'],
    GOOGLE_TOKEN_ISSUED_AT: [401, 'O horário da credencial Google é inválido.'],
    GOOGLE_TOKEN_NONCE: [401, 'A tentativa de login Google não corresponde à sessão atual.'],
    GOOGLE_TOKEN_PROFILE: [401, 'O perfil da conta Google está incompleto.'],
    GOOGLE_KEY_NOT_FOUND: [503, 'Não foi possível validar a chave pública do Google.'],
    DATABASE_NOT_CONFIGURED: [503, 'O banco SaaS ainda não foi configurado.'],
    ASSETS_NOT_CONFIGURED: [503, 'Os assets da aplicação não foram configurados.'],
    GOOGLE_DOMAIN_NOT_ALLOWED: [403, 'Esta conta Google não pertence a um domínio autorizado.'],
    GOOGLE_ACCOUNT_NOT_AUTHORITATIVE: [403, 'Esta conta precisa ser autorizada explicitamente.'],
    GOOGLE_JWKS_UNAVAILABLE: [503, 'O serviço de validação do Google está temporariamente indisponível.'],
    TENANT_CREATION_DISABLED: [403, 'A criação de novas empresas está desativada.'],
    TENANT_VALIDATION: [400, 'Os dados da empresa são inválidos.'],
    CUSTOMER_NAME_REQUIRED: [400, 'Informe o nome do cliente.'],
    CUSTOMER_KIND_INVALID: [400, 'O tipo do cliente é inválido.'],
    CUSTOMER_EMAIL_INVALID: [400, 'O e-mail do cliente é inválido.'],
    CUSTOMER_STATUS_INVALID: [400, 'O status do cliente é inválido.'],
    CUSTOMER_NOT_FOUND: [404, 'Cliente não encontrado.'],
    INVITE_EMAIL_INVALID: [400, 'O e-mail do convite é inválido.'],
    INVITE_ALREADY_MEMBER: [409, 'Este e-mail já pertence à empresa.'],
    INVITE_NOT_FOUND: [404, 'Convite não encontrado.'],
    AUTH_ROLE_INVALID: [400, 'O perfil informado é inválido.'],
    AUTH_MEMBERSHIP_STATUS_INVALID: [400, 'O status do acesso é inválido.'],
    MEMBERSHIP_NOT_FOUND: [404, 'Vínculo de usuário não encontrado.'],
    LAST_ADMIN_REQUIRED: [409, 'A empresa precisa manter pelo menos um administrador ativo.'],
    API_VALIDATION: [400, 'Os dados enviados são inválidos.'],
  };
  const [status, message] = mapping[code] || [500, 'Não foi possível concluir a operação.'];
  return json({ ok: false, code, message }, status);
}

async function routeApi(request, env, pathname) {
  if (pathname === '/api/health' && request.method === 'GET') return handleHealth(env);
  if (pathname === '/api/auth/config' && request.method === 'GET') return handleAuthConfig(request, env);
  if (pathname === '/api/auth/google' && request.method === 'POST') return handleGoogleLogin(request, env);
  if ((pathname === '/api/auth/me' || pathname === '/api/v1/me') && request.method === 'GET') {
    return handleMe(request, env);
  }
  if (pathname === '/api/auth/logout' && request.method === 'POST') return handleLogout(request, env);
  if ((pathname === '/api/auth/company' || pathname === '/api/v1/tenant/switch') && request.method === 'POST') {
    return handleTenantSwitch(request, env);
  }
  if (pathname === '/api/v1/tenants' && request.method === 'GET') return handleListTenants(request, env);
  if (pathname === '/api/v1/tenants' && request.method === 'POST') return handleTenantCreate(request, env);
  if (pathname === '/api/v1/customers' && request.method === 'GET') return handleCustomersList(request, env);
  if (pathname === '/api/v1/customers' && request.method === 'POST') return handleCustomerCreate(request, env);
  const customerId = customerPathId(pathname);
  if (customerId && request.method === 'PATCH') return handleCustomerUpdate(request, env, customerId);
  if (customerId && request.method === 'DELETE') return handleCustomerDelete(request, env, customerId);
  if (pathname === '/api/v1/audit' && request.method === 'GET') return handleAuditList(request, env);
  if (pathname === '/api/v1/admin/members' && request.method === 'GET') return handleAdminMembers(request, env);
  if (pathname === '/api/v1/admin/invites' && request.method === 'POST') return handleAdminInvite(request, env);
  const memberMatch = pathname.match(/^\/api\/v1\/admin\/members\/([^/]+)$/);
  if (memberMatch && request.method === 'PATCH') {
    return handleAdminMembershipUpdate(request, env, decodeURIComponent(memberMatch[1]));
  }
  const inviteMatch = pathname.match(/^\/api\/v1\/admin\/invites\/([^/]+)$/);
  if (inviteMatch && request.method === 'DELETE') {
    return handleAdminInviteCancel(request, env, decodeURIComponent(inviteMatch[1]));
  }
  return json({ ok: false, code: 'NOT_FOUND', message: 'Rota não encontrada.' }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const pathname = url.pathname;
    try {
      if (pathname.startsWith('/api/')) return await routeApi(request, env, pathname);

      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return json({ ok: false, message: 'Método não permitido.' }, 405);
      }

      if (pathname === '/login.html') {
        const session = await getSession(env, request);
        if (session) return redirect(safeReturnTo(url.searchParams.get('returnTo')));
        return serveAsset(request, env, { login: true, html: true, publicAsset: true });
      }

      if (isPublicAssetPath(pathname) || pathname === '/sw.js') {
        return serveAsset(request, env, { publicAsset: true });
      }

      const session = await getSession(env, request);
      if (!session) {
        const returnTo = safeReturnTo(`${pathname}${url.search}${url.hash}`);
        if (pathname === '/' || pathname.endsWith('.html')) {
          return redirect(`/login.html?returnTo=${encodeURIComponent(returnTo)}`);
        }
        return json({ ok: false, code: 'AUTH_REQUIRED', message: 'Sessão necessária.' }, 401);
      }

      if (pathname === '/admin-access.html' && !can(session.activeMembership.role, 'members.read')) {
        throw new Error('AUTH_FORBIDDEN');
      }

      return serveAsset(request, env, {
        html: pathname === '/' || pathname.endsWith('.html'),
      });
    } catch (error) {
      console.error(error);
      if (pathname === '/api/auth/google') {
        await recordAuthEvent(env, request, 'login_failed', {
          reason: error instanceof Error ? error.message : 'UNKNOWN',
        });
      }
      const response = errorResponse(error);
      if ((pathname === '/' || pathname.endsWith('.html')) && response.status === 401) {
        return redirect(`/login.html?returnTo=${encodeURIComponent(safeReturnTo(pathname))}`);
      }
      return response;
    }
  },
};
