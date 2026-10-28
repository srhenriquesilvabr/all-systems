import { coreSchema } from '@all/core';
import type { Tx } from '@all/db';
import { and, eq } from 'drizzle-orm';
import { createHash, randomBytes } from 'node:crypto';
import type { LeadAssetType, PlanProfile } from '../../contracts';
import { consLeads, consPlans } from '../../db/schema';
import { badRequest } from '../shared';

/** Origem do lead nas consultas de crédito e na auditoria. */
export const LEAD_SOURCE = 'consortium_lead';
/** Evento do webhook do Meta: a leitura do lead (Graph API) roda no worker, fora da requisição. */
export const META_LEAD_RECEIVED = 'consortium.lead.meta_received';

export type LeadRow = typeof consLeads.$inferSelect;

/** E.164 a partir do que a pessoa digitou (números brasileiros ganham +55). Null se não parecer telefone. */
export function normalizePhone(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  const digits = trimmed.replace(/\D/g, '');
  if (trimmed.startsWith('+')) return digits.length >= 10 && digits.length <= 15 ? `+${digits}` : null;
  if (digits.length === 10 || digits.length === 11) return `+55${digits}`;
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) return `+${digits}`;
  return null;
}

/** IP sem guardar o IP: hash com o tenant (só para limitar envios repetidos). */
export const ipHashOf = (tenantId: string, ip: string | undefined) => (ip ? createHash('sha256').update(`${tenantId}:${ip}`).digest('hex').slice(0, 32) : null);

/** Código do link de indicação: 8 letras/números sem ambiguidade (sem 0/o, 1/l). */
export function referralCode(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  return [...randomBytes(8)].map((b) => alphabet[b % alphabet.length]).join('');
}

/** Perfis de taxa dos planos ativos (sem o nome da administradora), para o simulador público. */
export async function planProfilesInTx(tx: Tx): Promise<PlanProfile[]> {
  const plans = await tx.select().from(consPlans).where(eq(consPlans.active, true));
  const seen = new Map<string, PlanProfile>();
  for (const p of plans) {
    const key = [p.assetType, p.termMonths, p.adminFeePercent, p.reserveFundPercent, p.insurancePercent].join('|');
    const credit = Number(p.creditValue);
    const prev = seen.get(key);
    if (prev) {
      prev.minCredit = Math.min(prev.minCredit, credit);
      prev.maxCredit = Math.max(prev.maxCredit, credit);
      continue;
    }
    seen.set(key, {
      assetType: p.assetType as LeadAssetType,
      termMonths: p.termMonths,
      adminFeePercent: Number(p.adminFeePercent),
      reserveFundPercent: Number(p.reserveFundPercent),
      insurancePercent: Number(p.insurancePercent),
      minCredit: credit,
      maxCredit: credit,
    });
  }
  return [...seen.values()].sort((a, b) => a.assetType.localeCompare(b.assetType) || a.termMonths - b.termMonths);
}

/** O usuário tem de estar ativo na equipe desta empresa. */
export async function assertTeamMember(tx: Tx, tenantId: string, userId: string, what = 'Vendedor') {
  const [m] = await tx
    .select({ id: coreSchema.memberships.id })
    .from(coreSchema.memberships)
    .where(and(eq(coreSchema.memberships.tenantId, tenantId), eq(coreSchema.memberships.userId, userId), eq(coreSchema.memberships.status, 'active')));
  if (!m) throw badRequest('USER_NOT_MEMBER', `${what} não faz parte da equipe ativa`);
}

/** Campos de UTM/clique aceitos (o resto é descartado), cortados em 200 caracteres. */
export function cleanUtm(input: Record<string, unknown> | undefined, keys: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of keys) {
    const v = input?.[k];
    if (typeof v === 'string' && v.trim()) out[k] = v.trim().slice(0, 200);
  }
  return out;
}
