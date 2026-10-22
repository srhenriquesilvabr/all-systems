# 01 — Visão geral

## Problema

Negócios de serviço muito diferentes (lavanderia, clínicas, cartório, academia) precisam das mesmas fundações: usuários, permissões, cadastro de clientes, financeiro e inteligência sobre a base de clientes. Cada segmento também tem fluxos próprios. Queremos **construir as fundações uma vez** e vender combinações de módulos por segmento.

## Modelo de 3 níveis

```
NÍVEL 1 — LOJA SaaS (nossa, 1 loja Shopify)
  Vende pacotes e add-ons do sistema ──► pedido pago ──► provisiona tenant
                                                            │
NÍVEL 2 — ADMIN ALL SYSTEMS (AWS, multi-tenant)            ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  VERTICAIS     Lavanderia │ Veterinária │ Odonto │ Ortopedia │ Estética  │
│                Cartório │ Academia                                       │
│  SHARED        Ordem de Serviço │ Agenda │ Prontuário │ Assinaturas │    │
│                Estoque │ Notificações                                    │
│  INTEGRATION   Shopify │ NFS-e/NF-e │ Gateway (Pix/boleto) │ WhatsApp    │
│  CORE          Login │ Usuários │ Permissões │ Recuperação de senha │    │
│                Clientes │ Financeiro │ Clusterização │ Auditoria         │
└──────────────────────────────────────────────────────────────────────────┘
                     ▲  webhooks            │ Admin API (produtos, metacampos)
                     │                      ▼
NÍVEL 3 — LOJA DO CLIENTE (opcional, 1 loja Shopify por tenant)
  Catálogo de serviços/produtos · Checkout · POS · Conta do cliente final
```

- **Nível 1** é o nosso canal de vendas. A Shopify cuida da vitrine e do pagamento do SaaS.
- **Nível 2** é o produto. Concentra toda a lógica e todos os dados.
- **Nível 3** é um **módulo opcional** para tenants que vendem ao consumidor final. Um cartório ou uma clínica de ortopedia usa só o nível 2 e cobra pelo módulo de gateway (link de Pix ou boleto).

## Princípios

1. **O PostgreSQL é a fonte da verdade.** A Shopify é um canal. Metacampos são cópia, nunca origem.
2. **O core não conhece as verticais.** As dependências apontam só para baixo (vertical → shared → core). A comunicação no sentido contrário acontece por eventos.
3. **Tudo é publicado junto e ativado por tenant.** Não há build por cliente. A ativação acontece em runtime, por `tenant_modules`.
4. **O isolamento de tenant fica no banco.** O Row-Level Security do Postgres garante o isolamento mesmo se a aplicação errar.
5. **Customização é configuração, não fork.** Campos customizados, settings por módulo e papéis editáveis. Nunca código específico de um cliente.
6. **Dados sensíveis não saem da AWS.** Dados de saúde (LGPD, art. 11) e dados de cartório nunca vão para a Shopify.
7. **Simples primeiro.** Começamos com um monolito modular e só extraímos um serviço quando houver necessidade medida.

## Stack

| Camada | Escolha | Motivo |
|---|---|---|
| Linguagem | TypeScript em tudo | Uma linguagem para API, admin, extensões Shopify e IaC |
| API e workers | **NestJS** | Módulos, DI, guards e interceptors se encaixam no sistema de módulos |
| Admin | **React + Vite** (SPA), React Router, TanStack Query | O admin fica atrás de login e não precisa de SSR nem SEO |
| UI | Tailwind + shadcn/ui | Componentes próprios, sem amarrar a marca à Shopify |
| Banco | **PostgreSQL 16** (RDS) | RLS, JSONB, views materializadas |
| ORM | **Drizzle** | O schema é um arquivo TS por módulo, com suporte a RLS e SQL explícito (ver [decisões](decisoes.md)) |
| Validação | Zod | Contratos compartilhados entre API e admin |
| Monorepo | pnpm workspaces + Turborepo | |
| Filas e eventos | SQS + EventBridge | Webhooks da Shopify entram direto no EventBridge |
| IaC | AWS CDK (TypeScript) | |
| Shopify | Shopify CLI, Admin GraphQL API, extensões (theme app, checkout UI, customer account UI, Functions) | |
