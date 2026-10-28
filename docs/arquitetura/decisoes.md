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
- **Consequências:** a conexão com o banco é aberta a cada requisição, porque o runtime não deixa reaproveitar sockets entre requisições. Não há módulos nativos, por isso o argon2id passou para JS puro, no mesmo formato de hash. O Supabase expõe o schema `public` pela Data API; a migration 0015 tira o acesso dos papéis `anon` e `authenticated`. O projeto do Supabase está na AWS us-west-2 (Oregon): os dados ficam fora do Brasil e cada consulta tem mais latência que em sa-east-1. O Hyperdrive reduz o custo de abrir a conexão, não a ida e volta de cada consulta. A sincronização dos manifestos sai do boot (cada isolate sobe sozinho) e roda no deploy. O caminho Node (`pnpm dev`, worker, CLI e testes) continua valendo para desenvolvimento.

### ADR-024 — Sessão de caixa no PDV
- **Contexto:** o PDV só vendia; faltava abertura com troco, sangria/suprimento e fechamento conferido por caixa (terminal).
- **Decisão:** `shared.sales` tem caixas (`sales_registers`) e sessões (`sales_register_sessions`, no máximo uma aberta por caixa, garantido por índice único parcial). O navegador guarda qual caixa ele é; a venda informa o caixa e entra na sessão aberta (`sales_sales.register_session_id`), que fica travada (`FOR SHARE`) até o commit, enquanto o fechamento usa `FOR UPDATE`. Esperado do dinheiro = troco inicial + vendas em dinheiro (já sem troco) + suprimentos − sangrias; nas outras formas, a soma das vendas concluídas. O fechamento grava contado, diferença e um retrato (`closing`) e não muda mais. No financeiro, as vendas continuam lançando a receita (origem `sale`); o caixa só lança sangria/suprimento (com conta do outro lado é transferência sem categoria; sem conta, despesa/receita em "Outras") e a quebra/sobra do dinheiro ("Outras despesas"/"Outras receitas", origem `sales_register_session`). O troco inicial não gera lançamento: é dinheiro que já está na conta Caixa. Exigir caixa aberto é uma configuração (`requireRegisterSession`), desligada por padrão.
- **Consequências:** empresas que já vendem sem caixa (e as de demonstração) não travam; quem liga a exigência passa a ter toda venda do dia num fechamento. Venda lançada com data de outro dia não entra em sessão (o dinheiro dela não está na gaveta). Cancelar venda de sessão fechada não altera o relatório dela. Todas as gavetas usam a mesma conta "Caixa" do financeiro.
- **Revisão (caixa de outro dia):** abertura (`openedAt`), sangria/suprimento (`occurredAt`, coluna nova em `sales_register_moves`) e fechamento (`closedAt`) aceitam um horário passado, nunca futuro, sem limite para trás (mesma regra das outras datas retroativas). As sessões do mesmo caixa não se cruzam: a sessão em vigor num momento é a última aberta até ele e vale até fechar ou até a abertura da seguinte; por isso o índice único "uma aberta por caixa" saiu (pode haver a sessão de agora e a de um dia que já passou, sendo lançada), as fechadas ganharam uma restrição de exclusão e a abertura trava o caixa. Movimentos e o fechamento ficam dentro dessa janela (o fechamento, depois da última venda/movimento). A venda com caixa entra na sessão em vigor no horário dela, se estiver aberta; sem sessão aberta, a de hoje é recusada (caixa fechado) e a de outro dia fica sem sessão, como antes. Sangria, suprimento e quebra/sobra entram no financeiro na data em que aconteceram. O PDV continua mostrando como "aberta" só a sessão mais recente do caixa.

### ADR-025 — Marca por empresa: logo público e cor calculada no navegador
- **Contexto:** o cliente quer o próprio logo e a própria cor no painel e nas páginas públicas (agendamento online, lojinha).
- **Decisão:** os dados cadastrais, o logo e a cor ficam em `tenants` (módulo core `core.company`, permissão `core.company.manage`). O logo é um arquivo em `files` (dono `company_logo`, fora do download genérico) servido sem login por `/api/public/company/<slug>/logo?v=<id do arquivo>`: com a versão atual, cache de um ano; sem ela, cinco minutos. O tipo é conferido pelos bytes; SVG só entra se passar por uma lista do que é permitido (sem script, eventos, links externos, animação, DOCTYPE/entidades, escapes de CSS) e ainda é servido com CSP `sandbox`. A API guarda só a cor principal (#rrggbb) e recusa a que deixa o texto branco dos botões abaixo de 4,5:1; a escala brand-50…900 dos dois temas é calculada no navegador em OKLCH (`@all/ui` `brandPalette`) e sobrepõe os tokens de styles.css. A última paleta fica no localStorage para o index.html aplicar antes da primeira pintura.
- **Consequências:** sem build nem CSS por cliente; trocar a cor é instantâneo e cada página pública aplica a da sua empresa. A regra de contraste do tema escuro vive no cliente (o servidor só confere o tema claro). Logos feitos para fundo escuro ficam sobre um fundo branco no menu; um "logo para fundo escuro" separado fica para quando alguém pedir.

### ADR-026 — Pessoa da equipe única (agenda + RH) e RH como módulo contratável
- **Contexto:** o cadastro do profissional da agenda era só um nome; o RH tinha os dados pessoais do colaborador numa tabela própria. A mesma pessoa podia existir duas vezes, sem nada que as ligasse.
- **Decisão:** o core ganha `core.team` e a tabela `team_members` (nome, sobrenome, CPF validado e único na empresa, RG, nascimento, contato, endereço jsonb, foto, LinkedIn, currículo, início/encerramento, login opcional). Permissões próprias (`core.team.read`/`core.team.manage`); leitura do cadastro e download do currículo vão para a auditoria, e o currículo não sai pelo download genérico. `sch_resources.team_member_id` (profissionais) e `hr_employees.team_member_id` (NOT NULL; nome, CPF, nascimento, e-mail e telefone saem do RH) apontam para a pessoa. Agenda e RH gravam a pessoa pelo `TeamService.saveInTx`, na própria transação; a API do RH continua aceitando os campos pessoais. O encerramento já passado publica `core.team.member_ended` (ao salvar, ou pelo job `core.team.endings` quando a data futura chega), e a agenda deixa o profissional inativo. O cadastro mostra onde a pessoa atua por um registro (`TeamLinksRegistry`), sem o core conhecer os módulos. O CEP é consultado pelo servidor (ViaCEP, `GET /cep/:cep`). O RH passa à camada `shared` (contratável por qualquer ramo) e o ramo "Consultoria de RH" (`hr_consulting`) é uma vertical que depende dele; o pacote continua em `modules/verticals/hr`, com a camada declarada no package.json para a checagem de fronteiras.
- **Consequências:** uma pessoa, um profissional e um colaborador (índices únicos); a rescisão desativa o profissional sem a agenda importar o RH. CPF passa a ter os dígitos conferidos também na admissão (antes só 11 dígitos); valores antigos fora do padrão (CPF, telefone) são aceitos enquanto não forem alterados. Reativar o profissional depois de desfazer um encerramento é manual.

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
