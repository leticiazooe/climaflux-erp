# ClimaFlux ERP

MVP+ demonstrativo v0.3.0 de um sistema integrado para empresas de assistência técnica em ar-condicionado e refrigeração, reunindo ordens de serviço, agenda, clientes, equipamentos, vendas, estoque e financeiro.

> Nome provisório criado para a demonstração da skill `software-product-studio`. A disponibilidade jurídica e comercial do nome não foi validada.

## O que já funciona

- Dashboard com indicadores operacionais, financeiros e de estoque.
- Área mobile do técnico com rota diária, checklist, medições, fotos e assinatura.
- Relatório técnico imprimível e contratos preventivos recorrentes.
- Abertura, pesquisa, filtro e acompanhamento de ordens de serviço.
- Fluxo controlado de status: Aberta → Agendada/Em atendimento → Aguardando peça/Concluída → Faturada.
- Agenda técnica, clientes e equipamentos vinculados.
- Orçamentos com aprovação e conversão em ordem de serviço.
- Vendas com validação de saldo, baixa automática e lançamento financeiro.
- Compras com fornecedores, recebimento, entrada de estoque e conta a pagar.
- Consumo de materiais dentro da OS com recálculo do total.
- Estoque com mínimo, custo, preço de venda e movimentações.
- Contas a receber e pagar, baixa de pagamentos e rastreabilidade da origem.
- Exportação CSV, tema claro/escuro e persistência local.

## Executar

### Opção 1 — abrir diretamente

Abra `index.html` no navegador. As funções principais funcionam sem instalação.

### Opção 2 — servidor local recomendado

```bash
python3 -m http.server 8080
```

Acesse `http://localhost:8080`.

## Validar

Não há dependências externas.

```bash
npm run quality
```

O comando executa validações estruturais, análise de sintaxe e testes de domínio com `node:test`.

## Estrutura

```text
climaflux-studio-demo/
├── index.html                 # estrutura da aplicação
├── styles.css                # design system e responsividade
├── app.js                    # interface e casos de uso do protótipo
├── domain.js                 # regras de domínio testáveis
├── tests/                    # testes automatizados
├── database/schema.sql       # modelo relacional de produção
├── openapi.yaml              # contrato inicial da API
├── docs/
│   ├── PRODUCT.md            # descoberta e estratégia
│   ├── REQUIREMENTS.md       # requisitos e regras
│   ├── UX_UI.md              # arquitetura de informação e UX
│   ├── ARCHITECTURE.md       # arquitetura alvo
│   ├── DATA_MODEL.md         # entidades e relações
│   ├── SECURITY.md           # segurança, privacidade e permissões
│   ├── BACKLOG.md            # MVP e roadmap
│   ├── QUALITY.md            # testes e quality gates
│   ├── DEPLOYMENT.md         # ambientes, CI/CD e rollback
│   ├── RISKS.md              # riscos, hipóteses e mitigação
│   ├── TRACEABILITY.md       # requisitos → telas → testes
│   └── adrs/                 # decisões arquiteturais
├── CHANGELOG.md
└── VERSION
```

## Arquitetura de produção proposta

- Front-end: React + TypeScript, com componentes acessíveis e PWA para técnicos.
- API: TypeScript em arquitetura modular, REST/OpenAPI.
- Banco: PostgreSQL com isolamento por empresa (`tenant_id`).
- Arquivos: armazenamento de objetos para fotos, laudos, assinaturas e anexos.
- Filas: notificações, geração de PDF, integrações e tarefas assíncronas.
- Observabilidade: logs estruturados, métricas, rastreamento de erros e auditoria.

O protótipo usa JavaScript sem dependências e `localStorage` apenas para ser executável imediatamente. Ele não substitui autenticação, banco, backups, controles fiscais ou segurança de produção.

## Perfis previstos

- Administrador
- Atendimento/comercial
- Técnico de campo
- Estoquista/compras
- Financeiro
- Gestor

## Documentação viva

Toda mudança de regra, tela, API, banco ou segurança deve atualizar os documentos correspondentes, o changelog, a matriz de rastreabilidade e os testes.


## Fluxos integrados da versão 0.3.0

```text
Orçamento → envio → aprovação → conversão em OS
OS → consumo de peça → baixa de estoque → conclusão → faturamento
Compra → envio → recebimento → entrada de estoque → conta a pagar
Venda → baixa de estoque → receita paga ou pendente
Agenda → execução em campo → checklist → fotos → assinatura → conclusão → relatório
Contrato → gerar preventiva → OS agendada → avanço da próxima visita
```
