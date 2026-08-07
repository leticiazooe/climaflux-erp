# ClimaFlux ERP

Candidato **v0.7.0 — Fundação SaaS** para empresas de assistência técnica em ar-condicionado e refrigeração.

> **ClimaFlux ERP** ainda é um nome provisório. A disponibilidade jurídica e comercial da marca precisa ser validada antes da venda.

## O que mudou na Fase 1

A versão v0.6.2 usava sessão, usuários e dados multiempresa simulados no navegador. A v0.7.0 inicia a migração para uma arquitetura SaaS real:

- Cloudflare Worker executado antes de todos os assets;
- login com Google Identity Services;
- validação criptográfica do ID token no servidor;
- sessões revogáveis com cookie `Secure`, `HttpOnly` e `SameSite=Lax`;
- Cloudflare D1 com migrations versionadas;
- empresas reais (`tenants`) e vínculos de usuário por empresa;
- convites por e-mail que são aceitos no primeiro login Google correspondente;
- RBAC aplicado no servidor;
- auditoria por tenant, usuário, recurso e ação;
- health check em `/api/health`;
- criação e troca de empresa;
- proteção contra CSRF e excesso de tentativas de login;
- idempotência para criação de clientes;
- primeiro módulo real no backend: **Clientes SaaS**;
- service worker impedido de armazenar APIs ou conteúdo autenticado.

## Primeiro módulo migrado

A rota protegida `/customers-saas.html` usa exclusivamente a API e o D1 para:

- listar e pesquisar clientes;
- filtrar por status;
- criar clientes;
- editar clientes;
- fazer exclusão lógica;
- respeitar o perfil do usuário;
- registrar auditoria;
- isolar todas as operações pela empresa ativa da sessão.

O módulo antigo de clientes do protótipo ainda existe dentro do ERP. A nova tela é a prova funcional da arquitetura que substituirá gradualmente os módulos locais.

## Gestão de empresas e acessos

A rota `/admin-access.html` permite ao administrador da empresa ativa:

- criar convite para uma conta Google;
- escolher o perfil inicial;
- consultar membros;
- alterar perfil e status;
- suspender o acesso e revogar sessões do vínculo;
- cancelar convites pendentes.

O backend impede que o último administrador ativo da empresa seja removido.

## Perfis e permissões iniciais

- `admin`: acesso total;
- `gestor`: clientes, auditoria e leitura da equipe;
- `atendimento`: leitura e escrita de clientes;
- `tecnico`: leitura de clientes;
- `estoque`: leitura de clientes;
- `financeiro`: leitura de clientes.

As permissões são verificadas no Worker. Esconder um botão no front-end não é usado como controle de segurança.

## Banco de dados

A migration `migrations/0001_saas_foundation.sql` cria:

- `tenants`;
- `users`;
- `memberships`;
- `tenant_invites`;
- `sessions`;
- `customers`;
- `audit_log`;
- `auth_events`;
- `idempotency_keys`;
- `schema_metadata`.

As tabelas de negócio e administração carregam `tenant_id`, com índices e unicidade no escopo da empresa.

## Configuração local

### 1. Instalar dependências

```bash
npm install
```

### 2. Criar o banco D1

```bash
npm run db:create
```

Copie o `database_id` retornado para `wrangler.jsonc`, substituindo `REPLACE_WITH_D1_DATABASE_ID`.

### 3. Aplicar as migrations

```bash
npm run db:migrate:local
npm run db:migrate
```

### 4. Configurar secrets

```bash
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put SESSION_SECRET
npx wrangler secret put BOOTSTRAP_ADMIN_EMAILS
```

- `GOOGLE_CLIENT_ID`: Client ID OAuth Web do Google;
- `SESSION_SECRET`: valor aleatório forte, mantido apenas no Cloudflare;
- `BOOTSTRAP_ADMIN_EMAILS`: e-mails que podem criar o primeiro vínculo administrativo, separados por vírgula.

Secret opcional:

```bash
npx wrangler secret put ALLOWED_GOOGLE_EMAILS
```

Variáveis opcionais no `wrangler.jsonc`:

- `ALLOWED_GOOGLE_DOMAINS`;
- `AUTO_PROVISION_ROLE`;
- `ENABLE_TENANT_CREATION`;
- `DEFAULT_TENANT_NAME`;
- `DEFAULT_APP_COMPANY_KEY`;
- `BOOTSTRAP_APP_USER_KEY`;
- tempos de sessão e convite.

### 5. Executar pelo Worker

```bash
npm run dev
```

O servidor estático simples não reproduz autenticação, D1 ou proteção dos assets. Para testar a Fase 1 use `wrangler dev` por meio do comando acima.

## Validação

```bash
npm run validate
```

O comando executa:

1. verificação de sintaxe;
2. testes de autenticação, RBAC, schema, tenant isolation e roteamento;
3. reconstrução do release público;
4. validação dos assets protegidos.

## API da Fase 1

### Públicas

- `GET /api/health`
- `GET /api/auth/config`
- `POST /api/auth/google`

### Sessão e empresas

- `GET /api/v1/me`
- `POST /api/auth/logout`
- `GET /api/v1/tenants`
- `POST /api/v1/tenants`
- `POST /api/v1/tenant/switch`

### Clientes

- `GET /api/v1/customers`
- `POST /api/v1/customers`
- `PATCH /api/v1/customers/:id`
- `DELETE /api/v1/customers/:id`

### Administração

- `GET /api/v1/admin/members`
- `POST /api/v1/admin/invites`
- `PATCH /api/v1/admin/members/:userId`
- `DELETE /api/v1/admin/invites/:inviteId`
- `GET /api/v1/audit`

## Build público

O build mantém a integridade do pacote-base v0.6.0 e instala a camada SaaS sobre ele.

SHA-256 do pacote-base:

```text
276dc082e046d202aeab91b807ee3bba9b20a403eba0187163f14e107b3750a5
```

## Publicação

```bash
npm run deploy
```

O deploy só deve ser executado depois de:

- criar o D1;
- substituir o ID do banco;
- aplicar migrations;
- configurar os secrets;
- cadastrar a origem final no Google Cloud;
- validar login, logout, troca de empresa e isolamento em homologação.

## O que ainda não foi migrado

A Fase 1 está iniciada, mas o ERP inteiro ainda não é SaaS. Estes módulos continuam no armazenamento local do protótipo:

- ordens de serviço;
- equipamentos;
- agenda e operação de campo;
- contratos;
- orçamentos;
- vendas;
- estoque;
- compras;
- financeiro;
- despacho e cálculo oficial de SLA;
- portal do cliente.

A próxima sequência recomendada é: **ordens de serviço → equipamentos → estoque → financeiro → anexos/R2 → portal do cliente**.

Consulte `docs/PHASE_1_SAAS.md` para o plano técnico e os critérios de ativação.
