(() => {
  'use strict';

  const SESSION_KEY = 'climaflux-preview-session-v1';
  const LOGIN_PATH = '/login.html';
  const isLoginPage = document.body?.dataset?.sessionPage === 'login';

  function safeReturnTo(value) {
    if (!value || typeof value !== 'string') return '/';
    if (!value.startsWith('/') || value.startsWith('//')) return '/';
    try {
      const url = new URL(value, location.origin);
      return url.origin === location.origin ? `${url.pathname}${url.search}${url.hash}` : '/';
    } catch {
      return '/';
    }
  }

  function currentReturnTo() {
    return safeReturnTo(`${location.pathname}${location.search}${location.hash}`);
  }

  function hasSession() {
    try {
      return localStorage.getItem(SESSION_KEY) === 'active';
    } catch {
      return false;
    }
  }

  function redirectToLogin() {
    const target = encodeURIComponent(currentReturnTo());
    location.replace(`${LOGIN_PATH}?returnTo=${target}`);
  }

  function closeDialog(dialog) {
    if (dialog.open) dialog.close();
  }

  function endSession() {
    try {
      localStorage.removeItem(SESSION_KEY);
      localStorage.removeItem('climaflux-preview-session-started-at');
      sessionStorage.clear();
    } catch (error) {
      console.warn('Não foi possível limpar a sessão demonstrativa.', error);
    }
    location.replace(`${LOGIN_PATH}?signedOut=1`);
  }

  function createLogoutDialog() {
    const dialog = document.createElement('dialog');
    dialog.className = 'climaflux-session-dialog';
    dialog.setAttribute('aria-labelledby', 'climafluxLogoutTitle');

    const form = document.createElement('form');
    form.method = 'dialog';

    const title = document.createElement('h2');
    title.id = 'climafluxLogoutTitle';
    title.textContent = 'Sair do ClimaFlux ERP?';

    const description = document.createElement('p');
    description.textContent = 'A sessão demonstrativa será encerrada. Os dados operacionais da demonstração continuarão salvos neste navegador.';

    const actions = document.createElement('div');
    actions.className = 'climaflux-session-dialog-actions';

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'climaflux-session-button';
    cancel.textContent = 'Continuar no sistema';
    cancel.addEventListener('click', () => closeDialog(dialog));

    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.className = 'climaflux-session-button danger';
    confirm.textContent = 'Sair do sistema';
    confirm.addEventListener('click', () => {
      confirm.disabled = true;
      endSession();
    });

    actions.append(cancel, confirm);
    form.append(title, description, actions);
    dialog.append(form);
    document.body.append(dialog);
    return dialog;
  }

  function attachLogoutButton(button) {
    if (!button || button.dataset.logoutReady === 'true') return;
    button.dataset.logoutReady = 'true';
    button.addEventListener('click', () => {
      const dialog = document.querySelector('.climaflux-session-dialog') || createLogoutDialog();
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else if (window.confirm('Sair do ClimaFlux ERP?')) endSession();
    });
  }

  function installSessionControls() {
    const existing = document.getElementById('logoutButton');
    if (existing) {
      existing.classList.add('climaflux-session-button', 'danger', 'climaflux-topbar-logout');
      attachLogoutButton(existing);
      return;
    }

    if (document.querySelector('.climaflux-session-dock')) return;
    const dock = document.createElement('aside');
    dock.className = 'climaflux-session-dock';
    dock.setAttribute('aria-label', 'Controles da sessão demonstrativa');

    const badge = document.createElement('span');
    badge.className = 'climaflux-session-badge';
    badge.textContent = 'Sessão demonstrativa';

    const access = document.createElement('a');
    access.className = 'climaflux-session-link';
    access.href = '/admin-access.html';
    access.textContent = 'Gestão de acessos';

    const logout = document.createElement('button');
    logout.id = 'climafluxFloatingLogout';
    logout.type = 'button';
    logout.className = 'climaflux-session-button danger';
    logout.textContent = 'Sair';
    logout.setAttribute('aria-label', 'Encerrar sessão e sair do ClimaFlux ERP');

    dock.append(badge, access, logout);
    document.body.append(dock);
    attachLogoutButton(logout);
  }

  if (isLoginPage) return;
  if (!hasSession()) {
    redirectToLogin();
    return;
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installSessionControls, { once: true });
  } else {
    installSessionControls();
  }
})();
