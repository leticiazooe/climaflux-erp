# Fase 1 — Fundação SaaS do ClimaFlux ERP

## Objetivo

Transformar o protótipo em uma base SaaS com identidade real, isolamento multiempresa, persistência no servidor e autorização no backend. A migração é incremental para preservar o ERP atual até cada domínio passar por testes.

## Entregue

### Autenticação e sessão

- Google Identity Services com validação RS256 no Cloudflare Worker.
- Verificações de `aud`, `azp`, `iss`, `exp`, `iat`, nonce, e-mail verificado e domínio permitido.
- Sessões revogáveis no D1; somente hash do token é armazenado.
- Cookie `__Host-climaflux_session` com `Secure`, `HttpOnly`, `SameSite=Lax` e `Path=/`.
- Expiração absoluta e por inatividade.
- Logout revogável, CSRF, validação de origem e rate limiting.

### Multiempresa e equipe

- `tenants`, `users`, `memberships`, `tenant_invites` e troca de tenant ativo.
- Convite por e-mail aceito no primeiro login Google correspondente.
- Perfis por tenant.
- Suspensão revoga sessões do vínculo.
- Último administrador ativo é protegido.
- Criação de tenant opcional e restrita a administrador.

### Auditoria e operação

- `audit_log` tenant-scoped.
- `auth_events` para segurança.
- IP persistido somente como hash.
- health check e schema versionado.
- idempotency keys com expiração.
- observabilidade do Worker habilitada.

## Domínios migrados para D1

### 1. Clientes

Tabela `customers` e rotas `/api/v1/customers`.

- pesquisa e paginação;
- código/documento únicos por tenant;
- criação idempotente;
- edição e exclusão lógica;
- auditoria;
- tenant obtido exclusivamente da sessão.

Interface: `/customers-saas.html`.

### 2. Equipamentos

Migration `0002_operational_core.sql`, tabela `equipment`.

- cliente proprietário obrigatório;
- código único por tenant;
- série única por tenant quando informada;
- marca, modelo, patrimônio, BTU, refrigerante e localização;
- status ativo, inativo ou baixado;
- criação idempotente;
- edição e exclusão lógica;
- exclusão bloqueada se houver OS não terminal;
- FK composta `(tenant_id, customer_id)`.

Interface: `/equipment-saas.html`.

### 3. Ordens de Serviço e histórico

Tabelas `work_orders` e `work_order_events`.

- cliente obrigatório;
- equipamento opcional, mas obrigatoriamente do mesmo cliente/tenant;
- técnico precisa possuir vínculo `tecnico` ativo no mesmo tenant;
- prioridade, agenda e prazo de SLA;
- criação idempotente;
- edição tenant-scoped;
- máquina de estados explícita;
- resolução obrigatória na conclusão;
- motivo obrigatório para pausa/cancelamento;
- exclusão lógica apenas em `draft`/`cancelled`;
- histórico de criação, edição, atribuição, status e exclusão;
- histórico sem endpoint de alteração e com trigger contra `UPDATE`;
- técnico lista somente OS atribuídas ao próprio `user_id`.

Interface: `/work-orders-saas.html`.

## Máquina de estados da OS

```text
draft       -> open | cancelled
open        -> scheduled | in_progress | cancelled
scheduled   -> in_progress | on_hold | cancelled
in_progress -> on_hold | completed | cancelled
on_hold     -> scheduled | in_progress | completed | cancelled
completed   -> terminal
cancelled   -> terminal
```

Técnicos podem transicionar somente as próprias ordens e não podem cancelar nem reagendar pelo endpoint de transição.

## RBAC operacional

| Perfil | Clientes | Equipamentos | Ordens |
|---|---|---|---|
| admin | total | total | total |
| gestor | leitura/escrita/exclusão | leitura/escrita/exclusão | leitura/escrita/atribuição/transição/exclusão |
| atendimento | leitura/escrita | leitura/escrita | leitura/escrita/atribuição/transição |
| tecnico | leitura | leitura | próprias OS + transição controlada |
| estoque | leitura | leitura | leitura |
| financeiro | leitura | leitura | leitura |

O Worker é a fonte de autoridade. A interface apenas adapta os controles visíveis.

## Arquitetura atual

```text
Navegador
  ├── Google Identity Services
  └── telas SaaS
        │
        ▼
worker/saas-worker.js
  ├── APIs Equipamentos/OS
  └── worker/index.js
       ├── autenticação
       ├── tenant/RBAC
       ├── clientes/equipe/auditoria
       └── static assets protegidos
             │
             ├── D1
             └── Cloudflare Static Assets
```

## APIs operacionais

### Equipamentos

- `GET /api/v1/equipment`
- `POST /api/v1/equipment`
- `PATCH /api/v1/equipment/:id`
- `DELETE /api/v1/equipment/:id`

### Ordens

- `GET /api/v1/work-orders`
- `POST /api/v1/work-orders`
- `PATCH /api/v1/work-orders/:id`
- `DELETE /api/v1/work-orders/:id`
- `POST /api/v1/work-orders/:id/status`
- `GET /api/v1/work-orders/:id/history`
- `GET /api/v1/work-orders/lookups`

## Validação atual

O pipeline executa:

- `npm ci` com lockfile;
- auditoria de dependências de runtime;
- syntax check de Workers e clientes;
- testes de autenticação/RBAC;
- testes da migration operacional;
- testes da máquina de estados;
- testes de tenant isolation;
- build do release;
- validação de 20 assets protegidos.

## Ativação externa obrigatória

1. Criar OAuth Client ID Web no Google Cloud.
2. Autorizar localhost, homologação e domínio final.
3. Criar D1 `climaflux-saas`.
4. Substituir `REPLACE_WITH_D1_DATABASE_ID`.
5. Configurar secrets diretamente no Cloudflare:
   - `GOOGLE_CLIENT_ID`;
   - `SESSION_SECRET`;
   - `BOOTSTRAP_ADMIN_EMAILS`.
6. Aplicar migrations 0001 e 0002.
7. Implantar em homologação.

Não enviar `SESSION_SECRET` por chat, commit, issue ou log.

## Critérios antes do merge/deploy

- [ ] D1 de homologação criado.
- [ ] ID real configurado.
- [ ] migrations 0001 e 0002 aplicadas.
- [ ] secrets configurados.
- [ ] origem Google autorizada.
- [ ] primeiro administrador autenticado.
- [ ] convite de segundo usuário testado.
- [ ] duas empresas testadas.
- [ ] cliente criado em cada empresa.
- [ ] equipamento criado em cada empresa.
- [ ] OS criada em cada empresa.
- [ ] tentativa de referência cruzada cliente/equipamento recusada.
- [ ] técnico enxerga somente sua OS.
- [ ] histórico de transições validado.
- [ ] suspensão e revogação de sessão testadas.
- [ ] backup/restauração do D1 testado.
- [ ] URL de homologação e logs do Cloudflare validados.

## Ainda local no protótipo

- agenda e operação de campo detalhada;
- contratos;
- orçamentos;
- vendas;
- estoque;
- compras;
- financeiro;
- despacho avançado e motor oficial de SLA;
- fotos, anexos e assinaturas;
- portal do cliente.

## Próxima ordem de migração

1. Técnicos, agenda e operação de campo.
2. Estoque e movimentações transacionais.
3. Compras e vendas.
4. Financeiro.
5. Contratos e motor oficial de SLA.
6. R2 para fotos, anexos e assinaturas.
7. Portal real do cliente.

D1 continua adequado para o beta controlado. Antes da expansão, medir concorrência e volume transacional para decidir se o domínio operacional permanece em D1 ou migra para PostgreSQL.
