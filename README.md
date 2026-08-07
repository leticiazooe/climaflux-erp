# ClimaFlux ERP

Candidato **v0.7.0 — Fundação SaaS** para empresas de assistência técnica em ar-condicionado e refrigeração.

> **ClimaFlux ERP** ainda é um nome provisório. A disponibilidade jurídica e comercial da marca precisa ser validada antes da venda.

## Fase 1 — estado atual

A v0.7.0 migra o protótipo para uma arquitetura SaaS real:

- Cloudflare Worker executado antes dos assets;
- Google Identity Services com validação do ID token no servidor;
- sessões revogáveis em cookie `Secure`, `HttpOnly` e `SameSite=Lax`;
- Cloudflare D1 com migrations versionadas;
- empresas reais (`tenants`) e vínculos de usuários;
- convites, RBAC e auditoria no backend;
- CSRF, nonce, validação de origem e rate limiting;
- health check em `/api/health`;
- idempotência nas operações críticas;
- service worker sem cache de APIs ou conteúdo autenticado.

## Módulos já migrados para API + D1

1. **Clientes** — `/customers-saas.html`
2. **Equipamentos** — `/equipment-saas.html`
3. **Ordens de Serviço + histórico** — `/work-orders-saas.html`
4. **Agenda e operação de campo** — `/field-service-saas.html`
5. **Estoque transacional** — `/inventory-saas.html`

As telas antigas continuam no shell do protótipo enquanto cada domínio é migrado. Nos módulos acima, as telas `*-saas.html` usam o backend como fonte de verdade.

## Multiempresa e segurança

Toda operação de negócio usa o `tenant_id` derivado da sessão autenticada. Os endpoints não aceitam `tenantId` do navegador como autoridade. FKs compostas e triggers reforçam no banco os vínculos Cliente → Equipamento → OS → Visita e Item → Local → Saldo/Movimento.

Uma OS não pode usar equipamento de outro cliente. Uma OS com visita ativa não pode trocar de técnico nem ser encerrada. O técnico recebe filtros obrigatórios por `user_id` para próprias OS e visitas.

## Estoque transacional

O estoque não possui endpoint para “editar saldo”. Cada alteração é um registro em `stock_movements`, e triggers do D1 atualizam `stock_balances`.

Controles implementados:

- itens e locais separados por tenant;
- SKU único por empresa;
- estoque mínimo e custo de referência;
- saldo por item/local;
- livro de movimentações imutável;
- bloqueio de saldo negativo no banco;
- saldo inicial permitido uma única vez por item/local;
- chave idempotente em cada movimentação;
- consumo e devolução vinculados à OS;
- devolução de OS limitada ao material líquido consumido;
- técnico só consome/devolve material de OS atribuída a ele;
- ajustes restritos a perfis autorizados.

## Agenda e operação de campo

`/field-service-saas.html` conecta a agenda à OS atribuída ao técnico e persiste checklist, medições e eventos. Fotos, anexos e assinatura digital ficam para a etapa R2.

## Banco de dados

- `0001_saas_foundation.sql`: identidade, tenants, sessões, clientes, auditoria e idempotência;
- `0002_operational_core.sql`: equipamentos, ordens e histórico;
- `0003_field_service.sql`: visitas, checklist, medições e histórico de campo;
- `0004_field_service_integrity.sql`: consistência entre visita ativa e ciclo da OS;
- `0005_inventory.sql`: locais, itens, saldos, ledger e triggers de saldo;
- `0006_inventory_integrity.sql`: saldo inicial, consumo em OS e limite de devolução.

## APIs

Identidade: `/api/auth/*`, `/api/v1/me`, `/api/v1/tenants` e `/api/v1/tenant/switch`.

Operação: `/api/v1/customers`, `/api/v1/equipment`, `/api/v1/work-orders`.

Campo: `/api/v1/field/lookups`, `/api/v1/field/visits` e subrotas de status/checklist/medições.

Estoque: `/api/v1/inventory/items`, `/api/v1/inventory/locations`, `/api/v1/inventory/balances` e `/api/v1/inventory/movements`.

Administração: `/api/v1/admin/members`, `/api/v1/admin/invites` e `/api/v1/audit`.

## Desenvolvimento

```bash
npm ci
npm run validate
npm run dev
```

Para criar e migrar o D1:

```bash
npm run db:create
npm run db:migrate:local
npm run db:migrate
```

Secrets obrigatórios:

```bash
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put SESSION_SECRET
npx wrangler secret put BOOTSTRAP_ADMIN_EMAILS
```

Nunca versione nem envie `SESSION_SECRET` por chat, issue ou log.

## Validação automatizada

O quality gate executa `npm ci`, auditoria de runtime, syntax check, testes de autenticação/RBAC/tenant isolation/workflows/integridade de estoque, build verificado e validação dos assets protegidos.

## Publicação

O deploy da v0.7.0 **não deve ser feito ainda** até:

- criar o D1 real e substituir `REPLACE_WITH_D1_DATABASE_ID`;
- aplicar migrations 0001–0006;
- configurar os secrets;
- cadastrar a origem final no Google Cloud;
- testar duas empresas em homologação;
- confirmar isolamento de clientes, equipamentos, OS, visitas e estoque;
- testar saldo negativo, idempotência e consumo/devolução de OS;
- testar backup/restauração do D1;
- validar URL e logs reais do Cloudflare.

## Ainda no armazenamento local

- contratos;
- orçamentos;
- compras;
- vendas;
- financeiro;
- despacho avançado e motor oficial de SLA;
- fotos, anexos e assinaturas;
- portal do cliente.

Próxima sequência: **compras/recebimento → vendas/baixa → financeiro → contratos/SLA → R2/anexos → portal real do cliente**.

Consulte `docs/PHASE_1_SAAS.md` para os critérios de ativação.
