import saasWorker from './saas-worker.js';
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

export default {
  async fetch(request, env, context) {
    const pathname = new URL(request.url).pathname;

    if ((pathname === '/api/v1/me' || pathname === '/api/auth/me') && request.method === 'GET') {
      return augmentSessionResponse(request, env, context);
    }

    if (isFieldPath(pathname)) {
      try {
        const response = await routeFieldServiceApi(request, env, pathname);
        return response || new Response(JSON.stringify({
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
      } catch (error) {
        console.error('Field service API failure', error);
        return fieldServiceErrorResponse(error);
      }
    }

    return saasWorker.fetch(request, env, context);
  },
};
