(() => {
  'use strict';

  const TYPE_LABELS = {
    opening: 'Saldo inicial', receipt: 'Entrada / recebimento', issue: 'Saída', return: 'Devolução',
    adjustment_in: 'Ajuste positivo', adjustment_out: 'Ajuste negativo',
    work_order_issue: 'Consumo em OS', work_order_return: 'Devolução de OS',
  };
  const WORK_ORDER_TYPES = new Set(['work_order_issue', 'work_order_return']);

  const el = Object.fromEntries([
    'tenantLabel','accessNavLink','feedback','activeItemsMetric','lowItemsMetric','locationsMetric','movementsMetric',
    'searchInput','itemStatusFilter','lowOnlyInput','refreshButton','itemGrid','balanceGrid','movementGrid','balanceLocationFilter',
    'newLocationButton','newItemButton','newMovementButton','itemDialog','itemForm','itemDialogTitle','closeItemButton','cancelItemButton',
    'itemId','itemSku','itemName','itemUnit','itemMinimum','itemCost','itemStatus','itemDescription','saveItemButton',
    'locationDialog','locationForm','closeLocationButton','cancelLocationButton','locationCode','locationName','saveLocationButton',
    'movementDialog','movementForm','closeMovementButton','cancelMovementButton','movementItem','movementLocation','movementType',
    'movementQuantity','movementWorkOrder','movementCost','movementNotes','saveMovementButton','workOrderField',
  ].map((id) => [id, document.getElementById(id)]));

  const state = { client: null, role: '', items: [], locations: [], balances: [], movements: [], workOrders: [], canWrite: false, canMove: false, canAdjust: false, canIssue: false };

  function show(message, type = '') { el.feedback.textContent = message; el.feedback.className = `saas-feedback ${type}`.trim(); }
  function close(dialog) { if (dialog.open) dialog.close(); }
  function empty(message) { const node = document.createElement('div'); node.className = 'saas-empty'; node.textContent = message; return node; }
  function money(cents) { return (Number(cents || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
  function quantity(value, unit = '') { return `${Number(value || 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 })}${unit ? ` ${unit}` : ''}`; }

  async function waitForClient() {
    const started = Date.now();
    while (!window.ClimaFluxSaaS) { if (Date.now() - started > 10000) throw new Error('A sessão não ficou disponível.'); await new Promise((resolve) => setTimeout(resolve, 50)); }
    await window.ClimaFluxSaaS.ready; return window.ClimaFluxSaaS;
  }

  function action(label, handler) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'saas-button secondary'; button.textContent = label; button.addEventListener('click', handler); return button;
  }

  function renderItems() {
    el.itemGrid.replaceChildren();
    if (!state.items.length) el.itemGrid.append(empty('Nenhum material encontrado.'));
    for (const item of state.items) {
      const card = document.createElement('article'); card.className = 'saas-card saas-inventory-row';
      const identity = document.createElement('div');
      const title = document.createElement('strong'); title.textContent = `${item.sku} · ${item.name}`;
      const description = document.createElement('small'); description.textContent = item.description || `${item.unit} · custo ref. ${money(item.reference_cost_cents)}`;
      identity.append(title, description);
      const balance = document.createElement('div');
      const total = document.createElement('strong'); total.textContent = quantity(item.total_quantity, item.unit);
      const minimum = document.createElement('small'); minimum.textContent = `mínimo ${quantity(item.minimum_quantity, item.unit)}`;
      balance.append(total, minimum);
      if (Number(item.total_quantity) <= Number(item.minimum_quantity)) card.classList.add('inventory-low');
      const status = document.createElement('span'); status.className = `saas-pill ${item.status === 'active' ? 'active' : 'inactive'}`; status.textContent = item.status === 'active' ? 'Ativo' : 'Inativo';
      const actions = document.createElement('div'); actions.className = 'saas-actions'; if (state.canWrite) actions.append(action('Editar', () => openItem(item)));
      card.append(identity, balance, status, actions); el.itemGrid.append(card);
    }
  }

  function renderBalances() {
    el.balanceGrid.replaceChildren();
    const filtered = state.balances.filter((balance) => !el.balanceLocationFilter.value || balance.location_id === el.balanceLocationFilter.value);
    if (!filtered.length) el.balanceGrid.append(empty('Ainda não há saldo registrado para o filtro selecionado.'));
    for (const balance of filtered) {
      const card = document.createElement('article'); card.className = 'saas-card saas-balance-row';
      const identity = document.createElement('div'); const title = document.createElement('strong'); title.textContent = `${balance.sku} · ${balance.item_name}`; const local = document.createElement('small'); local.textContent = `${balance.location_code} · ${balance.location_name}`; identity.append(title, local);
      const value = document.createElement('strong'); value.className = 'saas-balance-value'; value.textContent = quantity(balance.quantity, balance.unit);
      const minimum = document.createElement('span'); minimum.className = Number(balance.quantity) <= Number(balance.minimum_quantity) ? 'saas-danger-text' : ''; minimum.textContent = `Mínimo: ${quantity(balance.minimum_quantity, balance.unit)}`;
      card.append(identity, value, minimum); el.balanceGrid.append(card);
    }
  }

  function renderMovements() {
    el.movementGrid.replaceChildren();
    if (!state.movements.length) el.movementGrid.append(empty('Nenhuma movimentação registrada.'));
    for (const movement of state.movements) {
      const card = document.createElement('article'); card.className = 'saas-card saas-movement-row';
      const identity = document.createElement('div'); const title = document.createElement('strong'); title.textContent = `${movement.sku} · ${movement.item_name}`; const local = document.createElement('small'); local.textContent = `${movement.location_code} · ${movement.location_name}`; identity.append(title, local);
      const type = document.createElement('span'); type.className = 'saas-pill'; type.textContent = TYPE_LABELS[movement.movement_type] || movement.movement_type;
      const amount = document.createElement('strong'); amount.className = Number(movement.quantity_delta) < 0 ? 'inventory-out' : 'inventory-in'; amount.textContent = `${Number(movement.quantity_delta) > 0 ? '+' : ''}${quantity(movement.quantity_delta, movement.unit)}`;
      const meta = document.createElement('div'); const when = document.createElement('small'); when.textContent = new Date(movement.created_at).toLocaleString('pt-BR'); const ref = document.createElement('small'); ref.textContent = movement.reference_id ? `${movement.reference_type || 'referência'}: ${movement.reference_id}` : movement.notes || 'Sem referência'; meta.append(when, ref);
      card.append(identity, type, amount, meta); el.movementGrid.append(card);
    }
    el.movementsMetric.textContent = String(state.movements.length);
  }

  function fillSelects() {
    const currentLocation = el.balanceLocationFilter.value;
    el.balanceLocationFilter.replaceChildren(new Option('Todos os locais', ''));
    el.movementLocation.replaceChildren(new Option('Selecione', ''));
    for (const location of state.locations) {
      el.balanceLocationFilter.append(new Option(`${location.code} · ${location.name}`, location.id));
      if (location.status === 'active') el.movementLocation.append(new Option(`${location.code} · ${location.name}`, location.id));
    }
    if ([...el.balanceLocationFilter.options].some((option) => option.value === currentLocation)) el.balanceLocationFilter.value = currentLocation;

    el.movementItem.replaceChildren(new Option('Selecione', ''));
    for (const item of state.items.filter((item) => item.status === 'active')) el.movementItem.append(new Option(`${item.sku} · ${item.name}`, item.id));

    el.movementWorkOrder.replaceChildren(new Option('Selecione a OS', ''));
    for (const order of state.workOrders) el.movementWorkOrder.append(new Option(`${order.code} · ${order.title}`, order.id));

    const types = [];
    if (state.canMove) types.push('opening', 'receipt', 'issue', 'return', 'work_order_issue', 'work_order_return');
    if (state.canAdjust) types.push('adjustment_in', 'adjustment_out');
    if (!state.canMove && state.canIssue) types.push('work_order_issue', 'work_order_return');
    el.movementType.replaceChildren(...types.map((type) => new Option(TYPE_LABELS[type], type)));
    toggleWorkOrderField();
  }

  function toggleWorkOrderField() {
    const required = WORK_ORDER_TYPES.has(el.movementType.value);
    el.workOrderField.hidden = !required;
    el.movementWorkOrder.required = required;
  }

  async function load() {
    show('Sincronizando estoque…');
    const params = { limit: 100, q: el.searchInput.value, status: el.itemStatusFilter.value, low: el.lowOnlyInput.checked ? 1 : '' };
    const [items, lowItems, locations, balances, movements, orders] = await Promise.all([
      state.client.listStockItems(params),
      state.client.listStockItems({ limit: 100, status: 'active', low: 1 }),
      state.client.listStockLocations(),
      state.client.listStockBalances(),
      state.client.listStockMovements({ limit: 50 }),
      state.client.listWorkOrders({ limit: 100 }),
    ]);
    state.items = items.items || []; state.locations = locations.items || []; state.balances = balances.items || []; state.movements = movements.items || []; state.workOrders = orders.items || [];
    el.activeItemsMetric.textContent = String(state.items.filter((item) => item.status === 'active').length);
    el.lowItemsMetric.textContent = String((lowItems.items || []).length);
    el.locationsMetric.textContent = String(state.locations.filter((location) => location.status === 'active').length);
    fillSelects(); renderItems(); renderBalances(); renderMovements();
    show('Estoque sincronizado com o D1.', 'success');
  }

  function openItem(item = null) {
    el.itemForm.reset(); el.itemId.value = item?.id || ''; el.itemSku.value = item?.sku || ''; el.itemName.value = item?.name || ''; el.itemUnit.value = item?.unit || 'un'; el.itemMinimum.value = item?.minimum_quantity ?? 0; el.itemCost.value = (Number(item?.reference_cost_cents || 0) / 100).toFixed(2); el.itemStatus.value = item?.status || 'active'; el.itemDescription.value = item?.description || ''; el.itemDialogTitle.textContent = item ? `Editar · ${item.sku}` : 'Novo item'; el.itemDialog.showModal(); el.itemSku.focus();
  }

  function openMovement() {
    el.movementForm.reset(); fillSelects(); if (!state.locations.some((location) => location.status === 'active')) { show('Cadastre um local ativo antes de movimentar estoque.', 'error'); return; } if (!state.items.some((item) => item.status === 'active')) { show('Cadastre um item ativo antes de movimentar estoque.', 'error'); return; } el.movementDialog.showModal();
  }

  el.itemForm.addEventListener('submit', async (event) => {
    event.preventDefault(); el.saveItemButton.disabled = true;
    const payload = { sku: el.itemSku.value, name: el.itemName.value, unit: el.itemUnit.value, minimumQuantity: el.itemMinimum.value, referenceCostCents: Math.round(Number(el.itemCost.value || 0) * 100), status: el.itemStatus.value, description: el.itemDescription.value };
    try { if (el.itemId.value) await state.client.updateStockItem(el.itemId.value, payload); else await state.client.createStockItem(payload); close(el.itemDialog); await load(); show('Material salvo.', 'success'); } catch (error) { show(error.message, 'error'); } finally { el.saveItemButton.disabled = false; }
  });

  el.locationForm.addEventListener('submit', async (event) => {
    event.preventDefault(); el.saveLocationButton.disabled = true;
    try { await state.client.createStockLocation({ code: el.locationCode.value, name: el.locationName.value, status: 'active' }); close(el.locationDialog); el.locationForm.reset(); await load(); show('Local de estoque criado.', 'success'); } catch (error) { show(error.message, 'error'); } finally { el.saveLocationButton.disabled = false; }
  });

  el.movementForm.addEventListener('submit', async (event) => {
    event.preventDefault(); el.saveMovementButton.disabled = true;
    const workOrder = WORK_ORDER_TYPES.has(el.movementType.value);
    try {
      await state.client.createStockMovement({
        itemId: el.movementItem.value, locationId: el.movementLocation.value, movementType: el.movementType.value,
        quantity: el.movementQuantity.value, unitCostCents: el.movementCost.value === '' ? null : Math.round(Number(el.movementCost.value) * 100),
        referenceType: workOrder ? 'work_order' : null, referenceId: workOrder ? el.movementWorkOrder.value : null, notes: el.movementNotes.value,
      });
      close(el.movementDialog); await load(); show('Movimentação registrada. O saldo foi atualizado pelo banco.', 'success');
    } catch (error) { show(error.message, 'error'); } finally { el.saveMovementButton.disabled = false; }
  });

  el.movementType.addEventListener('change', toggleWorkOrderField);
  el.balanceLocationFilter.addEventListener('change', renderBalances);
  el.refreshButton.addEventListener('click', () => load().catch((error) => show(error.message, 'error')));
  el.searchInput.addEventListener('input', () => { clearTimeout(state.searchTimer); state.searchTimer = setTimeout(() => load().catch((error) => show(error.message, 'error')), 250); });
  el.itemStatusFilter.addEventListener('change', () => load().catch((error) => show(error.message, 'error')));
  el.lowOnlyInput.addEventListener('change', () => load().catch((error) => show(error.message, 'error')));
  el.newItemButton.addEventListener('click', () => openItem());
  el.newLocationButton.addEventListener('click', () => { el.locationForm.reset(); el.locationDialog.showModal(); });
  el.newMovementButton.addEventListener('click', openMovement);
  for (const [button, dialog] of [[el.closeItemButton, el.itemDialog],[el.cancelItemButton, el.itemDialog],[el.closeLocationButton, el.locationDialog],[el.cancelLocationButton, el.locationDialog],[el.closeMovementButton, el.movementDialog],[el.cancelMovementButton, el.movementDialog]]) button.addEventListener('click', () => close(dialog));

  async function init() {
    state.client = await waitForClient();
    if (!state.client.hasPermission('inventory.read')) throw new Error('Você não possui acesso ao estoque.');
    const tenant = state.client.session.activeTenant || state.client.session.activeCompany; state.role = tenant.role; el.tenantLabel.textContent = tenant.tenant_name || tenant.company_name;
    state.canWrite = state.client.hasPermission('inventory.write'); state.canMove = state.client.hasPermission('inventory.move'); state.canAdjust = state.client.hasPermission('inventory.adjust'); state.canIssue = state.client.hasPermission('inventory.issue');
    el.newItemButton.hidden = !state.canWrite; el.newLocationButton.hidden = !state.canWrite; el.newMovementButton.hidden = !(state.canMove || state.canIssue || state.canAdjust); el.accessNavLink.hidden = !state.client.hasPermission('members.read');
    await load();
  }
  init().catch((error) => show(error.message, 'error'));
})();
