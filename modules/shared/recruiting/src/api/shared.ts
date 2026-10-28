import type { Tx } from '@all/db';
import { customers, tenants } from '@all/core/schema';
import { eq } from 'drizzle-orm';
import type { Readable } from 'node:stream';
import { recJobs } from '../db/schema';
import type { BoardJob } from './gupy';

/** Currículos não saem pelo download genérico (/files/:id): só pelo módulo, com permissão e auditoria. */
export const RESUME_OWNER = 'recruiting_resume';
/** Limite do currículo enviado pela página pública. */
export const MAX_RESUME_BYTES = 5 * 1024 * 1024;

export const APPLICATION_SUBMITTED = 'recruiting.application.submitted';
export interface ApplicationSubmitted {
  applicationId: string;
  analysisId: string;
}
export const JOB_SYNC = 'recruiting.job.sync';
export interface JobSync {
  jobId: string;
}

export type JobRow = typeof recJobs.$inferSelect;

/** Celular/telefone em E.164 quando reconhecível (mesma regra do cadastro de clientes/equipe). */
export function normalizePhone(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  const digits = trimmed.replace(/\D/g, '');
  if (trimmed.startsWith('+')) return digits.length >= 10 && digits.length <= 15 ? `+${digits}` : null;
  if (digits.length === 10 || digits.length === 11) return `+55${digits}`;
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) return `+${digits}`;
  return null;
}

export async function readAll(stream: Readable, limit = 20 * 1024 * 1024): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    size += buf.length;
    if (size > limit) throw new Error('Arquivo grande demais');
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

export const isPdf = (buf: Buffer) => buf.subarray(0, 5).toString('latin1') === '%PDF-';

/** Endereço público da vaga (página de candidatura). */
export const jobUrl = (adminUrl: string, slug: string, jobId: string) => `${adminUrl.replace(/\/$/, '')}/vagas/${slug}/${jobId}`;
export const jobsUrl = (adminUrl: string, slug: string) => `${adminUrl.replace(/\/$/, '')}/vagas/${slug}`;
export const indeedFeedUrl = (adminUrl: string, slug: string) => `${adminUrl.replace(/\/$/, '')}/api/public/jobs/${slug}/feeds/indeed.xml`;

/** Nome e endereço público da empresa (tenant) do contexto atual. */
export async function currentTenant(tx: Tx, tenantId: string) {
  const [t] = await tx.select({ name: tenants.name, slug: tenants.slug }).from(tenants).where(eq(tenants.id, tenantId));
  return t ?? { name: '', slug: null };
}

/** Nome da contratante (cliente), ou null se é a própria empresa. */
export async function hiringCompanyName(tx: Tx, customerId: string | null): Promise<string | null> {
  if (!customerId) return null;
  const [c] = await tx.select({ name: customers.name }).from(customers).where(eq(customers.id, customerId));
  return c?.name ?? null;
}

/** Vaga no formato neutro das plataformas (Gupy, Indeed, texto do LinkedIn). */
export function boardJob(job: JobRow, companyName: string | null, applyUrl: string): BoardJob {
  return {
    id: job.id,
    title: job.title,
    area: job.area,
    description: job.description,
    requirements: job.requirements,
    niceToHave: job.niceToHave,
    benefits: job.benefits,
    workModel: job.workModel,
    city: job.city,
    state: job.state,
    contractType: job.contractType,
    positions: job.positions,
    salaryMin: job.salaryMin == null ? null : Number(job.salaryMin),
    salaryMax: job.salaryMax == null ? null : Number(job.salaryMax),
    showSalary: job.showSalary,
    status: job.status,
    hiringCompany: job.confidential ? null : companyName,
    applyUrl,
  };
}
