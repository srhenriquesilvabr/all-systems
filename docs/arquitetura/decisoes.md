# Registro de decisões (ADRs)

Formato curto: contexto → decisão → consequências. Novas decisões entram no fim da lista com número sequencial e nunca são apagadas. Se uma decisão mudar, ela é marcada como *substituída por ADR-N*.

## Tomadas

### ADR-001 — Monolito modular
- **Contexto:** muitas verticais com core comum e um time inicial pequeno.
- **Decisão:** um único código e deploy, dividido em módulos com fronteiras verificadas no CI. Ativação por tenant em runtime.
- **Consequências:** operação simples e refatoração fácil. Um módulo só é extraído como serviço se houver necessidade medida (escala ou isolamento).

### ADR-002 — NestJS (API/worker) + React (admin)
- **Decisão:** TypeScript em todo o sistema. NestJS pelo sistema de módulos, DI e guards. React + Vite como SPA, já que o admin não precisa de SSR.
- **Alternativas consideradas:** Laravel + Vue/Inertia, Django + React, .NET + React.

### ADR-003 — Banco único com `tenant_id` + RLS
- **Decisão:** um schema compartilhado, `tenant_id` em toda tabela de negócio e políticas RLS forçadas.
- **Consequências:** migrations rodam uma vez e o isolamento é garantido pelo banco. Cluster dedicado fica como exceção futura (`tenants.db_cluster`).

### ADR-004 — PostgreSQL é a fonte da verdade; metacampos são cópia
- **Decisão:** a Shopify é canal de venda. Metacampos só guardam o que a vitrine, o checkout ou a conta do cliente exibem. Dados sensíveis nunca saem da AWS.

### ADR-005 — Modelo Shopify de 3 níveis
- **Decisão:** (1) uma loja nossa vende o SaaS; (2) o admin AWS é o produto; (3) a loja Shopify do tenant é um módulo opcional.
- **Alternativa rejeitada:** uma loja Shopify compartilhada por todos os tenants, que implicaria intermediação de pagamento, nota fiscal confusa, marca única, clientes misturados e conflito com os termos da Shopify.

### ADR-006 — Drizzle como ORM
- **Contexto:** cada módulo precisa ser dono do seu schema e das suas migrations, e o RLS exige `set_config` por transação.
- **Decisão:** Drizzle, com schema em TS dentro de cada módulo, SQL explícito e suporte a políticas RLS.
- **Alternativa:** Prisma, que tem tooling maduro mas é menos natural para schema distribuído por módulo e transação com `set_config` em toda query.

### ADR-007 — Autenticação própria
- **Decisão:** auth no NestJS (argon2id, JWT curto + refresh rotativo). Não usar Cognito.
- **Motivo:** o modelo usuário ↔ vários tenants, as permissões por módulo e a recuperação de senha com e-mail próprio ficam mais simples e testáveis.
- **Revisitar se:** surgir exigência de SSO corporativo em muitos tenants.

### ADR-008 — AWS sa-east-1, ECS Fargate, CDK
- **Decisão:** containers no Fargate, eventos via EventBridge/SQS, IaC em CDK TypeScript.

### ADR-009 — Outbox no Postgres com relay em processo worker
- **Contexto:** e-mails (e depois Shopify, NFS-e) precisam sair só se a transação confirmar, e com nova tentativa.
- **Decisão:** tabela `outbox_events` gravada na mesma transação. Um worker (mesmo código, outro entrypoint) faz polling com `FOR UPDATE SKIP LOCKED`, registra a entrega por handler (`outbox_deliveries`) e aplica espera exponencial (até 10 tentativas). A tabela não tem RLS: o relay lê todos os tenants e só o `OutboxService` grava.
- **Consequências:** sem infraestrutura extra em dev. Em produção, o relay pode publicar no SQS/EventBridge sem mudar quem publica. Entrega "pelo menos uma vez": handlers idempotentes.

### ADR-010 — Um único "a receber" por origem
- **Decisão:** módulos que geram cobrança (OS hoje; pedidos depois) mantêm no financeiro um lançamento pendente com o saldo em aberto (`syncReceivableInTx`) e um lançamento pago por pagamento recebido. Pago ou cancelado zera o pendente.
- **Consequências:** contas a receber e fluxo de caixa saem do mesmo livro, sem dupla contagem. Lançamentos de módulos só são alterados pelo módulo de origem.

### ADR-011 — Reconciliação de tenants no boot
- **Decisão:** ao subir, a aplicação ativa em cada tenant os módulos core novos e as dependências novas, e alinha os papéis padrão ao manifesto. Uma instância por vez (advisory lock). Módulos suspensos não são reativados.
- **Consequências:** publicar uma versão com módulo novo não exige script manual por cliente. Com muitos tenants, mover para um job em lote.

## Pendentes

| ID | Decisão | Depende de |
|---|---|---|
| ADR-P1 | Cobrança recorrente do SaaS: Shopify subscriptions ou gateway brasileiro | Validação V1 |
| ADR-P2 | Distribuição do app nível 3: público ou personalizado | Validação V2 |
| ADR-P3 | Provedor de NFS-e | Validação V4 |
| ADR-P4 | Provedor de WhatsApp | Validação V5 |
| ADR-P5 | Gateway de pagamento padrão do `integration.payments` | Taxas, Pix, split futuro |
