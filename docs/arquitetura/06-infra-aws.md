# 06 — Infraestrutura AWS

## Região
**sa-east-1 (São Paulo)**: latência para os usuários e dados de clientes brasileiros em território nacional. A LGPD não exige residência local, mas isso simplifica a conversa com clientes regulados (cartório, saúde). O custo é maior que em us-east-1, o que é aceitável.

## Diagrama

```
                      Route 53
                         │
          ┌──────────────┴───────────────┐
          ▼                              ▼
   CloudFront + WAF               CloudFront + WAF
   admin.allsystems.com.br        api.allsystems.com.br
          │                              │
     S3 (SPA React)            ALB ──► ECS Fargate: api (NestJS)  ──┐
                                                                     │
  Shopify ──► EventBridge (partner) ──► SQS ──► ECS Fargate: worker ─┤
  EventBridge Scheduler (cron) ──────────────► SQS ─────────────────┤
                                                                     ▼
                      RDS PostgreSQL (Multi-AZ) ◄── RDS Proxy   ElastiCache Redis
                      + réplica de leitura (relatórios/ML)       (rate limit, cache)
                                                                     │
           S3 (arquivos, fotos de peças) · SES (e-mail) · KMS · Secrets Manager
           CloudWatch (logs/métricas/alarmes) · X-Ray via OpenTelemetry
           ECS scheduled task (Python): clusterização (etapa 2)
```

## Serviços e motivo

| Serviço | Uso | Observação |
|---|---|---|
| **ECS Fargate** | `api` e `worker` (mesma imagem, entrypoints diferentes) | Sem gerenciar servidores. Autoscaling por CPU e por profundidade de fila |
| **RDS PostgreSQL 16** | Banco principal | Multi-AZ em produção, PITR de 7 a 35 dias, réplica para relatórios |
| **RDS Proxy** | Pool de conexões | Necessário com várias tasks |
| **SQS** (+ DLQ) | Filas de eventos, webhooks e jobs | Um par fila/DLQ por domínio (shopify, notifications, billing, outbox) |
| **EventBridge** | Recebe os webhooks da Shopify, com roteamento por tópico | Remove a necessidade de endpoint HTTP público para webhooks |
| **EventBridge Scheduler** | Jobs agendados (RFM noturno, reconciliação, expurgo) | |
| **S3** | Arquivos (fotos, PDFs, exportações) | Upload direto do browser por **URL pré-assinada**, bucket privado, prefixo por tenant |
| **CloudFront + S3** | Hospedagem do admin | |
| **SES** | E-mails transacionais | Domínio verificado, DKIM/SPF/DMARC, sair do sandbox antes do go-live |
| **KMS** | Cifrar tokens Shopify e campos sensíveis (envelope encryption) | |
| **Secrets Manager** | Credenciais (DB, Shopify app secret, gateways) | |
| **ElastiCache Redis** | Rate limit e cache de `/me` e de permissões | Opcional na fase 1 (dá para começar com rate limit no Postgres) |
| **WAF** | Proteção de borda, rate limit em `/auth/*` | |
| **CloudWatch + OpenTelemetry/X-Ray** | Logs estruturados (JSON com `tenant_id`, `request_id`), métricas, traces e alarmes | |

## Contas e ambientes
- **AWS Organizations** com contas separadas: `shared` (ECR, DNS), `dev`, `staging` e `prod`.
- **Lojas Shopify de desenvolvimento** para dev e staging (uma "loja SaaS" de teste e algumas "lojas cliente" de teste).
- IaC em **AWS CDK (TypeScript)** em `infra/`. Um stack por domínio: rede, dados, compute, edge, observabilidade.

## CI/CD (GitHub Actions)
1. PR → lint, typecheck, testes unitários, **teste de isolamento RLS**, regras de dependência entre módulos e build Turborepo (com cache).
2. Merge na `main` → imagem no ECR → deploy em **staging** → migrations (ECS one-off task) → smoke tests.
3. Aprovação manual → **prod** (rolling deploy no ECS, com rollback automático por alarme).
4. Admin SPA → S3 + invalidação do CloudFront.
5. Extensões Shopify → `shopify app deploy` (versionado, junto com o release).

**Migrations** sempre compatíveis com a versão anterior (expand → migrate → contract), porque api e worker de duas versões convivem durante o deploy.

## Segurança — checklist base
- [ ] Banco e Redis em subnets privadas, sem IP público
- [ ] Usuário de aplicação sem `BYPASSRLS`, com usuário de migração separado
- [ ] Tokens Shopify e segredos cifrados (KMS) e nunca em log
- [ ] Validação HMAC dos webhooks que chegarem por HTTP (os que chegam pelo EventBridge já são autenticados pela integração)
- [ ] Headers de segurança (CSP, HSTS) no CloudFront
- [ ] Backups testados (restore trimestral)
- [ ] GuardDuty e Security Hub ligados nas contas
- [ ] Pentest antes de vender para cartório e para clínicas

## Custos — ordem de grandeza
O que pesa no início: RDS Multi-AZ, NAT Gateway, Fargate (2 serviços × 2 tasks) e ALB. Em **dev/staging**, usar RDS single-AZ pequeno, 1 task por serviço e desligar fora do horário. **[validar]** Montar a estimativa na AWS Pricing Calculator com sa-east-1 antes de definir o preço dos planos.
