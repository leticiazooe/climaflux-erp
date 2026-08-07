# Changelog

## 0.7.0 — 2026-08-06

### Adicionado

- Autenticação Google Identity Services.
- Cloudflare Worker como middleware de autenticação e autorização.
- Validação de assinatura RS256, audience, issuer, expiração, nonce e domínio Google Workspace.
- Banco D1 para usuários, empresas, vínculos, sessões e auditoria de segurança.
- Sessões revogáveis com cookie `__Host-`, `Secure`, `HttpOnly` e `SameSite=Lax`.
- Proteção CSRF e validação de origem para operações mutáveis.
- Rate limiting por hash de IP nas tentativas de login.
- Painel administrativo de aprovação e gestão de acessos.
- Suporte a múltiplas empresas por usuário autenticado.
- Testes unitários dos utilitários de autenticação.
- Documentação de provisionamento e segurança.

### Alterado

- Build público passou a instalar a tela de login e o cliente de sessão no shell do ERP.
- Service worker deixou de armazenar páginas e dados autenticados.
- Logout remove sessão, caches, service workers e dados locais do ClimaFlux.
- O deploy passa a combinar Worker, Static Assets e D1.

## 0.6.0 — 2026-08-06

- Regras de SLA, fila de despacho e portal do cliente.
- 23 testes automatizados de domínio, autorização, multiempresa, SLA e portal.

## 0.5.0 — 2026-08-06

- Multiempresa, notificações, auditoria, backup e restauração.

## 0.4.0 — 2026-08-06

- PWA e RBAC demonstrativo.

## 0.3.0

- MVP+ com ordens de serviço, operação de campo, agenda, contratos, orçamentos, vendas, estoque, compras e financeiro.
