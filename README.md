# ClimaFlux ERP

ERP demonstrativo **v0.5.0** para empresas de assistência técnica em ar-condicionado e refrigeração. O produto integra atendimento, operação de campo, agenda, clientes, equipamentos, contratos preventivos, orçamentos, vendas, estoque, compras e financeiro.

> **ClimaFlux ERP** é um nome provisório de demonstração. A disponibilidade jurídica e comercial da marca ainda não foi validada.

## Novidades da v0.5.0

- Contexto multiempresa com dados separados por organização.
- Alternância de empresa diretamente na interface.
- Central de notificações operacionais.
- Trilha de auditoria por empresa, usuário e ação.
- Backup JSON da base local completa.
- Restauração de backup com validação e confirmação.
- PWA, funcionamento offline e RBAC preservados da v0.4.0.
- Migração automática dos dados locais para a estrutura v0.5.0.

## Perfis demonstrativos

- Administrador
- Atendimento
- Técnico
- Estoque
- Financeiro
- Gestor

Os usuários e as permissões são simulados no cliente para demonstração. Em produção, autenticação, autorização e isolamento multiempresa precisam ser aplicados no servidor e no banco de dados.

## Recursos implementados

- Dashboard operacional, financeiro e de estoque.
- Área mobile do técnico com rota diária, checklist, medições, fotos e assinatura.
- Ordens de serviço com fluxo de status e histórico.
- Clientes, equipamentos e contratos preventivos.
- Orçamentos com aprovação e conversão em OS.
- Vendas com baixa automática de estoque e lançamento financeiro.
- Compras com recebimento, entrada no estoque e conta a pagar.
- Consumo de materiais diretamente na OS.
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

O build confere os 22 fragmentos e o SHA-256 final antes de extrair os arquivos públicos.

```text
c16df5ef402bb1146f0638da5d939d4bb20252ff0028f1b33a2bbfd295387d7d
```

## Publicação

```bash
npm run deploy
```

O Wrangler executa `scripts/build-public.mjs` e publica somente a pasta `public` no Cloudflare Workers Static Assets.

## Validação realizada

- 20 testes automatizados de domínio, autorização e multiempresa.
- Análise estrutural e sintática.
- Smoke tests desktop e mobile.
- Troca de empresa e isolamento dos dados.
- Alternância de usuários e perfis.
- Notificações, auditoria, backup e restauração.
- Fluxos de OS, orçamento, compra, venda, estoque e contratos.

## Arquitetura de produção proposta

- Front-end React + TypeScript com PWA para técnicos.
- API TypeScript modular e contrato REST/OpenAPI.
- PostgreSQL com isolamento obrigatório por `tenant_id`.
- Object storage para fotos, laudos, anexos e assinaturas.
- Filas para notificações, PDFs e integrações.
- Autenticação real, RBAC no servidor, auditoria imutável, observabilidade, backups e controles LGPD.

O protótipo atual utiliza JavaScript sem dependências e `localStorage` para demonstração imediata. Ele não substitui os controles necessários para produção.
