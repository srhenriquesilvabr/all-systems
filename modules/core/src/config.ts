import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET precisa ter ao menos 32 caracteres'),
  ADMIN_URL: z.string().url().default('http://localhost:5173'),
  SMTP_URL: z.string().default('smtp://localhost:1025'),
  MAIL_FROM: z.string().default('Palmer Tech <nao-responda@palmertech.local>'),
  /** Envio de e-mail pela API do Resend (produção). Sem ela, usa o SMTP_URL. */
  RESEND_API_KEY: z.string().optional(),
  /** Teto de empresas novas por dia pelo cadastro público; 0 fecha o cadastro. */
  SIGNUP_DAILY_LIMIT: z.coerce.number().int().min(0).default(50),
  /** Arquivos enviados (fotos), em disco. Em produção (Cloudflare) o storage é o R2. */
  STORAGE_DIR: z.string().default('.storage'),
  /** Chave (32 bytes, base64) para cifrar segredos das configurações. Obrigatória em produção. */
  SETTINGS_ENCRYPTION_KEY: z.string().optional(),
});

/** Configuração do core, validada no boot. Usada também como token de injeção. */
export class CoreConfig {
  nodeEnv!: 'development' | 'test' | 'production';
  databaseUrl!: string;
  jwtSecret!: string;
  signupDailyLimit!: number;
  adminUrl!: string;
  smtpUrl!: string;
  mailFrom!: string;
  resendApiKey?: string;
  storageDir!: string;
  settingsEncryptionKey?: string;
  /** Definido pelo CoreModule.forRoot (não vem do ambiente). */
  syncModulesOnBoot = true;

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
    signupDailyLimit: e.SIGNUP_DAILY_LIMIT,
    adminUrl: e.ADMIN_URL,
    smtpUrl: e.SMTP_URL,
    mailFrom: e.MAIL_FROM,
    resendApiKey: e.RESEND_API_KEY,
    storageDir: e.STORAGE_DIR,
    settingsEncryptionKey: e.SETTINGS_ENCRYPTION_KEY,
  });
}
