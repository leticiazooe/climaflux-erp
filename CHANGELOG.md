# Changelog

## 0.7.0 — 2026-08-07

### Adicionado

- Cloudflare Worker executado antes dos assets estáticos.
- Autenticação Google com validação criptográfica no servidor.
- Sessões revogáveis no D1 com cookie `Secure`, `HttpOnly` e `SameSite=Lax`.
- Multiempresa real com tenants, vínculos, convites, RBAC e auditoria.
- CSRF, nonce, validação de origem e rate limiting.
- Health check, migrations versionadas e idempotência.
- Clientes SaaS em `/customers-saas.html`.
- Equipamentos SaaS em `/equipment-saas.html`.
- Ordens de Serviço e histórico imutável em `/work-orders-saas.html`.
- Agenda e operação de campo em `/field-service-saas.html`, com checklist, medições e histórico.
- Estoque transacional em `/inventory-saas.html`.
- Livro de movimentações imutável com saldos derivados no banco.
- Bloqueio de saldo negativo diretamente no D1.
- Consumo e devolução de materiais vinculados a Ordens de Serviço.
- Proteção contra saldo inicial duplicado e devolução acima do material consumido.
- Package lock reproduzível e Dependabot.

### Alterado

- Sessão demonstrativa da v0.6.2 substituída pela camada autenticada na branch da Fase 1.
- Service worker passou a armazenar apenas assets públicos e nunca respostas de API.
- Worker principal passou a ser `worker/phase1-worker.js`, compondo identidade, operação, campo e estoque.
- Quality gate passou a validar migrations 0001–0006 e 24 assets protegidos.
- Pipeline usa `npm ci`, auditoria das dependências de runtime, syntax check, testes e build verificado.

### Segurança e integridade

- `tenant_id` é sempre derivado da sessão para as APIs de negócio.
- FKs compostas reforçam relacionamentos dentro do tenant.
- Técnico enxerga somente próprias OS e visitas.
- OS com visita ativa não pode trocar de técnico nem ser encerrada.
- Histórico de OS, visitas e movimentações de estoque é imutável.
- Movimentações de estoque exigem chave idempotente.

### Pendente para ativação

- Criar OAuth Client ID Web no Google Cloud.
- Criar D1 `climaflux-saas` e substituir o ID no `wrangler.jsonc`.
- Configurar secrets do Worker diretamente no Cloudflare.
- Aplicar migrations 0001–0006 remotamente.
- Testar duas empresas em homologação.
- Validar backup/restauração do D1 e URL/logs de homologação.
- Migrar compras, vendas, financeiro, contratos/SLA, anexos e portal do cliente.

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

### Alterado

- Persistência local migrada para `climaflux-demo-v6`.
- Cache do PWA atualizado para `climaflux-v060-shell`.
- Release público reduzido aos sete assets necessários e validado pelo SHA-256 `276dc082e046d202aeab91b807ee3bba9b20a403eba0187163f14e107b3750a5`.
