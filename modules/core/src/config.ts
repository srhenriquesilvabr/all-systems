import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET precisa ter ao menos 32 caracteres'),
  ADMIN_URL: z.string().url().default('http://localhost:5173'),
  SMTP_URL: z.string().default('smtp://localhost:1025'),
  MAIL_FROM: z.string().default('All Systems <nao-responda@allsystems.local>'),
});

/** Configuração do core, validada no boot. Usada também como token de injeção. */
export class CoreConfig {
  nodeEnv!: 'development' | 'test' | 'production';
  databaseUrl!: string;
  jwtSecret!: string;
  adminUrl!: string;
  smtpUrl!: string;
  mailFrom!: string;

  get isProduction() {
    return this.nodeEnv === 'production';
  }
}

export function loadConfig(env: Record<string, string | undefined>): CoreConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Variáveis de ambiente inválidas:\n${issues}`);
  }
  const e = parsed.data;
  return Object.assign(new CoreConfig(), {
    nodeEnv: e.NODE_ENV,
    databaseUrl: e.DATABASE_URL,
    jwtSecret: e.JWT_SECRET,
    adminUrl: e.ADMIN_URL,
    smtpUrl: e.SMTP_URL,
    mailFrom: e.MAIL_FROM,
  });
}
