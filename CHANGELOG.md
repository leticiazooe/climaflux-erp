# Changelog

## 0.6.0 — 2026-08-06

### Adicionado

- Regras de SLA por prioridade e por contrato.
- Estados de SLA: no prazo, em risco, violado e cumprido.
- Fila de despacho ordenada por risco, prioridade, atribuição e agenda.
- Edição de técnico, prioridade, data, horário, SLA personalizado e observações.
- Indicadores de SLA e ordens sem técnico.
- Exportação CSV da fila de despacho.
- Portal demonstrativo do cliente com equipamentos, ordens, orçamentos e contratos.
- Resumo copiável do atendimento para comunicação com o cliente.
- Testes automatizados do cálculo, ordenação e projeção segura do portal.

### Alterado

- Persistência local migrada para `climaflux-demo-v6`.
- Cache do PWA atualizado para `climaflux-v060-shell`.
- Notificações e auditoria passaram a registrar ações de despacho.
- Release público reduzido aos sete assets necessários e validado pelo SHA-256 `276dc082e046d202aeab91b807ee3bba9b20a403eba0187163f14e107b3750a5`.

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
