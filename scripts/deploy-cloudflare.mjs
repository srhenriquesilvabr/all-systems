// Comando de deploy do Workers Builds (Cloudflare), depois do `pnpm build`:
//   1. aplica as migrations no Supabase (cria o app_user na primeira vez);
//   2. espelha os manifestos desta build no banco (`cli sync`);
//   3. publica o Worker (admin + API + cron).
// Variáveis de build: MIGRATION_DATABASE_URL (Supabase, usuário postgres, pooler de sessão)
// e, na primeira vez ou para trocar a senha, APP_USER_PASSWORD.
import { execSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const migrationUrl = process.env.MIGRATION_DATABASE_URL;
if (!migrationUrl) {
  console.error('MIGRATION_DATABASE_URL não definido nas variáveis de build do Workers Builds');
  process.exit(1);
}

const run = (command, env = {}) => execSync(command, { stdio: 'inherit', env: { ...process.env, ...env } });

run('pnpm --filter @all/db migrate');
// O sync roda como dono do schema e não emite tokens: o JWT_SECRET aqui só satisfaz a validação do boot.
run('pnpm --filter @all/api cli sync', { DATABASE_URL: migrationUrl, JWT_SECRET: randomBytes(48).toString('base64url') });
run('pnpm exec wrangler deploy');
