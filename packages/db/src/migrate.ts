import path from 'node:path';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDb } from './client';

/**
 * Papel usado pela aplicação: sem superuser nem BYPASSRLS, é isso que faz o RLS valer.
 * No Docker local ele vem do docker/postgres/init.sql; no Supabase é criado aqui, antes
 * das migrations (que lhe concedem as permissões). Com APP_USER_PASSWORD, a senha é (re)definida.
 */
async function ensureAppUser(db: ReturnType<typeof createDb>['db'], password?: string) {
  await db.execute(sql`
    do $$ begin
      if not exists (select from pg_roles where rolname = 'app_user') then
        create role app_user login nosuperuser nobypassrls;
      end if;
    end $$`);
  if (password) await db.execute(sql.raw(`alter role app_user password '${password.replaceAll("'", "''")}'`));
}

export async function runMigrations(connectionString: string, appUserPassword?: string) {
  const { db, pool } = createDb(connectionString, 1);
  try {
    await ensureAppUser(db, appUserPassword);
    await migrate(db, { migrationsFolder: path.join(__dirname, '../migrations') });
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url) {
    console.error('MIGRATION_DATABASE_URL não definido');
    process.exit(1);
  }
  runMigrations(url, process.env.APP_USER_PASSWORD)
    .then(() => console.log('Migrations aplicadas'))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
