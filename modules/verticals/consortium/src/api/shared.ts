import { consortiumInstallment } from '@all/banking';
import { addMonths, toCents } from '@all/core';
import type { Tx } from '@all/db';
import { BadRequestException } from '@nestjs/common';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { consAdministrators, consAssemblies, consBids, consCredits, consGroups, consInstallments, consPlans, consQuotas } from '../db/schema';

export const MODULE = 'consortium';
/** Origem da cota nas propostas e no financeiro (comissão a receber). */
export const SOURCE = 'consortium_quota';
/** Origem do estorno de comissão no financeiro (despesa: a administradora desconta o que já pagou). */
export const REVERSAL_SOURCE = 'consortium_commission_reversal';

export const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const badRequest = (code: string, message: string) => new BadRequestException({ code, message });
export const localToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
export const brDate = (iso: string) => iso.split('-').reverse().join('/');

export type PlanRow = typeof consPlans.$inferSelect;
export type QuotaRow = typeof consQuotas.$inferSelect;

export const installmentOf = (p: PlanRow) => consortiumInstallment(Number(p.creditValue), p.termMonths, Number(p.adminFeePercent), Number(p.reserveFundPercent), Number(p.insurancePercent));

/** Dias entre duas datas ISO (b - a). */
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** Meses completos de `a` até `b` (datas ISO). */
export function monthsBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number) as [number, number, number];
  const [by, bm, bd] = b.split('-').map(Number) as [number, number, number];
  return (by - ay) * 12 + (bm - am) - (bd < ad ? 1 : 0);
}

/** Data local (São Paulo) de um instante. */
export const localDate = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d);

/** Primeiro vencimento depois da ativação: o próximo dia `dueDay` estritamente depois de `from`. */
export function firstDueAfter(from: string, dueDay: number): string {
  const sameMonth = `${from.slice(0, 7)}-${String(dueDay).padStart(2, '0')}`;
  return sameMonth > from ? sameMonth : addMonths(sameMonth, 1);
}

/** Percentual de comissão vigente: o do plano, senão o da administradora, senão o padrão do módulo. */
export const effectiveCommission = (planPercent: string | null, adminPercent: string | null | undefined, defaultPercent: number) =>
  planPercent != null ? Number(planPercent) : adminPercent != null ? Number(adminPercent) : defaultPercent;

export async function commissionPercentInTx(tx: Tx, plan: PlanRow, defaultPercent: number) {
  const [admin] = await tx.select({ percent: consAdministrators.commissionPercent }).from(consAdministrators).where(eq(consAdministrators.connectionId, plan.connectionId));
  return effectiveCommission(plan.commissionPercent, admin?.percent, defaultPercent);
}

export const commissionCents = (creditValue: string, percent: number) => Math.round((toCents(creditValue) * percent) / 100);

/**
 * Gera o calendário de parcelas da cota (apaga o anterior, que não pode ter parcela paga).
 * Vencimento mensal no dia do primeiro vencimento; valor e quantidade do plano, salvo se informados.
 */
export async function generateInstallmentsInTx(tx: Tx, tenantId: string, quota: QuotaRow, plan: PlanRow, opts: { firstDueOn: string; count?: number | null; amount?: number | null }) {
  const [paid] = await tx
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(consInstallments)
    .where(and(eq(consInstallments.quotaId, quota.id), sql`${consInstallments.paidOn} is not null`));
  if (paid && paid.n > 0) throw badRequest('INSTALLMENTS_PAID', 'Há parcelas pagas: desfaça os pagamentos antes de refazer o calendário');
  await tx.delete(consInstallments).where(eq(consInstallments.quotaId, quota.id));
  const count = opts.count ?? plan.termMonths;
  const amount = (opts.amount ?? installmentOf(plan)).toFixed(2);
  const rows = Array.from({ length: count }, (_, i) => ({ tenantId, quotaId: quota.id, seq: i + 1, dueOn: addMonths(opts.firstDueOn, i), amount }));
  for (let i = 0; i < rows.length; i += 200) await tx.insert(consInstallments).values(rows.slice(i, i + 200));
  return count;
}

/** Cadastra o grupo da cota (administradora + código) se ainda não existir. */
export async function ensureGroupInTx(tx: Tx, tenantId: string, plan: PlanRow, groupCode: string) {
  await tx.insert(consGroups).values({ tenantId, connectionId: plan.connectionId, planId: plan.id, groupCode }).onConflictDoNothing({ target: [consGroups.tenantId, consGroups.connectionId, consGroups.groupCode] });
}

/** Cadastra a administradora (para a tabela de comissões) se ainda não existir. */
export async function ensureAdministratorInTx(tx: Tx, tenantId: string, connectionId: string, institution: string) {
  await tx
    .insert(consAdministrators)
    .values({ tenantId, connectionId, institution })
    .onConflictDoUpdate({ target: [consAdministrators.tenantId, consAdministrators.connectionId], set: { institution } });
}

/**
 * Depois do resultado: lances da assembleia viram vencedor (cota contemplada por lance), sem efeito
 * (contemplada por sorteio) ou perdedor. Devolve os lances vencedores por cota.
 */
export async function settleBidsInTx(tx: Tx, assemblyId: string, winners: { quotaIds: Set<string>; bidQuotaIds: Set<string> }) {
  const bids = await tx
    .select()
    .from(consBids)
    .where(and(eq(consBids.assemblyId, assemblyId), inArray(consBids.status, ['registered', 'sent'])))
    .orderBy(asc(consBids.createdAt));
  const won = new Map<string, typeof consBids.$inferSelect>();
  for (const b of bids) {
    const status = winners.bidQuotaIds.has(b.quotaId) ? 'won' : winners.quotaIds.has(b.quotaId) ? 'void' : 'lost';
    await tx.update(consBids).set({ status, updatedAt: new Date() }).where(eq(consBids.id, b.id));
    if (status === 'won') won.set(b.quotaId, b);
  }
  return won;
}

/** Abre o acompanhamento do crédito da cota contemplada (lance embutido sai do crédito). */
export async function openCreditInTx(tx: Tx, tenantId: string, quotaId: string, creditValue: string, embeddedBidAmount: string | null) {
  const amountCents = toCents(creditValue) - (embeddedBidAmount ? toCents(embeddedBidAmount) : 0);
  await tx
    .insert(consCredits)
    .values({ tenantId, quotaId, status: 'awaiting_docs', amount: (Math.max(amountCents, 0) / 100).toFixed(2) })
    .onConflictDoNothing({ target: consCredits.quotaId });
}

/** Assembleia da cota: tem de ser do mesmo grupo e ainda sem resultado. */
export async function scheduledAssemblyInTx(tx: Tx, assemblyId: string, groupCode: string | null) {
  const [a] = await tx.select().from(consAssemblies).where(eq(consAssemblies.id, assemblyId));
  if (!a) throw badRequest('ASSEMBLY_NOT_FOUND', 'Assembleia não encontrada');
  if (a.groupCode !== groupCode) throw badRequest('ASSEMBLY_OTHER_GROUP', 'A assembleia é de outro grupo');
  if (a.status !== 'scheduled') throw badRequest('ASSEMBLY_HELD', 'Esta assembleia já tem resultado');
  return a;
}
