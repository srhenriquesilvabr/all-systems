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

### ADR-027 — Consultoria de RH: empregador no colaborador e na folha
- **Contexto:** a consultoria de RH (cliente da Palmer) processa a folha de várias empresas-clientes; o RH só conhecia a própria empresa (uma folha por competência e tipo, tudo lançado no financeiro).
- **Decisão:** `hr_employees` e `hr_payrolls` ganham `employer_customer_id` (FK para `customers`, só tipo empresa, conferido na aplicação; vazio = a própria empresa). Folha única por competência + tipo + empregador e contrato único por pessoa + empregador, com dois índices únicos parciais cada (empregador vazio / preenchido), para valer também na própria empresa. A mesma pessoa da equipe pode ser colaboradora de várias empresas-clientes (e da consultoria); os contratos de empresa-cliente não alteram início/encerramento da pessoa (que desativa o profissional da agenda). O empregador só muda antes da primeira folha. Na folha, férias e rescisão de empresa-cliente nada vai para o financeiro da consultoria (salários e guias são pagos pela empresa-cliente): a folha fecha, gera holerites e um resumo imprimível com as guias. O RH (camada shared) não conhece o ramo: o `hr_consulting` registra no `HrEmployersRegistry` (ADR-018), o que liga os empregadores no tenant (`GET /hr/employers` responde `enabled`, e as telas do RH mostram o seletor de empresa) e recebe, na mesma transação, o fechamento da folha e a rescisão confirmada. O ramo guarda os honorários por empresa (`hrc_clients`: por colaborador na folha ou fixo, dia de vencimento, opcional na 2ª parcela do 13º e por rescisão) e lança a receita a receber da empresa (origem `hrc_fee`).
- **Consequências:** tenants sem o ramo seguem iguais (empregador sempre vazio; a API recusa empregador com `EMPLOYERS_DISABLED`). Na consultoria, a equipe (core) lista também os colaboradores das empresas-clientes, com o vínculo "Colaborador (RH) — Empresa". Trocar um colaborador de empresa depois de folha fechada exige desligar e admitir de novo. A FK impede apagar um cliente que é empregador. Honorário de folha já fechada não é recalculado se a configuração mudar depois.

### ADR-028 — Lojinha: anúncios sobre o PDV, reserva calculada e checkout por provedor
- **Contexto:** o cliente da Palmer quer vender os produtos dele num endereço da Palmer Tech (`/loja/<slug>`), mas o checkout definitivo (gateway, Pix com baixa automática) ainda não foi escolhido (ADR-P5).
- **Decisão:** módulo `store` (camada shared, contratável). O anúncio (`store_listings`, um por produto) guarda só o que a vitrine mostra a mais (título, descrição, categoria, fotos no storage com dono `store_photo`, destaque, preço promocional com validade); preço, nome e estoque continuam no `shared.sales`, sem coluna nova lá. O pedido (`store_orders`, número por `tenant_sequences` `store_order`) segue novo → confirmado → em preparo → pronto (retirada) ou saiu para entrega → concluído, com cancelamento por motivo. A reserva de estoque não é um movimento: é a soma dos itens dos pedidos confirmados e ainda em aberto, descontada do saldo do PDV no que a vitrine oferece e no que a confirmação aceita (confirmações da empresa passam uma por vez, por trava da transação; com o bloqueio de venda sem estoque ligado no PDV, confirmar sem saldo é recusado, senão vem com aviso). Concluir chama `SalesService.sellInTx` na mesma transação, com o preço do pedido (`unitPrices`): estoque, sessão de caixa, financeiro e o evento de venda saem como no PDV; a taxa de entrega é receita de serviço à parte (origem `store_order`). O cliente é ligado pelo celular, depois pelo e-mail, ou criado, ao confirmar (não ao receber o pedido, para robôs não criarem cadastros). A finalização é uma interface (`StorePaymentProvider`): "WhatsApp" (link `wa.me` com o resumo) e "pagar na retirada/entrega" vêm prontos; "online" só aparece quando um provedor registrado disser que está disponível, e a confirmação dele chama `StoreOrdersService.markPaidInTx`. Como `integration.payments` não pode importar módulos shared, o provedor online é registrado por uma ponte que conheça os dois pacotes. A vitrine é pública (mesmo padrão das vagas): throttle por IP, armadilha para robôs, limite de pedidos por IP e por celular, consentimento LGPD versionado guardado no pedido e CEP pelo servidor.
- **Consequências:** nenhuma mudança no schema de vendas; o PDV não enxerga a reserva (pode vender o que um pedido confirmado segura). Pedido concluído não volta: cancela-se a venda no PDV, e a taxa de entrega fica no financeiro até ser estornada à mão. Avisos ao cliente saem pelo `shared.notifications` (e WhatsApp, se ativo) só quando esses módulos estão ativos; sem eles o fluxo segue igual.

### ADR-030 — Catálogo de administradoras e conexão manual (sem API)
- **Contexto:** os clientes vendem cotas de bancos (Itaú, Bradesco, Caixa, Santander, BB) e de independentes (Embracon, Porto, Rodobens, Ademicon…). Nenhuma publica API: a integração real depende de contrato e credenciais de cada corretora (ADR-P8), e muitas só oferecem portal do parceiro.
- **Decisão:** `integration.banking` ganha um catálogo de referência (`contracts/catalog.ts`: tipo, linhas de consórcio, canal mais comum e o que é preciso para ligar, tudo marcado "a confirmar") e a conexão guarda `catalog_key`. Modos: `simulated` (demonstração), `api` com o adaptador REST genérico ou o adaptador da administradora (`VendorAdapters`; hoje esqueletos que respondem "a confirmar com a administradora", sem inventar endpoints ou campos) e `manual`: a proposta é registrada com protocolo local, não há consulta de status, e a equipe registra a resposta (`POST /banking/proposals/:id/manual`; adesão aprovada exige grupo e cota). Os planos da conexão manual são cadastrados nela (`manual_plans`). A resposta manual publica o mesmo `proposal_updated`.
- **Consequências:** o consórcio acompanha igual (ativação, parcelas, comissão) qualquer que seja o modo. Uma administradora que falha na listagem de planos derruba a sincronização com 502 (pular deixaria os planos dela "fora de oferta"). Escrever um adaptador real é uma classe nova registrada em `VendorAdapters`.

### ADR-031 — Consulta de crédito só com autorização registrada
- **Contexto:** a venda de cota precisa de análise de crédito (Serasa Experian, Boa Vista/Equifax, Quod), cada birô com contrato e produto próprios. A consulta é dado pessoal com finalidade específica.
- **Decisão:** módulo `integration.credit_bureau` (contratável). Toda consulta grava antes a autorização (`cb_consents`: finalidade, data, forma, prova, texto exato e quem registrou) e depois a consulta (`cb_queries`: só o resumo — score 0–1000, faixa, contagem/valor de negativações, protestos, cheques —, custo configurado, quem consultou e a decisão "seguir"/"reprovar" de uma pessoa). Abrir o resultado, consultar e decidir vão para a auditoria (documento mascarado). Provedores atrás de `CreditBureauAdapter`: o simulado (determinístico pelo documento) e esqueletos dos birôs, que respondem "a confirmar" até a documentação do contrato. Teto mensal configurável. O consórcio pode exigir consulta aprovada nos últimos 30 dias para enviar a adesão (`requireCreditApproval`).
- **Consequências:** a resposta bruta do birô nunca é guardada; consulta que falha fica no histórico sem custo. A base legal "proteção do crédito" (LGPD art. 7º, X) dispensaria o consentimento, mas a regra do produto é sempre registrar a autorização.

### ADR-032 — Captação de leads no consórcio sem listas de terceiros
- **Contexto:** o dono quer captar clientes. Buscar "quem tem ou já teve carta de consórcio" é vedado (sigilo bancário, LC 105/2001, e LGPD).
- **Decisão:** a captação fica no próprio `consortium` (sem módulo novo para ativar): leads só de quem pediu contato — simulador público com a marca da empresa (`/consorcio/<slug>`, aceite versionado, armadilha, limites por IP e celular, deduplicação por celular em 24 h), formulários de anúncio (Meta Lead Ads: webhook único do app com `X-Hub-Signature-256`, rota página → empresa em `cons_lead_routes` sem RLS, leitura do lead pela Graph API no worker com o token da página cifrado; Google Ads: webhook por canal com a chave `google_key` cifrada), planilha e cadastro manual (com a base do contato) e indicação (link por cliente/vendedor). Funil novo → em contato → simulação enviada → proposta → venda/perdido; "venda" só quando a adesão da cota ligada ao lead é aceita. Rodízio opcional entre vendedores (trava por empresa), retornos, WhatsApp com mensagem pronta, relatório por origem/vendedor/campanha, anonimização a pedido e por prazo de guarda (job diário).
- **Consequências:** públicos e semelhantes ficam nas plataformas de anúncio; o sistema não compra nem raspa listas. Quem não gerencia vê só os próprios leads e os sem vendedor. Um slug de empresa igual a um caminho do admin em `/consorcio/<trecho>` (ex.: "cotas") não tem simulador público.

### ADR-033 — Nota fiscal por provedor de emissão, desacoplada por eventos
- **Contexto:** a maioria dos ramos precisa de NFS-e (NFS-e Nacional obrigatória para os municípios desde jan/2026, LC 214/2025), o PDV precisa de NFC-e e a venda a empresas, de NF-e; os documentos de 2026 levam IBS/CBS. Falar direto com 27 SEFAZ e mais de 5.500 prefeituras é inviável, e o provedor ainda não foi escolhido (ADR-P3, ADR-P6).
- **Decisão:** módulo `integration.fiscal` (contratável) com a interface `FiscalProvider`: modo simulado (determinístico, só homologação), adaptador Focus NFe (campos não confirmados na documentação pública marcados "a confirmar") e esqueletos de PlugNotas e NFE.io. Cadastro fiscal em tabelas próprias (produto e serviço), sem coluna nova em vendas/agenda. Como a integração não importa módulos shared, as origens chegam por eventos do outbox com a cópia do que a nota precisa (`shared.sales.sale_completed`/`sale_cancelled`, `shared.scheduling.payment_recorded`, `shared.service-orders.status_changed`, publicados com a menor alteração possível) e ficam em `fiscal_sources`. A emissão sai pelo outbox; a situação volta por webhook (segredo por empresa) ou consulta a cada 5 min; falha de comunicação tenta de novo com a mesma referência. XML/DANFE no storage (dono protegido, download auditado), notas e histórico sem DELETE para a aplicação (guarda de 5 anos). Certificado A1 lido com node-forge (roda no Workers), arquivo no storage e senha cifrada. Detalhes em [11](11-integracao-fiscal.md).
- **Consequências:** demonstrável e testável sem provedor; produção depende de contrato com o provedor, token por empresa, certificado A1 e CSC (NFC-e), e da confirmação dos campos marcados. Os códigos e alíquotas são do cliente e do contador: o sistema confere só o formato. Trocar de provedor é escrever um adaptador.

### ADR-034 — Contratação pelo site e telas sob demanda
- **Contexto:** a empresa era criada por comando, sem escolher ramo; o botão de contratar não fazia nada; todo navegador baixava as telas de todos os ramos (435 KB comprimidos).
- **Decisão:** cadastro público em `/contratar` (um ramo, status `trial`, sem cobrança) com honeypot, tempo mínimo de preenchimento, consentimento registrado, limite de 5 por IP/hora e teto diário (`SIGNUP_DAILY_LIMIT`, 0 fecha o cadastro). E-mail que já tem conta é recusado, para ninguém anexar empresa à conta alheia. O dono contrata ramos e módulos em `POST /modules/:key/activate`, com efeito imediato. No admin, cada módulo é um arquivo baixado só quando está ativo na empresa.
- **Consequências:** entrada e contratação sem intervenção da Palmer, e cerca de 40% menos JavaScript. Sem cobrança, tudo é gratuito até haver gateway; sem Resend, o e-mail do cadastro não é confirmado. A API continua com todos os módulos: é uma instância só para todas as empresas, e o isolamento dela é por `tenant_modules`.

### ADR-035 — Worker na região do banco e limite de requisições sem timer
- **Contexto:** com `placement: smart`, o Worker ficava em São Paulo e o banco em us-west-2: 17 ms de CPU e cerca de 2 s de espera em toda chamada com banco. E o `ThrottlerStorageService` amarra um timer à requisição que inicia o Nest (`AsyncResource.bind`): no Workers, chamá-lo de outra requisição dá erro, o que causava 500 em toda a instância, inclusive no login.
- **Decisão:** `placement` fixo em `aws:us-west-2` e `IsolateThrottlerStorage`, sem timer, com a limpeza feita durante as chamadas.
- **Consequências:** chamadas com banco caíram para cerca de 410 ms. Se o banco mudar de região, o `placement` muda junto; um banco em São Paulo reduziria ainda mais o tempo para usuários no Brasil. O limite continua por instância, não global.

## Pendentes

| ID | Decisão | Depende de |
|---|---|---|
| ADR-P1 | Cobrança recorrente do SaaS: Shopify subscriptions ou gateway brasileiro | Validação V1 |
| ADR-P2 | Distribuição do app nível 3: público ou personalizado | Validação V2 |
| ADR-P3 | Provedor de NFS-e (a parte técnica está pronta, ADR-033; falta escolher e contratar) | Validação V4 |
| ADR-P4 | Provedor de WhatsApp | Validação V5 |
| ADR-P5 | Gateway de pagamento padrão do `integration.payments` | Taxas, Pix, split futuro |
| ADR-P6 | Emissão fiscal no PDV (NFC-e) (técnica pronta, ADR-033) | UF dos primeiros clientes, provedor, CSC por empresa |
| ADR-P7 | Transmissão de eSocial / DCTFWeb / FGTS Digital | Parceiro homologado ou certificado A1 por cliente |
| ADR-P8 | Parcerias bancárias reais (financiamento e consórcio) | Contratos de correspondente / integrador |
