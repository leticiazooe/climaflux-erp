# ClimaFlux ERP

Candidato **v0.7.0 — Fundação SaaS** para empresas de assistência técnica em ar-condicionado e refrigeração.

> **ClimaFlux ERP** ainda é um nome provisório. A disponibilidade jurídica e comercial da marca precisa ser validada antes da venda.

## Fase 1 — estado atual

A v0.7.0 migra a base do protótipo para uma arquitetura SaaS real:

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

As telas antigas continuam no shell do protótipo enquanto a migração é validada. As telas `*-saas.html` são a fonte de verdade para os módulos já migrados.

## Multiempresa e segurança

Toda operação de negócio usa o `tenant_id` derivado da sessão autenticada. Os endpoints operacionais não aceitam `tenantId` do navegador como autoridade.

O banco também reforça relacionamentos compostos por tenant:

- Cliente → Equipamento;
- Cliente → Ordem de Serviço;
- Equipamento → Ordem de Serviço;
- Ordem de Serviço → Histórico.

Uma OS não pode apontar para um equipamento pertencente a outro cliente ou tenant.

## Perfis operacionais

- `admin`: acesso total;
- `gestor`: clientes, equipamentos, ordens, exclusões, equipe e auditoria;
- `atendimento`: clientes, equipamentos e gestão operacional das ordens;
- `tecnico`: leitura de clientes/equipamentos e fluxo das próprias ordens atribuídas;
- `estoque`: leitura de clientes, equipamentos e ordens;
- `financeiro`: leitura de clientes, equipamentos e ordens.

O técnico recebe filtro obrigatório por `technician_user_id` no servidor. Esconder botões no front-end nunca substitui a autorização do Worker.

## Equipamentos SaaS

`/equipment-saas.html` oferece:

- vínculo obrigatório com cliente;
- marca, modelo, série, patrimônio, capacidade, refrigerante e localização;
- status ativo/inativo/baixado;
- pesquisa e filtros;
- criação idempotente;
- edição tenant-scoped;
- exclusão lógica;
- bloqueio de exclusão enquanto houver OS aberta;
- auditoria.

## Ordens de Serviço SaaS

`/work-orders-saas.html` oferece:

- cliente e equipamento vinculados;
- técnico atribuído com vínculo ativo no mesmo tenant;
- tipo de serviço, título, descrição e prioridade;
- agenda e prazo de SLA;
- fluxo de status controlado;
- conclusão com resolução obrigatória;
- motivo obrigatório para pausa/cancelamento;
- exclusão lógica restrita a rascunho/cancelada;
- ordenação por criticidade e prazo;
- histórico de eventos imutável na aplicação.

Fluxo inicial permitido:

`draft → open/cancelled`

`open → scheduled/in_progress/cancelled`

`scheduled → in_progress/on_hold/cancelled`

`in_progress → on_hold/completed/cancelled`

`on_hold → scheduled/in_progress/completed/cancelled`

Ordens concluídas ou canceladas são terminais nesta primeira versão.

## Banco de dados

- `migrations/0001_saas_foundation.sql`: identidade, tenants, sessões, clientes, auditoria e idempotência.
- `migrations/0002_operational_core.sql`: equipamentos, ordens de serviço e histórico operacional.

O schema operacional inclui índices por tenant, FKs compostas e trigger para impedir associação equipamento/cliente inconsistente.

## API

### Identidade e tenant

- `GET /api/health`
- `GET /api/auth/config`
- `POST /api/auth/google`
- `GET /api/v1/me`
- `POST /api/auth/logout`
- `GET /api/v1/tenants`
- `POST /api/v1/tenants`
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

O quality gate executa:

1. `npm ci` com lockfile;
2. auditoria das dependências de runtime;
3. verificação de sintaxe;
4. testes de autenticação, RBAC, tenant isolation, schema e fluxo operacional;
5. build verificado;
6. validação de **20 assets protegidos**.

## Publicação

```bash
npm run deploy
```

O deploy da v0.7.0 **não deve ser feito ainda** até:

- criar o D1 real;
- substituir `REPLACE_WITH_D1_DATABASE_ID`;
- aplicar migrations 0001 e 0002;
- configurar secrets;
- cadastrar a origem final no Google Cloud;
- testar duas empresas em homologação;
- confirmar isolamento de clientes, equipamentos e OS;
- testar backup/restauração do D1.

## Ainda no armazenamento local

- agenda e operação de campo completa;
- contratos;
- orçamentos;
- vendas;
- estoque e movimentações;
- compras;
- financeiro;
- despacho avançado e motor oficial de SLA;
- anexos, fotos e assinaturas;
- portal do cliente.

Próxima sequência: **agenda/técnicos → estoque → compras/vendas/financeiro → contratos/SLA → R2/anexos → portal real do cliente**.

Consulte `docs/PHASE_1_SAAS.md` para os critérios de ativação.
