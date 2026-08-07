# ClimaFlux ERP

ERP demonstrativo **v0.7.0** para empresas de assistência técnica em ar-condicionado e refrigeração. O produto integra atendimento, operação de campo, agenda, clientes, equipamentos, contratos preventivos, orçamentos, vendas, estoque, compras, financeiro, despacho, SLA e portal do cliente.

> **ClimaFlux ERP** é um nome provisório de demonstração. A disponibilidade jurídica e comercial da marca ainda não foi validada.

## Novidades da v0.7.0

- Login com Google Identity Services.
- Validação criptográfica do ID token no Cloudflare Worker.
- Proteções de nonce, CSRF, origem, audience, issuer e expiração.
- Sessões revogáveis armazenadas no Cloudflare D1.
- Cookie `Secure`, `HttpOnly`, `SameSite=Lax` e prefixo `__Host-`.
- Usuários vinculados a empresas e perfis RBAC.
- Painel administrativo para aprovação, suspensão e alteração de perfil.
- Troca segura de empresa para usuários com múltiplos vínculos.
- Auditoria de login, logout, troca de empresa e alterações de acesso.
- Rate limiting de tentativas de autenticação.
- Logout com limpeza do armazenamento local e dos caches.
- Service worker revisado para não armazenar páginas e dados autenticados.

## Perfis disponíveis

- Administrador
- Atendimento
- Técnico
- Estoque
- Financeiro
- Gestor

## Configuração da autenticação

A implementação está documentada em [`docs/AUTHENTICATION.md`](docs/AUTHENTICATION.md).

Antes de ativar o deploy:

1. crie uma credencial OAuth 2.0 Web no Google Cloud;
2. crie o banco D1 `climaflux-auth`;
3. substitua `REPLACE_WITH_D1_DATABASE_ID` no `wrangler.jsonc`;
4. configure os secrets `GOOGLE_CLIENT_ID`, `SESSION_SECRET` e `BOOTSTRAP_ADMIN_EMAILS`;
5. execute a migration remota;
6. faça o deploy.

```bash
npm install
npm run auth:db:create
npm run auth:migrate
npm run deploy
```

## Validação local

```bash
npm run check:auth
npm run test:auth
npm run build:public
```

## Segurança e limitação do protótipo

O Google é usado somente como provedor de identidade; o ClimaFlux não recebe a senha do usuário. O Worker valida o token usando as chaves públicas rotativas do Google e usa a claim `sub` como identificador estável.

A autenticação protege a entrada e as APIs de sessão. Entretanto, os dados operacionais do protótipo ainda ficam no navegador. Para produção, os módulos de negócio devem migrar para APIs autenticadas e banco de dados com autorização obrigatória por empresa em todas as consultas.

## Funcionalidades anteriores preservadas

- PWA instalável.
- Contexto multiempresa.
- Despacho e acompanhamento de SLA.
- Portal demonstrativo do cliente.
- Ordens de serviço e operação móvel.
- Agenda, clientes, equipamentos e contratos.
- Orçamentos, vendas, estoque, compras e financeiro.
- Notificações, auditoria operacional, backup e restauração.
