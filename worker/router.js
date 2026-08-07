import authWorker from './index.js';

const PUBLIC_AUTH_ASSETS = new Set([
  '/auth.css',
  '/login.js',
  '/icon.svg',
  '/manifest.webmanifest',
]);

function publicSecurityHeaders(response) {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'public, max-age=300, must-revalidate');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function isPublicAuthAsset(pathname) {
  return PUBLIC_AUTH_ASSETS.has(pathname);
}

export default {
  async fetch(request, env, context) {
    const url = new URL(request.url);
    if (request.method === 'GET' && isPublicAuthAsset(url.pathname)) {
      return publicSecurityHeaders(await env.ASSETS.fetch(request));
    }
    return authWorker.fetch(request, env, context);
  },
};
