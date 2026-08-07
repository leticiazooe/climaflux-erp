import { normalizeEmail, splitCsv } from './auth-core.js';
import { ROLE_PERMISSIONS, normalizeSlug } from './policy.js';
import {
  addSeconds,
  getNumber,
  hashedIp,
  nowIso,
  randomToken,
  requireDatabase,
  sessionTokenFromRequest,
  sha256,
  userAgent,
} from './security.js';

export async function recordAuthEvent(env, request, event, details = {}, userId = null) {
  if (!env.DB) return;
  try {
    await env.DB.prepare(
      `INSERT INTO auth_events (id, user_id, event, details_json, ip_hash, user_agent, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        crypto.randomUUID(),
        userId,
        event,
        JSON.stringify(details).slice(0, 8000),
        await hashedIp(request, env),
        userAgent(request),
        nowIso(),
      )
      .run();
  } catch (error) {
    console.error('Falha ao registrar evento de autenticação', error);
  }
}

export async function recordAudit(env, request, session, action, resourceType, resourceId = null, metadata = {}) {
  await env.DB.prepare(
    `INSERT INTO audit_log
      (id, tenant_id, actor_user_id, action, resource_type, resource_id, metadata_json, ip_hash, user_agent, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      crypto.randomUUID(),
      session.activeMembership.tenant_id,
      session.user_id,
      action,
      resourceType,
      resourceId,
      JSON.stringify(metadata).slice(0, 8000),
      await hashedIp(request, env),
      userAgent(request),
      nowIso(),
    )
    .run();
}

export async function enforceLoginRateLimit(env, request) {
  const ipHash = await hashedIp(request, env);
  const threshold = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const result = await env.DB.prepare(
    `SELECT COUNT(*) AS attempts
     FROM auth_events
     WHERE ip_hash = ? AND event IN ('login_failed', 'login_denied') AND created_at >= ?`
  )
    .bind(ipHash, threshold)
    .first();
  if (Number(result?.attempts || 0) >= 20) throw new Error('AUTH_RATE_LIMITED');
}

export async function ensureDefaultTenant(env) {
  requireDatabase(env);
  const id = String(env.DEFAULT_TENANT_ID || 'climaflux-default').slice(0, 100);
  const name = String(env.DEFAULT_TENANT_NAME || 'ClimaFlux').slice(0, 200);
  const slug = normalizeSlug(env.DEFAULT_TENANT_SLUG || name) || 'climaflux';
  const appCompanyKey = String(env.DEFAULT_APP_COMPANY_KEY || '').slice(0, 100) || null;
  const current = nowIso();
  await env.DB.prepare(
    `INSERT INTO tenants
      (id, slug, name, timezone, currency, plan_code, app_company_key, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       app_company_key = COALESCE(excluded.app_company_key, tenants.app_company_key),
       updated_at = excluded.updated_at`
  )
    .bind(
      id,
      slug,
      name,
      String(env.DEFAULT_TIMEZONE || 'America/Sao_Paulo').slice(0, 80),
      String(env.DEFAULT_CURRENCY || 'BRL').slice(0, 10),
      String(env.DEFAULT_PLAN_CODE || 'pilot').slice(0, 40),
      appCompanyKey,
      current,
      current,
    )
    .run();
  return id;
}

export async function upsertUser(env, payload) {
  const id = crypto.randomUUID();
  const email = normalizeEmail(payload.email);
  const current = nowIso();
  await env.DB.prepare(
    `INSERT INTO users
      (id, google_sub, email, email_verified, name, picture_url, hosted_domain, status, created_at, updated_at, last_login_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
     ON CONFLICT(google_sub) DO UPDATE SET
       email = excluded.email,
       email_verified = excluded.email_verified,
       name = excluded.name,
       picture_url = excluded.picture_url,
       hosted_domain = excluded.hosted_domain,
       updated_at = excluded.updated_at,
       last_login_at = excluded.last_login_at`
  )
    .bind(
      id,
      payload.sub,
      email,
      payload.email_verified ? 1 : 0,
      String(payload.name || email).slice(0, 200),
      String(payload.picture || '').slice(0, 1000) || null,
      String(payload.hd || '').slice(0, 255) || null,
      current,
      current,
      current,
    )
    .run();
  return env.DB.prepare('SELECT * FROM users WHERE google_sub = ?').bind(payload.sub).first();
}

export async function acceptPendingInvites(env, user) {
  const current = nowIso();
  await env.DB.prepare(
    `UPDATE tenant_invites SET status = 'expired', updated_at = ?
     WHERE status = 'pending' AND expires_at <= ?`
  )
    .bind(current, current)
    .run();

  const invites = await env.DB.prepare(
    `SELECT * FROM tenant_invites
     WHERE email = ? AND status = 'pending' AND expires_at > ?
     ORDER BY created_at ASC`
  )
    .bind(normalizeEmail(user.email), current)
    .all();

  for (const invite of invites.results || []) {
    await env.DB.prepare(
      `INSERT INTO memberships (id, tenant_id, user_id, role, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'active', ?, ?)
       ON CONFLICT(tenant_id, user_id) DO UPDATE SET
         role = excluded.role,
         status = 'active',
         updated_at = excluded.updated_at`
    )
      .bind(crypto.randomUUID(), invite.tenant_id, user.id, invite.role, current, current)
      .run();
    await env.DB.prepare(
      `UPDATE tenant_invites
       SET status = 'accepted', accepted_by = ?, accepted_at = ?, updated_at = ?
       WHERE id = ? AND status = 'pending'`
    )
      .bind(user.id, current, current, invite.id)
      .run();
  }
}

export async function listMemberships(env, userId) {
  const result = await env.DB.prepare(
    `SELECT
       m.id,
       m.tenant_id,
       m.tenant_id AS company_id,
       m.role,
       m.status,
       m.app_user_key,
       t.name AS tenant_name,
       t.name AS company_name,
       t.slug AS tenant_slug,
       t.slug AS company_slug,
       t.plan_code,
       t.timezone,
       t.currency,
       t.app_company_key
     FROM memberships m
     JOIN tenants t ON t.id = m.tenant_id
     WHERE m.user_id = ? AND m.status = 'active' AND t.status = 'active'
     ORDER BY t.name ASC`
  )
    .bind(userId)
    .all();
  return result.results || [];
}

export async function provisionBootstrapMembership(env, user, payload) {
  let memberships = await listMemberships(env, user.id);
  if (memberships.length) return memberships;

  const email = normalizeEmail(user.email);
  const bootstrapEmails = splitCsv(env.BOOTSTRAP_ADMIN_EMAILS);
  const allowedDomains = splitCsv(env.ALLOWED_GOOGLE_DOMAINS);
  const hostedDomain = String(payload.hd || '').toLowerCase();
  const autoRole = String(env.AUTO_PROVISION_ROLE || '').toLowerCase();
  let role = null;
  if (bootstrapEmails.includes(email)) role = 'admin';
  else if (ROLE_PERMISSIONS[autoRole] && allowedDomains.includes(hostedDomain)) role = autoRole;
  if (!role) return [];

  const tenantId = await ensureDefaultTenant(env);
  const current = nowIso();
  await env.DB.prepare(
    `INSERT INTO memberships
      (id, tenant_id, user_id, role, status, app_user_key, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'active', ?, ?, ?)
     ON CONFLICT(tenant_id, user_id) DO UPDATE SET
       role = excluded.role,
       status = 'active',
       updated_at = excluded.updated_at`
  )
    .bind(
      crypto.randomUUID(),
      tenantId,
      user.id,
      role,
      String(env.BOOTSTRAP_APP_USER_KEY || '').slice(0, 100) || null,
      current,
      current,
    )
    .run();
  memberships = await listMemberships(env, user.id);
  return memberships;
}

export async function createSession(env, request, user, memberships) {
  const current = new Date();
  await env.DB.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(current.toISOString()).run();
  const token = randomToken(32);
  const csrf = randomToken(24);
  const expiresAt = addSeconds(current, getNumber(env, 'SESSION_TTL_SECONDS', 8 * 60 * 60));
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO sessions
      (id, user_id, token_hash, csrf_hash, active_tenant_id, expires_at, last_seen_at, ip_hash, user_agent, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      user.id,
      await sha256(token),
      await sha256(csrf),
      memberships[0].tenant_id,
      expiresAt.toISOString(),
      current.toISOString(),
      await hashedIp(request, env),
      userAgent(request),
      current.toISOString(),
    )
    .run();
  return { id, token, csrf, expiresAt, activeTenantId: memberships[0].tenant_id };
}

export async function getSession(env, request) {
  if (!env.DB) return null;
  const token = sessionTokenFromRequest(request);
  if (!token) return null;
  const session = await env.DB.prepare(
    `SELECT s.*, u.email, u.name, u.picture_url, u.status AS user_status
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ?`
  )
    .bind(await sha256(token))
    .first();
  if (!session || session.user_status !== 'active') return null;

  const now = Date.now();
  const expiresAt = Date.parse(session.expires_at);
  const lastSeenAt = Date.parse(session.last_seen_at);
  const idleMs = getNumber(env, 'SESSION_IDLE_SECONDS', 2 * 60 * 60) * 1000;
  if (
    !Number.isFinite(expiresAt) ||
    expiresAt <= now ||
    !Number.isFinite(lastSeenAt) ||
    lastSeenAt + idleMs <= now
  ) {
    await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(session.id).run();
    return null;
  }

  const memberships = await listMemberships(env, session.user_id);
  const activeMembership = memberships.find((item) => item.tenant_id === session.active_tenant_id) || memberships[0];
  if (!activeMembership) return null;
  if (activeMembership.tenant_id !== session.active_tenant_id) {
    await env.DB.prepare('UPDATE sessions SET active_tenant_id = ? WHERE id = ?')
      .bind(activeMembership.tenant_id, session.id)
      .run();
  }
  if (now - lastSeenAt > 5 * 60 * 1000) {
    await env.DB.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?')
      .bind(nowIso(), session.id)
      .run();
  }
  return { ...session, memberships, activeMembership };
}

export async function requireSession(env, request) {
  const session = await getSession(env, request);
  if (!session) throw new Error('AUTH_REQUIRED');
  return session;
}

export function publicSession(session, csrfToken) {
  const activeTenant = session.activeMembership;
  return {
    user: {
      id: session.user_id,
      email: session.email,
      name: session.name,
      picture: session.picture_url,
    },
    activeTenant,
    activeCompany: activeTenant,
    memberships: session.memberships,
    permissions: ROLE_PERMISSIONS[activeTenant.role] || [],
    csrfToken,
    expiresAt: session.expires_at,
  };
}
