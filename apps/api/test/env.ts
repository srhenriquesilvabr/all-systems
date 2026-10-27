import os from 'node:os';
import path from 'node:path';

try {
  process.loadEnvFile(path.resolve(__dirname, '../../../.env'));
} catch {
  // No CI as variáveis vêm do ambiente.
}

export const testEnv = {
  NODE_ENV: 'test',
  DATABASE_URL: required('TEST_DATABASE_URL'),
  MIGRATION_DATABASE_URL: required('TEST_MIGRATION_DATABASE_URL'),
  JWT_SECRET: 'segredo-de-teste-com-pelo-menos-32-caracteres!!',
  ADMIN_URL: 'http://admin.test',
  SMTP_URL: 'smtp://localhost:1',
  STORAGE_DIR: path.join(os.tmpdir(), 'all-systems-test-storage'),
};

function required(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`${key} não definido (veja .env.example)`);
  return value;
}
