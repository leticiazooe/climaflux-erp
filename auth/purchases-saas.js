(() => {
  'use strict';

  const STATUS_LABELS = {
    draft: 'Rascunho', approved: 'Aprovado', ordered: 'Enviado', partially_received: 'Recebimento parcial', received: 'Recebido', cancelled: 'Cancelado',
  };
  const el = Object.fromEntries([
    'tenantLabel','accessNavLink','feedback','statusFilter','refreshButton','orderGrid','newSupplierButton','newOrderButton',
    'supplierDialog','supplierForm','supplierName','supplierDocument','supplierEmail','supplierPhone','closeSupplierButton','cancelSupplierButton','saveSupplierButton',
    'orderDialog','orderForm','orderSupplier','orderExpected','orderNotes','orderLines','addOrderLineButton','closeOrderButton','cancelOrderButton','saveOrderButton',
    'detailDialog','detailTitle','detailSummary','detailActions','detailLines','receiptHistory','closeDetailButton',
    'receiveDialog','receiveForm','receiveTitle','receiveOrderId','receiveLocation','receiveLines','receiveNotes','closeReceiveButton','cancelReceiveButton','saveReceiveButton',
  ].map((id) => [id, document.getElementById(id)]));

  const state = { client: null, suppliers: [], items: [], locations: [], orders: [], detail: null, canWrite: false, canApprove: false, canReceive: false };
  function show(message, type = '') { el.feedback.textContent = message; el.feedback.className = `saas-feedback ${type}`.trim(); }
  function close(dialog) { if (dialog.open) dialog.close(); }
  function empty(message) { const node = document.createElement('div'); node.className = 'saas-empty'; node.textContent = message; return node; }
  function money(cents) { return (Number(cents || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
  function action(label, variant, handler) { const button = document.createElement('button'); button.type = 'button'; button.className = `saas-button ${variant}`.trim(); button.textContent = label; button.addEventListener('click', () => handler(button)); return button; }
  async function waitForClient() { const started = Date.now(); while (!window.ClimaFluxSaaS) { if (Date.now() - started > 10000) throw new Error('A sessão não ficou disponível.'); await new Promise((resolve) => setTimeout(resolve, 50)); } await window.ClimaFluxSaaS.ready; return window.ClimaFluxSaaS; }

  async function loadLookups() {
    const data = await state.client.purchaseLookups();
    state.suppliers = data.suppliers || []; state.items = data.items || []; state.locations = data.locations || [];
    el.orderSupplier.replaceChildren(new Option('Selecione', ''));
    for (const supplier of state.suppliers) el.orderSupplier.append(new Option(`${supplier.name}${supplier.document ? ` · ${supplier.document}` : ''}`, supplier.id));
    el.receiveLocation.replaceChildren(new Option('Selecione', ''));
    for (const location of state.locations) el.receiveLocation.append(new Option(`${location.code} · ${location.name}`, location.id));
  }

  function renderOrders() {
    el.orderGrid.replaceChildren();
    if (!state.orders.length) el.orderGrid.append(empty('Nenhum pedido de compra encontrado.'));
    for (const order of state.orders) {
      const row = document.createElement('article'); row.className = 'saas-card saas-purchase-row';
      const identity = document.createElement('div'); const title = document.createElement('strong'); title.textContent = `${order.code} · ${order.supplier_name}`; const expected = document.createElement('small'); expected.textContent = order.expected_date ? `Previsão: ${new Date(order.expected_date).toLocaleDateString('pt-BR')}` : 'Sem previsão'; identity.append(title, expected);
      const total = document.createElement('div'); const totalStrong = document.createElement('strong'); totalStrong.textContent = money(order.total_cents); const received = document.createElement('small'); received.textContent = `Recebido: ${money(order.received_cents)}`; total.append(totalStrong, received);
      const status = document.createElement('span'); status.className = `saas-pill purchase-${order.status}`; status.textContent = STATUS_LABELS[order.status] || order.status;
      const actions = document.createElement('div'); actions.className = 'saas-actions'; actions.append(action('Abrir', 'secondary', () => openDetail(order.id)));
      row.append(identity, total, status, actions); el.orderGrid.append(row);
    }
  }

  async function loadOrders() {
    show('Carregando pedidos…');
    const data = await state.client.listPurchaseOrders({ limit: 100, status: el.statusFilter.value });
    state.orders = data.items || []; renderOrders(); show('Compras sincronizadas com o backend.', 'success');
  }

  function createLineRow(values = {}) {
    const row = document.createElement('div'); row.className = 'saas-purchase-line';
    const item = document.createElement('select'); item.className = 'saas-input purchase-line-item'; item.required = true; item.append(new Option('Material', ''));
    for (const stockItem of state.items) item.append(new Option(`${stockItem.sku} · ${stockItem.name}`, stockItem.id));
    item.value = values.itemId || '';
    const qty = document.createElement('input'); qty.className = 'saas-input purchase-line-qty'; qty.type = 'number'; qty.min = '0.000001'; qty.step = 'any'; qty.placeholder = 'Quantidade'; qty.required = true; qty.value = values.quantity || '';
    const cost = document.createElement('input'); cost.className = 'saas-input purchase-line-cost'; cost.type = 'number'; cost.min = '0'; cost.step = '0.01'; cost.placeholder = 'Custo unit. R$'; cost.required = true; cost.value = values.cost || '';
    const remove = action('Remover', 'danger', () => { row.remove(); if (!el.orderLines.children.length) el.orderLines.append(createLineRow()); });
    row.append(item, qty, cost, remove); return row;
  }

  function openOrder() {
    if (!state.suppliers.length) { show('Cadastre um fornecedor ativo antes de criar o pedido.', 'error'); return; }
    if (!state.items.length) { show('Cadastre itens de estoque antes de criar o pedido.', 'error'); return; }
    el.orderForm.reset(); el.orderLines.replaceChildren(createLineRow()); el.orderDialog.showModal(); el.orderSupplier.focus();
  }

  async function openDetail(id) {
    el.detailDialog.showModal(); el.detailTitle.textContent = 'Carregando pedido…'; el.detailSummary.replaceChildren(empty('Consultando backend…')); el.detailLines.replaceChildren(); el.receiptHistory.replaceChildren(); el.detailActions.replaceChildren();
    try { state.detail = await state.client.getPurchaseOrder(id); renderDetail(); }
    catch (error) { el.detailSummary.replaceChildren(empty(error.message)); }
  }

  function renderDetail() {
    const { order, lines, receipts } = state.detail;
    el.detailTitle.textContent = `${order.code} · ${order.supplier_name}`; el.detailSummary.replaceChildren();
    const summary = [['Status', STATUS_LABELS[order.status] || order.status], ['Fornecedor', order.supplier_name], ['Previsão', order.expected_date ? new Date(order.expected_date).toLocaleDateString('pt-BR') : '—'], ['Criado', new Date(order.created_at).toLocaleString('pt-BR')]];
    for (const [label, value] of summary) { const card = document.createElement('div'); const strong = document.createElement('strong'); strong.textContent = label; const span = document.createElement('span'); span.textContent = value; card.append(strong, span); el.detailSummary.append(card); }
    el.detailActions.replaceChildren();
    if (order.status === 'draft') {
      if (state.canApprove) el.detailActions.append(action('Aprovar', '', () => transition('approved')));
      if (state.canWrite) el.detailActions.append(action('Cancelar', 'danger', () => transition('cancelled')));
    } else if (order.status === 'approved') {
      if (state.canWrite) el.detailActions.append(action('Marcar como enviado', '', () => transition('ordered')));
      if (state.canApprove) el.detailActions.append(action('Cancelar', 'danger', () => transition('cancelled')));
    } else if (order.status === 'ordered') {
      if (state.canReceive) el.detailActions.append(action('Receber materiais', '', openReceive));
      if (state.canApprove) el.detailActions.append(action('Cancelar', 'danger', () => transition('cancelled')));
    } else if (order.status === 'partially_received' && state.canReceive) {
      el.detailActions.append(action('Continuar recebimento', '', openReceive));
    }

    el.detailLines.replaceChildren();
    for (const line of lines) {
      const row = document.createElement('article'); row.className = 'saas-card saas-purchase-detail-line';
      const identity = document.createElement('div'); const title = document.createElement('strong'); title.textContent = `${line.sku} · ${line.item_name}`; const unit = document.createElement('small'); unit.textContent = `${line.quantity_ordered} ${line.unit} × ${money(line.unit_cost_cents)}`; identity.append(title, unit);
      const progress = document.createElement('strong'); progress.textContent = `${line.quantity_received} / ${line.quantity_ordered} ${line.unit}`;
      const pending = document.createElement('span'); pending.textContent = `Pendente: ${Math.max(0, Number(line.quantity_ordered) - Number(line.quantity_received)).toLocaleString('pt-BR')} ${line.unit}`;
      row.append(identity, progress, pending); el.detailLines.append(row);
    }
    el.receiptHistory.replaceChildren();
    if (!receipts.length) el.receiptHistory.append(empty('Nenhum recebimento registrado.'));
    for (const receipt of receipts) { const row = document.createElement('article'); row.className = 'saas-card saas-receipt-row'; const code = document.createElement('strong'); code.textContent = receipt.code; const meta = document.createElement('span'); meta.textContent = `${receipt.location_name} · ${new Date(receipt.received_at).toLocaleString('pt-BR')}`; const actor = document.createElement('small'); actor.textContent = receipt.received_by_name || 'Usuário'; row.append(code, meta, actor); el.receiptHistory.append(row); }
  }

  async function transition(status) {
    if (!state.detail?.order?.id) return;
    show('Atualizando pedido…');
    try { await state.client.transitionPurchaseOrder(state.detail.order.id, { status }); state.detail = await state.client.getPurchaseOrder(state.detail.order.id); renderDetail(); await loadOrders(); show('Status do pedido atualizado.', 'success'); }
    catch (error) { show(error.message, 'error'); }
  }

  function openReceive() {
    const { order, lines } = state.detail;
    if (!state.locations.length) { show('Cadastre um local de estoque ativo antes do recebimento.', 'error'); return; }
    const pending = lines.filter((line) => Number(line.quantity_received) + 0.000001 < Number(line.quantity_ordered));
    if (!pending.length) { show('Este pedido não possui saldo pendente.', 'error'); return; }
    el.receiveForm.reset(); el.receiveOrderId.value = order.id; el.receiveTitle.textContent = `Receber · ${order.code}`; el.receiveLines.replaceChildren();
    for (const line of pending) {
      const row = document.createElement('div'); row.className = 'saas-receive-line'; row.dataset.lineId = line.id;
      const identity = document.createElement('div'); const name = document.createElement('strong'); name.textContent = `${line.sku} · ${line.item_name}`; const outstanding = Number(line.quantity_ordered) - Number(line.quantity_received); const meta = document.createElement('small'); meta.textContent = `Pendente: ${outstanding.toLocaleString('pt-BR')} ${line.unit}`; identity.append(name, meta);
      const qty = document.createElement('input'); qty.className = 'saas-input receive-line-qty'; qty.type = 'number'; qty.min = '0'; qty.max = String(outstanding); qty.step = 'any'; qty.value = String(outstanding);
      row.append(identity, qty); el.receiveLines.append(row);
    }
    el.receiveDialog.showModal(); el.receiveLocation.focus();
  }

  el.supplierForm.addEventListener('submit', async (event) => { event.preventDefault(); el.saveSupplierButton.disabled = true; try { await state.client.createSupplier({ name: el.supplierName.value, document: el.supplierDocument.value, email: el.supplierEmail.value, phone: el.supplierPhone.value, status: 'active' }); close(el.supplierDialog); el.supplierForm.reset(); await loadLookups(); show('Fornecedor cadastrado.', 'success'); } catch (error) { show(error.message, 'error'); } finally { el.saveSupplierButton.disabled = false; } });
  el.orderForm.addEventListener('submit', async (event) => {
    event.preventDefault(); el.saveOrderButton.disabled = true;
    try {
      const lines = [...el.orderLines.querySelectorAll('.saas-purchase-line')].map((row) => ({ itemId: row.querySelector('.purchase-line-item').value, quantity: row.querySelector('.purchase-line-qty').value, unitCostCents: Math.round(Number(row.querySelector('.purchase-line-cost').value || 0) * 100) }));
      await state.client.createPurchaseOrder({ supplierId: el.orderSupplier.value, expectedDate: el.orderExpected.value, notes: el.orderNotes.value, lines });
      close(el.orderDialog); await loadOrders(); show('Pedido criado em rascunho.', 'success');
    } catch (error) { show(error.message, 'error'); } finally { el.saveOrderButton.disabled = false; }
  });
  el.receiveForm.addEventListener('submit', async (event) => {
    event.preventDefault(); el.saveReceiveButton.disabled = true;
    try {
      const lines = [...el.receiveLines.querySelectorAll('.saas-receive-line')].map((row) => ({ lineId: row.dataset.lineId, quantity: Number(row.querySelector('.receive-line-qty').value || 0) })).filter((line) => line.quantity > 0);
      if (!lines.length) throw new Error('Informe ao menos uma quantidade recebida.');
      await state.client.receivePurchaseOrder(el.receiveOrderId.value, { locationId: el.receiveLocation.value, notes: el.receiveNotes.value, lines });
      close(el.receiveDialog); state.detail = await state.client.getPurchaseOrder(el.receiveOrderId.value); renderDetail(); await loadOrders(); show('Recebimento concluído e estoque atualizado.', 'success');
    } catch (error) { show(error.message, 'error'); } finally { el.saveReceiveButton.disabled = false; }
  });

  el.newSupplierButton.addEventListener('click', () => { el.supplierForm.reset(); el.supplierDialog.showModal(); });
  el.newOrderButton.addEventListener('click', openOrder); el.addOrderLineButton.addEventListener('click', () => el.orderLines.append(createLineRow()));
  el.refreshButton.addEventListener('click', () => Promise.all([loadLookups(), loadOrders()]).catch((error) => show(error.message, 'error'))); el.statusFilter.addEventListener('change', () => loadOrders().catch((error) => show(error.message, 'error')));
  for (const [button, dialog] of [[el.closeSupplierButton,el.supplierDialog],[el.cancelSupplierButton,el.supplierDialog],[el.closeOrderButton,el.orderDialog],[el.cancelOrderButton,el.orderDialog],[el.closeDetailButton,el.detailDialog],[el.closeReceiveButton,el.receiveDialog],[el.cancelReceiveButton,el.receiveDialog]]) button.addEventListener('click', () => close(dialog));

  async function init() {
    state.client = await waitForClient(); if (!state.client.hasPermission('purchases.read')) throw new Error('Você não possui acesso ao módulo de compras.');
    const tenant = state.client.session.activeTenant || state.client.session.activeCompany; el.tenantLabel.textContent = tenant.tenant_name || tenant.company_name;
    state.canWrite = state.client.hasPermission('purchases.write'); state.canApprove = state.client.hasPermission('purchases.approve'); state.canReceive = state.client.hasPermission('purchases.receive');
    el.newSupplierButton.hidden = !state.canWrite; el.newOrderButton.hidden = !state.canWrite; el.accessNavLink.hidden = !state.client.hasPermission('members.read');
    await loadLookups(); await loadOrders();
  }
  init().catch((error) => show(error.message, 'error'));
})();
