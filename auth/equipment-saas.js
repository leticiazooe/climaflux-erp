(() => {
  'use strict';

  const el = {
    tenant: document.getElementById('tenantLabel'), access: document.getElementById('accessNavLink'),
    feedback: document.getElementById('feedback'), grid: document.getElementById('equipmentGrid'),
    search: document.getElementById('searchInput'), customerFilter: document.getElementById('customerFilter'),
    statusFilter: document.getElementById('statusFilter'), refresh: document.getElementById('refreshButton'),
    create: document.getElementById('newEquipmentButton'), previous: document.getElementById('previousButton'),
    next: document.getElementById('nextButton'), page: document.getElementById('pageLabel'),
    dialog: document.getElementById('equipmentDialog'), form: document.getElementById('equipmentForm'),
    title: document.getElementById('dialogTitle'), close: document.getElementById('closeDialogButton'),
    cancel: document.getElementById('cancelDialogButton'), id: document.getElementById('equipmentId'),
    customer: document.getElementById('equipmentCustomer'), category: document.getElementById('equipmentCategory'),
    brand: document.getElementById('equipmentBrand'), model: document.getElementById('equipmentModel'),
    serial: document.getElementById('equipmentSerial'), assetTag: document.getElementById('equipmentAssetTag'),
    capacity: document.getElementById('equipmentCapacity'), refrigerant: document.getElementById('equipmentRefrigerant'),
    location: document.getElementById('equipmentLocation'), status: document.getElementById('equipmentStatus'),
    notes: document.getElementById('equipmentNotes'), save: document.getElementById('saveEquipmentButton'),
  };

  const state = { client: null, items: [], customers: [], limit: 25, offset: 0, total: 0, canWrite: false, canDelete: false, timer: null };

  function show(message, type = '') {
    el.feedback.textContent = message;
    el.feedback.className = `saas-feedback ${type}`.trim();
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

  function fillCustomers() {
    const selectedFilter = el.customerFilter.value;
    const selectedForm = el.customer.value;
    el.customerFilter.replaceChildren(new Option('Todos', ''));
    el.customer.replaceChildren(new Option('Selecione um cliente', ''));
    for (const customer of state.customers) {
      const label = `${customer.code} · ${customer.name}`;
      el.customerFilter.append(new Option(label, customer.id));
      el.customer.append(new Option(label, customer.id));
    }
    el.customerFilter.value = selectedFilter;
    el.customer.value = selectedForm;
  }

  function empty(message) {
    const node = document.createElement('div');
    node.className = 'saas-empty';
    node.textContent = message;
    return node;
  }

  function render() {
    el.grid.replaceChildren();
    if (!state.items.length) el.grid.append(empty('Nenhum equipamento encontrado para esta empresa.'));
    for (const item of state.items) {
      const row = document.createElement('article');
      row.className = 'saas-card saas-equipment-row';

      const identity = document.createElement('div');
      const name = document.createElement('strong');
      name.textContent = [item.brand, item.model].filter(Boolean).join(' ') || item.category;
      const code = document.createElement('small');
      code.textContent = `${item.code} · ${item.customer_name}`;
      const serial = document.createElement('small');
      serial.textContent = [item.serial_number && `Série ${item.serial_number}`, item.asset_tag && `Tag ${item.asset_tag}`].filter(Boolean).join(' · ') || 'Sem identificação adicional';
      identity.append(name, code, serial);

      const technical = document.createElement('div');
      technical.textContent = [item.capacity_btu && `${Number(item.capacity_btu).toLocaleString('pt-BR')} BTU`, item.refrigerant].filter(Boolean).join(' · ') || 'Dados técnicos não informados';
      const location = document.createElement('div');
      location.textContent = item.location || 'Localização não informada';
      const status = document.createElement('span');
      status.className = `saas-pill ${item.status === 'active' ? 'active' : 'inactive'}`;
      status.textContent = item.status === 'active' ? 'Ativo' : item.status === 'retired' ? 'Baixado' : 'Inativo';

      const actions = document.createElement('div');
      actions.className = 'saas-actions';
      if (state.canWrite) {
        const edit = document.createElement('button');
        edit.type = 'button'; edit.className = 'saas-button secondary'; edit.textContent = 'Editar';
        edit.addEventListener('click', () => openDialog(item));
        actions.append(edit);
      }
      if (state.canDelete) {
        const remove = document.createElement('button');
        remove.type = 'button'; remove.className = 'saas-button danger'; remove.textContent = 'Excluir';
        remove.addEventListener('click', () => deleteEquipment(item, remove));
        actions.append(remove);
      }
      if (!actions.childElementCount) {
        const readOnly = document.createElement('span'); readOnly.textContent = 'Somente leitura'; actions.append(readOnly);
      }
      row.append(identity, technical, location, status, actions);
      el.grid.append(row);
    }

    const first = state.total ? state.offset + 1 : 0;
    const last = Math.min(state.offset + state.limit, state.total);
    el.page.textContent = `${first}–${last} de ${state.total} equipamento(s)`;
    el.previous.disabled = state.offset === 0;
    el.next.disabled = state.offset + state.limit >= state.total;
    el.create.hidden = !state.canWrite;
  }

  async function loadCustomers() {
    const result = await state.client.listCustomers({ limit: 100, offset: 0, status: 'active' });
    state.customers = result.items || [];
    fillCustomers();
  }

  async function load() {
    show('Carregando equipamentos do backend…');
    const data = await state.client.listEquipment({
      limit: state.limit,
      offset: state.offset,
      search: el.search.value.trim(),
      customerId: el.customerFilter.value,
      status: el.statusFilter.value,
    });
    state.items = data.items || [];
    state.total = data.page?.total || 0;
    render();
    show('Equipamentos sincronizados com o D1.', 'success');
  }

  function openDialog(item = null) {
    el.form.reset();
    el.id.value = item?.id || '';
    el.customer.value = item?.customer_id || '';
    el.category.value = item?.category || 'air_conditioner';
    el.brand.value = item?.brand || '';
    el.model.value = item?.model || '';
    el.serial.value = item?.serial_number || '';
    el.assetTag.value = item?.asset_tag || '';
    el.capacity.value = item?.capacity_btu ?? '';
    el.refrigerant.value = item?.refrigerant || '';
    el.location.value = item?.location || '';
    el.status.value = item?.status || 'active';
    el.notes.value = item?.notes || '';
    el.title.textContent = item ? `Editar ${item.code}` : 'Novo equipamento';
    el.dialog.showModal();
    el.customer.focus();
  }

  function closeDialog() { if (el.dialog.open) el.dialog.close(); }

  async function deleteEquipment(item, button) {
    if (!confirm(`Excluir ${item.code}? Equipamentos com ordens abertas não podem ser excluídos.`)) return;
    button.disabled = true;
    show('Excluindo equipamento…');
    try {
      await state.client.deleteEquipment(item.id);
      show('Equipamento excluído com auditoria.', 'success');
      await load();
    } catch (error) {
      show(error.message, 'error');
      button.disabled = false;
    }
  }

  el.form.addEventListener('submit', async (event) => {
    event.preventDefault();
    el.save.disabled = true;
    show('Salvando equipamento…');
    const equipment = {
      customerId: el.customer.value,
      category: el.category.value,
      brand: el.brand.value,
      model: el.model.value,
      serialNumber: el.serial.value,
      assetTag: el.assetTag.value,
      capacityBtu: el.capacity.value,
      refrigerant: el.refrigerant.value,
      location: el.location.value,
      status: el.status.value,
      notes: el.notes.value,
    };
    try {
      if (el.id.value) await state.client.updateEquipment(el.id.value, equipment);
      else await state.client.createEquipment(equipment);
      closeDialog();
      state.offset = 0;
      await load();
      show('Equipamento salvo no backend.', 'success');
    } catch (error) {
      show(error.message, 'error');
    } finally {
      el.save.disabled = false;
    }
  });

  el.create.addEventListener('click', () => openDialog());
  el.close.addEventListener('click', closeDialog);
  el.cancel.addEventListener('click', closeDialog);
  el.refresh.addEventListener('click', () => load().catch((error) => show(error.message, 'error')));
  for (const control of [el.customerFilter, el.statusFilter]) control.addEventListener('change', () => { state.offset = 0; load().catch((error) => show(error.message, 'error')); });
  el.search.addEventListener('input', () => {
    clearTimeout(state.timer);
    state.timer = setTimeout(() => { state.offset = 0; load().catch((error) => show(error.message, 'error')); }, 300);
  });
  el.previous.addEventListener('click', () => { state.offset = Math.max(0, state.offset - state.limit); load().catch((error) => show(error.message, 'error')); });
  el.next.addEventListener('click', () => { state.offset += state.limit; load().catch((error) => show(error.message, 'error')); });

  async function init() {
    state.client = await waitForClient();
    state.canWrite = state.client.hasPermission('equipment.write');
    state.canDelete = state.client.hasPermission('equipment.delete');
    el.access.hidden = !state.client.hasPermission('members.read');
    const tenant = state.client.session.activeTenant || state.client.session.activeCompany;
    el.tenant.textContent = tenant.tenant_name || tenant.company_name;
    await loadCustomers();
    await load();
  }

  init().catch((error) => show(error.message, 'error'));
})();
