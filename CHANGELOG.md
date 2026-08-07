# Changelog

## 0.7.0 — 2026-08-06

### Adicionado

- Cloudflare Worker executado antes dos assets estáticos.
- Autenticação Google com validação de assinatura, audiência, emissor, expiração, nonce, e-mail e domínio.
- Sessões revogáveis no D1 com cookie `Secure`, `HttpOnly` e `SameSite=Lax`.
- Schema SaaS com tenants, usuários, vínculos, convites, sessões, clientes, auditoria, eventos de autenticação e idempotência.
- RBAC aplicado no servidor.
- Criação e troca de empresa.
- Convites aceitos automaticamente no primeiro login Google correspondente.
- Proteção do último administrador ativo de cada empresa.
- Health check em `/api/health`.
- API versionada `/api/v1`.
- CRUD de clientes com escopo obrigatório por tenant, paginação, pesquisa, exclusão lógica e auditoria.
- Tela protegida `/customers-saas.html` como primeiro módulo persistido no backend.
- Gestão real de membros e convites em `/admin-access.html`.
- Testes de autenticação, políticas, schema, isolamento e roteamento.

### Alterado

- Sessão demonstrativa da v0.6.2 substituída pela camada autenticada na branch da Fase 1.
- Service worker passou a armazenar apenas assets públicos e nunca respostas de API.
- Build público passou a injetar a camada SaaS e validar 15 assets protegidos.
- Pipeline passou a executar `npm run validate` antes do deploy.

### Pendente para ativação

- Criar OAuth Client ID Web no Google Cloud.
- Criar o banco D1 `climaflux-saas` e substituir o ID no `wrangler.jsonc`.
- Configurar os secrets do Worker.
- Aplicar migrations remotas.
- Validar o domínio final em homologação.
- Migrar os demais módulos ainda armazenados no navegador.

## 0.6.2 — 2026-08-06

### Adicionado

- Tela de entrada demonstrativa em `/login.html`.
- Sessão local de navegação com retorno seguro à rota solicitada.
- Botão **Sair do sistema** no ERP e na Gestão de Acessos.
- Confirmação antes do encerramento da sessão.
- Atalho flutuante para a Gestão de Acessos.
- Indicador visual de sessão demonstrativa.
- Quality gates para entrada, saída e rotas administrativas.

### Alterado

- Logout passou a remover somente o estado da sessão, preservando os dados operacionais locais.
- Service worker atualizado para `climaflux-v062-session-shell`.
- Cache antigo do PWA é removido durante a ativação da nova versão.
- Build público passou a validar 14 arquivos obrigatórios.

## 0.6.1 — 2026-08-06

### Adicionado

- Prévia funcional da Gestão de Acessos em `/admin-access.html`.
- Pesquisa e filtros por nome, e-mail, status e perfil.
- Edição de empresa, perfil e situação do usuário.
- Cadastro demonstrativo de novos usuários.
- Indicadores e histórico local de alterações.

### Alterado

- O build passou a copiar e validar os assets da Gestão de Acessos.

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
