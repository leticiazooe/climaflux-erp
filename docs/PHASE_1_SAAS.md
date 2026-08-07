# Fase 1 — Fundação SaaS do ClimaFlux ERP

## Objetivo

Transformar a aplicação demonstrativa em uma base SaaS com autenticação, isolamento multiempresa, persistência no servidor e autorização aplicada no backend.

Esta entrega cria a fundação e migra o primeiro módulo de negócio. Ela não declara que todos os dados do ERP já saíram do navegador.

## Entregue nesta branch

### Identidade e sessão

- Google Identity Services.
- Validação do ID token no Cloudflare Worker.
- Verificação de assinatura RS256, `aud`, `azp`, `iss`, `exp`, `iat`, nonce, conta autoritativa e domínio permitido.
- Sessões aleatórias com armazenamento apenas do hash no D1.
- Cookie `__Host-climaflux_session` com `Secure`, `HttpOnly`, `SameSite=Lax` e `Path=/`.
- Expiração absoluta e por inatividade.
- Logout com revogação no banco.
- Proteção CSRF e validação de origem.
- Rate limiting de login baseado em eventos e hash do IP.

### Multiempresa

- Tabela `tenants`.
- Tabela `memberships` com papéis e status por tenant.
- Um usuário pode possuir múltiplos vínculos.
- Tenant ativo armazenado na sessão.
- Troca de tenant permitida somente para vínculos ativos.
- Criação de tenant opcional por feature flag.
- `tenant_id` nunca é aceito como origem de autoridade nas operações de clientes.

### Equipe e convites

- Convites por e-mail e tenant.
- Perfis definidos no convite.
- Aceite automático no primeiro login Google com o mesmo e-mail.
- Expiração e cancelamento de convite.
- Atualização de perfil e status.
- Revogação das sessões do vínculo suspenso.
- Proteção para manter pelo menos um administrador ativo.

### RBAC

Permissões iniciais:

| Perfil | Permissões principais |
|---|---|
| admin | todas |
| gestor | clientes, exclusão, auditoria e leitura de membros |
| atendimento | leitura e escrita de clientes |
| tecnico | leitura de clientes |
| estoque | leitura de clientes |
| financeiro | leitura de clientes |

O Worker valida as permissões em cada endpoint. A interface apenas reflete a autorização, sem substituí-la.

### Primeiro módulo de negócio

`customers` é o primeiro módulo persistido no D1.

Controles aplicados:

- tenant obrigatório;
- código único por tenant;
- documento único por tenant;
- paginação com limite máximo;
- pesquisa parametrizada;
- criação idempotente;
- validação de entrada;
- edição tenant-scoped;
- exclusão lógica;
- usuário criador e atualizador;
- auditoria de criação, edição e exclusão.

A interface de teste fica em `/customers-saas.html`.

### Auditoria e operação

- `audit_log` separado por tenant.
- `auth_events` para eventos de login e logout.
- hash de IP, nunca IP puro, nos registros de segurança.
- user agent limitado.
- health check com versão do schema.
- observabilidade do Worker habilitada.
- migrations versionadas.
- idempotency keys com expiração.

### PWA e cache

- Apenas assets públicos de login podem permanecer em cache.
- Respostas `/api/*` usam `cache: no-store`.
- HTML e assets autenticados são entregues com `Cache-Control: no-store, private`.
- O cache antigo da sessão demonstrativa é removido.

## Arquitetura

```text
Navegador
  │
  ├── Google Identity Services
  │
  ▼
Cloudflare Worker
  ├── validação Google
  ├── sessão / CSRF
  ├── tenant context
  ├── RBAC
  ├── API /api/v1
  ├── auditoria
  └── proteção de assets
        │
        ├── D1: identidade, tenants, clientes e auditoria
        └── Static Assets: ERP e telas SaaS
```

## Endpoints

### Públicos

| Método | Rota | Finalidade |
|---|---|---|
| GET | `/api/health` | saúde da aplicação e versão do schema |
| GET | `/api/auth/config` | Client ID, nonce e CSRF do login |
| POST | `/api/auth/google` | validação Google e criação da sessão |

### Sessão e tenant

| Método | Rota | Finalidade |
|---|---|---|
| GET | `/api/v1/me` | usuário, tenant, permissões e CSRF |
| POST | `/api/auth/logout` | revogar sessão |
| GET | `/api/v1/tenants` | listar vínculos do usuário |
| POST | `/api/v1/tenants` | criar tenant quando habilitado |
| POST | `/api/v1/tenant/switch` | trocar tenant ativo |

### Clientes

| Método | Rota | Permissão |
|---|---|---|
| GET | `/api/v1/customers` | `customers.read` |
| POST | `/api/v1/customers` | `customers.write` |
| PATCH | `/api/v1/customers/:id` | `customers.write` |
| DELETE | `/api/v1/customers/:id` | `customers.delete` |

### Administração

| Método | Rota | Permissão |
|---|---|---|
| GET | `/api/v1/admin/members` | `members.read` |
| POST | `/api/v1/admin/invites` | `members.write` |
| PATCH | `/api/v1/admin/members/:userId` | `members.write` |
| DELETE | `/api/v1/admin/invites/:inviteId` | `members.write` |
| GET | `/api/v1/audit` | `audit.read` |

## Ativação externa obrigatória

### Google Cloud

1. Criar uma credencial OAuth 2.0 do tipo **Aplicativo da Web**.
2. Cadastrar as origens JavaScript:
   - `http://localhost:8787`;
   - URL `workers.dev` de homologação;
   - domínio de produção.
3. Guardar apenas o Client ID no secret `GOOGLE_CLIENT_ID`.

### Cloudflare D1

```bash
npm run db:create
```

Substituir `REPLACE_WITH_D1_DATABASE_ID` no `wrangler.jsonc` pelo ID retornado.

```bash
npm run db:migrate:local
npm run db:migrate
```

### Secrets

```bash
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put SESSION_SECRET
npx wrangler secret put BOOTSTRAP_ADMIN_EMAILS
```

Recomendação para gerar o segredo de sessão localmente:

```bash
openssl rand -base64 48
```

Não versionar nem enviar esse valor por chat, issue, commit ou log.

## Critérios antes do merge

- [ ] D1 de homologação criado.
- [ ] ID real configurado na branch de homologação.
- [ ] migrations locais e remotas aplicadas.
- [ ] secrets configurados.
- [ ] origem Google autorizada.
- [ ] login do primeiro administrador testado.
- [ ] convite e aceite por outro e-mail testados.
- [ ] suspensão e revogação de sessão testadas.
- [ ] duas empresas criadas.
- [ ] cliente criado em cada empresa.
- [ ] teste manual confirma que um tenant não enxerga o cliente do outro.
- [ ] logout e expiração testados.
- [ ] Cloudflare deploy validado sem erro.
- [ ] backup/exportação do D1 definido.

## Limitações atuais

### Ainda no navegador

- ordens de serviço;
- equipamentos;
- agenda;
- contratos;
- orçamentos;
- vendas;
- estoque;
- compras;
- financeiro;
- despacho;
- regras oficiais de SLA;
- portal do cliente.

### Ainda não incluído

- R2 para anexos;
- envio real de e-mail dos convites;
- cobrança e planos;
- recuperação de conta alternativa;
- MFA obrigatório;
- painel interno da operadora do SaaS;
- backup automatizado testado;
- homologação separada da produção;
- integração entre o módulo antigo de clientes e o novo endpoint.

## Próxima ordem de migração

1. Ordens de serviço e histórico.
2. Equipamentos e vínculo com clientes.
3. Técnicos, agenda e operação de campo.
4. Estoque e movimentações transacionais.
5. Compras, vendas e financeiro.
6. Contratos e motor oficial de SLA.
7. Anexos e assinaturas no R2.
8. Portal real do cliente.

## Decisão de banco

D1 é adequado para a fundação e para um beta controlado. Antes de ampliar a operação, medir concorrência, volume de escrita, tamanho dos anexos e necessidades de relatório. Caso a carga transacional exija, a API foi organizada para permitir a migração futura para PostgreSQL sem mover a autorização de volta ao navegador.
