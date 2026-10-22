# All Systems

Plataforma SaaS modular e multi-tenant: um core comum (login, usuários, permissões, auditoria…) e verticais contratáveis por empresa (lavanderia, veterinária, academia…). A arquitetura está em [docs/arquitetura](docs/arquitetura/README.md).

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
pnpm dev                      # API :3000, worker (e-mails/eventos) e admin :5173
```

- Admin: http://localhost:5173
- E-mails enviados em dev (convites, recuperação de senha): http://localhost:8025

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

## Estrutura

```
apps/api            NestJS: monta o core + os módulos instalados (src/installed-modules.ts); src/worker.ts entrega o outbox
apps/admin          React + Vite: shell do admin e telas do core; as telas de cada módulo vêm do pacote dele
packages/db         Conexão, escopo de tenant (RLS), migrations
packages/module-sdk Manifesto de módulo, registry, decorators, contexto da requisição, cliente web
packages/ui         Componentes visuais compartilhados
modules/core        Login, usuários, permissões, tenancy, auditoria, clientes, financeiro, outbox
modules/shared/*    Módulos usados por várias verticais (ordens de serviço, notificações)
modules/verticals/* Uma pasta por vertical (api + db + web + contracts)
```

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
