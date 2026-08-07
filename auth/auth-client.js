(() => {
  let session = null;
  let csrfToken = '';

  function showFatal(message) {
    const root = document.createElement('div');
    root.className = 'climaflux-auth-error';
    root.innerHTML = `<div><h2>Sessão não disponível</h2><p>${message}</p><p><a href="/login.html">Voltar para o login</a></p></div>`;
    document.body.append(root);
  }

  async function api(path, options = {}) {
    const headers = new Headers(options.headers || {});
    if (csrfToken && options.method && options.method !== 'GET') headers.set('X-CSRF-Token', csrfToken);
    const response = await fetch(path, { ...options, headers, credentials: 'same-origin', cache: 'no-store' });
    const body = await response.json().catch(() => ({}));
    if (response.status === 401) {
      location.replace(`/login.html?returnTo=${encodeURIComponent(location.pathname + location.search + location.hash)}`);
      throw new Error('Sessão expirada.');
    }
    if (!response.ok) throw new Error(body.message || 'Falha na solicitação.');
    return body;
  }

  function findSelect(ids) {
    for (const id of ids) {
      const element = document.getElementById(id);
      if (element instanceof HTMLSelectElement) return element;
    }
    return null;
  }

  function chooseOption(select, candidates) {
    if (!select) return false;
    const normalized = candidates.filter(Boolean).map((value) => String(value).trim().toLowerCase());
    const option = [...select.options].find((item) => {
      const value = item.value.trim().toLowerCase();
      const text = item.textContent.trim().toLowerCase();
      return normalized.includes(value) || normalized.includes(text);
    });
    if (!option) return false;
    if (select.value !== option.value) {
      select.value = option.value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return true;
  }

  function hideControl(element) {
    if (!element) return;
    const wrapper = element.closest('label, .field, .form-field, .control, .selector, .topbar-control') || element.parentElement;
    if (wrapper) wrapper.style.display = 'none';
    element.disabled = true;
    element.setAttribute('aria-hidden', 'true');
  }

  function synchronizeDemoContext() {
    const membership = session.activeCompany;
    const companySelect = findSelect(['companySelect', 'empresaSelect', 'tenantSelect']);
    chooseOption(companySelect, [membership.app_company_key, membership.company_id, membership.company_name, membership.company_slug]);
    hideControl(companySelect);

    const userSelect = findSelect(['userSelect', 'usuarioSelect', 'profileSelect']);
    chooseOption(userSelect, [membership.app_user_key, session.user.email, session.user.name]);
    hideControl(userSelect);

    localStorage.setItem('climaflux-auth-context', JSON.stringify({
      userId: session.user.id,
      email: session.user.email,
      companyId: membership.company_id,
      role: membership.role,
      appCompanyKey: membership.app_company_key,
      appUserKey: membership.app_user_key,
    }));
    window.dispatchEvent(new CustomEvent('climaflux:auth-context', { detail: session }));
  }

  function sessionBar() {
    document.querySelector('.climaflux-session-bar')?.remove();
    const bar = document.createElement('aside');
    bar.className = 'climaflux-session-bar';
    bar.setAttribute('aria-label', 'Sessão autenticada');

    const avatar = document.createElement('img');
    avatar.src = session.user.picture || '/icon.svg';
    avatar.alt = '';
    avatar.referrerPolicy = 'no-referrer';

    const copy = document.createElement('div');
    copy.className = 'climaflux-session-copy';
    copy.innerHTML = `<strong>${session.user.name || session.user.email}</strong><span>${session.activeCompany.company_name} · ${session.activeCompany.role}</span>`;

    bar.append(avatar, copy);

    if (session.memberships.length > 1) {
      const select = document.createElement('select');
      select.setAttribute('aria-label', 'Empresa ativa');
      for (const membership of session.memberships) {
        const option = document.createElement('option');
        option.value = membership.company_id;
        option.textContent = membership.company_name;
        option.selected = membership.company_id === session.activeCompany.company_id;
        select.append(option);
      }
      select.addEventListener('change', async () => {
        select.disabled = true;
        try {
          const result = await api('/api/auth/company', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ companyId: select.value }),
          });
          session.activeCompany = result.activeCompany;
          synchronizeDemoContext();
          sessionBar();
          location.reload();
        } catch (error) {
          alert(error.message);
          select.disabled = false;
        }
      });
      bar.append(select);
    }

    if (session.activeCompany.role === 'admin') {
      const admin = document.createElement('a');
      admin.href = '/admin-access.html';
      admin.textContent = 'Acessos';
      bar.append(admin);
    }

    const logout = document.createElement('button');
    logout.type = 'button';
    logout.textContent = 'Sair';
    logout.addEventListener('click', async () => {
      logout.disabled = true;
      try {
        await api('/api/auth/logout', { method: 'POST' });
      } catch (error) {
        console.warn(error);
      }
      for (const key of Object.keys(localStorage)) {
        if (key.toLowerCase().startsWith('climaflux')) localStorage.removeItem(key);
      }
      if ('caches' in window) {
        for (const name of await caches.keys()) await caches.delete(name);
      }
      if ('serviceWorker' in navigator) {
        for (const registration of await navigator.serviceWorker.getRegistrations()) await registration.unregister();
      }
      location.replace('/login.html');
    });
    bar.append(logout);
    document.body.append(bar);
  }

  async function init() {
    const body = await api('/api/auth/me');
    session = body;
    csrfToken = body.csrfToken;
    synchronizeDemoContext();
    sessionBar();
    setTimeout(synchronizeDemoContext, 250);
    setTimeout(synchronizeDemoContext, 1000);
  }

  init().catch((error) => showFatal(error.message || 'Não foi possível validar a sessão.'));
})();
