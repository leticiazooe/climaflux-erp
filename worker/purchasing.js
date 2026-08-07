import { requireSession, recordAudit } from './auth.js';
import { assertPermission } from './policy.js';
import { json, nowIso, verifyCsrf } from './security.js';

const ORDER_STATUSES = Object.freeze(['draft','approved','ordered','partially_received','received','cancelled']);
const ORDER_TRANSITIONS = Object.freeze({
  draft: Object.freeze(['approved','cancelled']),
  approved: Object.freeze(['ordered','cancelled']),
  ordered: Object.freeze(['cancelled']),
  partially_received: Object.freeze([]),
  received: Object.freeze([]),
  cancelled: Object.freeze([]),
});

function cleanText(value,maxLength,{nullable=true}={}) { const text=String(value ?? '').trim(); if(!text) return nullable?null:''; return text.slice(0,maxLength); }
function normalizeEmail(value) { return String(value || '').trim().toLowerCase(); }
function cleanIsoDate(value) {
  if(value===null||value===undefined||value==='') return null;
  const text=String(value).trim();
  const parsed=Date.parse(text.length===10?`${text}T12:00:00Z`:text);
  if(!Number.isFinite(parsed)) throw new Error('PURCHASE_DATE_INVALID');
  return new Date(parsed).toISOString();
}
function pagination(searchParams){const limitRaw=Number.parseInt(String(searchParams.get('limit')||'50'),10);const offsetRaw=Number.parseInt(String(searchParams.get('offset')||'0'),10);return{limit:Number.isFinite(limitRaw)?Math.min(100,Math.max(1,limitRaw)):50,offset:Number.isFinite(offsetRaw)?Math.max(0,offsetRaw):0};}
function purchaseCode(id,date=new Date()){return `PC-${date.getUTCFullYear()}-${String(id).replace(/-/g,'').slice(0,8).toUpperCase()}`;}
function receiptCode(id,date=new Date()){return `REC-${date.toISOString().slice(0,10).replace(/-/g,'')}-${String(id).replace(/-/g,'').slice(0,6).toUpperCase()}`;}

export function normalizeSupplierInput(input,{partial=false}={}) {
  if(!input||typeof input!=='object'||Array.isArray(input)) throw new Error('API_VALIDATION');
  const has=(key)=>Object.prototype.hasOwnProperty.call(input,key); const out={};
  if(!partial||has('name')){const name=cleanText(input.name,200,{nullable:false});if(!name||name.length<2)throw new Error('PURCHASE_SUPPLIER_NAME_REQUIRED');out.name=name;}
  if(!partial||has('document')) out.document=cleanText(input.document,40);
  if(!partial||has('email')){const email=normalizeEmail(input.email);if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new Error('PURCHASE_SUPPLIER_EMAIL_INVALID');out.email=email||null;}
  if(!partial||has('phone')) out.phone=cleanText(input.phone,40);
  if(!partial||has('notes')) out.notes=cleanText(input.notes,2000);
  if(!partial||has('status')){const status=String(input.status||'active').toLowerCase();if(!['active','inactive'].includes(status))throw new Error('PURCHASE_STATUS_INVALID');out.status=status;}
  if(partial&&!Object.keys(out).length)throw new Error('API_VALIDATION'); return out;
}

export function normalizePurchaseOrderInput(input) {
  if(!input||typeof input!=='object'||Array.isArray(input)) throw new Error('API_VALIDATION');
  const supplierId=cleanText(input.supplierId,100,{nullable:false});
  const expectedDate=cleanIsoDate(input.expectedDate); const notes=cleanText(input.notes,3000);
  if(!supplierId) throw new Error('PURCHASE_SUPPLIER_REQUIRED');
  if(!Array.isArray(input.lines)||!input.lines.length||input.lines.length>100) throw new Error('PURCHASE_LINES_REQUIRED');
  const seen=new Set();
  const lines=input.lines.map((line)=>{
    const itemId=cleanText(line?.itemId,100,{nullable:false}); const quantity=Number(line?.quantity); const cost=Number(line?.unitCostCents);
    if(!itemId||!Number.isFinite(quantity)||quantity<=0||quantity>1_000_000_000||!Number.isInteger(cost)||cost<0) throw new Error('PURCHASE_LINE_INVALID');
    if(seen.has(itemId)) throw new Error('PURCHASE_LINE_DUPLICATE_ITEM'); seen.add(itemId);
    return {itemId,quantity,unitCostCents:cost,notes:cleanText(line?.notes,1000)};
  });
  return {supplierId,expectedDate,notes,lines};
}

export function normalizePurchaseTransition(input) {
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('API_VALIDATION');
  const status=String(input.status||'').toLowerCase(); if(!ORDER_STATUSES.includes(status))throw new Error('PURCHASE_STATUS_INVALID');
  return {status,note:cleanText(input.note,2000)};
}
export function canTransitionPurchase(from,to){return (ORDER_TRANSITIONS[String(from||'')]||[]).includes(String(to||''));}

export function normalizeReceiptInput(input) {
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('API_VALIDATION');
  const locationId=cleanText(input.locationId,100,{nullable:false});
  if(!locationId)throw new Error('PURCHASE_RECEIPT_LOCATION_REQUIRED');
  if(!Array.isArray(input.lines)||!input.lines.length||input.lines.length>100)throw new Error('PURCHASE_RECEIPT_LINES_REQUIRED');
  const seen=new Set();
  const lines=input.lines.map((line)=>{
    const lineId=cleanText(line?.lineId,100,{nullable:false}); const quantity=Number(line?.quantity);
    if(!lineId||!Number.isFinite(quantity)||quantity<=0||quantity>1_000_000_000)throw new Error('PURCHASE_RECEIPT_QUANTITY_INVALID');
    if(seen.has(lineId))throw new Error('PURCHASE_RECEIPT_LINE_DUPLICATE');seen.add(lineId);return{lineId,quantity};
  });
  return {locationId,notes:cleanText(input.notes,2000),lines};
}

async function getSupplier(env,tenantId,id){const row=await env.DB.prepare(`SELECT * FROM suppliers WHERE tenant_id = ? AND id = ?`).bind(tenantId,id).first();if(!row)throw new Error('PURCHASE_SUPPLIER_NOT_FOUND');return row;}
async function getOrder(env,tenantId,id){const row=await env.DB.prepare(`SELECT p.*,s.name AS supplier_name,s.document AS supplier_document FROM purchase_orders p JOIN suppliers s ON s.tenant_id=p.tenant_id AND s.id=p.supplier_id WHERE p.tenant_id=? AND p.id=?`).bind(tenantId,id).first();if(!row)throw new Error('PURCHASE_ORDER_NOT_FOUND');return row;}

async function handleSupplierList(request,env){const session=await requireSession(env,request);assertPermission(session.activeMembership.role,'purchases.read');const url=new URL(request.url);const q=cleanText(url.searchParams.get('q'),120);const status=String(url.searchParams.get('status')||'').toLowerCase();const where=['tenant_id = ?'];const values=[session.activeMembership.tenant_id];if(q){where.push('(name LIKE ? OR document LIKE ? OR email LIKE ?)');const like=`%${q}%`;values.push(like,like,like);}if(status){if(!['active','inactive'].includes(status))throw new Error('PURCHASE_STATUS_INVALID');where.push('status = ?');values.push(status);}const rows=await env.DB.prepare(`SELECT * FROM suppliers WHERE ${where.join(' AND ')} ORDER BY name LIMIT 200`).bind(...values).all();return json({items:rows.results||[]});}

async function handleSupplierCreate(request,env){const session=await requireSession(env,request);assertPermission(session.activeMembership.role,'purchases.write');await verifyCsrf(request,session);const input=normalizeSupplierInput(await request.json().catch(()=>({})));const id=crypto.randomUUID();const current=nowIso();await env.DB.prepare(`INSERT INTO suppliers (id,tenant_id,name,document,email,phone,notes,status,created_by,updated_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id,session.activeMembership.tenant_id,input.name,input.document,input.email,input.phone,input.notes,input.status,session.user_id,session.user_id,current,current).run();await recordAudit(env,request,session,'purchase.supplier.create','supplier',id,{name:input.name});return json({ok:true,supplier:await getSupplier(env,session.activeMembership.tenant_id,id)},201);}

async function handleSupplierUpdate(request,env,id){const session=await requireSession(env,request);assertPermission(session.activeMembership.role,'purchases.write');await verifyCsrf(request,session);await getSupplier(env,session.activeMembership.tenant_id,id);const input=normalizeSupplierInput(await request.json().catch(()=>({})),{partial:true});const columns={name:'name',document:'document',email:'email',phone:'phone',notes:'notes',status:'status'};const entries=Object.entries(input).filter(([key])=>columns[key]);const assignments=entries.map(([key])=>`${columns[key]} = ?`);const values=entries.map(([,value])=>value);assignments.push('updated_by = ?','updated_at = ?');values.push(session.user_id,nowIso(),id,session.activeMembership.tenant_id);await env.DB.prepare(`UPDATE suppliers SET ${assignments.join(', ')} WHERE id=? AND tenant_id=?`).bind(...values).run();await recordAudit(env,request,session,'purchase.supplier.update','supplier',id,{fields:entries.map(([key])=>key)});return json({ok:true,supplier:await getSupplier(env,session.activeMembership.tenant_id,id)});}

async function handleLookups(request,env){const session=await requireSession(env,request);assertPermission(session.activeMembership.role,'purchases.read');const tenant=session.activeMembership.tenant_id;const [suppliers,items,locations]=await Promise.all([
  env.DB.prepare(`SELECT id,name,document FROM suppliers WHERE tenant_id=? AND status='active' ORDER BY name`).bind(tenant).all(),
  env.DB.prepare(`SELECT id,sku,name,unit,reference_cost_cents FROM stock_items WHERE tenant_id=? AND status='active' ORDER BY name`).bind(tenant).all(),
  env.DB.prepare(`SELECT id,code,name FROM stock_locations WHERE tenant_id=? AND status='active' ORDER BY name`).bind(tenant).all(),
]);return json({suppliers:suppliers.results||[],items:items.results||[],locations:locations.results||[]});}

async function handleOrderList(request,env){const session=await requireSession(env,request);assertPermission(session.activeMembership.role,'purchases.read');const url=new URL(request.url);const {limit,offset}=pagination(url.searchParams);const status=String(url.searchParams.get('status')||'').toLowerCase();const where=['p.tenant_id = ?'];const values=[session.activeMembership.tenant_id];if(status){if(!ORDER_STATUSES.includes(status))throw new Error('PURCHASE_STATUS_INVALID');where.push('p.status = ?');values.push(status);}const rows=await env.DB.prepare(`SELECT p.id,p.code,p.status,p.expected_date,p.created_at,p.updated_at,s.name AS supplier_name, COALESCE(SUM(l.quantity_ordered*l.unit_cost_cents),0) AS total_cents, COALESCE(SUM(l.quantity_received*l.unit_cost_cents),0) AS received_cents FROM purchase_orders p JOIN suppliers s ON s.tenant_id=p.tenant_id AND s.id=p.supplier_id LEFT JOIN purchase_order_lines l ON l.tenant_id=p.tenant_id AND l.purchase_order_id=p.id WHERE ${where.join(' AND ')} GROUP BY p.id ORDER BY p.updated_at DESC LIMIT ? OFFSET ?`).bind(...values,limit,offset).all();return json({items:rows.results||[],page:{limit,offset}});}

async function handleOrderDetail(request,env,id){const session=await requireSession(env,request);assertPermission(session.activeMembership.role,'purchases.read');const tenant=session.activeMembership.tenant_id;const order=await getOrder(env,tenant,id);const [lines,receipts]=await Promise.all([
  env.DB.prepare(`SELECT l.id,l.item_id,l.quantity_ordered,l.quantity_received,l.unit_cost_cents,l.notes,i.sku,i.name AS item_name,i.unit FROM purchase_order_lines l JOIN stock_items i ON i.tenant_id=l.tenant_id AND i.id=l.item_id WHERE l.tenant_id=? AND l.purchase_order_id=? ORDER BY i.name`).bind(tenant,id).all(),
  env.DB.prepare(`SELECT r.id,r.code,r.location_id,r.notes,r.received_at,u.name AS received_by_name,loc.name AS location_name FROM purchase_receipts r JOIN users u ON u.id=r.received_by JOIN stock_locations loc ON loc.tenant_id=r.tenant_id AND loc.id=r.location_id WHERE r.tenant_id=? AND r.purchase_order_id=? ORDER BY r.received_at DESC`).bind(tenant,id).all(),
]);return json({order,lines:lines.results||[],receipts:receipts.results||[]});}

async function handleOrderCreate(request,env){const session=await requireSession(env,request);assertPermission(session.activeMembership.role,'purchases.write');await verifyCsrf(request,session);const input=normalizePurchaseOrderInput(await request.json().catch(()=>({})));const tenant=session.activeMembership.tenant_id;const supplier=await getSupplier(env,tenant,input.supplierId);if(supplier.status!=='active')throw new Error('PURCHASE_SUPPLIER_INVALID');const itemIds=input.lines.map((line)=>line.itemId);const placeholders=itemIds.map(()=>'?').join(',');const available=await env.DB.prepare(`SELECT id FROM stock_items WHERE tenant_id=? AND status='active' AND id IN (${placeholders})`).bind(tenant,...itemIds).all();if((available.results||[]).length!==itemIds.length)throw new Error('PURCHASE_ITEM_INVALID');const id=crypto.randomUUID();const code=purchaseCode(id);const current=nowIso();const statements=[env.DB.prepare(`INSERT INTO purchase_orders (id,tenant_id,supplier_id,code,status,expected_date,notes,created_by,updated_by,created_at,updated_at) VALUES (?,?,?,?,'draft',?,?,?,?,?,?,?)`).bind(id,tenant,input.supplierId,code,input.expectedDate,input.notes,session.user_id,session.user_id,current,current)];for(const line of input.lines)statements.push(env.DB.prepare(`INSERT INTO purchase_order_lines (id,tenant_id,purchase_order_id,item_id,quantity_ordered,quantity_received,unit_cost_cents,notes) VALUES (?,?,?,?,?,0,?,?)`).bind(crypto.randomUUID(),tenant,id,line.itemId,line.quantity,line.unitCostCents,line.notes));await env.DB.batch(statements);await recordAudit(env,request,session,'purchase.order.create','purchase_order',id,{code,supplierId:input.supplierId,lines:input.lines.length});return json({ok:true,code,id},201);}

async function handleOrderTransition(request,env,id){const session=await requireSession(env,request);await verifyCsrf(request,session);const tenant=session.activeMembership.tenant_id;const order=await getOrder(env,tenant,id);const input=normalizePurchaseTransition(await request.json().catch(()=>({})));if(!canTransitionPurchase(order.status,input.status))throw new Error('PURCHASE_TRANSITION_INVALID');if(input.status==='approved')assertPermission(session.activeMembership.role,'purchases.approve');else if(input.status==='ordered')assertPermission(session.activeMembership.role,'purchases.write');else if(input.status==='cancelled'){assertPermission(session.activeMembership.role,order.status==='draft'?'purchases.write':'purchases.approve');const received=await env.DB.prepare(`SELECT COALESCE(SUM(quantity_received),0) AS total FROM purchase_order_lines WHERE tenant_id=? AND purchase_order_id=?`).bind(tenant,id).first();if(Number(received?.total||0)>0)throw new Error('PURCHASE_RECEIVED_CANNOT_CANCEL');}
  const current=nowIso();const fields=['status = ?','updated_by = ?','updated_at = ?'];const values=[input.status,session.user_id,current];if(input.status==='approved'){fields.push('approved_by = ?','approved_at = ?');values.push(session.user_id,current);}if(input.status==='ordered'){fields.push('ordered_at = ?');values.push(current);}if(input.status==='cancelled'){fields.push('cancelled_at = ?');values.push(current);}values.push(id,tenant);await env.DB.prepare(`UPDATE purchase_orders SET ${fields.join(', ')} WHERE id=? AND tenant_id=?`).bind(...values).run();await recordAudit(env,request,session,'purchase.order.status','purchase_order',id,{fromStatus:order.status,toStatus:input.status,note:input.note});return json({ok:true,order:await getOrder(env,tenant,id)});}

async function handleReceiptCreate(request,env,orderId){const session=await requireSession(env,request);assertPermission(session.activeMembership.role,'purchases.receive');await verifyCsrf(request,session);const requestKey=cleanText(request.headers.get('Idempotency-Key'),200,{nullable:false});if(!requestKey||requestKey.length<8)throw new Error('IDEMPOTENCY_REQUIRED');const input=normalizeReceiptInput(await request.json().catch(()=>({})));const tenant=session.activeMembership.tenant_id;const existing=await env.DB.prepare(`SELECT id,code FROM purchase_receipts WHERE tenant_id=? AND request_key=?`).bind(tenant,requestKey).first();if(existing)return json({ok:true,replayed:true,receipt:existing});const order=await getOrder(env,tenant,orderId);if(!['ordered','partially_received'].includes(order.status))throw new Error('PURCHASE_RECEIPT_ORDER_INVALID');const location=await env.DB.prepare(`SELECT id FROM stock_locations WHERE tenant_id=? AND id=? AND status='active'`).bind(tenant,input.locationId).first();if(!location)throw new Error('PURCHASE_RECEIPT_LOCATION_INVALID');const lineIds=input.lines.map((line)=>line.lineId);const placeholders=lineIds.map(()=>'?').join(',');const rows=await env.DB.prepare(`SELECT id,item_id,quantity_ordered,quantity_received,unit_cost_cents FROM purchase_order_lines WHERE tenant_id=? AND purchase_order_id=? AND id IN (${placeholders})`).bind(tenant,orderId,...lineIds).all();const lineMap=new Map((rows.results||[]).map((line)=>[line.id,line]));if(lineMap.size!==lineIds.length)throw new Error('PURCHASE_RECEIPT_LINE_INVALID');for(const line of input.lines){const current=lineMap.get(line.lineId);if(line.quantity>Number(current.quantity_ordered)-Number(current.quantity_received)+0.000001)throw new Error('PURCHASE_RECEIPT_QUANTITY_INVALID');}
  const receiptId=crypto.randomUUID();const code=receiptCode(receiptId);const current=nowIso();const statements=[env.DB.prepare(`INSERT INTO purchase_receipts (id,tenant_id,purchase_order_id,location_id,code,request_key,notes,received_by,received_at) VALUES (?,?,?,?,?,?,?,?,?)`).bind(receiptId,tenant,orderId,input.locationId,code,requestKey,input.notes,session.user_id,current)];for(const line of input.lines){const source=lineMap.get(line.lineId);statements.push(env.DB.prepare(`INSERT INTO purchase_receipt_lines (id,tenant_id,receipt_id,purchase_order_line_id,item_id,quantity_received,unit_cost_cents) VALUES (?,?,?,?,?,?,?)`).bind(crypto.randomUUID(),tenant,receiptId,line.lineId,source.item_id,line.quantity,source.unit_cost_cents));}await env.DB.batch(statements);await recordAudit(env,request,session,'purchase.receipt.create','purchase_receipt',receiptId,{purchaseOrderId:orderId,locationId:input.locationId,lines:input.lines.length});return json({ok:true,receipt:{id:receiptId,code},order:await getOrder(env,tenant,orderId)},201);}

function routeId(pathname,entity){const match=pathname.match(new RegExp(`^/api/v1/purchases/${entity}/([^/]+)$`));return match?decodeURIComponent(match[1]):null;}
function orderAction(pathname){const match=pathname.match(/^\/api\/v1\/purchases\/orders\/([^/]+)\/(status|receipts)$/);return match?{id:decodeURIComponent(match[1]),action:match[2]}:null;}
export async function routePurchasingApi(request,env,pathname){
  if(pathname==='/api/v1/purchases/lookups'&&request.method==='GET')return handleLookups(request,env);
  if(pathname==='/api/v1/purchases/suppliers'&&request.method==='GET')return handleSupplierList(request,env);
  if(pathname==='/api/v1/purchases/suppliers'&&request.method==='POST')return handleSupplierCreate(request,env);
  const supplierId=routeId(pathname,'suppliers');if(supplierId&&request.method==='PATCH')return handleSupplierUpdate(request,env,supplierId);
  if(pathname==='/api/v1/purchases/orders'&&request.method==='GET')return handleOrderList(request,env);
  if(pathname==='/api/v1/purchases/orders'&&request.method==='POST')return handleOrderCreate(request,env);
  const orderId=routeId(pathname,'orders');if(orderId&&request.method==='GET')return handleOrderDetail(request,env,orderId);
  const action=orderAction(pathname);if(action?.action==='status'&&request.method==='POST')return handleOrderTransition(request,env,action.id);if(action?.action==='receipts'&&request.method==='POST')return handleReceiptCreate(request,env,action.id);
  return null;
}

export function purchasingErrorResponse(error){const code=error instanceof Error?error.message:'UNKNOWN';
  if(code.includes('PURCHASE_RECEIPT_QUANTITY_INVALID'))return json({ok:false,code:'PURCHASE_RECEIPT_QUANTITY_INVALID',message:'A quantidade recebida excede o saldo pendente do pedido.'},409);
  if(code.includes('PURCHASE_SUPPLIER_INVALID'))return json({ok:false,code:'PURCHASE_SUPPLIER_INVALID',message:'O fornecedor está inativo ou não pertence a esta empresa.'},409);
  if(code.includes('PURCHASE_ITEM_INVALID'))return json({ok:false,code:'PURCHASE_ITEM_INVALID',message:'Um dos materiais está inativo ou não pertence a esta empresa.'},409);
  if(/UNIQUE constraint failed: suppliers\.tenant_id, suppliers\.document/i.test(code))return json({ok:false,code:'PURCHASE_SUPPLIER_DOCUMENT_CONFLICT',message:'Já existe fornecedor ativo com este documento.'},409);
  const mapping={AUTH_REQUIRED:[401,'Sessão expirada ou inexistente.'],AUTH_FORBIDDEN:[403,'Você não possui permissão para esta ação.'],AUTH_CSRF:[403,'A validação de segurança falhou.'],API_VALIDATION:[400,'Os dados enviados são inválidos.'],IDEMPOTENCY_REQUIRED:[400,'O recebimento precisa de chave idempotente.'],PURCHASE_SUPPLIER_NAME_REQUIRED:[400,'Informe o nome do fornecedor.'],PURCHASE_SUPPLIER_EMAIL_INVALID:[400,'O e-mail do fornecedor é inválido.'],PURCHASE_STATUS_INVALID:[400,'O status informado é inválido.'],PURCHASE_DATE_INVALID:[400,'A data informada é inválida.'],PURCHASE_SUPPLIER_REQUIRED:[400,'Selecione o fornecedor.'],PURCHASE_LINES_REQUIRED:[400,'Inclua ao menos um item no pedido.'],PURCHASE_LINE_INVALID:[400,'Uma linha do pedido é inválida.'],PURCHASE_LINE_DUPLICATE_ITEM:[400,'Não repita o mesmo item no pedido.'],PURCHASE_SUPPLIER_NOT_FOUND:[404,'Fornecedor não encontrado nesta empresa.'],PURCHASE_ORDER_NOT_FOUND:[404,'Pedido de compra não encontrado nesta empresa.'],PURCHASE_TRANSITION_INVALID:[409,'Esta mudança de status do pedido não é permitida.'],PURCHASE_RECEIVED_CANNOT_CANCEL:[409,'Pedido com recebimento não pode ser cancelado.'],PURCHASE_RECEIPT_LOCATION_REQUIRED:[400,'Selecione o local de recebimento.'],PURCHASE_RECEIPT_LINES_REQUIRED:[400,'Informe as quantidades recebidas.'],PURCHASE_RECEIPT_LINE_DUPLICATE:[400,'Uma linha foi repetida no recebimento.'],PURCHASE_RECEIPT_LINE_INVALID:[400,'Uma linha não pertence a este pedido.'],PURCHASE_RECEIPT_ORDER_INVALID:[409,'O pedido não está disponível para recebimento.'],PURCHASE_RECEIPT_LOCATION_INVALID:[409,'O local de estoque não está disponível.']};const [status,message]=mapping[code]||[500,'Não foi possível concluir a operação de compras.'];return json({ok:false,code,message},status);}
