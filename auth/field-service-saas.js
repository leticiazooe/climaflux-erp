(() => {
  'use strict';

  const STATUS_LABELS = {
    planned: 'Planejada',
    en_route: 'A caminho',
    on_site: 'No local',
    completed: 'Concluída',
    cancelled: 'Cancelada',
  };
  const TRANSITIONS = {
    planned: ['en_route', 'on_site', 'cancelled'],
    en_route: ['on_site', 'cancelled'],
    on_site: ['completed', 'cancelled'],
    completed: [],
    cancelled: [],
  };
  const CHECKLIST_LABELS = { pending: 'Pendente', ok: 'OK', not_ok: 'Não conforme', na: 'N/A' };

  const el = {
    tenant: document.getElementById('tenantLabel'),
    access: document.getElementById('accessNavLink'),
    feedback: document.getElementById('feedback'),
    grid: document.getElementById('visitGrid'),
    from: document.getElementById('fromInput'),
    to: document.getElementById('toInput'),
    status: document.getElementById('statusFilter'),
    refresh: document.getElementById('refreshButton'),
    create: document.getElementById('newVisitButton'),
    previous: document.getElementById('previousButton'),
    next: document.getElementById('nextButton'),
    page: document.getElementById('pageLabel'),
    visitDialog: document.getElementById('visitDialog'),
    visitForm: document.getElementById('visitForm'),
    visitTitle: document.getElementById('visitDialogTitle'),
    closeVisit: document.getElementById('closeVisitButton'),
    cancelVisit: document.getElementById('cancelVisitButton'),
    visitId: document.getElementById('visitId'),
    workOrder: document.getElementById('visitWorkOrder'),
    technician: document.getElementById('visitTechnician'),
    start: document.getElementById('visitStart'),
    end: document.getElementById('visitEnd'),
    notes: document.getElementById('visitNotes'),
    saveVisit: document.getElementById('saveVisitButton'),
    statusDialog: document.getElementById('statusDialog'),
    statusForm: document.getElementById('statusForm'),
    statusTitle: document.getElementById('statusDialogTitle'),
    statusVisitId: document.getElementById('statusVisitId'),
    nextStatus: document.getElementById('nextStatus'),
    statusNote: document.getElementById('statusNote'),
    closeStatus: document.getElementById('closeStatusButton'),
    cancelStatus: document.getElementById('cancelStatusButton'),
    saveStatus: document.getElementById('saveStatusButton'),
    detailDialog: document.getElementById('detailDialog'),
    detailTitle: document.getElementById('detailTitle'),
    detailSummary: document.getElementById('detailSummary'),
    closeDetail: document.getElementById('closeDetailButton'),
    checklistForm: document.getElementById('checklistForm'),
    checklistGrid: document.getElementById('checklistGrid'),
    saveChecklist: document.getElementById('saveChecklistButton'),
    measurementForm: document.getElementById('measurementForm'),
    measurementName: document.getElementById('measurementName'),
    measurementValue: document.getElementById('measurementValue'),
    measurementUnit: document.getElementById('measurementUnit'),
    saveMeasurement: document.getElementById('saveMeasurementButton'),
    measurementGrid: document.getElementById('measurementGrid'),
    eventGrid: document.getElementById('eventGrid'),
  };

  const state = {
    client: null,
    items: [],
    workOrders: [],
    technicians: [],
    limit: 25,
    offset: 0,
    total: 0,
    role: '',
    canWrite: false,
    canStatus: false,
    canRecord: false,
    currentDetail: null,
  };

  function show(message, type = '') {
    el.feedback.textContent = message;
    el.feedback.className = `saas-feedback ${type}`.trim();
  }

  function empty(message) {
    const node = document.createElement('div');
    node.className = 'saas-empty';
    node.textContent = message;
    return node;
  }

  function close(dialog) {
    if (dialog.open) dialog.close();
  }

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

  function queryBoundary(value, end = false) {
    if (!value) return '';
    const date = new Date(`${value}T${end ? '23:59:59' : '00:00:00'}`);
    return Number.isNaN(date.getTime()) ? '' : date.toISOString();
  }

  function actionButton(label, variant, handler) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `saas-button ${variant}`.trim();
    button.textContent = label;
    button.addEventListener('click', () => handler(button));
    return button;
  }

  function visitOrder(visit) {
    return state.workOrders.find((item) => item.id === visit.work_order_id);
  }

  function allowedTransitions(visit) {
    let values = [...(TRANSITIONS[visit.status] || [])];
    if (state.role === 'tecnico') values = values.filter((value) => value !== 'cancelled');
    return values;
  }

  function render() {
    el.grid.replaceChildren();
    if (!state.items.length) {
      el.grid.append(empty(state.role === 'tecnico' ? 'Nenhuma visita atribuída a este técnico no período.' : 'Nenhuma visita encontrada no período.'));
    }

    for (const visit of state.items) {
      const row = document.createElement('article');
      row.className = `saas-card saas-field-row visit-${visit.status}`;

      const identity = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = `${visit.work_order_code} · ${visit.work_order_title}`;
      const customer = document.createElement('small');
      customer.textContent = `${visit.customer_name}${visit.equipment_code ? ` · ${visit.equipment_code}` : ''}`;
      identity.append(title, customer);

      const schedule = document.createElement('div');
      const start = document.createElement('strong');
      start.textContent = new Date(visit.scheduled_start).toLocaleString('pt-BR');
      const end = document.createElement('small');
      end.textContent = visit.scheduled_end ? `até ${new Date(visit.scheduled_end).toLocaleString('pt-BR')}` : 'sem término previsto';
      schedule.append(start, end);

      const technician = document.createElement('div');
      technician.textContent = visit.technician_name || visit.technician_email || 'Técnico';
      const actual = document.createElement('small');
      actual.textContent = visit.arrival_at
        ? `Chegada ${new Date(visit.arrival_at).toLocaleString('pt-BR')}${visit.departure_at ? ` · saída ${new Date(visit.departure_at).toLocaleString('pt-BR')}` : ''}`
        : 'Atendimento ainda não iniciado';
      technician.append(actual);

      const status = document.createElement('span');
      status.className = `saas-pill field-${visit.status}`;
      status.textContent = STATUS_LABELS[visit.status] || visit.status;

      const actions = document.createElement('div');
      actions.className = 'saas-actions saas-actions-wrap';
      if (state.canWrite && !['completed', 'cancelled'].includes(visit.status)) {
        actions.append(actionButton('Editar', 'secondary', () => openVisitDialog(visit)));
      }
      if (state.canStatus && allowedTransitions(visit).length) {
        actions.append(actionButton('Status', '', () => openStatusDialog(visit)));
      }
      actions.append(actionButton('Execução', 'secondary', () => openDetail(visit)));
      row.append(identity, schedule, technician, status, actions);
      el.grid.append(row);
    }

    const first = state.total ? state.offset + 1 : 0;
    const last = Math.min(state.offset + state.limit, state.total);
    el.page.textContent = `${first}–${last} de ${state.total} visita(s)`;
    el.previous.disabled = state.offset === 0;
    el.next.disabled = state.offset + state.limit >= state.total;
    el.create.hidden = !state.canWrite;
  }

  function fillLookups() {
    el.workOrder.replaceChildren(new Option('Selecione uma OS atribuída', ''));
    for (const order of state.workOrders) {
      el.workOrder.append(new Option(`${order.code} · ${order.customer_name} · ${order.title}`, order.id));
    }
    el.technician.replaceChildren(new Option('Técnico da ordem', ''));
    for (const technician of state.technicians) {
      el.technician.append(new Option(technician.name || technician.email, technician.user_id));
    }
    el.technician.disabled = true;
  }

  function syncTechnicianFromOrder() {
    const order = state.workOrders.find((item) => item.id === el.workOrder.value);
    el.technician.value = order?.technician_user_id || '';
  }

  async function loadLookups() {
    const data = await state.client.fieldLookups();
    state.workOrders = data.workOrders || [];
    state.technicians = data.technicians || [];
    fillLookups();
  }

  async function load() {
    show('Carregando agenda do backend…');
    const data = await state.client.listVisits({
      limit: state.limit,
      offset: state.offset,
      status: el.status.value,
      from: queryBoundary(el.from.value),
      to: queryBoundary(el.to.value, true),
    });
    state.items = data.items || [];
    state.total = data.page?.total || 0;
    render();
    show(state.role === 'tecnico' ? 'Agenda restrita às visitas do técnico autenticado.' : 'Agenda sincronizada com o D1.', 'success');
  }

  function openVisitDialog(visit = null) {
    el.visitForm.reset();
    el.visitId.value = visit?.id || '';
    el.workOrder.value = visit?.work_order_id || '';
    syncTechnicianFromOrder();
    if (visit) el.technician.value = visit.technician_user_id;
    el.start.value = localInputValue(visit?.scheduled_start);
    el.end.value = localInputValue(visit?.scheduled_end);
    el.notes.value = visit?.notes || '';
    el.visitTitle.textContent = visit ? `Editar visita · ${visit.work_order_code}` : 'Agendar nova visita';
    el.workOrder.disabled = Boolean(visit);
    el.visitDialog.showModal();
    (visit ? el.start : el.workOrder).focus();
  }

  function openStatusDialog(visit) {
    el.statusForm.reset();
    el.statusVisitId.value = visit.id;
    el.statusTitle.textContent = `${visit.work_order_code} · ${STATUS_LABELS[visit.status]}`;
    el.nextStatus.replaceChildren();
    for (const status of allowedTransitions(visit)) el.nextStatus.append(new Option(STATUS_LABELS[status], status));
    el.statusDialog.showModal();
    el.nextStatus.focus();
  }

  function renderDetail(detail) {
    state.currentDetail = detail;
    const { visit } = detail;
    el.detailTitle.textContent = `${visit.work_order_code} · ${visit.customer_name}`;
    el.detailSummary.replaceChildren();
    const summaryItems = [
      ['Status', STATUS_LABELS[visit.status] || visit.status],
      ['Técnico', visit.technician_name || visit.technician_email],
      ['Agendamento', new Date(visit.scheduled_start).toLocaleString('pt-BR')],
      ['Chegada', visit.arrival_at ? new Date(visit.arrival_at).toLocaleString('pt-BR') : '—'],
      ['Saída', visit.departure_at ? new Date(visit.departure_at).toLocaleString('pt-BR') : '—'],
    ];
    for (const [label, value] of summaryItems) {
      const card = document.createElement('div');
      const strong = document.createElement('strong'); strong.textContent = label;
      const span = document.createElement('span'); span.textContent = value || '—';
      card.append(strong, span); el.detailSummary.append(card);
    }

    const terminal = ['completed', 'cancelled'].includes(visit.status);
    el.checklistGrid.replaceChildren();
    for (const item of detail.checklist || []) {
      const row = document.createElement('div');
      row.className = 'saas-checklist-row';
      row.dataset.key = item.item_key;
      const label = document.createElement('strong'); label.textContent = item.label;
      const select = document.createElement('select'); select.className = 'saas-input checklist-status';
      for (const value of ['pending', 'ok', 'not_ok', 'na']) select.append(new Option(CHECKLIST_LABELS[value], value));
      select.value = item.status;
      const note = document.createElement('input');
      note.className = 'saas-input checklist-note'; note.placeholder = 'Observação'; note.value = item.note || '';
      select.disabled = !state.canRecord || terminal;
      note.disabled = !state.canRecord || terminal;
      row.append(label, select, note); el.checklistGrid.append(row);
    }
    el.saveChecklist.hidden = !state.canRecord || terminal;

    el.measurementForm.hidden = !state.canRecord || terminal;
    el.measurementGrid.replaceChildren();
    if (!(detail.measurements || []).length) el.measurementGrid.append(empty('Nenhuma medição registrada.'));
    for (const measurement of detail.measurements || []) {
      const card = document.createElement('div'); card.className = 'saas-measurement-card';
      const name = document.createElement('strong'); name.textContent = measurement.name;
      const value = document.createElement('span');
      value.textContent = `${measurement.value_number ?? measurement.value_text}${measurement.unit ? ` ${measurement.unit}` : ''}`;
      const time = document.createElement('small'); time.textContent = new Date(measurement.created_at).toLocaleString('pt-BR');
      card.append(name, value, time); el.measurementGrid.append(card);
    }

    el.eventGrid.replaceChildren();
    if (!(detail.events || []).length) el.eventGrid.append(empty('Nenhum evento registrado.'));
    for (const event of detail.events || []) {
      const card = document.createElement('article'); card.className = 'saas-timeline-item';
      const title = document.createElement('strong'); title.textContent = event.event_type.replaceAll('_', ' ').replaceAll('.', ' · ');
      const meta = document.createElement('small'); meta.textContent = `${new Date(event.created_at).toLocaleString('pt-BR')} · ${event.actor_name || 'Sistema'}`;
      card.append(title, meta);
      if (event.from_status || event.to_status) {
        const transition = document.createElement('div');
        transition.textContent = `${STATUS_LABELS[event.from_status] || event.from_status || '—'} → ${STATUS_LABELS[event.to_status] || event.to_status || '—'}`;
        card.append(transition);
      }
      if (event.note) { const note = document.createElement('p'); note.textContent = event.note; card.append(note); }
      el.eventGrid.append(card);
    }
  }

  async function openDetail(visit) {
    el.detailTitle.textContent = `${visit.work_order_code} · carregando…`;
    el.detailSummary.replaceChildren(empty('Carregando execução técnica…'));
    el.detailDialog.showModal();
    try { renderDetail(await state.client.getVisit(visit.id)); }
    catch (error) { el.detailSummary.replaceChildren(empty(error.message)); }
  }

  async function refreshDetail() {
    if (!state.currentDetail?.visit?.id) return;
    renderDetail(await state.client.getVisit(state.currentDetail.visit.id));
  }

  el.workOrder.addEventListener('change', syncTechnicianFromOrder);
  el.visitForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    el.saveVisit.disabled = true;
    show('Salvando visita…');
    const payload = {
      workOrderId: el.workOrder.value,
      technicianUserId: el.technician.value,
      scheduledStart: el.start.value,
      scheduledEnd: el.end.value,
      notes: el.notes.value,
    };
    try {
      if (el.visitId.value) {
        delete payload.workOrderId;
        delete payload.technicianUserId;
        await state.client.updateVisit(el.visitId.value, payload);
      } else {
        await state.client.createVisit(payload);
      }
      close(el.visitDialog); state.offset = 0; await load(); show('Visita salva no backend.', 'success');
    } catch (error) { show(error.message, 'error'); }
    finally { el.saveVisit.disabled = false; el.workOrder.disabled = false; }
  });

  el.statusForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    el.saveStatus.disabled = true;
    show('Atualizando fluxo da visita…');
    try {
      await state.client.transitionVisit(el.statusVisitId.value, { status: el.nextStatus.value, note: el.statusNote.value });
      close(el.statusDialog); await load(); show('Status atualizado e auditado.', 'success');
    } catch (error) { show(error.message, 'error'); }
    finally { el.saveStatus.disabled = false; }
  });

  el.checklistForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!state.currentDetail?.visit?.id) return;
    el.saveChecklist.disabled = true;
    try {
      const items = [...el.checklistGrid.querySelectorAll('.saas-checklist-row')].map((row) => ({
        key: row.dataset.key,
        label: row.querySelector('strong').textContent,
        status: row.querySelector('.checklist-status').value,
        note: row.querySelector('.checklist-note').value,
      }));
      await state.client.saveVisitChecklist(state.currentDetail.visit.id, items);
      await refreshDetail();
      show('Checklist salvo no backend.', 'success');
    } catch (error) { show(error.message, 'error'); }
    finally { el.saveChecklist.disabled = false; }
  });

  el.measurementForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!state.currentDetail?.visit?.id) return;
    el.saveMeasurement.disabled = true;
    try {
      await state.client.addVisitMeasurement(state.currentDetail.visit.id, {
        name: el.measurementName.value,
        valueNumber: el.measurementValue.value,
        unit: el.measurementUnit.value,
      });
      el.measurementForm.reset();
      await refreshDetail();
      show('Medição registrada no backend.', 'success');
    } catch (error) { show(error.message, 'error'); }
    finally { el.saveMeasurement.disabled = false; }
  });

  el.create.addEventListener('click', () => openVisitDialog());
  el.closeVisit.addEventListener('click', () => { el.workOrder.disabled = false; close(el.visitDialog); });
  el.cancelVisit.addEventListener('click', () => { el.workOrder.disabled = false; close(el.visitDialog); });
  el.closeStatus.addEventListener('click', () => close(el.statusDialog));
  el.cancelStatus.addEventListener('click', () => close(el.statusDialog));
  el.closeDetail.addEventListener('click', () => close(el.detailDialog));
  el.refresh.addEventListener('click', async () => { try { await loadLookups(); await load(); } catch (error) { show(error.message, 'error'); } });
  for (const control of [el.from, el.to, el.status]) {
    control.addEventListener('change', () => { state.offset = 0; load().catch((error) => show(error.message, 'error')); });
  }
  el.previous.addEventListener('click', () => { state.offset = Math.max(0, state.offset - state.limit); load().catch((error) => show(error.message, 'error')); });
  el.next.addEventListener('click', () => { state.offset += state.limit; load().catch((error) => show(error.message, 'error')); });

  async function init() {
    state.client = await waitForClient();
    state.role = (state.client.session.activeTenant || state.client.session.activeCompany).role;
    state.canWrite = state.client.hasPermission('field_service.write');
    state.canStatus = state.client.hasPermission('field_service.status');
    state.canRecord = state.client.hasPermission('field_service.record');
    if (!state.client.hasPermission('field_service.read')) throw new Error('Você não possui acesso à operação de campo.');
    el.access.hidden = !state.client.hasPermission('members.read');
    const tenant = state.client.session.activeTenant || state.client.session.activeCompany;
    el.tenant.textContent = tenant.tenant_name || tenant.company_name;
    await loadLookups();
    await load();
  }

  init().catch((error) => show(error.message, 'error'));
})();
