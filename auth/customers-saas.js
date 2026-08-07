(() => {
  'use strict';

  const elements = {
    tenantLabel: document.getElementById('tenantLabel'),
    accessNavLink: document.getElementById('accessNavLink'),
    feedback: document.getElementById('feedback'),
    grid: document.getElementById('customerGrid'),
    search: document.getElementById('searchInput'),
    status: document.getElementById('statusFilter'),
    refresh: document.getElementById('refreshButton'),
    create: document.getElementById('newCustomerButton'),
    previous: document.getElementById('previousButton'),
    next: document.getElementById('nextButton'),
    pageLabel: document.getElementById('pageLabel'),
    dialog: document.getElementById('customerDialog'),
    form: document.getElementById('customerForm'),
    dialogTitle: document.getElementById('dialogTitle'),
    close: document.getElementById('closeDialogButton'),
    cancel: document.getElementById('cancelDialogButton'),
    id: document.getElementById('customerId'),
    name: document.getElementById('customerName'),
    kind: document.getElementById('customerKind'),
    document: document.getElementById('customerDocument'),
    email: document.getElementById('customerEmail'),
    phone: document.getElementById('customerPhone'),
    statusInput: document.getElementById('customerStatus'),
    notes: document.getElementById('customerNotes'),
    save: document.getElementById('saveCustomerButton'),
  };

  const state = {
    client: null,
    items: [],
    limit: 25,
    offset: 0,
    total: 0,
    canWrite: false,
    canDelete: false,
    searchTimer: null,
  };

  function show(message, type = '') {
    elements.feedback.textContent = message;
    elements.feedback.className = `saas-feedback ${type}`.trim();
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

  function empty(message) {
    const node = document.createElement('div');
    node.className = 'saas-empty';
    node.textContent = message;
    return node;
  }

  function customerIdentity(customer) {
    const block = document.createElement('div');
    const name = document.createElement('strong');
    name.textContent = customer.name;
    const code = document.createElement('small');
    code.textContent = `${customer.code} · ${customer.kind === 'person' ? 'Pessoa' : 'Empresa'}`;
    const contact = document.createElement('small');
    contact.textContent = [customer.email, customer.phone].filter(Boolean).join(' · ') || 'Sem contato informado';
    const pill = document.createElement('span');
    pill.className = `saas-pill ${customer.status}`;
    pill.textContent = customer.status === 'active' ? 'Ativo' : 'Inativo';
    block.append(name, code, contact, pill);
    return block;
  }

  function render() {
    elements.grid.replaceChildren();
    if (!state.items.length) {
      elements.grid.append(empty('Nenhum cliente encontrado para esta empresa.'));
    }

    for (const customer of state.items) {
      const row = document.createElement('article');
      row.className = 'saas-card saas-customer-row';
      const identity = customerIdentity(customer);

      const documentNode = document.createElement('span');
      documentNode.textContent = customer.document || 'Sem documento';
      const updated = document.createElement('span');
      updated.textContent = `Atualizado em ${new Date(customer.updated_at).toLocaleDateString('pt-BR')}`;
      const status = document.createElement('span');
      status.textContent = customer.status === 'active' ? 'Em operação' : 'Inativo';

      const actions = document.createElement('div');
      actions.className = 'saas-actions';
      if (state.canWrite) {
        const edit = document.createElement('button');
        edit.type = 'button';
        edit.className = 'saas-button secondary';
        edit.textContent = 'Editar';
        edit.addEventListener('click', () => openDialog(customer));
        actions.append(edit);
      }
      if (state.canDelete) {
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'saas-button danger';
        remove.textContent = 'Excluir';
        remove.addEventListener('click', () => deleteCustomer(customer, remove));
        actions.append(remove);
      }
      if (!actions.childElementCount) {
        const readonly = document.createElement('span');
        readonly.textContent = 'Somente leitura';
        actions.append(readonly);
      }

      row.append(identity, documentNode, updated, status, actions);
      elements.grid.append(row);
    }

    const first = state.total ? state.offset + 1 : 0;
    const last = Math.min(state.offset + state.limit, state.total);
    elements.pageLabel.textContent = `${first}–${last} de ${state.total} cliente(s)`;
    elements.previous.disabled = state.offset === 0;
    elements.next.disabled = state.offset + state.limit >= state.total;
    elements.create.hidden = !state.canWrite;
  }

  async function load() {
    show('Carregando clientes do backend…');
    const params = {
      limit: String(state.limit),
      offset: String(state.offset),
    };
    if (elements.search.value.trim()) params.search = elements.search.value.trim();
    if (elements.status.value) params.status = elements.status.value;
    const data = await state.client.listCustomers(params);
    state.items = data.items;
    state.total = data.page.total;
    render();
    show('Clientes sincronizados com o D1.', 'success');
  }

  function openDialog(customer = null) {
    elements.form.reset();
    elements.id.value = customer?.id || '';
    elements.name.value = customer?.name || '';
    elements.kind.value = customer?.kind || 'company';
    elements.document.value = customer?.document || '';
    elements.email.value = customer?.email || '';
    elements.phone.value = customer?.phone || '';
    elements.statusInput.value = customer?.status || 'active';
    elements.notes.value = customer?.notes || '';
    elements.dialogTitle.textContent = customer ? 'Editar cliente' : 'Novo cliente';
    elements.dialog.showModal();
    elements.name.focus();
  }

  function closeDialog() {
    if (elements.dialog.open) elements.dialog.close();
  }

  async function deleteCustomer(customer, button) {
    if (!window.confirm(`Excluir ${customer.name}? O registro será mantido na auditoria.`)) return;
    button.disabled = true;
    show('Excluindo cliente…');
    try {
      await state.client.deleteCustomer(customer.id);
      show('Cliente excluído com registro de auditoria.', 'success');
      await load();
    } catch (error) {
      show(error.message, 'error');
      button.disabled = false;
    }
  }

  elements.form.addEventListener('submit', async (event) => {
    event.preventDefault();
    elements.save.disabled = true;
    show('Salvando cliente…');
    const customer = {
      name: elements.name.value,
      kind: elements.kind.value,
      document: elements.document.value,
      email: elements.email.value,
      phone: elements.phone.value,
      status: elements.statusInput.value,
      notes: elements.notes.value,
    };
    try {
      if (elements.id.value) {
        await state.client.updateCustomer(elements.id.value, customer);
        show('Cliente atualizado no backend.', 'success');
      } else {
        await state.client.createCustomer(customer);
        show('Cliente criado no backend.', 'success');
      }
      closeDialog();
      state.offset = 0;
      await load();
    } catch (error) {
      show(error.message, 'error');
    } finally {
      elements.save.disabled = false;
    }
  });

  elements.create.addEventListener('click', () => openDialog());
  elements.close.addEventListener('click', closeDialog);
  elements.cancel.addEventListener('click', closeDialog);
  elements.refresh.addEventListener('click', () => load().catch((error) => show(error.message, 'error')));
  elements.status.addEventListener('change', () => {
    state.offset = 0;
    load().catch((error) => show(error.message, 'error'));
  });
  elements.search.addEventListener('input', () => {
    window.clearTimeout(state.searchTimer);
    state.searchTimer = window.setTimeout(() => {
      state.offset = 0;
      load().catch((error) => show(error.message, 'error'));
    }, 300);
  });
  elements.previous.addEventListener('click', () => {
    state.offset = Math.max(0, state.offset - state.limit);
    load().catch((error) => show(error.message, 'error'));
  });
  elements.next.addEventListener('click', () => {
    state.offset += state.limit;
    load().catch((error) => show(error.message, 'error'));
  });

  async function init() {
    state.client = await waitForClient();
    const permissions = state.client.session.permissions || [];
    state.canWrite = permissions.includes('*') || permissions.includes('customers.write');
    state.canDelete = permissions.includes('*') || permissions.includes('customers.delete');
    elements.accessNavLink.hidden = !permissions.includes('*') && !permissions.includes('members.read');
    const tenant = state.client.session.activeTenant || state.client.session.activeCompany;
    elements.tenantLabel.textContent = tenant.tenant_name || tenant.company_name;
    await load();
  }

  init().catch((error) => show(error.message, 'error'));
})();
