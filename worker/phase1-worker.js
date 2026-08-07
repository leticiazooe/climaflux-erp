import saasWorker from './saas-worker.js';
import { requireSession } from './auth.js';
import {
  fieldPermissionsForRole,
  fieldServiceErrorResponse,
  routeFieldServiceApi,
} from './field-service.js';

function isFieldPath(pathname) {
  return pathname === '/api/v1/field/lookups'
    || pathname === '/api/v1/field/visits'
    || pathname.startsWith('/api/v1/field/visits/');
}

async function augmentSessionResponse(request, env, context) {
  const response = await saasWorker.fetch(request, env, context);
  if (!response.ok) return response;
  const body = await response.json().catch(() => null);
  if (!body?.activeTenant && !body?.activeCompany) return response;
  const active = body.activeTenant || body.activeCompany;
  body.permissions = [...new Set([...(body.permissions || []), ...fieldPermissionsForRole(active.role)])];
  const headers = new Headers(response.headers);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  return new Response(JSON.stringify(body), { status: response.status, headers });
}

async function restrictTechnicianLookups(response, request, env, pathname) {
  if (pathname !== '/api/v1/field/lookups' || !response.ok) return response;
  const session = await requireSession(env, request);
  if (session.activeMembership.role !== 'tecnico') return response;
  const body = await response.json().catch(() => ({}));
  body.workOrders = (body.workOrders || []).filter((order) => order.technician_user_id === session.user_id);
  body.technicians = (body.technicians || []).filter((technician) => technician.user_id === session.user_id);
  const headers = new Headers(response.headers);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  return new Response(JSON.stringify(body), { status: response.status, headers });
}

export default {
  async fetch(request, env, context) {
    const pathname = new URL(request.url).pathname;

    if ((pathname === '/api/v1/me' || pathname === '/api/auth/me') && request.method === 'GET') {
      return augmentSessionResponse(request, env, context);
    }

    if (isFieldPath(pathname)) {
      try {
        const response = await routeFieldServiceApi(request, env, pathname);
        if (!response) {
          return new Response(JSON.stringify({
            ok: false,
            code: 'NOT_FOUND',
            message: 'Rota de operação de campo não encontrada.',
          }), {
            status: 404,
            headers: {
              'Content-Type': 'application/json; charset=utf-8',
              'Cache-Control': 'no-store',
            },
          });
        }
        return restrictTechnicianLookups(response, request, env, pathname);
      } catch (error) {
        console.error('Field service API failure', error);
        return fieldServiceErrorResponse(error);
      }
    }

    return saasWorker.fetch(request, env, context);
  },
};
