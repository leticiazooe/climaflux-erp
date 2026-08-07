# ClimaFlux ERP — Checkpoint da Fase 1

Data: 2026-08-07
Branch: `agent/phase1-saas-foundation`
Versão candidata: `0.7.0`

## Estado

A fundação SaaS está implementada e validada em código, mas ainda não foi ativada em produção porque depende de configuração externa do Google Cloud e Cloudflare.

## Plataforma SaaS entregue

- autenticação Google validada no Worker;
- sessões revogáveis no D1;
- CSRF, nonce, origem, rate limiting e expiração;
- Worker-first antes dos assets;
- tenants, usuários, vínculos, convites e troca de empresa;
- RBAC no servidor;
- auditoria tenant-scoped;
- health check e observabilidade;
- migrations versionadas;
- idempotência;
- service worker sem cache de APIs ou conteúdo autenticado;
- CI com `npm ci`, runtime audit, syntax check, testes e build.

## Domínios persistidos no backend

1. Clientes.
2. Equipamentos.
3. Ordens de Serviço e histórico imutável.
4. Agenda e operação de campo.
5. Checklist e medições técnicas.
6. Estoque transacional.
7. Fornecedores e Pedidos de Compra.
8. Recebimentos de compras integrados ao estoque.

## Compras → Estoque

O recebimento de um pedido utiliza `D1Database.batch()` para gravar a sequência de recebimento. Cada linha recebida dispara triggers que:

1. validam a quantidade pendente;
2. incrementam `purchase_order_lines.quantity_received`;
3. criam um movimento `receipt` no ledger `stock_movements`;
4. atualizam `stock_balances` pelos triggers do estoque;
5. alteram o pedido para `partially_received` ou `received`.

Recebimentos e suas linhas são imutáveis. A chave `request_key` impede repetição acidental do mesmo recebimento.

## Migrations vigentes

- `0001_saas_foundation.sql`
- `0002_operational_core.sql`
- `0003_field_service.sql`
- `0004_field_service_integrity.sql`
- `0005_inventory.sql`
- `0006_inventory_integrity.sql`
- `0007_purchasing.sql`

Schema esperado após aplicação: versão `7`.

## Telas SaaS protegidas

- `/login.html`
- `/admin-access.html`
- `/customers-saas.html`
- `/equipment-saas.html`
- `/work-orders-saas.html`
- `/field-service-saas.html`
- `/inventory-saas.html`
- `/purchases-saas.html`

## Quality gate

No checkpoint anterior ao registro deste documento, a branch passou integralmente no GitHub Actions com a implementação de Compras incluída. O build gera 27 assets públicos protegidos. Os testes cobrem identidade, RBAC, isolamento por tenant, OS, campo, estoque e compras.

## Bloqueadores externos para homologação

- OAuth Client ID Web do Google.
- D1 real `climaflux-saas`.
- substituição de `REPLACE_WITH_D1_DATABASE_ID`.
- secrets `GOOGLE_CLIENT_ID`, `SESSION_SECRET` e `BOOTSTRAP_ADMIN_EMAILS`.
- migrations 0001–0007 aplicadas remotamente.
- origens Google autorizadas.

Nunca versionar ou enviar `SESSION_SECRET` por chat, issue ou log.

## Testes manuais obrigatórios em homologação

- duas empresas sem vazamento cruzado;
- convite e suspensão de usuário;
- técnico sem acesso às OS/visitas de outro técnico;
- cliente/equipamento/OS em cada tenant;
- visita, checklist e medições;
- entrada e saída de estoque;
- tentativa de saldo negativo;
- consumo/devolução de OS;
- saldo inicial duplicado bloqueado;
- pedido de compra completo;
- recebimento parcial e total;
- recebimento repetido com mesma chave idempotente;
- recebimento acima do saldo pendente recusado;
- confirmação de que o recebimento alterou o estoque;
- backup e restauração do D1;
- login/logout no domínio real.

## Domínios ainda locais

- vendas;
- financeiro;
- contratos;
- motor oficial de SLA e despacho avançado;
- fotos, anexos e assinaturas;
- portal real do cliente.

## Próxima sequência

1. Vendas com baixa transacional do estoque.
2. Financeiro com contas a receber/pagar e vínculo com compras/vendas.
3. Contratos e motor oficial de SLA.
4. R2 para anexos e assinaturas.
5. Portal do cliente.
