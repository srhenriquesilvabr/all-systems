import { defineConfig } from 'drizzle-kit';

// Cada módulo é dono do seu schema (src/**/schema.ts); as migrations são geradas
// num único histórico para o banco inteiro.
export default defineConfig({
  dialect: 'postgresql',
  schema: [
    '../../modules/core/src/**/schema.ts',
    '../../modules/shared/*/src/**/schema.ts',
    '../../modules/integrations/*/src/**/schema.ts',
    '../../modules/verticals/*/src/**/schema.ts',
  ],
  out: './migrations',
});
