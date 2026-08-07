# Autenticação do ClimaFlux ERP

A autenticação foi projetada para Cloudflare Workers + D1 e Google Identity Services.

## Arquitetura

1. A tela `/login.html` solicita uma credencial do Google Identity Services.
2. O navegador envia o ID token ao endpoint `POST /api/auth/google`.
3. O Worker valida:
   - token CSRF em cookie, cabeçalho e corpo;
   - nonce vinculado à tentativa de login;
   - assinatura RS256 usando as chaves públicas rotativas do Google;
   - claims `aud`, `iss`, `exp`, `iat`, `sub`, `email_verified` e, quando configurado, `hd`;
   - allowlist de domínio/e-mail.
4. O usuário e seus vínculos empresariais são consultados no D1.
5. O Worker cria uma sessão aleatória e armazena somente o hash do token.
6. O navegador recebe o cookie `__Host-climaflux_session` com `Secure`, `HttpOnly` e `SameSite=Lax`.
7. O acesso ao HTML do ERP, ao service worker e às APIs exige sessão válida.

## Segurança aplicada

- O ClimaFlux nunca recebe a senha Google.
- O identificador estável é a claim `sub`, não o e-mail.
- Sessões são revogáveis no D1.
- CSRF token rotativo para operações de escrita.
- Nonce por tentativa de login.
- Validação de origem em requisições mutáveis.
- Limite de tentativas por hash de IP.
- Auditoria de login, logout, troca de empresa e alteração de acesso.
- Conteúdo autenticado usa `Cache-Control: no-store`.
- O service worker não armazena o shell autenticado nem respostas de API.
- Logout remove sessão, cache, service workers e chaves `climaflux*` do armazenamento local.
- Cabeçalhos contra framing, MIME sniffing e uso indevido de permissões do navegador.

## Provisionamento

O acesso é negado por padrão. Um usuário autenticado sem vínculo ativo aparece como pendente no painel administrativo.

As contas listadas em `BOOTSTRAP_ADMIN_EMAILS` recebem automaticamente o papel `admin` na empresa padrão. O auto provisionamento por domínio só ocorre quando `ALLOWED_GOOGLE_DOMAINS` e `AUTO_PROVISION_ROLE` estão configurados.

## Configuração obrigatória

### 1. Google Cloud

Crie uma credencial OAuth 2.0 do tipo **Aplicativo da Web** e adicione como origem JavaScript autorizada:

- a URL `workers.dev` do projeto;
- o domínio personalizado de produção, quando existir;
- `http://localhost:8787` para desenvolvimento local.

Não é necessário client secret neste fluxo; o backend valida o ID token assinado pelo Google.

### 2. D1

```bash
npx wrangler d1 create climaflux-auth
```

Copie o `database_id` retornado para `wrangler.jsonc` e execute:

```bash
npm run auth:migrate:local
npm run auth:migrate
```

### 3. Secrets

```bash
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put SESSION_SECRET
npx wrangler secret put BOOTSTRAP_ADMIN_EMAILS
```

- `GOOGLE_CLIENT_ID`: client ID da credencial Web do Google.
- `SESSION_SECRET`: string aleatória com pelo menos 32 bytes.
- `BOOTSTRAP_ADMIN_EMAILS`: e-mails administrativos separados por vírgula.

Secret opcional:

```bash
npx wrangler secret put ALLOWED_GOOGLE_EMAILS
```

Variáveis opcionais no `wrangler.jsonc`:

- `ALLOWED_GOOGLE_DOMAINS`: domínios Google Workspace separados por vírgula.
- `AUTO_PROVISION_ROLE`: perfil automático para contas do domínio (`atendimento`, `tecnico`, `estoque`, `financeiro`, `gestor` ou `admin`).
- `DEFAULT_COMPANY_NAME`: nome da empresa inicial.
- `DEFAULT_APP_COMPANY_KEY`: valor da empresa correspondente no protótipo.
- `BOOTSTRAP_APP_USER_KEY`: valor do usuário correspondente no protótipo.
- `SESSION_TTL_SECONDS`: duração absoluta da sessão; padrão 8 horas.
- `SESSION_IDLE_SECONDS`: expiração por inatividade; padrão 2 horas.

## Gestão de acessos

Administradores acessam `/admin-access.html` para:

- aprovar ou suspender vínculos;
- selecionar a empresa;
- atribuir o perfil RBAC;
- associar o usuário autenticado ao identificador usado pelo protótipo.

## Limitação atual do protótipo

A autenticação protege a entrada e as APIs de sessão, mas o ERP demonstrativo ainda mantém dados operacionais no navegador. Para produção, os dados de negócio precisam migrar para APIs autenticadas e PostgreSQL/D1 com autorização por `company_id` em todas as consultas. O modo offline de dados foi desativado para não contornar o logout.
