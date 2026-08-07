(() => {
  'use strict';

  let session = null;
  let csrfToken = '';
  let resolveReady;
  let rejectReady;

  const ready = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  function showFatal(message) {
    const root = document.createElement('div');
    root.className = 'climaflux-auth-error';
    const card = document.createElement('div');
    const title = document.createElement('h2');
    title.textContent = 'Sessão não disponível';
    const description = document.createElement('p');
    description.textContent = String(message || 'Não foi possível validar a sessão.');
    const action = document.createElement('p');
    const link = document.createElement('a');
    link.href = '/login.html';
    link.textContent = 'Voltar para o login';
    action.append(link);
    card.append(title, description, action);
    root.append(card);
    document.body.append(root);
  }

  async function api(path, options = {}) {
    const method = String(options.method || 'GET').toUpperCase();
    const headers = new Headers(options.headers || {});
    if (csrfToken && !['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      headers.set('X-CSRF-Token', csrfToken);
    }
    const response = await fetch(path, {
      ...options,
      method,
      headers,
      credentials: 'same-origin',
      cache: 'no-store',
    });
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
    const membership = session.activeTenant || session.activeCompany;
    const companySelect = findSelect(['companySelect', 'empresaSelect', 'tenantSelect']);
    chooseOption(companySelect, [
      membership.app_company_key,
      membership.tenant_id,
      membership.company_id,
      membership.tenant_name,
      membership.company_name,
      membership.tenant_slug,
    ]);
    hideControl(companySelect);

    const userSelect = findSelect(['userSelect', 'usuarioSelect', 'profileSelect']);
    chooseOption(userSelect, [membership.app_user_key, session.user.email, session.user.name]);
    hideControl(userSelect);

    localStorage.setItem('climaflux-auth-context', JSON.stringify({
      userId: session.user.id,
      email: session.user.email,
      tenantId: membership.tenant_id,
      role: membership.role,
      appCompanyKey: membership.app_company_key,
      appUserKey: membership.app_user_key,
    }));
    window.dispatchEvent(new CustomEvent('climaflux:auth-context', { detail: session }));
  }

  function appendLink(bar, href, label) {
    const link = document.createElement('a');
    link.href = href;
    link.textContent = label;
    bar.append(link);
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
    const identity = document.createElement('strong');
    identity.textContent = session.user.name || session.user.email;
    const context = document.createElement('span');
    const active = session.activeTenant || session.activeCompany;
    context.textContent = `${active.tenant_name || active.company_name} · ${active.role}`;
    copy.append(identity, context);
    bar.append(avatar, copy);

    if (session.memberships.length > 1) {
      const select = document.createElement('select');
      select.setAttribute('aria-label', 'Empresa ativa');
      for (const membership of session.memberships) {
        const option = document.createElement('option');
        option.value = membership.tenant_id;
        option.textContent = membership.tenant_name || membership.company_name;
        option.selected = membership.tenant_id === active.tenant_id;
        select.append(option);
      }
      select.addEventListener('change', async () => {
        select.disabled = true;
        try {
          await api('/api/v1/tenant/switch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tenantId: select.value }),
          });
          location.reload();
        } catch (error) {
          alert(error.message);
          select.disabled = false;
        }
      });
      bar.append(select);
    }

    appendLink(bar, '/', 'ERP');
    appendLink(bar, '/customers-saas.html', 'Clientes SaaS');
    if (session.permissions.includes('*') || session.permissions.includes('members.read')) {
      appendLink(bar, '/admin-access.html', 'Acessos');
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
      localStorage.removeItem('climaflux-auth-context');
      sessionStorage.clear();
      if ('caches' in window) {
        for (const name of await caches.keys()) await caches.delete(name);
      }
      location.replace('/login.html');
    });
    bar.append(logout);
    document.body.append(bar);
  }

  async function init() {
    const body = await api('/api/v1/me');
    session = body;
    csrfToken = body.csrfToken;
    synchronizeDemoContext();
    sessionBar();

    window.ClimaFluxSaaS = {
      ready,
      api,
      get session() { return session; },
      get csrfToken() { return csrfToken; },
      listCustomers(params = {}) {
        const search = new URLSearchParams(params);
        return api(`/api/v1/customers?${search.toString()}`);
      },
      createCustomer(customer, idempotencyKey = crypto.randomUUID()) {
        return api('/api/v1/customers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
          body: JSON.stringify(customer),
        });
      },
      updateCustomer(id, customer) {
        return api(`/api/v1/customers/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(customer),
        });
      },
      deleteCustomer(id) {
        return api(`/api/v1/customers/${encodeURIComponent(id)}`, { method: 'DELETE' });
      },
    };
    resolveReady(window.ClimaFluxSaaS);
    setTimeout(synchronizeDemoContext, 250);
    setTimeout(synchronizeDemoContext, 1000);
  }

  init().catch((error) => {
    rejectReady(error);
    showFatal(error.message || 'Não foi possível validar a sessão.');
  });
})();
