# ClimaFlux ERP v0.5.0

## Escopo

- PWA instalável e shell offline.
- Sessões demonstrativas e RBAC por perfil.
- Contexto multiempresa com dados isolados por organização.
- Central de notificações operacionais.
- Trilha de auditoria por empresa e usuário.
- Backup e restauração JSON da base local completa.

## Validação

- 20 testes automatizados aprovados.
- Smoke tests desktop e mobile.
- Troca entre duas empresas demonstrativas.
- Verificação de isolamento de dados.
- Troca de usuário e perfil.
- Testes de notificações, auditoria, backup e restauração.
- Release validado pelo SHA-256 `c16df5ef402bb1146f0638da5d939d4bb20252ff0028f1b33a2bbfd295387d7d`.

## Limites

O protótipo permanece client-side. Autenticação, autorização, auditoria imutável e isolamento multiempresa precisam ser aplicados no servidor e no banco de dados em produção.
