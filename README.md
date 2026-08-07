# ClimaFlux ERP

ERP demonstrativo **v0.6.2** para empresas de assistência técnica em ar-condicionado e refrigeração. O produto integra atendimento, operação de campo, agenda, clientes, equipamentos, contratos preventivos, orçamentos, vendas, estoque, compras, financeiro, despacho, SLA e uma prévia da gestão de acessos.

> **ClimaFlux ERP** é um nome provisório de demonstração. A disponibilidade jurídica e comercial da marca ainda não foi validada.

## Novidades da v0.6.2

- Tela de entrada demonstrativa em `/login.html`.
- Sessão local de navegação antes da autenticação Google definitiva.
- Botão **Sair do sistema** no ERP e na Gestão de Acessos.
- Confirmação antes de encerrar a sessão.
- Redirecionamento seguro para a tela de entrada após o logout.
- Dados operacionais preservados ao sair; apenas a sessão é encerrada.
- Atalho flutuante para `/admin-access.html` dentro do ERP.
- Service worker atualizado para invalidar o cache anterior e entregar as novas telas.
- Quality gate que valida entrada, saída, Gestão de Acessos e cache PWA.

## Gestão de acessos — prévia funcional

A rota `/admin-access.html` permite testar:

- pesquisa e filtros de usuários;
- alteração de empresa, perfil e status;
- criação de novos usuários;
- indicadores de ativos, pendentes e suspensos;
- histórico local de alterações;
- restauração dos dados demonstrativos.

As alterações dessa prévia ficam no `localStorage` do navegador e **ainda não controlam o acesso real ao ERP**. A integração robusta com Google, Cloudflare Worker e D1 está sendo desenvolvida separadamente.

## Perfis demonstrativos

- Administrador
- Atendimento
- Técnico
- Estoque
- Financeiro
- Gestor

## Recursos implementados

- Dashboard operacional, financeiro e de estoque.
- Área mobile do técnico com rota diária, checklist, medições, fotos e assinatura.
- Ordens de serviço com fluxo de status, histórico e SLA.
- Fila de despacho ordenada por criticidade e vencimento.
- Clientes, equipamentos e contratos preventivos.
- Orçamentos com aprovação e conversão em OS.
- Vendas com baixa automática de estoque e lançamento financeiro.
- Compras com recebimento, entrada no estoque e conta a pagar.
- Consumo de materiais diretamente na OS.
- Contexto multiempresa, notificações, auditoria, backup e restauração.
- Portal demonstrativo do cliente.
- PWA com atualização de cache e fallback offline.

## Executar localmente

```bash
npm install
npm run serve
```

Acesse `http://localhost:8080`. O primeiro acesso é direcionado para `/login.html`.

## Validar o release

```bash
npm run build:public
```

O build:

1. valida os 27 fragmentos da aplicação e o SHA-256 original;
2. extrai os assets do ERP;
3. adiciona as telas de entrada, sessão e Gestão de Acessos;
4. substitui o service worker pela versão `climaflux-v062-session-shell`;
5. confirma que os 14 arquivos públicos obrigatórios foram gerados.

SHA-256 do pacote-base:

```text
276dc082e046d202aeab91b807ee3bba9b20a403eba0187163f14e107b3750a5
```

## Publicação

```bash
npm run deploy
```

O Wrangler executa `scripts/build-public.mjs` e publica somente a pasta `public` no Cloudflare Workers Static Assets.

## Limitação de segurança

A sessão da v0.6.2 é uma **simulação funcional no navegador**. Ela serve para validar a experiência de entrada e saída, mas não substitui autenticação no servidor. Dados operacionais e permissões ainda precisam migrar para APIs autenticadas com autorização por empresa antes de uso real em produção.

## Arquitetura de produção proposta

- Front-end React + TypeScript com PWA para técnicos.
- Cloudflare Worker/API TypeScript para autenticação e serviços.
- Google Identity Services com validação criptográfica do ID token.
- D1/PostgreSQL com isolamento obrigatório por `tenant_id`.
- Sessões revogáveis em cookies `Secure`, `HttpOnly` e `SameSite`.
- Motor de SLA no servidor com calendário comercial, feriados e pausas auditáveis.
- Object storage para fotos, laudos, anexos e assinaturas.
- Auditoria imutável, observabilidade, backups e controles LGPD.
