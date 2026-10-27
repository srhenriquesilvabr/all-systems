# All Systems — Documento de Arquitetura

> Status: **rascunho v0.2** · Última atualização: 2026-10-22

Plataforma SaaS modular e multi-tenant. Um **core** comum a todos os clientes, mais **verticais** contratáveis: lavanderia, salão, pet shop, veterinária, estética, ortodontia, padaria, advocacia, revenda de veículos, imobiliária, consórcio, contabilidade e RH. A Shopify é usada para vender o próprio SaaS e, opcionalmente, como canal de venda de cada cliente.

## Índice

| # | Documento | Conteúdo |
|---|---|---|
| 01 | [Visão geral](01-visao-geral.md) | Contexto, modelo de 3 níveis, princípios, stack |
| 02 | [Sistema de módulos](02-sistema-de-modulos.md) | Camadas, manifesto, ativação por tenant, permissões, eventos, estrutura do monorepo |
| 03 | [Multi-tenancy e dados](03-multi-tenancy-e-dados.md) | Isolamento, RLS, modelo de dados do core |
| 04 | [Módulos do core](04-core.md) | Login, usuários, permissões, recuperação de senha, clientes, financeiro, clusterização |
| 05 | [Integração Shopify](05-integracao-shopify.md) | Loja do SaaS (nível 1), lojas dos clientes (nível 3), webhooks, metacampos, checkout |
| 06 | [Infraestrutura AWS](06-infra-aws.md) | Serviços, ambientes, CI/CD, observabilidade, segurança |
| 07 | [Vertical Lavanderia](07-vertical-lavanderia.md) | Primeira vertical, detalhada |
| 08 | [Roadmap e riscos](08-roadmap-e-riscos.md) | Fases, validações pendentes, riscos |
| 09 | [Verticais e módulos compartilhados](09-verticais.md) | O que cada vertical faz, pontos de extensão, limites |
| 10 | [Integração bancária](10-integracao-bancaria.md) | Crédito e consórcio: modos, contrato da API, webhook, LGPD |
| — | [Registro de decisões](decisoes.md) | ADRs tomadas e pendentes |

## Resumo em um parágrafo

Um **monolito modular** em **NestJS** (API e workers) com um admin em **React**, rodando na **AWS** (sa-east-1) sobre **PostgreSQL**, que é a fonte da verdade. Todos os módulos são publicados juntos, e cada tenant só enxerga e acessa os módulos que contratou. A **Shopify** tem dois papéis: (1) uma loja nossa que vende os pacotes do SaaS e dispara o provisionamento do tenant; (2) um **módulo de integração opcional**, que conecta a loja Shopify do cliente ao admin dele para vender serviços e produtos com o checkout da Shopify. Metacampos guardam apenas uma **cópia** do que a vitrine e o checkout precisam exibir.

## Glossário

| Termo | Significado |
|---|---|
| **Tenant** | Empresa contratante, por exemplo "Lavanderia Bolha Azul". Unidade de isolamento de dados |
| **Unidade** | Filial ou local físico de um tenant |
| **Módulo** | Pedaço funcional com manifesto próprio (permissões, rotas, menu, tabelas, eventos) |
| **Camada** | `core` (sempre ativo), `shared` (compartilhado entre verticais), `vertical` ou `integration` |
| **Pacote** | Conjunto vendável de módulos, por exemplo "Sistema Lavanderia Profissional" |
| **Loja SaaS** | Nossa loja Shopify, que vende os pacotes (nível 1) |
| **Loja do cliente** | Loja Shopify do tenant, conectada pelo módulo `integration.shopify` (nível 3) |
| **OS** | Ordem de serviço |
