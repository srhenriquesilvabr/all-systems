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

### ADR-008 — AWS sa-east-1, ECS Fargate, CDK (*substituída por ADR-023*)
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

### ADR-012 — Pix estático antes do gateway
- **Contexto:** o gateway (ADR-P5) ainda não foi escolhido, mas o balcão precisa cobrar Pix desde o piloto.
- **Decisão:** `integration.payments` gera o BR Code "copia e cola" localmente a partir da chave Pix da empresa, com valor e txid (`OS<nº>`). Quem recebe confere no banco e registra o pagamento na ordem.
- **Consequências:** sem custo de gateway e sem credenciais. Não há baixa automática. Quando o gateway for escolhido, ele entra como outro provedor no mesmo módulo, com webhook de confirmação via outbox.

### ADR-013 — Versão do módulo por tenant (upgrade)
- **Decisão:** `tenant_modules.version` guarda a versão do manifesto cujo `onEnable` já rodou. Na reconciliação do boot, versão diferente roda o `onEnable` (idempotente) de novo.
- **Consequências:** dados iniciais novos (ex.: tipos de peça) chegam aos tenants existentes ao publicar uma versão nova, sem script manual. Todo `onEnable` precisa ser idempotente.

### ADR-014 — Arquivos: metadados no Postgres, conteúdo no storage
- **Decisão:** a tabela `files` (com RLS) guarda dono, tipo e tamanho; o conteúdo vai para um `FileStorage` (disco local em dev, S3 em produção). O download passa pela API (`/files/:id`), que confere o tenant. Upload só pelos módulos donos (ex.: foto de peça), que checam a permissão.
- **Consequências:** isolamento por tenant garantido pelo mesmo RLS. Em produção, servir por URL pré-assinada do S3 para não passar bytes pela API.

### ADR-015 — WhatsApp em três modos
- **Decisão:** `integration.whatsapp` envia pela API oficial da Meta (Cloud API) quando configurada; sem ela, monta a mensagem com link `wa.me` para a equipe enviar ("manual"); "simulated" para testes. Respostas por botão chegam por webhook com HMAC e viram evento.
- **Consequências:** funciona desde o primeiro dia sem conta Business; com a conta, os lembretes passam a ter confirmação automática. Resolve a parte técnica da ADR-P4.

### ADR-016 — Agenda compartilhada com garantia no banco
- **Decisão:** `shared.scheduling` é usado por todas as verticais com horário marcado. Sobreposição do mesmo profissional é barrada por constraint EXCLUDE (btree_gist), não só pela aplicação. Fuso fixo America/Sao_Paulo.
- **Consequências:** duas recepções marcando ao mesmo tempo não geram conflito. Fuso por tenant fica para quando houver clientes fora do horário de Brasília.

### ADR-017 — Prontuário só de inclusão, garantido pelo banco
- **Decisão:** `mr_entries` e `mr_access_log` não têm UPDATE/DELETE para o `app_user` (REVOKE na migration). Correção é uma retificação que aponta para o original. Toda leitura, inclusão e download de anexo fica no log. Anexos de prontuário não saem pelo download genérico de arquivos.
- **Consequências:** atende a exigência ética de não alterar registro clínico e dá rastreabilidade para a LGPD (dado sensível). O prontuário não é apagado com o cliente (guarda legal); o cadastro, sim.

### ADR-018 — Extensão por registro, não por import
- **Decisão:** verticais estendem módulos compartilhados registrando peças (fluxos de ordem, *pricers* da agenda, seletores, formulários, abas) e reagindo a eventos. Itens de menu podem substituir o genérico (`replaces`).
- **Consequências:** o shared não conhece as verticais e nenhuma vertical depende de outra. Cada registro só vale com o módulo dono ativo no tenant.

### ADR-019 — Estoque por saldo + movimentos
- **Decisão:** `sales_products.stock` guarda o saldo; cada mudança grava um movimento com o saldo resultante, na mesma transação e com a linha do produto travada. Vender sem estoque é permitido por padrão (padaria produz e vende no dia); bloqueio é configurável.
- **Consequências:** saldo consistente sob concorrência e auditável. Inventário vira um movimento de ajuste.

### ADR-020 — Segmentação RFM a partir do financeiro
- **Decisão:** a etapa 1 da clusterização usa os recebimentos pagos do financeiro (com cliente) como fonte única. Notas 1–5 por posição relativa (`percent_rank`) dentro da empresa e segmentos por regra fixa. Recalculado por job diário e sob demanda.
- **Consequências:** funciona para qualquer vertical sem código específico. Vendas sem cliente identificado não entram.

### ADR-021 — Integração bancária por provedores
- **Decisão:** `integration.banking` define a interface `BankProvider` com dois provedores: simulado (taxas configuradas, matemática real) e REST genérico com OAuth2 e webhook HMAC por conexão ([10](10-integracao-bancaria.md)). As verticais reagem a `proposal_updated`.
- **Consequências:** o produto pode ser demonstrado e testado sem banco. Produção depende de contrato com cada instituição (ADR-P8); APIs fora do contrato padrão entram como adaptadores.

### ADR-022 — Folha calcula e registra, não transmite
- **Decisão:** `hr` calcula INSS, IRRF (com a redução da Lei 15.270/2025) e FGTS com tabelas configuráveis, guarda uma cópia das tabelas em cada folha e lança o fechamento no financeiro. Não transmite eSocial/DCTFWeb/FGTS Digital.
- **Consequências:** útil para empresas pequenas e escritórios conferirem a folha; a transmissão segue no software homologado ou entra depois como integração (ADR-P7).

### ADR-023 — Produção no Cloudflare Workers + Supabase (substitui ADR-008)
- **Contexto:** queremos publicar a cada push no GitHub, sem servidores nem infraestrutura para manter.
- **Decisão:** um Worker `palmer-systems` serve o admin (assets estáticos) e a mesma API Nest em `/api/*`, sobre o servidor HTTP do Node que o runtime emula (`nodejs_compat`). O Postgres é o Supabase, acessado pelo Hyperdrive com cache desligado. Fotos e documentos ficam no R2, e-mails saem pelo Resend. O Cron Trigger, a cada minuto, faz o papel do processo worker: drena o outbox e roda os jobs vencidos. Após cada requisição que altera dados, o outbox também é drenado em segundo plano.
- **Consequências:** a conexão com o banco é aberta a cada requisição, porque o runtime não deixa reaproveitar sockets entre requisições. Não há módulos nativos, por isso o argon2id passou para JS puro, no mesmo formato de hash. O Supabase expõe o schema `public` pela Data API; a migration 0015 tira o acesso dos papéis `anon` e `authenticated`. Os dados continuam na AWS sa-east-1, no Supabase. A sincronização dos manifestos sai do boot (cada isolate sobe sozinho) e roda no deploy. O caminho Node (`pnpm dev`, worker, CLI e testes) continua valendo para desenvolvimento.

## Pendentes

| ID | Decisão | Depende de |
|---|---|---|
| ADR-P1 | Cobrança recorrente do SaaS: Shopify subscriptions ou gateway brasileiro | Validação V1 |
| ADR-P2 | Distribuição do app nível 3: público ou personalizado | Validação V2 |
| ADR-P3 | Provedor de NFS-e | Validação V4 |
| ADR-P4 | Provedor de WhatsApp | Validação V5 |
| ADR-P5 | Gateway de pagamento padrão do `integration.payments` | Taxas, Pix, split futuro |
| ADR-P6 | Emissão fiscal no PDV (NFC-e) | UF dos primeiros clientes, provedor |
| ADR-P7 | Transmissão de eSocial / DCTFWeb / FGTS Digital | Parceiro homologado ou certificado A1 por cliente |
| ADR-P8 | Parcerias bancárias reais (financiamento e consórcio) | Contratos de correspondente / integrador |
