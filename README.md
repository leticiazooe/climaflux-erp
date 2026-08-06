# ClimaFlux ERP

ERP demonstrativo **v0.6.0** para empresas de assistência técnica em ar-condicionado e refrigeração. O produto integra atendimento, operação de campo, agenda, clientes, equipamentos, contratos preventivos, orçamentos, vendas, estoque, compras, financeiro, despacho e acompanhamento de SLA.

> **ClimaFlux ERP** é um nome provisório de demonstração. A disponibilidade jurídica e comercial da marca ainda não foi validada.

## Novidades da v0.6.0

- Regras de SLA por prioridade e por contrato.
- Classificação automática: no prazo, em risco, violado e cumprido.
- Fila de despacho ordenada por criticidade e vencimento.
- Atribuição de técnico, prioridade, data, horário e SLA personalizado.
- Indicadores operacionais de SLA e ordens sem técnico.
- Exportação CSV da fila de despacho.
- Portal demonstrativo do cliente com equipamentos, ordens, orçamentos, contratos e alertas.
- Resumo do atendimento pronto para copiar e compartilhar.
- Notificações e auditoria integradas às ações de despacho.
- PWA, funcionamento offline, multiempresa, backup e RBAC preservados.

## Perfis demonstrativos

- Administrador
- Atendimento
- Técnico
- Estoque
- Financeiro
- Gestor

Os usuários, permissões, SLAs e o isolamento multiempresa são simulados no cliente para demonstração. Em produção, autenticação, autorização, cálculo oficial de SLA e isolamento por empresa devem ser aplicados também no servidor e no banco de dados.

## Recursos implementados

- Dashboard operacional, financeiro e de estoque.
- Área mobile do técnico com rota diária, checklist, medições, fotos e assinatura.
- Ordens de serviço com fluxo de status, histórico e SLA.
- Clientes, equipamentos e contratos preventivos.
- Orçamentos com aprovação e conversão em OS.
- Vendas com baixa automática de estoque e lançamento financeiro.
- Compras com recebimento, entrada no estoque e conta a pagar.
- Consumo de materiais diretamente na OS.
- Contexto multiempresa, notificações, auditoria, backup e restauração.
- Exportações CSV, tema claro/escuro e persistência local.

## Executar localmente

```bash
npm install
npm run serve
```

Acesse `http://localhost:8080`.

## Validar o release

```bash
npm run build:public
```

O build confere **27 fragmentos**, valida o SHA-256 final e extrai somente os sete arquivos públicos permitidos.

```text
276dc082e046d202aeab91b807ee3bba9b20a403eba0187163f14e107b3750a5
```

## Publicação

```bash
npm run deploy
```

O Wrangler executa `scripts/build-public.mjs` e publica somente a pasta `public` no Cloudflare Workers Static Assets.

## Validação realizada

- 23 testes automatizados de domínio, autorização, multiempresa, SLA e portal.
- Análise estrutural e sintática.
- Smoke tests desktop e mobile.
- Fila de despacho e atualização de técnico, prioridade, agenda e SLA.
- Classificação de SLA e ordenação por risco.
- Portal do cliente e isolamento entre empresas.
- Fluxos de OS, orçamento, compra, venda, estoque, contratos e campo.

## Arquitetura de produção proposta

- Front-end React + TypeScript com PWA para técnicos.
- API TypeScript modular e contrato REST/OpenAPI.
- PostgreSQL com isolamento obrigatório por `tenant_id`.
- Motor de SLA no servidor com calendário comercial, feriados e pausas auditáveis.
- Object storage para fotos, laudos, anexos e assinaturas.
- Filas para notificações, PDFs e integrações.
- Autenticação real, RBAC no servidor, auditoria imutável, observabilidade, backups e controles LGPD.

O protótipo atual utiliza JavaScript sem dependências e `localStorage` para demonstração imediata. Ele não substitui os controles necessários para produção.
