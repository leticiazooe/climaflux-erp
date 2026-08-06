# ClimaFlux ERP

MVP+ demonstrativo **v0.3.0** para empresas de assistência técnica em ar-condicionado e refrigeração, integrando ordens de serviço, operação móvel, agenda, clientes, equipamentos, contratos preventivos, orçamentos, vendas, estoque, compras e financeiro.

> **ClimaFlux ERP** é um nome provisório de demonstração. A disponibilidade jurídica e comercial da marca não foi validada.

## Recursos implementados

- Dashboard operacional, financeiro e de estoque.
- Área mobile do técnico com rota diária, checklist, medições, fotos e assinatura.
- Relatório técnico imprimível.
- Ordens de serviço com fluxo de status e histórico.
- Clientes e equipamentos vinculados.
- Contratos preventivos com geração recorrente de OS.
- Orçamentos com aprovação e conversão em OS.
- Vendas com baixa automática de estoque e lançamento financeiro.
- Compras com fornecedores, recebimento, entrada no estoque e conta a pagar.
- Consumo de materiais diretamente na OS.
- Exportações CSV, tema claro/escuro e persistência local.

## Executar a demonstração

O `index.html` reconstrói o pacote, confere seu SHA-256 e inicia a aplicação no navegador. Por segurança do navegador, use um servidor local:

```bash
npm run serve
```

Depois acesse:

```text
http://localhost:8080
```

Também funciona com qualquer servidor HTTP estático, incluindo GitHub Pages.

## Materializar o código-fonte

O código-fonte completo, documentação, testes, schema PostgreSQL e contrato OpenAPI estão armazenados no pacote verificado dentro de `.bootstrap`.

Para extrair tudo em uma pasta legível chamada `source`:

```bash
npm run unpack
cd source
npm run quality
```

O extrator valida o SHA-256 abaixo antes de escrever qualquer arquivo:

```text
528555dd66740baa9f83de81269f4360a70d2ca02096596d37ee4bd15fbe180d
```

## Conteúdo do pacote

```text
source/
├── index.html
├── styles.css
├── app.js
├── app-parts/
├── domain.js
├── tests/
├── database/schema.sql
├── openapi.yaml
├── scripts/
├── docs/
│   ├── PRODUCT.md
│   ├── REQUIREMENTS.md
│   ├── UX_UI.md
│   ├── ARCHITECTURE.md
│   ├── DATA_MODEL.md
│   ├── SECURITY.md
│   ├── BACKLOG.md
│   ├── QUALITY.md
│   ├── DEPLOYMENT.md
│   ├── RISKS.md
│   ├── TRACEABILITY.md
│   └── adrs/
├── CHANGELOG.md
└── VERSION
```

## Validação

A versão foi validada localmente com:

- 16 testes automatizados de domínio;
- análise estrutural e sintática;
- OpenAPI 3.1;
- smoke tests desktop e mobile;
- fluxo de orçamento, compra, venda, estoque e OS;
- atendimento de campo com checklist e assinatura;
- geração de OS preventiva por contrato.

## Arquitetura de produção proposta

- Front-end React + TypeScript com PWA para técnicos.
- API TypeScript modular e contrato REST/OpenAPI.
- PostgreSQL com isolamento por empresa (`tenant_id`).
- Object storage para fotos, laudos, anexos e assinaturas.
- Filas para notificações, PDFs e integrações.
- RBAC, auditoria, observabilidade, backups e controles LGPD.

O protótipo atual utiliza JavaScript sem dependências e `localStorage` para permitir demonstração imediata. Ele não substitui os controles necessários para produção.
