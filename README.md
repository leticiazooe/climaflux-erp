# ClimaFlux ERP

Candidato **v0.7.0 — Fundação SaaS** para empresas de assistência técnica em ar-condicionado e refrigeração.

> **ClimaFlux ERP** ainda é um nome provisório. A disponibilidade jurídica e comercial da marca precisa ser validada antes da venda.

## Fase 1 — estado atual

A v0.7.0 migra o protótipo para uma arquitetura SaaS real:

- Cloudflare Worker executado antes dos assets;
- Google Identity Services com validação do ID token no servidor;
- sessões revogáveis em cookie `Secure`, `HttpOnly` e `SameSite=Lax`;
- Cloudflare D1 com migrations versionadas;
- empresas reais (`tenants`) e vínculos de usuários;
- convites, RBAC e auditoria no backend;
- CSRF, nonce, validação de origem e rate limiting;
- health check em `/api/health`;
- idempotência nas criações operacionais;
- service worker sem cache de APIs ou conteúdo autenticado.

### Módulos já migrados para API + D1

1. **Clientes** — `/customers-saas.html`
2. **Equipamentos** — `/equipment-saas.html`
3. **Ordens de Serviço + histórico** — `/work-orders-saas.html`
4. **Agenda e operação de campo** — `/field-service-saas.html`

As telas antigas continuam no shell do protótipo enquanto cada domínio é migrado. Para os domínios acima, as telas `*-saas.html` usam o backend como fonte de verdade.

## Multiempresa e segurança

Toda operação de negócio usa o `tenant_id` derivado da sessão autenticada. Os endpoints não aceitam `tenantId` do navegador como autoridade.

O banco reforça os relacionamentos por tenant:

- Cliente → Equipamento;
- Cliente → Ordem de Serviço;
- Equipamento → Ordem de Serviço;
- Ordem de Serviço → Histórico;
- Ordem de Serviço → Visita técnica;
- Visita → Checklist, medições e eventos.

Uma OS não pode usar equipamento de outro cliente. Equipamentos com histórico de OS não podem ser transferidos silenciosamente para outro cliente. Uma OS com visita ativa não pode trocar de técnico nem ser encerrada até a visita ser concluída ou cancelada.

## Perfis operacionais

- `admin`: acesso total;
- `gestor`: gestão completa da operação e auditoria;
- `atendimento`: clientes, equipamentos, ordens, atribuição e planejamento das visitas;
- `tecnico`: leitura necessária, próprias OS, própria agenda, status, checklist e medições;
- `estoque`: leitura de clientes/equipamentos/ordens;
- `financeiro`: leitura de clientes/equipamentos/ordens.

O técnico recebe filtros obrigatórios por `user_id` no servidor para OS e visitas. Os endpoints auxiliares também removem dados de outros técnicos antes da resposta.

## Equipamentos SaaS

`/equipment-saas.html` oferece vínculo com cliente, identificação técnica, localização, status, pesquisa, criação idempotente, edição, exclusão lógica e auditoria. Série e patrimônio ativos são únicos por tenant.

## Ordens de Serviço SaaS

`/work-orders-saas.html` oferece cliente/equipamento vinculados, técnico ativo, prioridade, agenda, prazo de SLA, fluxo de status controlado, resolução obrigatória na conclusão, motivo de pausa/cancelamento e histórico imutável.

Fluxo permitido:

```text
draft       -> open | cancelled
open        -> scheduled | in_progress | cancelled
scheduled   -> in_progress | on_hold | cancelled
in_progress -> on_hold | completed | cancelled
on_hold     -> scheduled | in_progress | completed | cancelled
completed   -> terminal
cancelled   -> terminal
```

## Agenda e operação de campo

`/field-service-saas.html` conecta a agenda diretamente à OS atribuída ao técnico.

Fluxo da visita:

```text
planned  -> en_route | on_site | cancelled
en_route -> on_site | cancelled
on_site  -> completed | cancelled
completed/cancelled -> terminal
```

Controles implementados:

- visita somente para OS aberta e já atribuída a um técnico ativo;
- técnico vê apenas a própria agenda;
- atendimento/gestão planejam e alteram horário;
- chegada e saída registradas pelo fluxo de status;
- checklist padrão persistido no D1;
- item `not_ok` exige observação;
- visita não conclui com checklist pendente;
- medições técnicas persistidas no D1;
- histórico da visita protegido contra `UPDATE` e `DELETE`;
- fotos, anexos e assinatura ficam para a etapa R2.

## Banco de dados

- `0001_saas_foundation.sql`: identidade, tenants, sessões, clientes, auditoria e idempotência;
- `0002_operational_core.sql`: equipamentos, ordens e histórico;
- `0003_field_service.sql`: visitas, checklist, medições e histórico de campo;
- `0004_field_service_integrity.sql`: bloqueio de encerramento de OS com visita ativa.

## API

### Identidade e tenant

- `GET /api/health`
- `GET /api/auth/config`
- `POST /api/auth/google`
- `GET /api/v1/me`
- `POST /api/auth/logout`
- `GET|POST /api/v1/tenants`
- `POST /api/v1/tenant/switch`

### Clientes

- `GET|POST /api/v1/customers`
- `PATCH|DELETE /api/v1/customers/:id`

### Equipamentos

- `GET|POST /api/v1/equipment`
- `PATCH|DELETE /api/v1/equipment/:id`

### Ordens de Serviço

- `GET|POST /api/v1/work-orders`
- `PATCH|DELETE /api/v1/work-orders/:id`
- `POST /api/v1/work-orders/:id/status`
- `GET /api/v1/work-orders/:id/history`
- `GET /api/v1/work-orders/lookups`

### Operação de campo

- `GET /api/v1/field/lookups`
- `GET|POST /api/v1/field/visits`
- `GET|PATCH /api/v1/field/visits/:id`
- `POST /api/v1/field/visits/:id/status`
- `PUT /api/v1/field/visits/:id/checklist`
- `POST /api/v1/field/visits/:id/measurements`

### Administração

- `GET /api/v1/admin/members`
- `POST /api/v1/admin/invites`
- `PATCH /api/v1/admin/members/:userId`
- `DELETE /api/v1/admin/invites/:inviteId`
- `GET /api/v1/audit`

## Desenvolvimento

```bash
npm ci
npm run validate
npm run dev
```

Para criar e migrar o D1:

```bash
npm run db:create
npm run db:migrate:local
npm run db:migrate
```

Secrets obrigatórios:

```bash
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put SESSION_SECRET
npx wrangler secret put BOOTSTRAP_ADMIN_EMAILS
```

Nunca versione nem envie `SESSION_SECRET` por chat, issue ou log.

## Validação automatizada

O quality gate executa `npm ci`, auditoria de runtime, syntax check, testes de autenticação/RBAC/tenant isolation/workflows, build verificado e validação de **22 assets protegidos**.

## Publicação

O deploy da v0.7.0 **não deve ser feito ainda** até:

- criar o D1 real e substituir `REPLACE_WITH_D1_DATABASE_ID`;
- aplicar migrations 0001–0004;
- configurar os secrets;
- cadastrar a origem final no Google Cloud;
- testar duas empresas em homologação;
- confirmar isolamento de clientes, equipamentos, OS e visitas;
- testar backup/restauração do D1.

## Ainda no armazenamento local

- contratos;
- orçamentos;
- vendas;
- estoque e movimentações;
- compras;
- financeiro;
- despacho avançado e motor oficial de SLA;
- fotos, anexos e assinaturas;
- portal do cliente.

Próxima sequência: **estoque transacional → compras/vendas → financeiro → contratos/SLA → R2/anexos → portal real do cliente**.

Consulte `docs/PHASE_1_SAAS.md` para os critérios de ativação.
