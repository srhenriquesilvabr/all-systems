# 08 — Roadmap e riscos

## Fases

Cada fase termina com algo **utilizável e demonstrável**. As durações dependem do tamanho do time e serão estimadas no planejamento da Fase 1.

### Fase 0 — Validação (antes de codar)
Respostas que podem mudar a arquitetura:

| # | Validar | Com quem | Impacto se der errado |
|---|---|---|---|
| V1 | Assinatura recorrente no checkout Shopify com gateway disponível no Brasil | Shopify / gateways | Usar o plano B: recorrência pelo gateway brasileiro ([05](05-integracao-shopify.md#cobrança-recorrente)) |
| V2 | Distribuição do app do nível 3 (público ou personalizado) e obrigatoriedade da Billing API | Shopify Partners | Muda como o add-on "Integração Shopify" é cobrado |
| V3 | Taxa adicional por transação com gateway de terceiros, por plano | Shopify | Precificação e margem dos tenants |
| V4 | Provedor de NFS-e (cobertura de municípios dos primeiros clientes) | Focus NFe, eNotas, PlugNotas… | Escopo do `integration.nfse` |
| V5 | Provedor de WhatsApp (API oficial Meta/BSP), custo por conversa | BSPs | Custo do pacote Profissional |
| V6 | 3 a 5 lavanderias para entrevista e piloto | Comercial | Escopo do MVP da vertical |

**POC técnica:** loja Shopify de dev → webhook `orders/paid` → EventBridge → SQS → worker NestJS → registro no Postgres com RLS.

### Fase 1 — Fundação · *em andamento*
- [x] Monorepo (pnpm + Turborepo) e CI (GitHub Actions)
- [ ] CDK (dev e staging) e deploy contínuo
- [x] `module-sdk`: manifesto, registry, decorators, contexto da requisição
- [x] Outbox de eventos e worker (entregue na Fase 2, junto com o primeiro consumidor: e-mails)
- [x] Tenancy + RLS + teste de isolamento
- [x] `core.auth` (login, refresh com rotação, recuperação de senha, convite), `core.users`, `core.access`, `core.audit`
- [x] Admin: login, seleção e troca de empresa, menu dinâmico, usuários, papéis e auditoria
- [x] CLI de plataforma: criar empresa, ativar e desativar módulos
- [x] Primeira fatia da Lavanderia (catálogo de serviços) para validar a ativação por tenant
- Ainda não feito: papel `core.admin`, MFA, checagem de senha vazada (HIBP) e unidades/filiais
- **Entrega:** tenant criado manualmente, com usuários, papéis e um módulo ligado e desligado ✔

### Fase 2 — Negócio do core · *concluída*
- [x] `core.customers`: ficha, CPF/CNPJ validados, telefone em E.164, dedup (documento bloqueia; e-mail/telefone avisa), campos customizados, consentimentos com histórico, linha do tempo, exportação e anonimização (LGPD) alcançando todos os módulos
- [x] `core.finance`: contas, categorias padrão, lançamentos (a receber/a pagar), baixa, cancelamento, vencidos, resumo por mês e categoria, saldos, CSV
- [x] `shared.service-orders`: itens, numeração por empresa, fluxo de status registrável por vertical, pagamentos → financeiro, saldo em aberto → "a receber" único
- [x] `shared.notifications`: templates por módulo personalizáveis pelo tenant, envio por e-mail via outbox, histórico com motivo de não envio
- [x] Outbox + worker (`apps/api/src/worker.ts`), com nova tentativa por handler e espera crescente
- [x] Reconciliação de tenants no boot: módulos core novos, dependências novas e papéis padrão alinhados ao manifesto
- Ainda não feito: mesclagem de cadastros duplicados, edição de itens da OS pela tela (a API já aceita), fuso horário por tenant (hoje fixo em São Paulo), devolução de pagamento de OS cancelada
- **Entrega:** cadastro de clientes e financeiro básico utilizáveis ✔

### Fase 3 — Lavanderia MVP (balcão) + piloto
- `laundry` conforme o MVP em [07](07-vertical-lavanderia.md#mvp-o-que-entra-primeiro)
- `integration.payments` (Pix)
- **Entrega:** uma lavanderia piloto operando o balcão no sistema

### Fase 4 — Loja SaaS (nível 1) e provisionamento
- Loja Shopify com pacotes Lavanderia, provisionamento automático, onboarding, suspensão por inadimplência
- **Entrega:** um cliente novo compra, recebe o acesso e configura sozinho

### Fase 5 — Loja do cliente (nível 3)
- `integration.shopify`: conexão, webhooks, sync de serviços e clientes, metacampos, extensões (theme, customer account, página de obrigado)
- Lavanderia online com coleta e cobrança da diferença
- **Entrega:** a lavanderia piloto vende online

### Fase 6 — Inteligência e fiscal
- `core.segmentation` (RFM + sync de segmento para a Shopify)
- `integration.nfse`, `integration.whatsapp`
- Relatórios avançados (DRE gerencial, produtividade)

### Depois — próximas verticais
1. **Veterinária**: introduz `shared.scheduling` e `shared.medical-records` (e com eles as regras de dados sensíveis)
2. Odonto / Ortopedia / Estética: reaproveitam agenda e prontuário
3. Academia: introduz `shared.subscriptions` e controle de acesso
4. Cartório: reaproveita OS, mas exige avaliação regulatória própria (CNJ/provimentos) antes de começar

## Riscos

| Risco | Prob. | Impacto | Mitigação |
|---|:-:|:-:|---|
| Recorrência via Shopify inviável no Brasil | Alta | Alto | Plano B com gateway brasileiro, já previsto no modelo (`subscriptions.source`) |
| Mudanças de política, plano ou API da Shopify | Média | Médio | A Shopify é canal, não fonte da verdade. Integração isolada em `integration.shopify`. Uso de versões estáveis da API e atualização trimestral |
| Vazamento entre tenants | Baixa | Crítico | RLS + teste automático de isolamento + revisão de queries de plataforma |
| Vertical "vazar" para o core (if vertical == ...) | Média | Alto | Regras de dependência no CI e pontos de extensão via manifesto |
| Escopo de cada vertical crescer indefinidamente | Alta | Médio | MVP por vertical validado com piloto. Customização por configuração, nunca por fork |
| Dados sensíveis (saúde) sob a LGPD | Média | Alto | `shared.medical-records` com controles reforçados, sem envio à Shopify, DPO/contratos antes das verticais de saúde |
| Cartório com exigências regulatórias específicas | Alta | Alto | Tratar como projeto separado, com avaliação jurídica antes de construir |
| Custo AWS em sa-east-1 acima do previsto | Média | Médio | Estimativa na Fase 0 e ambientes não-prod desligáveis |
