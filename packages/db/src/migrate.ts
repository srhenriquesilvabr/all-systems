import path from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDb } from './client';

export async function runMigrations(connectionString: string) {
  const { db, pool } = createDb(connectionString, 1);
  try {
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
  runMigrations(url)
    .then(() => console.log('Migrations aplicadas'))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
