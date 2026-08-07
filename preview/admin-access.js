(() => {
  'use strict';

  const STORAGE_KEY = 'climaflux-access-preview-v1';
  const AUDIT_KEY = 'climaflux-access-preview-audit-v1';

  const roleLabels = {
    admin: 'Administrador',
    atendimento: 'Atendimento',
    tecnico: 'Técnico',
    estoque: 'Estoque',
    financeiro: 'Financeiro',
    gestor: 'Gestor',
  };

  const statusLabels = {
    active: 'Ativo',
    pending: 'Pendente',
    suspended: 'Suspenso',
  };

  const defaults = [
    {
      id: 'usr-leticia',
      name: 'Letícia Vitória',
      email: 'leticia@climaflux.demo',
      company: 'ClimaFlux Matriz',
      role: 'admin',
      status: 'active',
      lastAccess: new Date(Date.now() - 18 * 60 * 1000).toISOString(),
    },
    {
      id: 'usr-marina',
      name: 'Marina Alves',
      email: 'marina@climaflux.demo',
      company: 'ClimaFlux Matriz',
      role: 'atendimento',
      status: 'active',
      lastAccess: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: 'usr-caio',
      name: 'Caio Nunes',
      email: 'caio@climaflux.demo',
      company: 'ClimaFlux Matriz',
      role: 'tecnico',
      status: 'active',
      lastAccess: new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: 'usr-bianca',
      name: 'Bianca Martins',
      email: 'bianca@climaflux.demo',
      company: 'ClimaFlux Unidade 2',
      role: 'financeiro',
      status: 'pending',
      lastAccess: null,
    },
    {
      id: 'usr-lucas',
      name: 'Lucas Ferreira',
      email: 'lucas@climaflux.demo',
      company: 'ClimaFlux Unidade 2',
      role: 'estoque',
      status: 'suspended',
      lastAccess: new Date(Date.now() - 9 * 24 * 60 * 60 * 1000).toISOString(),
    },
  ];

  const elements = {
    grid: document.getElementById('userGrid'),
    feedback: document.getElementById('feedback'),
    search: document.getElementById('searchInput'),
    statusFilter: document.getElementById('statusFilter'),
    roleFilter: document.getElementById('roleFilter'),
    reset: document.getElementById('resetButton'),
    newUser: document.getElementById('newUserButton'),
    dialog: document.getElementById('userDialog'),
    form: document.getElementById('userForm'),
    closeDialog: document.getElementById('closeDialogButton'),
    cancelDialog: document.getElementById('cancelDialogButton'),
    auditList: document.getElementById('auditList'),
    clearAudit: document.getElementById('clearAuditButton'),
    total: document.getElementById('metricTotal'),
    active: document.getElementById('metricActive'),
    pending: document.getElementById('metricPending'),
    suspended: document.getElementById('metricSuspended'),
  };

  let users = readUsers();
  let audit = readAudit();

  function cloneDefaults() {
    return defaults.map((user) => ({ ...user }));
  }

  function readUsers() {
    try {
      const value = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (Array.isArray(value) && value.length) return value;
    } catch (error) {
      console.warn('Não foi possível carregar os usuários da prévia.', error);
    }
    return cloneDefaults();
  }

  function readAudit() {
    try {
      const value = JSON.parse(localStorage.getItem(AUDIT_KEY));
      return Array.isArray(value) ? value : [];
    } catch (error) {
      console.warn('Não foi possível carregar o histórico da prévia.', error);
      return [];
    }
  }

  function persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(users));
    localStorage.setItem(AUDIT_KEY, JSON.stringify(audit.slice(0, 40)));
  }

  function notify(message, type = '') {
    elements.feedback.textContent = message;
    elements.feedback.className = `feedback ${type}`.trim();
    if (message) window.setTimeout(() => {
      if (elements.feedback.textContent === message) notify('');
    }, 3500);
  }

  function record(message) {
    audit.unshift({ id: crypto.randomUUID(), message, at: new Date().toISOString() });
    persist();
    renderAudit();
  }

  function initials(name) {
    return String(name || '?')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0].toUpperCase())
      .join('');
  }

  function formatDate(value) {
    if (!value) return 'Ainda não acessou';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Data indisponível';
    return `Último acesso: ${date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}`;
  }

  function createSelect(options, selected, label) {
    const select = document.createElement('select');
    select.setAttribute('aria-label', label);
    for (const [value, text] of Object.entries(options)) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = text;
      option.selected = value === selected;
      select.append(option);
    }
    return select;
  }

  function createCompanySelect(selected) {
    const select = document.createElement('select');
    select.setAttribute('aria-label', 'Empresa');
    for (const value of ['ClimaFlux Matriz', 'ClimaFlux Unidade 2']) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = value;
      option.selected = value === selected;
      select.append(option);
    }
    return select;
  }

  function labeledControl(labelText, control) {
    const label = document.createElement('label');
    const title = document.createElement('span');
    title.textContent = labelText;
    label.append(title, control);
    return label;
  }

  function renderUser(user) {
    const card = document.createElement('article');
    card.className = 'user-card';

    const identity = document.createElement('div');
    identity.className = 'identity';
    const identityLine = document.createElement('div');
    identityLine.className = 'identity-line';
    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    avatar.textContent = initials(user.name);
    const identityCopy = document.createElement('div');
    const name = document.createElement('strong');
    name.textContent = user.name;
    const email = document.createElement('small');
    email.textContent = user.email;
    const lastAccess = document.createElement('small');
    lastAccess.textContent = formatDate(user.lastAccess);
    identityCopy.append(name, email, lastAccess);
    identityLine.append(avatar, identityCopy);
    const pill = document.createElement('span');
    pill.className = `status-pill ${user.status}`;
    pill.textContent = statusLabels[user.status] || user.status;
    identity.append(identityLine, pill);

    const company = createCompanySelect(user.company);
    const role = createSelect(roleLabels, user.role, 'Perfil');
    const status = createSelect(statusLabels, user.status, 'Status');
    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'primary-button';
    save.textContent = 'Salvar';
    save.addEventListener('click', () => {
      const previous = { company: user.company, role: user.role, status: user.status };
      user.company = company.value;
      user.role = role.value;
      user.status = status.value;
      persist();
      record(`${user.name}: ${roleLabels[user.role]}, ${statusLabels[user.status]} em ${user.company}.`);
      notify('Acesso atualizado na prévia.', 'success');
      if (previous.status !== user.status || previous.role !== user.role || previous.company !== user.company) render();
    });

    card.append(
      identity,
      labeledControl('Empresa', company),
      labeledControl('Perfil', role),
      labeledControl('Status', status),
      save,
    );
    return card;
  }

  function filteredUsers() {
    const term = elements.search.value.trim().toLowerCase();
    return users.filter((user) => {
      const matchesTerm = !term || `${user.name} ${user.email}`.toLowerCase().includes(term);
      const matchesStatus = elements.statusFilter.value === 'all' || user.status === elements.statusFilter.value;
      const matchesRole = elements.roleFilter.value === 'all' || user.role === elements.roleFilter.value;
      return matchesTerm && matchesStatus && matchesRole;
    });
  }

  function renderMetrics() {
    elements.total.textContent = String(users.length);
    elements.active.textContent = String(users.filter((user) => user.status === 'active').length);
    elements.pending.textContent = String(users.filter((user) => user.status === 'pending').length);
    elements.suspended.textContent = String(users.filter((user) => user.status === 'suspended').length);
  }

  function renderAudit() {
    elements.auditList.replaceChildren();
    if (!audit.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = 'Nenhuma atividade registrada nesta prévia.';
      elements.auditList.append(empty);
      return;
    }
    for (const item of audit.slice(0, 10)) {
      const row = document.createElement('div');
      row.className = 'audit-item';
      const message = document.createElement('strong');
      message.textContent = item.message;
      const time = document.createElement('span');
      time.textContent = new Date(item.at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
      row.append(message, time);
      elements.auditList.append(row);
    }
  }

  function render() {
    renderMetrics();
    renderAudit();
    elements.grid.replaceChildren();
    const result = filteredUsers();
    if (!result.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = 'Nenhum usuário corresponde aos filtros selecionados.';
      elements.grid.append(empty);
      return;
    }
    for (const user of result) elements.grid.append(renderUser(user));
  }

  function openDialog() {
    elements.form.reset();
    elements.dialog.showModal();
    elements.form.elements.name.focus();
  }

  function closeDialog() {
    elements.dialog.close();
  }

  elements.search.addEventListener('input', render);
  elements.statusFilter.addEventListener('change', render);
  elements.roleFilter.addEventListener('change', render);
  elements.newUser.addEventListener('click', openDialog);
  elements.closeDialog.addEventListener('click', closeDialog);
  elements.cancelDialog.addEventListener('click', closeDialog);

  elements.form.addEventListener('submit', (event) => {
    event.preventDefault();
    const data = new FormData(elements.form);
    const email = String(data.get('email') || '').trim().toLowerCase();
    if (users.some((user) => user.email.toLowerCase() === email)) {
      notify('Já existe um usuário com esse e-mail.', 'error');
      return;
    }
    const user = {
      id: crypto.randomUUID(),
      name: String(data.get('name') || '').trim(),
      email,
      company: String(data.get('company') || 'ClimaFlux Matriz'),
      role: String(data.get('role') || 'atendimento'),
      status: 'pending',
      lastAccess: null,
    };
    users.unshift(user);
    persist();
    record(`${user.name} foi adicionado como acesso pendente.`);
    closeDialog();
    notify('Usuário adicionado à prévia.', 'success');
    render();
  });

  elements.reset.addEventListener('click', () => {
    if (!window.confirm('Restaurar os usuários e apagar as alterações desta prévia?')) return;
    users = cloneDefaults();
    audit = [];
    persist();
    notify('Demonstração restaurada.', 'success');
    render();
  });

  elements.clearAudit.addEventListener('click', () => {
    audit = [];
    persist();
    renderAudit();
    notify('Histórico local limpo.', 'success');
  });

  render();
})();
