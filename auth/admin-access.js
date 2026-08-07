(() => {
  'use strict';

  const status = document.getElementById('adminStatus');
  const tenantLabel = document.getElementById('tenantLabel');
  const memberGrid = document.getElementById('memberGrid');
  const inviteGrid = document.getElementById('inviteGrid');
  const inviteForm = document.getElementById('inviteForm');
  const roles = ['admin', 'atendimento', 'tecnico', 'estoque', 'financeiro', 'gestor'];
  const membershipStatuses = ['active', 'pending', 'suspended'];
  let client;
  let canWrite = false;

  function show(message, type = '') {
    status.textContent = message;
    status.className = `auth-status ${type}`.trim();
  }

  async function waitForClient(timeoutMs = 10000) {
    const started = Date.now();
    while (!window.ClimaFluxSaaS) {
      if (Date.now() - started > timeoutMs) throw new Error('A sessão não ficou disponível.');
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    await window.ClimaFluxSaaS.ready;
    return window.ClimaFluxSaaS;
  }

  function selectField(values, selected, label) {
    const select = document.createElement('select');
    select.setAttribute('aria-label', label);
    for (const value of values) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = value === 'admin'
        ? 'Administrador'
        : value.charAt(0).toUpperCase() + value.slice(1);
      option.selected = value === selected;
      select.append(option);
    }
    return select;
  }

  function empty(message) {
    const node = document.createElement('div');
    node.className = 'saas-empty';
    node.textContent = message;
    return node;
  }

  function identityBlock(member) {
    const identity = document.createElement('div');
    const name = document.createElement('strong');
    name.textContent = member.name || member.email;
    const email = document.createElement('small');
    email.textContent = member.email;
    const access = document.createElement('small');
    access.textContent = member.last_login_at
      ? `Último acesso: ${new Date(member.last_login_at).toLocaleString('pt-BR')}`
      : 'Ainda não acessou';
    identity.append(name, email, access);
    return identity;
  }

  function renderMembers(members) {
    memberGrid.replaceChildren();
    if (!members.length) {
      memberGrid.append(empty('Nenhum membro vinculado a esta empresa.'));
      return;
    }

    for (const member of members) {
      const card = document.createElement('article');
      card.className = 'admin-auth-card admin-auth-user';
      const identity = identityBlock(member);
      const role = selectField(roles, member.role, 'Perfil');
      const memberStatus = selectField(membershipStatuses, member.status, 'Status');
      const appUserKey = document.createElement('input');
      appUserKey.value = member.app_user_key || '';
      appUserKey.placeholder = 'ID no ERP legado';
      appUserKey.setAttribute('aria-label', 'ID correspondente no ERP legado');

      role.disabled = !canWrite;
      memberStatus.disabled = !canWrite;
      appUserKey.disabled = !canWrite;

      const save = document.createElement('button');
      save.type = 'button';
      save.textContent = 'Salvar';
      save.hidden = !canWrite;
      save.addEventListener('click', async () => {
        save.disabled = true;
        show('Atualizando acesso…', 'loading');
        try {
          await client.api(`/api/v1/admin/members/${encodeURIComponent(member.user_id)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              role: role.value,
              status: memberStatus.value,
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
      card.append(identity, role, memberStatus, appUserKey, save);
      memberGrid.append(card);
    }
  }

  function renderInvites(invites) {
    inviteGrid.replaceChildren();
    if (!invites.length) {
      inviteGrid.append(empty('Nenhum convite pendente.'));
      return;
    }

    for (const invite of invites) {
      const card = document.createElement('article');
      card.className = 'admin-auth-card admin-auth-pending';
      const identity = document.createElement('div');
      const email = document.createElement('strong');
      email.textContent = invite.email;
      const created = document.createElement('small');
      created.textContent = `Criado em ${new Date(invite.created_at).toLocaleString('pt-BR')}`;
      identity.append(email, created);

      const role = document.createElement('span');
      role.textContent = invite.role === 'admin'
        ? 'Administrador'
        : invite.role.charAt(0).toUpperCase() + invite.role.slice(1);
      const expiry = document.createElement('span');
      expiry.textContent = `Expira em ${new Date(invite.expires_at).toLocaleDateString('pt-BR')}`;
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.hidden = !canWrite;
      cancel.className = 'saas-button danger';
      cancel.textContent = 'Cancelar';
      cancel.addEventListener('click', async () => {
        cancel.disabled = true;
        try {
          await client.api(`/api/v1/admin/invites/${encodeURIComponent(invite.id)}`, {
            method: 'DELETE',
          });
          show('Convite cancelado.', 'success');
          await load();
        } catch (error) {
          show(error.message, 'error');
          cancel.disabled = false;
        }
      });
      card.append(identity, role, expiry, cancel);
      inviteGrid.append(card);
    }
  }

  async function load() {
    show('Carregando equipe…', 'loading');
    const data = await client.api('/api/v1/admin/members');
    tenantLabel.textContent = data.tenant.tenant_name || data.tenant.company_name;
    renderMembers(data.members);
    renderInvites(data.invites);
    show(`${data.members.length} membro(s) e ${data.invites.length} convite(s) pendente(s).`, 'ready');
  }

  inviteForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = inviteForm.querySelector('button[type="submit"]');
    submit.disabled = true;
    show('Criando convite…', 'loading');
    const data = new FormData(inviteForm);
    try {
      await client.api('/api/v1/admin/invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: data.get('email'), role: data.get('role') }),
      });
      inviteForm.reset();
      show('Convite criado. A conta será vinculada no primeiro login Google.', 'success');
      await load();
    } catch (error) {
      show(error.message, 'error');
    } finally {
      submit.disabled = false;
    }
  });

  async function init() {
    client = await waitForClient();
    const permissions = client.session.permissions || [];
    canWrite = permissions.includes('*') || permissions.includes('members.write');
    inviteForm.closest('section').hidden = !canWrite;
    if (!permissions.includes('*') && !permissions.includes('members.read')) {
      throw new Error('Apenas administradores e gestores podem consultar a equipe.');
    }
    await load();
  }

  init().catch((error) => show(error.message, 'error'));
})();
