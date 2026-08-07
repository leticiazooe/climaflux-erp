(() => {
  'use strict';

  const buttonHost = document.getElementById('googleButton');
  const status = document.getElementById('loginStatus');
  const returnTo = new URLSearchParams(location.search).get('returnTo') || '/';
  let config;

  function show(message, type = '') {
    status.textContent = message;
    status.className = `auth-status ${type}`.trim();
  }

  async function waitForGoogle(timeoutMs = 10000) {
    const started = Date.now();
    while (!window.google?.accounts?.id) {
      if (Date.now() - started > timeoutMs) throw new Error('O serviço de login do Google não respondeu.');
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  async function sendCredential(response) {
    show('Validando sua conta com segurança…', 'loading');
    try {
      const result = await fetch('/api/auth/google', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': config.csrf,
        },
        body: JSON.stringify({ credential: response.credential, csrf: config.csrf, returnTo }),
      });
      const body = await result.json().catch(() => ({}));
      if (!result.ok) {
        if (body.code === 'ACCESS_PENDING') {
          show('Sua conta foi confirmada, mas ainda precisa de um convite de uma empresa.', 'warning');
          return;
        }
        throw new Error(body.message || 'Não foi possível concluir o acesso.');
      }
      show('Acesso autorizado. Abrindo o ClimaFlux…', 'success');
      location.replace(body.returnTo || '/');
    } catch (error) {
      show(error.message || 'Falha ao entrar com o Google.', 'error');
      window.google?.accounts?.id?.disableAutoSelect();
    }
  }

  async function init() {
    show('Preparando o login…', 'loading');
    const response = await fetch('/api/auth/config', {
      credentials: 'same-origin',
      cache: 'no-store',
    });
    config = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(config.message || 'A autenticação ainda não foi configurada.');
    await waitForGoogle();
    window.google.accounts.id.initialize({
      client_id: config.clientId,
      callback: sendCredential,
      nonce: config.nonce,
      auto_select: false,
      cancel_on_tap_outside: false,
      use_fedcm_for_prompt: true,
    });
    window.google.accounts.id.renderButton(buttonHost, {
      type: 'standard',
      theme: 'outline',
      size: 'large',
      text: 'signin_with',
      shape: 'rectangular',
      logo_alignment: 'left',
      width: Math.min(360, buttonHost.clientWidth || 360),
      locale: 'pt-BR',
    });
    show('Selecione a conta Google autorizada.', 'ready');
  }

  init().catch((error) => show(error.message || 'Não foi possível preparar o login.', 'error'));
})();
