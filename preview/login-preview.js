(() => {
  'use strict';

  const SESSION_KEY = 'climaflux-preview-session-v1';
  const status = document.getElementById('loginStatus');
  const enterButton = document.getElementById('enterDemoButton');
  const accessButton = document.getElementById('openAccessButton');

  function safeReturnTo(value) {
    if (!value || !value.startsWith('/') || value.startsWith('//')) return '/';
    try {
      const url = new URL(value, location.origin);
      return url.origin === location.origin ? `${url.pathname}${url.search}${url.hash}` : '/';
    } catch {
      return '/';
    }
  }

  function startSession(destination) {
    try {
      localStorage.setItem(SESSION_KEY, 'active');
      localStorage.setItem('climaflux-preview-session-started-at', new Date().toISOString());
    } catch (error) {
      console.warn('Não foi possível salvar a sessão demonstrativa.', error);
    }
    status.textContent = 'Sessão iniciada. Abrindo o sistema…';
    location.replace(destination);
  }

  const params = new URLSearchParams(location.search);
  const returnTo = safeReturnTo(params.get('returnTo'));
  if (params.get('signedOut') === '1') status.textContent = 'Você saiu do sistema com segurança.';

  enterButton.addEventListener('click', () => {
    enterButton.disabled = true;
    startSession(returnTo === '/login.html' ? '/' : returnTo);
  });

  accessButton.addEventListener('click', () => {
    accessButton.disabled = true;
    startSession('/admin-access.html');
  });
})();
