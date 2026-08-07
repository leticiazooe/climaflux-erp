import baseWorker from './index.js';
import {
  operationalErrorResponse,
  operationalPermissionsForRole,
  routeOperationsApi,
} from './operations.js';

function isOperationalPath(pathname) {
  return pathname === '/api/v1/equipment'
    || pathname.startsWith('/api/v1/equipment/')
    || pathname === '/api/v1/work-orders'
    || pathname.startsWith('/api/v1/work-orders/');
}

async function augmentSessionResponse(request, env, context) {
  const response = await baseWorker.fetch(request, env, context);
  if (!response.ok) return response;
  const body = await response.json().catch(() => null);
  if (!body?.activeTenant && !body?.activeCompany) return response;
  const active = body.activeTenant || body.activeCompany;
  const operational = operationalPermissionsForRole(active.role);
  body.permissions = [...new Set([...(body.permissions || []), ...operational])];
  const headers = new Headers(response.headers);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  return new Response(JSON.stringify(body), { status: response.status, headers });
}

function operationalError(error) {
  const code = error instanceof Error ? error.message : 'UNKNOWN';
  if (code.includes('WORK_ORDER_ACTIVE_VISIT_EXISTS')) {
    return new Response(JSON.stringify({
      ok: false,
      code: 'WORK_ORDER_ACTIVE_VISIT_EXISTS',
      message: 'Finalize ou cancele a visita técnica ativa antes de trocar o técnico ou encerrar a ordem.',
    }), {
      status: 409,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  }
  return operationalErrorResponse(error);
}

export default {
  async fetch(request, env, context) {
    const pathname = new URL(request.url).pathname;

    if ((pathname === '/api/v1/me' || pathname === '/api/auth/me') && request.method === 'GET') {
      return augmentSessionResponse(request, env, context);
    }

    if (isOperationalPath(pathname)) {
      try {
        const response = await routeOperationsApi(request, env, pathname);
        return response || new Response(JSON.stringify({
          ok: false,
          code: 'NOT_FOUND',
          message: 'Rota operacional não encontrada.',
        }), {
          status: 404,
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
          },
        });
      } catch (error) {
        console.error('Operational API failure', error);
        return operationalError(error);
      }
    }

    return baseWorker.fetch(request, env, context);
  },
};
