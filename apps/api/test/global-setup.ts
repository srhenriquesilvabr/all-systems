import { runMigrations } from '@all/db';
import { Client } from 'pg';
import { testEnv } from './env';

/** Banco de teste limpo e migrado antes de cada execução. */
export default async function setup() {
  await runMigrations(testEnv.MIGRATION_DATABASE_URL);
  const client = new Client({ connectionString: testEnv.MIGRATION_DATABASE_URL });
  await client.connect();
  await client.query('TRUNCATE tenants, users, modules CASCADE');
  await client.end();
}
