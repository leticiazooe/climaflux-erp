# Fase 1 — Fundação SaaS do ClimaFlux ERP

## Objetivo

Transformar o protótipo em uma base SaaS com identidade real, isolamento multiempresa, persistência no servidor e autorização no backend. A migração é incremental para preservar o ERP atual até cada domínio passar por testes.

## Plataforma entregue

- Google Identity Services validado no Cloudflare Worker.
- Sessões revogáveis no D1; somente hashes dos tokens são persistidos.
- Cookie `__Host-climaflux_session` com `Secure`, `HttpOnly` e `SameSite=Lax`.
- CSRF, nonce, origem, rate limiting e expiração absoluta/por inatividade.
- `tenants`, `users`, `memberships`, convites e troca de empresa.
- RBAC no servidor, proteção do último administrador e auditoria tenant-scoped.
- Health check, observabilidade, migrations e idempotência.
- Worker-first e service worker sem cache de APIs ou conteúdo autenticado.

## Domínios migrados para API + D1

### 1. Clientes

`customers` e `/customers-saas.html`:

- pesquisa, paginação e validação;
- código/documento únicos por tenant;
- criação idempotente;
- edição e exclusão lógica;
- auditoria;
- `tenant_id` sempre derivado da sessão.

### 2. Equipamentos

`equipment` e `/equipment-saas.html`:

- cliente proprietário obrigatório;
- identificação técnica, patrimônio, capacidade, refrigerante e localização;
- série/patrimônio ativos únicos por tenant;
- FK composta cliente/tenant;
- equipamento com histórico de OS não pode ser transferido silenciosamente para outro cliente.

### 3. Ordens de Serviço

`work_orders`, `work_order_events` e `/work-orders-saas.html`:

- cliente, equipamento e técnico validados no tenant;
- prioridade, agenda e SLA;
- máquina de estados explícita;
- conclusão exige resolução;
- pausa/cancelamento exigem motivo;
- técnico vê somente próprias OS;
- histórico imutável por triggers;
- OS com visita ativa não troca de técnico nem encerra.

### 4. Agenda e operação de campo

`service_visits`, `visit_checklist_items`, `visit_measurements`, `service_visit_events` e `/field-service-saas.html`:

- visita nasce de OS já atribuída ao técnico;
- técnico vê somente a própria agenda;
- planejamento por atendimento/gestão;
- fluxo `planned → en_route → on_site → completed` com cancelamento controlado;
- chegada e saída registradas pelo fluxo;
- checklist padrão persistido;
- item não conforme exige observação;
- visita não conclui com checklist pendente;
- medições persistidas no D1;
- eventos imutáveis.

Fotos, anexos e assinatura digital permanecem reservados para R2.

### 5. Estoque transacional

`stock_locations`, `stock_items`, `stock_balances`, `stock_movements` e `/inventory-saas.html`:

- locais físicos de estoque por tenant;
- catálogo de materiais com SKU, unidade, mínimo e custo de referência;
- saldos por item/local;
- livro de movimentações somente acréscimo;
- saldo nunca é editado diretamente pela API;
- trigger aplica cada movimento ao saldo;
- saída que produziria saldo negativo é recusada pelo D1;
- saldo inicial só pode ser registrado uma vez por item/local;
- consumo/devolução de OS exigem referência válida;
- devolução de OS não pode exceder o material líquido consumido;
- técnico só consome/devolve material das próprias OS;
- movimentações recebem chave idempotente por tenant;
- ajustes ficam restritos a perfis autorizados.

## Migrations

- `0001_saas_foundation.sql`: identidade, tenants, sessões, clientes, auditoria e idempotência.
- `0002_operational_core.sql`: equipamentos, ordens e histórico.
- `0003_field_service.sql`: visitas, checklist, medições e histórico de campo.
- `0004_field_service_integrity.sql`: consistência entre visita ativa e ciclo da OS.
- `0005_inventory.sql`: itens, locais, saldos, ledger e triggers de saldo.
- `0006_inventory_integrity.sql`: saldo inicial único, consumo de OS e limite de devolução.

## APIs principais

### Identidade

- `GET /api/health`
- `GET /api/auth/config`
- `POST /api/auth/google`
- `GET /api/v1/me`
- `POST /api/auth/logout`
- `GET|POST /api/v1/tenants`
- `POST /api/v1/tenant/switch`

### Operação

- `GET|POST /api/v1/customers`
- `PATCH|DELETE /api/v1/customers/:id`
- `GET|POST /api/v1/equipment`
- `PATCH|DELETE /api/v1/equipment/:id`
- `GET|POST /api/v1/work-orders`
- `PATCH|DELETE /api/v1/work-orders/:id`
- `POST /api/v1/work-orders/:id/status`
- `GET /api/v1/work-orders/:id/history`

### Campo

- `GET /api/v1/field/lookups`
- `GET|POST /api/v1/field/visits`
- `GET|PATCH /api/v1/field/visits/:id`
- `POST /api/v1/field/visits/:id/status`
- `PUT /api/v1/field/visits/:id/checklist`
- `POST /api/v1/field/visits/:id/measurements`

### Estoque

- `GET|POST /api/v1/inventory/items`
- `PATCH /api/v1/inventory/items/:id`
- `GET|POST /api/v1/inventory/locations`
- `PATCH /api/v1/inventory/locations/:id`
- `GET /api/v1/inventory/balances`
- `GET|POST /api/v1/inventory/movements`

## Segurança multiempresa

A autoridade do tenant sempre vem da sessão. As APIs de negócio não aceitam `tenantId` do corpo ou query como fonte de autorização. FKs compostas, índices por tenant e triggers reforçam o isolamento também no banco.

## Ativação externa obrigatória

1. Criar OAuth Client ID Web no Google Cloud.
2. Autorizar localhost, homologação e domínio final.
3. Criar D1 `climaflux-saas`.
4. Substituir `REPLACE_WITH_D1_DATABASE_ID`.
5. Configurar diretamente no Cloudflare:
   - `GOOGLE_CLIENT_ID`;
   - `SESSION_SECRET`;
   - `BOOTSTRAP_ADMIN_EMAILS`.
6. Aplicar migrations 0001–0006.
7. Implantar em homologação.
8. Testar duas empresas, perfis, agenda e estoque antes do merge.

Não enviar `SESSION_SECRET` por chat, commit, issue ou log.

## Critérios antes do merge/deploy

- [ ] D1 de homologação criado e ID real configurado.
- [ ] migrations 0001–0006 aplicadas remotamente.
- [ ] secrets configurados e origem Google autorizada.
- [ ] primeiro administrador e convite de segundo usuário testados.
- [ ] duas empresas validadas sem vazamento cruzado.
- [ ] cliente, equipamento e OS criados em cada empresa.
- [ ] técnico enxerga somente suas OS e visitas.
- [ ] checklist, medições e transições testados.
- [ ] item/local de estoque criados em cada empresa.
- [ ] entrada, saída, consumo e devolução de OS testados.
- [ ] tentativa de saldo negativo recusada.
- [ ] tentativa de devolução acima do consumido recusada.
- [ ] idempotência de movimentação testada.
- [ ] suspensão e revogação de sessão testadas.
- [ ] backup/restauração do D1 testado.
- [ ] URL e logs do Cloudflare de homologação validados.

## Ainda local no protótipo

- contratos;
- orçamentos;
- compras;
- vendas;
- financeiro;
- despacho avançado e motor oficial de SLA;
- fotos, anexos e assinaturas;
- portal do cliente.

## Próxima ordem de migração

1. Compras e recebimento integrado ao estoque.
2. Vendas e baixa integrada ao estoque.
3. Financeiro.
4. Contratos e motor oficial de SLA.
5. R2 para fotos, anexos e assinaturas.
6. Portal real do cliente.

D1 continua sendo usado no beta controlado. Antes de ampliar a operação, medir concorrência, volume transacional e relatórios para decidir se algum domínio deve migrar para PostgreSQL.
