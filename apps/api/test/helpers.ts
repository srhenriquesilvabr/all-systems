import { CepHttp, configureHttp, MailService, OutboxRelay, ScheduledJobs, TenancyService, type MailMessage } from '@all/core';
import { BankHttp } from '@all/banking';
import { FipeHttp } from '@all/vehicles';
import { WhatsAppHttp } from '@all/whatsapp';
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
  jobs: ScheduledJobs;
  /** Chamadas que iriam para a API do WhatsApp (Meta). */
  whatsapp: { url: string; body: any; token: string }[];
  mails: MailMessage[];
  /** API REST de banco (modo "api" das conexões): chamadas recebidas e a resposta a dar. */
  bankApi: {
    calls: { method: string; url: string; json?: any; form?: Record<string, string> }[];
    respond: (method: string, url: string, json?: any) => { ok: boolean; status: number; body: any };
  };
  http: () => ReturnType<typeof request>;
  close: () => Promise<void>;
}

export async function createTestApp(): Promise<TestApp> {
  const mails: MailMessage[] = [];
  const fakeMail = {
    send: async (m: MailMessage) => void mails.push(m),
    sendInBackground: (m: MailMessage) => void mails.push(m),
  };

  const whatsapp: TestApp['whatsapp'] = [];
  const fakeWhatsApp = {
    post: async (url: string, body: unknown, token: string) => {
      whatsapp.push({ url, body, token });
      return { ok: true, status: 200, body: { messages: [{ id: `wamid.${whatsapp.length}` }] } };
    },
  };

  const bankApi: TestApp['bankApi'] = { calls: [], respond: () => ({ ok: false, status: 503, body: {} }) };
  const fakeBank = {
    request: async (method: string, url: string, opts: { json?: unknown; form?: Record<string, string> } = {}) => {
      bankApi.calls.push({ method, url, json: opts.json, form: opts.form });
      if (url.endsWith('/oauth/token')) return { ok: true, status: 200, body: { access_token: 'token-teste', expires_in: 3600 } };
      return bankApi.respond(method, url, opts.json);
    },
  };
  const fakeFipe = {
    price: async (code: string) =>
      code === '005340-6' ? [{ codigoFipe: code, marca: 'VW - VolksWagen', modelo: 'Gol 1.0', anoModelo: 2020, combustivel: 'Gasolina', valor: 48_500, mesReferencia: 'outubro de 2026' }] : [],
  };

  // ViaCEP: 01001-000 existe, 99999-999 não existe, 12345-678 não responde (timeout).
  const fakeCep = {
    get: async (cep: string) => {
      if (cep === '12345678') throw new Error('timeout');
      if (cep === '01001000') {
        return { status: 200, body: { cep: '01001-000', logradouro: 'Praça da Sé', complemento: 'lado ímpar', bairro: 'Sé', localidade: 'São Paulo', uf: 'SP' } };
      }
      return { status: 200, body: { erro: 'true' } };
    },
  };

  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(testEnv)] })
    .overrideProvider(CepHttp)
    .useValue(fakeCep)
    .overrideProvider(MailService)
    .useValue(fakeMail)
    .overrideProvider(WhatsAppHttp)
    .useValue(fakeWhatsApp)
    .overrideProvider(BankHttp)
    .useValue(fakeBank)
    .overrideProvider(FipeHttp)
    .useValue(fakeFipe)
    .compile();
  const app = moduleRef.createNestApplication({ logger: false, rawBody: true });
  configureHttp(app);
  await app.init();

  return {
    app,
    tenancy: app.get(TenancyService),
    relay: app.get(OutboxRelay),
    jobs: app.get(ScheduledJobs),
    whatsapp,
    mails,
    bankApi,
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
