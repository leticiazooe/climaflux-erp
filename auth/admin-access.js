(() => {
  const grid = document.getElementById('userGrid');
  const status = document.getElementById('adminStatus');
  let csrfToken = '';
  let companies = [];

  const roles = ['admin', 'atendimento', 'tecnico', 'estoque', 'financeiro', 'gestor'];
  const statuses = ['active', 'pending', 'suspended'];

  function show(message, type = '') {
    status.textContent = message;
    status.className = `auth-status ${type}`.trim();
  }

  async function request(path, options = {}) {
    const headers = new Headers(options.headers || {});
    if (csrfToken && options.method && options.method !== 'GET') headers.set('X-CSRF-Token', csrfToken);
    const response = await fetch(path, { ...options, headers, credentials: 'same-origin', cache: 'no-store' });
    const body = await response.json().catch(() => ({}));
    if (response.status === 401) location.replace('/login.html?returnTo=/admin-access.html');
    if (!response.ok) throw new Error(body.message || 'Falha ao consultar acessos.');
    return body;
  }

  function selectField(values, selected, label) {
    const select = document.createElement('select');
    select.setAttribute('aria-label', label);
    for (const value of values) {
      const option = document.createElement('option');
      option.value = typeof value === 'string' ? value : value.id;
      option.textContent = typeof value === 'string' ? value : value.name;
      option.selected = option.value === selected;
      select.append(option);
    }
    return select;
  }

  function identityBlock(user) {
    const identity = document.createElement('div');
    const name = document.createElement('strong');
    name.textContent = user.name || user.email;
    const email = document.createElement('small');
    email.textContent = user.email;
    const access = document.createElement('small');
    access.textContent = user.last_login_at
      ? `Último acesso: ${new Date(user.last_login_at).toLocaleString('pt-BR')}`
      : 'Ainda não acessou';
    identity.append(name, email, access);
    return identity;
  }

  function render(rows) {
    grid.replaceChildren();
    const grouped = new Map();
    for (const row of rows) {
      if (!grouped.has(row.id)) grouped.set(row.id, []);
      grouped.get(row.id).push(row);
    }

    for (const [userId, memberships] of grouped) {
      const user = memberships[0];
      const membership = memberships.find((item) => item.membership_id) || {};
      const card = document.createElement('article');
      card.className = 'admin-auth-card admin-auth-user';

      const identity = identityBlock(user);
      const company = selectField(companies, membership.company_id || companies[0]?.id, 'Empresa');
      const role = selectField(roles, membership.role || 'atendimento', 'Perfil');
      const membershipStatus = selectField(statuses, membership.membership_status || 'pending', 'Status');
      const appUserKey = document.createElement('input');
      appUserKey.placeholder = 'ID do usuário no ERP';
      appUserKey.value = membership.app_user_key || '';
      appUserKey.setAttribute('aria-label', 'ID do usuário no ERP');

      const save = document.createElement('button');
      save.type = 'button';
      save.textContent = membership.membership_id ? 'Atualizar' : 'Autorizar';
      save.addEventListener('click', async () => {
        save.disabled = true;
        show('Salvando acesso…', 'loading');
        try {
          await request('/api/admin/membership', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userId,
              companyId: company.value,
              role: role.value,
              status: membershipStatus.value,
              appUserKey: appUserKey.value,
            }),
          });
          show('Acesso atualizado.', 'success');
          await load();
        } catch (error) {
          show(error.message, 'error');
          save.disabled = false;
        }
      });

      card.append(identity, company, role, membershipStatus, appUserKey, save);
      grid.append(card);
    }
  }

  async function load() {
    show('Carregando usuários…', 'loading');
    const me = await request('/api/auth/me');
    csrfToken = me.csrfToken;
    if (me.activeCompany.role !== 'admin') throw new Error('Apenas administradores podem gerenciar acessos.');
    const data = await request('/api/admin/users');
    companies = data.companies.filter((company) => company.status === 'active');
    render(data.users);
    show(`${new Set(data.users.map((user) => user.id)).size} usuário(s) encontrado(s).`, 'ready');
  }

  load().catch((error) => show(error.message, 'error'));
})();
