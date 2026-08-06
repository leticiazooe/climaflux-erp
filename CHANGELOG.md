# Changelog

## 0.5.0 — 2026-08-06

### Adicionado

- Contexto multiempresa com dados isolados por organização.
- Seletor de empresa na interface.
- Central de notificações operacionais.
- Trilha de auditoria por empresa, usuário e ação.
- Exportação de backup JSON da base local completa.
- Restauração de backup com validação e confirmação.
- Testes automatizados de isolamento multiempresa.
- Release dividido em 22 partes verificadas individualmente.

### Alterado

- Persistência local migrada para a estrutura v0.5.0.
- PWA, modo offline e RBAC atualizados para o contexto da empresa selecionada.
- Build público passou a validar o SHA-256 `c16df5ef402bb1146f0638da5d939d4bb20252ff0028f1b33a2bbfd295387d7d`.

## 0.4.0 — 2026-08-06

### Adicionado

- Aplicação instalável como PWA.
- Service worker para disponibilidade offline do shell.
- Indicador de conexão online/offline.
- Sessões demonstrativas para Administrador, Atendimento, Técnico, Estoque, Financeiro e Gestor.
- Matrizes de permissão para visualização e execução de ações.
- Alternância de usuário na interface.
- Visão do técnico limitada às próprias ordens e agenda.
- Testes automatizados de autorização por perfil.
- Build de release com validação individual das partes e SHA-256 final.

### Alterado

- Persistência local migrada para `climaflux-demo-v4`.
- Deploy Cloudflare passou a publicar somente a pasta `public` validada.
- Documentação e comandos do projeto atualizados para a versão 0.4.0.

## 0.3.0

- MVP+ com ordens de serviço, operação de campo, agenda, contratos, orçamentos, vendas, estoque, compras e financeiro.
