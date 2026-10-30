# All Systems

Sistema de gestão da **Palmer Tech**. Manual de uso: [docs/manual](docs/manual/README.md). Contas e acessos: [docs/acessos.md](docs/acessos.md).

Plataforma SaaS modular e multi-tenant: um core comum (login, usuários, permissões, auditoria…) e verticais contratáveis por empresa (lavanderia, salão, pet shop, veterinária, estética, ortodontia, padaria, advocacia, veículos, imobiliária, consórcio, contabilidade e RH). A arquitetura está em [docs/arquitetura](docs/arquitetura/README.md).

## Requisitos
- Node 22.12+ (testado com Node 24)
- pnpm 10 (`corepack enable pnpm`)
- Docker (Postgres 16 e Mailpit)

## Primeira execução

```bash
cp .env.example .env          # ajuste JWT_SECRET
pnpm install
pnpm infra:up                 # Postgres :5432 e Mailpit :8025
pnpm db:migrate
pnpm db:seed                  # cria "Lavanderia Bolha Azul" (dono@demo.com / demo123456)
pnpm --filter @all/api cli seed-verticals  # uma empresa por vertical (demo+<vertical>@demo.com / demo123456)
pnpm dev                      # API :3000, worker (e-mails/eventos) e admin :5173
```

- Admin: http://localhost:5173
- E-mails enviados em dev (convites, recuperação de senha, avisos a clientes): http://localhost:8025
- Fotos enviadas em dev ficam em `apps/api/.storage/` (ignorada pelo git)

## Comandos

| Comando | O que faz |
|---|---|
| `pnpm dev` | API, worker do outbox (tsc watch + node --watch) e admin (Vite) |
| `pnpm build` / `pnpm typecheck` | Build e checagem de tipos de todos os pacotes |
| `pnpm test` | Testes unitários e e2e. O e2e usa o banco `allsystems_test` |
| `pnpm check:boundaries` | Verifica as regras de dependência entre camadas de módulo |
| `pnpm db:generate` | Gera migration a partir dos schemas dos módulos (`modules/**/src/**/schema.ts`) |
| `pnpm db:migrate` | Aplica migrations |
| `pnpm --filter @all/api cli help` | Operações de plataforma: criar empresa, ativar e desativar módulos |

## Produção: Cloudflare + Supabase

Cada push na branch de produção no GitHub dispara o build e o deploy no Cloudflare (Workers Builds). Decisão: [ADR-023](docs/arquitetura/decisoes.md).

| Peça | Onde roda |
|---|---|
| Admin (React) | Assets estáticos do Worker `palmer-systems` |
| API (NestJS) | O mesmo Worker, em `/api/*` (`apps/api/src/edge.mts`) |
| Outbox e jobs | Cron Trigger do Worker, a cada minuto |
| Banco | Supabase (Postgres), via Hyperdrive com cache desligado e no máximo 10 conexões com a origem |
| Fotos e documentos | R2, bucket `palmer-systems-files` |
| E-mails | Resend (`RESEND_API_KEY`) |

Configuração do Workers Builds:
- **Build command:** `pnpm build`
- **Deploy command:** `pnpm deploy:cloudflare` (migrations, `cli sync` e `wrangler deploy`)
- **Variáveis de build:** `MIGRATION_DATABASE_URL` (Supabase, usuário `postgres`, pooler de sessão, porta 5432). Na primeira vez, defina também `APP_USER_PASSWORD`: a senha do `app_user`, que o Hyperdrive usa.

O pooler de sessão do Supabase aceita até 15 conexões (`pool_size`). Por isso o Hyperdrive fica limitado a 10 (`wrangler hyperdrive update <id> --origin-connection-limit 10`): nos picos ele enfileira as consultas em vez de abrir a 16ª conexão, que o Supabase recusaria com `EMAXCONNSESSION` (erro 500 na API). As 5 restantes ficam para migrations e para o painel do Supabase. Se o plano do Supabase mudar, ajuste os dois números juntos.

Segredos do Worker (`pnpm exec wrangler secret put <NOME>`): `JWT_SECRET`, `SETTINGS_ENCRYPTION_KEY` (32 bytes em base64) e `RESEND_API_KEY`. As demais variáveis ficam em `vars`, no [wrangler.jsonc](wrangler.jsonc).

Para rodar o Worker localmente: `pnpm dev:cloudflare`. Ele usa o banco de `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` (veja o `.env.example`).

## Estrutura

```
apps/api            NestJS: monta o core + os módulos instalados (src/installed-modules.ts); src/worker.ts entrega o outbox
apps/admin          React + Vite: shell do admin e telas do core; as telas de cada módulo vêm do pacote dele
packages/db         Conexão, escopo de tenant (RLS), migrations
packages/module-sdk Manifesto de módulo, registry, decorators, contexto da requisição, cliente web
packages/ui         Componentes visuais compartilhados
modules/core        Login, usuários, permissões, tenancy, auditoria, clientes, financeiro, outbox
modules/shared/*    Módulos usados por várias verticais (ordens de serviço, notificações)
modules/integrations/* Integrações contratáveis (Pix hoje; NFS-e, Shopify, WhatsApp depois)
modules/verticals/* Uma pasta por vertical (api + db + web + contracts)
```

## Identidade visual
- Cores, fontes e raios ficam nos tokens de `apps/admin/src/styles.css` (azul `#2d4bff`, tinta `#0e1330`, ciano `#7df9ff`; Outfit nos títulos e IBM Plex Sans no texto), tirados de palmertech.pages.dev.
- Logo (símbolo azul e branco) e ícones em `apps/admin/public/brand/`; o componente é `BrandLogo`.

## Regras que o código garante
- **Isolamento entre empresas no banco**: a aplicação conecta como `app_user` (sem `BYPASSRLS`) e toda tabela com `tenant_id` tem política de RLS. O teste `apps/api/test/rls.test.ts` falha se alguma tabela ficar sem proteção.
- **Módulo não contratado = rota inexistente**: `@ModuleRoute('laundry')` responde 403 `MODULE_NOT_ENABLED`, e o admin nem registra as telas.
- **Permissões efetivas** = permissões dos papéis ∩ permissões dos módulos ativos.
- **Efeitos assíncronos só depois do commit**: e-mails e integrações passam pelo outbox (`OutboxService.publish` na mesma transação) e são entregues pelo worker.
- **Fronteiras**: o core não importa verticais, e uma vertical não importa outra (`pnpm check:boundaries`, também no CI).

## Criando uma nova vertical
1. Copie `modules/verticals/laundry` como ponto de partida e troque `key`, permissões e menu no `manifest.ts`.
2. Declare as tabelas em `src/db/schema.ts` usando `tenantId()` e `tenantIsolation()` de `@all/db`, depois rode `pnpm db:generate`.
3. Registre o manifesto e o Nest module em `apps/api/src/installed-modules.ts` e as telas em `apps/admin/src/modules.ts`.
4. Ative para uma empresa: `pnpm --filter @all/api cli module:enable --tenant <id> --module <key>`.
