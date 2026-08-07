(() => {
  'use strict';

  const STATUS_LABELS = { draft: 'Rascunho', open: 'Aberta', scheduled: 'Agendada', in_progress: 'Em andamento', on_hold: 'Pausada', completed: 'Concluída', cancelled: 'Cancelada' };
  const PRIORITY_LABELS = { low: 'Baixa', normal: 'Normal', high: 'Alta', critical: 'Crítica' };
  const TRANSITIONS = {
    draft: ['open', 'cancelled'], open: ['scheduled', 'in_progress', 'cancelled'], scheduled: ['in_progress', 'on_hold', 'cancelled'],
    in_progress: ['on_hold', 'completed', 'cancelled'], on_hold: ['scheduled', 'in_progress', 'completed', 'cancelled'], completed: [], cancelled: [],
  };

  const el = {
    tenant: document.getElementById('tenantLabel'), access: document.getElementById('accessNavLink'), feedback: document.getElementById('feedback'),
    grid: document.getElementById('workOrderGrid'), search: document.getElementById('searchInput'), customerFilter: document.getElementById('customerFilter'),
    statusFilter: document.getElementById('statusFilter'), priorityFilter: document.getElementById('priorityFilter'), refresh: document.getElementById('refreshButton'),
    create: document.getElementById('newWorkOrderButton'), previous: document.getElementById('previousButton'), next: document.getElementById('nextButton'), page: document.getElementById('pageLabel'),
    dialog: document.getElementById('workOrderDialog'), form: document.getElementById('workOrderForm'), dialogTitle: document.getElementById('dialogTitle'), close: document.getElementById('closeDialogButton'), cancel: document.getElementById('cancelDialogButton'),
    id: document.getElementById('workOrderId'), customer: document.getElementById('workOrderCustomer'), equipment: document.getElementById('workOrderEquipment'), technician: document.getElementById('workOrderTechnician'),
    serviceType: document.getElementById('workOrderServiceType'), title: document.getElementById('workOrderTitle'), priority: document.getElementById('workOrderPriority'), sla: document.getElementById('workOrderSla'),
    scheduledStart: document.getElementById('workOrderScheduledStart'), scheduledEnd: document.getElementById('workOrderScheduledEnd'), description: document.getElementById('workOrderDescription'), notes: document.getElementById('workOrderNotes'), save: document.getElementById('saveWorkOrderButton'),
    statusDialog: document.getElementById('statusDialog'), statusForm: document.getElementById('statusForm'), statusTitle: document.getElementById('statusDialogTitle'), statusId: document.getElementById('statusWorkOrderId'), nextStatus: document.getElementById('nextStatus'), statusNote: document.getElementById('statusNote'), statusResolution: document.getElementById('statusResolution'), closeStatus: document.getElementById('closeStatusButton'), cancelStatus: document.getElementById('cancelStatusButton'), saveStatus: document.getElementById('saveStatusButton'),
    historyDialog: document.getElementById('historyDialog'), historyTitle: document.getElementById('historyTitle'), historyGrid: document.getElementById('historyGrid'), closeHistory: document.getElementById('closeHistoryButton'),
  };

  const state = { client: null, items: [], customers: [], equipment: [], technicians: [], limit: 25, offset: 0, total: 0, canWrite: false, canAssign: false, canTransition: false, canDelete: false, role: '', timer: null };

  function show(message, type = '') { el.feedback.textContent = message; el.feedback.className = `saas-feedback ${type}`.trim(); }
  function closeDialog(dialog) { if (dialog.open) dialog.close(); }
  function empty(message) { const node = document.createElement('div'); node.className = 'saas-empty'; node.textContent = message; return node; }

  async function waitForClient() {
    const started = Date.now();
    while (!window.ClimaFluxSaaS) {
      if (Date.now() - started > 10000) throw new Error('A sessão não ficou disponível.');
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    await window.ClimaFluxSaaS.ready;
    return window.ClimaFluxSaaS;
  }

  function localInputValue(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
  }

  function fillSelect(select, items, placeholder, mapper) {
    const selected = select.value;
    select.replaceChildren(new Option(placeholder, ''));
    for (const item of items) {
      const mapped = mapper(item);
      select.append(new Option(mapped.label, mapped.value));
    }
    select.value = selected;
  }

  function fillLookups() {
    fillSelect(el.customerFilter, state.customers, 'Todos', (item) => ({ value: item.id, label: `${item.code} · ${item.name}` }));
    fillSelect(el.customer, state.customers, 'Selecione um cliente', (item) => ({ value: item.id, label: `${item.code} · ${item.name}` }));
    fillSelect(el.technician, state.technicians, 'Não atribuído', (item) => ({ value: item.user_id, label: item.name || item.email }));
    el.technician.disabled = !state.canAssign;
    filterEquipmentOptions();
  }

  function filterEquipmentOptions(selected = '') {
    const customerId = el.customer.value;
    const items = state.equipment.filter((item) => !customerId || item.customer_id === customerId);
    el.equipment.replaceChildren(new Option('Sem equipamento', ''));
    for (const item of items) {
      const label = `${item.code} · ${[item.brand, item.model].filter(Boolean).join(' ') || 'Equipamento'}`;
      el.equipment.append(new Option(label, item.id));
    }
    el.equipment.value = selected;
  }

  function render() {
    el.grid.replaceChildren();
    if (!state.items.length) el.grid.append(empty(state.role === 'tecnico' ? 'Nenhuma ordem atribuída a este técnico.' : 'Nenhuma ordem encontrada nesta empresa.'));
    for (const order of state.items) {
      const row = document.createElement('article');
      row.className = `saas-card saas-work-order-row priority-${order.priority}`;

      const identity = document.createElement('div');
      const code = document.createElement('strong'); code.textContent = `${order.code} · ${order.title}`;
      const customer = document.createElement('small'); customer.textContent = `${order.customer_name}${order.equipment_code ? ` · ${order.equipment_code}` : ''}`;
      const service = document.createElement('small'); service.textContent = order.service_type;
      identity.append(code, customer, service);

      const workflow = document.createElement('div');
      const status = document.createElement('span'); status.className = `saas-pill work-order-${order.status}`; status.textContent = STATUS_LABELS[order.status] || order.status;
      const priority = document.createElement('small'); priority.textContent = `Prioridade ${PRIORITY_LABELS[order.priority] || order.priority}`;
      workflow.append(status, priority);

      const technician = document.createElement('div');
      technician.textContent = order.technician_name || 'Não atribuído';
      const schedule = document.createElement('small'); schedule.textContent = order.scheduled_start ? new Date(order.scheduled_start).toLocaleString('pt-BR') : 'Sem agendamento';
      technician.append(schedule);

      const sla = document.createElement('div');
      if (order.sla_due_at) {
        const due = new Date(order.sla_due_at);
        sla.textContent = due.toLocaleString('pt-BR');
        if (!['completed', 'cancelled'].includes(order.status) && due.getTime() < Date.now()) sla.className = 'saas-danger-text';
      } else sla.textContent = 'SLA não definido';

      const actions = document.createElement('div'); actions.className = 'saas-actions saas-actions-wrap';
      if (state.canWrite && !['completed', 'cancelled'].includes(order.status)) actions.append(actionButton('Editar', 'secondary', () => openOrderDialog(order)));
      if (state.canTransition && (TRANSITIONS[order.status] || []).length) actions.append(actionButton('Status', '', () => openStatusDialog(order)));
      actions.append(actionButton('Histórico', 'secondary', () => openHistory(order)));
      if (state.canDelete && ['draft', 'cancelled'].includes(order.status)) actions.append(actionButton('Excluir', 'danger', (button) => deleteOrder(order, button)));
      row.append(identity, workflow, technician, sla, actions);
      el.grid.append(row);
    }
    const first = state.total ? state.offset + 1 : 0;
    const last = Math.min(state.offset + state.limit, state.total);
    el.page.textContent = `${first}–${last} de ${state.total} ordem(ns)`;
    el.previous.disabled = state.offset === 0;
    el.next.disabled = state.offset + state.limit >= state.total;
    el.create.hidden = !state.canWrite;
  }

  function actionButton(label, variant, handler) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = `saas-button ${variant}`.trim(); button.textContent = label;
    button.addEventListener('click', () => handler(button));
    return button;
  }

  async function loadLookups() {
    const data = await state.client.workOrderLookups();
    state.customers = data.customers || [];
    state.equipment = data.equipment || [];
    state.technicians = data.technicians || [];
    fillLookups();
  }

  async function load() {
    show('Carregando ordens do backend…');
    const data = await state.client.listWorkOrders({ limit: state.limit, offset: state.offset, search: el.search.value.trim(), customerId: el.customerFilter.value, status: el.statusFilter.value, priority: el.priorityFilter.value });
    state.items = data.items || [];
    state.total = data.page?.total || 0;
    render();
    show(state.role === 'tecnico' ? 'Exibindo somente ordens atribuídas ao técnico autenticado.' : 'Ordens sincronizadas com o D1.', 'success');
  }

  function openOrderDialog(order = null) {
    el.form.reset();
    el.id.value = order?.id || '';
    el.customer.value = order?.customer_id || '';
    filterEquipmentOptions(order?.equipment_id || '');
    el.technician.value = order?.technician_user_id || '';
    el.serviceType.value = order?.service_type || '';
    el.title.value = order?.title || '';
    el.priority.value = order?.priority || 'normal';
    el.sla.value = localInputValue(order?.sla_due_at);
    el.scheduledStart.value = localInputValue(order?.scheduled_start);
    el.scheduledEnd.value = localInputValue(order?.scheduled_end);
    el.description.value = order?.description || '';
    el.notes.value = order?.notes || '';
    el.dialogTitle.textContent = order ? `Editar ${order.code}` : 'Nova ordem';
    el.dialog.showModal();
    el.customer.focus();
  }

  function allowedTransitions(order) {
    let values = [...(TRANSITIONS[order.status] || [])];
    if (state.role === 'tecnico') values = values.filter((status) => !['cancelled', 'scheduled'].includes(status));
    return values;
  }

  function openStatusDialog(order) {
    const options = allowedTransitions(order);
    el.statusForm.reset();
    el.statusId.value = order.id;
    el.statusTitle.textContent = `${order.code} · ${STATUS_LABELS[order.status]}`;
    el.nextStatus.replaceChildren();
    for (const value of options) el.nextStatus.append(new Option(STATUS_LABELS[value] || value, value));
    el.statusResolution.value = order.resolution || '';
    el.statusDialog.showModal();
    el.nextStatus.focus();
  }

  async function openHistory(order) {
    el.historyTitle.textContent = `Histórico · ${order.code}`;
    el.historyGrid.replaceChildren(empty('Carregando histórico…'));
    el.historyDialog.showModal();
    try {
      const data = await state.client.workOrderHistory(order.id);
      el.historyGrid.replaceChildren();
      if (!data.items.length) el.historyGrid.append(empty('Nenhum evento registrado.'));
      for (const event of data.items) {
        const card = document.createElement('article'); card.className = 'saas-timeline-item';
        const title = document.createElement('strong'); title.textContent = event.event_type.replaceAll('_', ' ').replaceAll('.', ' · ');
        const meta = document.createElement('small'); meta.textContent = `${new Date(event.created_at).toLocaleString('pt-BR')} · ${event.actor_name || event.actor_email || 'Sistema'}`;
        card.append(title, meta);
        if (event.from_status || event.to_status) {
          const transition = document.createElement('div'); transition.textContent = `${STATUS_LABELS[event.from_status] || event.from_status || '—'} → ${STATUS_LABELS[event.to_status] || event.to_status || '—'}`; card.append(transition);
        }
        if (event.note) { const note = document.createElement('p'); note.textContent = event.note; card.append(note); }
        el.historyGrid.append(card);
      }
    } catch (error) {
      el.historyGrid.replaceChildren(empty(error.message));
    }
  }

  async function deleteOrder(order, button) {
    if (!confirm(`Excluir ${order.code}? O evento permanecerá na trilha de auditoria.`)) return;
    button.disabled = true;
    try { await state.client.deleteWorkOrder(order.id); await load(); show('Ordem excluída logicamente.', 'success'); }
    catch (error) { show(error.message, 'error'); button.disabled = false; }
  }

  el.customer.addEventListener('change', () => filterEquipmentOptions());
  el.form.addEventListener('submit', async (event) => {
    event.preventDefault(); el.save.disabled = true; show('Salvando ordem…');
    const payload = {
      customerId: el.customer.value, equipmentId: el.equipment.value, technicianUserId: el.technician.value,
      serviceType: el.serviceType.value, title: el.title.value, priority: el.priority.value,
      slaDueAt: el.sla.value, scheduledStart: el.scheduledStart.value, scheduledEnd: el.scheduledEnd.value,
      description: el.description.value, notes: el.notes.value,
    };
    try {
      if (el.id.value) await state.client.updateWorkOrder(el.id.value, payload);
      else await state.client.createWorkOrder(payload);
      closeDialog(el.dialog); state.offset = 0; await load(); show('Ordem salva no backend.', 'success');
    } catch (error) { show(error.message, 'error'); }
    finally { el.save.disabled = false; }
  });

  el.statusForm.addEventListener('submit', async (event) => {
    event.preventDefault(); el.saveStatus.disabled = true; show('Aplicando transição…');
    try {
      await state.client.transitionWorkOrder(el.statusId.value, { status: el.nextStatus.value, note: el.statusNote.value, resolution: el.statusResolution.value });
      closeDialog(el.statusDialog); await load(); show('Status alterado e registrado no histórico.', 'success');
    } catch (error) { show(error.message, 'error'); }
    finally { el.saveStatus.disabled = false; }
  });

  el.create.addEventListener('click', () => openOrderDialog());
  el.close.addEventListener('click', () => closeDialog(el.dialog)); el.cancel.addEventListener('click', () => closeDialog(el.dialog));
  el.closeStatus.addEventListener('click', () => closeDialog(el.statusDialog)); el.cancelStatus.addEventListener('click', () => closeDialog(el.statusDialog));
  el.closeHistory.addEventListener('click', () => closeDialog(el.historyDialog));
  el.refresh.addEventListener('click', async () => { try { await loadLookups(); await load(); } catch (error) { show(error.message, 'error'); } });
  for (const control of [el.customerFilter, el.statusFilter, el.priorityFilter]) control.addEventListener('change', () => { state.offset = 0; load().catch((error) => show(error.message, 'error')); });
  el.search.addEventListener('input', () => { clearTimeout(state.timer); state.timer = setTimeout(() => { state.offset = 0; load().catch((error) => show(error.message, 'error')); }, 300); });
  el.previous.addEventListener('click', () => { state.offset = Math.max(0, state.offset - state.limit); load().catch((error) => show(error.message, 'error')); });
  el.next.addEventListener('click', () => { state.offset += state.limit; load().catch((error) => show(error.message, 'error')); });

  async function init() {
    state.client = await waitForClient();
    state.canWrite = state.client.hasPermission('work_orders.write');
    state.canAssign = state.client.hasPermission('work_orders.assign');
    state.canTransition = state.client.hasPermission('work_orders.transition');
    state.canDelete = state.client.hasPermission('work_orders.delete');
    state.role = (state.client.session.activeTenant || state.client.session.activeCompany).role;
    el.access.hidden = !state.client.hasPermission('members.read');
    const tenant = state.client.session.activeTenant || state.client.session.activeCompany;
    el.tenant.textContent = tenant.tenant_name || tenant.company_name;
    await loadLookups();
    await load();
  }

  init().catch((error) => show(error.message, 'error'));
})();
