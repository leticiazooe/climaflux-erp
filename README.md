# ClimaFlux ERP

ERP demonstrativo **v0.4.0** para empresas de assistência técnica em ar-condicionado e refrigeração. O produto integra atendimento, operação de campo, agenda, clientes, equipamentos, contratos preventivos, orçamentos, vendas, estoque, compras e financeiro.

> **ClimaFlux ERP** é um nome provisório de demonstração. A disponibilidade jurídica e comercial da marca ainda não foi validada.

## Novidades da v0.4.0

- PWA instalável no computador e no celular.
- Shell da aplicação disponível offline após o primeiro acesso.
- Indicador de conexão online/offline.
- Sessões demonstrativas com seis perfis de usuário.
- Controle de visualização e ações por perfil (RBAC).
- Área do técnico limitada às próprias ordens e agenda.
- Persistência local migrada para a estrutura da v0.4.0.
- Deploy Cloudflare com pacote versionado e validação SHA-256.

## Perfis disponíveis

- Administrador
- Atendimento
- Técnico
- Estoque
- Financeiro
- Gestor

O usuário pode alternar o perfil na própria interface para demonstrar as permissões.

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

## Executar localmente

```bash
npm install
npm run serve
```

Depois acesse:

```text
http://localhost:8080
```

O comando reconstrói a pasta `public`, valida o release e inicia um servidor HTTP.

## Validar o release

```bash
npm run build:public
```

O build confere cada fragmento e o SHA-256 final antes de extrair os arquivos públicos. O release esperado é:

```text
34804cc826c0cced08375ff288b0de9ba7bcee723aa538cf6c5e5d44c9b9f3f0
```

## Publicação

```bash
npm run deploy
```

O Wrangler executa `scripts/build-public.mjs` e publica somente a pasta `public` no Cloudflare Workers Static Assets.

## Validação realizada

- 19 testes automatizados de domínio e autorização.
- Análise estrutural e sintática.
- Smoke tests desktop e mobile.
- Fluxos de OS, orçamento, compra, venda, estoque e contratos.
- Alternância entre administrador e técnico.
- Verificação das restrições de navegação e ações por perfil.
- Validação do manifesto e do service worker.

## Arquitetura de produção proposta

- Front-end React + TypeScript com PWA para técnicos.
- API TypeScript modular e contrato REST/OpenAPI.
- PostgreSQL com isolamento por empresa (`tenant_id`).
- Object storage para fotos, laudos, anexos e assinaturas.
- Filas para notificações, PDFs e integrações.
- Autenticação real, RBAC no servidor, auditoria, observabilidade, backups e controles LGPD.

O protótipo atual utiliza JavaScript sem dependências e `localStorage` para demonstração imediata. As sessões e permissões são simuladas no cliente e não substituem autenticação e autorização de produção.
