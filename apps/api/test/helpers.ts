import { configureHttp, MailService, OutboxRelay, TenancyService, type MailMessage } from '@all/core';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { testEnv } from './env';

export const PASSWORD = 'senha-forte-123';

export interface TestApp {
  app: INestApplication;
  tenancy: TenancyService;
  /** Processa o outbox na hora (no app real quem faz isso é o worker). */
  relay: OutboxRelay;
  mails: MailMessage[];
  http: () => ReturnType<typeof request>;
  close: () => Promise<void>;
}

export async function createTestApp(): Promise<TestApp> {
  const mails: MailMessage[] = [];
  const fakeMail = {
    send: async (m: MailMessage) => void mails.push(m),
    sendInBackground: (m: MailMessage) => void mails.push(m),
  };

  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(testEnv)] })
    .overrideProvider(MailService)
    .useValue(fakeMail)
    .compile();
  const app = moduleRef.createNestApplication({ logger: false });
  configureHttp(app);
  await app.init();

  return {
    app,
    tenancy: app.get(TenancyService),
    relay: app.get(OutboxRelay),
    mails,
    http: () => request(app.getHttpServer()),
    close: () => app.close(),
  };
}

export const uniqueEmail = (prefix: string) => `${prefix}-${randomUUID().slice(0, 8)}@teste.com`;

/** Cria uma empresa com dono já com senha definida. */
export async function createTenant(t: TestApp, opts: { modules?: string[]; ownerEmail?: string; name?: string } = {}) {
  const email = opts.ownerEmail ?? uniqueEmail('dono');
  const { tenantId, ownerUserId } = await t.tenancy.createTenant({
    name: opts.name ?? `Empresa ${randomUUID().slice(0, 6)}`,
    modules: opts.modules ?? ['laundry'],
    owner: { email, name: 'Dono Teste', password: PASSWORD },
  });
  return { tenantId, ownerUserId, email };
}

export async function login(t: TestApp, email: string, password = PASSWORD) {
  const res = await t.http().post('/api/auth/login').send({ email, password });
  if (res.status !== 200 || !res.body.accessToken) throw new Error(`Login falhou: ${res.status} ${JSON.stringify(res.body)}`);
  return { token: res.body.accessToken as string, cookie: refreshCookie(res) };
}

export function refreshCookie(res: { headers: Record<string, unknown> }): string {
  const cookies = ([] as string[]).concat((res.headers['set-cookie'] as string[] | undefined) ?? []);
  const cookie = cookies.find((c) => c.startsWith('as_rt='));
  if (!cookie) throw new Error('Sem cookie de refresh');
  return cookie.split(';')[0]!;
}

export function tokenFromMail(mail: MailMessage | undefined): string {
  const match = mail?.text.match(/token=([\w-]+)/);
  if (!match) throw new Error('E-mail sem token');
  return match[1]!;
}

export const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

/** CPF válido aleatório (dígitos verificadores calculados). */
export function cpf(): string {
  const base = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
  const digit = (nums: number[]) => {
    const sum = nums.reduce((acc, n, i) => acc + n * (nums.length + 1 - i), 0);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  const d1 = digit(base);
  const d2 = digit([...base, d1]);
  return [...base, d1, d2].join('');
}

/** Login do dono de uma empresa nova; devolve o token e um atalho para chamadas autenticadas. */
export async function ownerSession(t: TestApp, modules?: string[]) {
  const tenant = await createTenant(t, { modules });
  const { token } = await login(t, tenant.email);
  const as = (method: 'get' | 'post' | 'patch' | 'put' | 'delete', path: string) => t.http()[method](`/api${path}`).set(auth(token));
  return { ...tenant, token, as };
}
