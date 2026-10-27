import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

// Segredos guardados no banco (ex.: token da API do WhatsApp de cada empresa): AES-256-GCM.
// A chave vem de SETTINGS_ENCRYPTION_KEY; em produção, é um segredo do Worker no Cloudflare.

const PREFIX = 'enc:v1:';

export class SecretBox {
  private readonly key: Buffer;

  /** `key` em base64 (32 bytes). Sem chave, deriva do segredo do JWT (aceitável só em dev/teste). */
  constructor(key: string | undefined, fallbackSecret: string) {
    this.key = key ? Buffer.from(key, 'base64') : createHash('sha256').update(`settings:${fallbackSecret}`).digest();
    if (this.key.length !== 32) throw new Error('SETTINGS_ENCRYPTION_KEY precisa ter 32 bytes em base64');
  }

  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return PREFIX + [iv, cipher.getAuthTag(), data].map((b) => b.toString('base64url')).join(':');
  }

  decrypt(value: string): string {
    if (!value.startsWith(PREFIX)) return value;
    const [iv, tag, data] = value.slice(PREFIX.length).split(':').map((p) => Buffer.from(p, 'base64url'));
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv!);
    decipher.setAuthTag(tag!);
    return Buffer.concat([decipher.update(data!), decipher.final()]).toString('utf8');
  }
}

/** Mostra só o fim do segredo: "••••a1b2". */
export const maskSecret = (plain: string) => (plain ? `••••${plain.slice(-4)}` : '');
export const isMasked = (value: unknown) => typeof value === 'string' && value.startsWith('••••');
