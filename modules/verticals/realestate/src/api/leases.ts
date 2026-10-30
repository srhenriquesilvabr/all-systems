import { addMonths, AuditService, centsToDecimal, CustomersService, FinanceService, financeSchema, ModuleSettingsService, nextSequence, ScheduledJobs, TenantDb, toCents, ZodPipe } from '@all/core';
import { customers } from '@all/core/schema';
import type { Tx } from '@all/db';
import { ModuleRoute, RequirePermission, requestContext } from '@all/module-sdk';
import { NotificationsService } from '@all/notifications';
import { BadRequestException, Body, ConflictException, Controller, Get, HttpCode, Injectable, Logger, NotFoundException, OnModuleInit, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { aliasedTable, and, asc, desc, eq, gt, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  addressOf,
  adjustmentIndexLabel,
  applyAdjustmentInput,
  depositLimitMessage,
  extendLeaseInput,
  extraKindLabel,
  leaseExtraInput,
  leaseInput,
  leaseStatuses,
  leaseUpdateInput,
  MAX_DEPOSIT_RENTS,
  payoutInput,
  skipAdjustmentInput,
  terminateLeaseInput,
  type AdjustmentIndex,
  type ApplyAdjustmentInput,
  type Lease,
  type LeaseAdjustment,
  type LeaseCharge,
  type LeaseDetail,
  type LeaseExtra,
  type LeaseExtraInput,
  type LeaseInput,
  type LeaseUpdateInput,
  type LeaseUpdateResult,
  type OwnerStatement,
  type OwnerStatementLine,
  type PayoutInput,
  type PayoutStatus,
  type RealEstateSettings,
  type ReceiptStatus,
  type TerminateLeaseInput,
} from '../contracts';
import { reDeals, reLeaseAdjustments, reLeaseCharges, reLeaseExtras, reLeases, reProperties } from '../db/schema';

const MODULE = 'real_estate';
/** Mensalidade (aluguel + condomínio + IPTU a receber; repasse a pagar). source_id = re_lease_charges.id */
export const LEASE_CHARGE_SOURCE = 'real_estate_lease';
/** Cobrança avulsa (e o repasse dela, se houver). source_id = re_lease_extras.id */
export const LEASE_EXTRA_SOURCE = 'real_estate_lease_extra';
/** Quantos meses à frente as mensalidades dos contratos ativos ficam lançadas. */
const HORIZON_MONTHS = 12;

const { finAccounts, finEntries } = financeSchema;
const renter = aliasedTable(customers, 'renter');
const owner = aliasedTable(customers, 'owner');

type LeaseRow = typeof reLeases.$inferSelect;
type ChargeRow = typeof reLeaseCharges.$inferSelect;
type ExtraRow = typeof reLeaseExtras.$inferSelect;
type AdjustmentRow = typeof reLeaseAdjustments.$inferSelect;
type Entry = Awaited<ReturnType<FinanceService['listBySourceInTx']>>[number];
/** O contrato e o que vai nas descrições dos lançamentos. */
interface Ctx {
  lease: LeaseRow;
  code: number;
  title: string;
}
interface Amounts {
  rent: number;
  condo: number;
  iptu: number;
  fee: number;
  payout: number;
}

const badRequest = (code: string, message: string) => new BadRequestException({ code, message });
const notFound = () => new NotFoundException({ code: 'LEASE_NOT_FOUND', message: 'Contrato de locação não encontrado' });

// ---- Datas (sempre YYYY-MM-DD, sem fuso) -------------------------------------------------------

export const localToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
/** Dia `day` do mês que fica `months` meses depois do mês de `iso`; nos meses curtos, o último dia. */
export function dayOfMonth(iso: string, months: number, day: number): string {
  const [y, m] = iso.split('-').map(Number) as [number, number];
  const first = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(day, last));
  return first.toISOString().slice(0, 10);
}
const brDate = (iso: string) => iso.split('-').reverse().join('/');
const monthLabel = (iso: string) => `${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const brl = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const indexText: Record<AdjustmentIndex, string> = { igpm: 'IGP-M', ipca: 'IPCA', fixed: 'percentual fixo do contrato', none: '' };

/**
 * Calendário do contrato. A mensalidade `seq` (1..prazo) é o aluguel do mês de uso que começa em
 * início + (seq − 1) meses, e vence no dia de vencimento do mês seguinte (aluguel pago "vencido").
 */
export const periodStartOf = (l: Pick<LeaseRow, 'startDate'>, seq: number) => addMonths(l.startDate, seq - 1);
export const dueDateOf = (l: Pick<LeaseRow, 'startDate' | 'dueDay'>, seq: number) => dayOfMonth(l.startDate, seq, l.dueDay);
export const endDateOf = (startDate: string, termMonths: number) => addDays(addMonths(startDate, termMonths), -1);
const anniversaryIn = (l: Pick<LeaseRow, 'startDate' | 'adjustmentMonth'>, year: number) =>
  dayOfMonth(`${year}-${String(l.adjustmentMonth).padStart(2, '0')}-01`, 0, Number(l.startDate.slice(8, 10)));
/** Primeiro aniversário: o mês de reajuste, no dia do início, com pelo menos 12 meses de contrato (Lei 10.192/2001). */
export function firstAnniversary(l: Pick<LeaseRow, 'startDate' | 'adjustmentMonth'>): string {
  const base = addMonths(l.startDate, 12);
  const year = Number(base.slice(0, 4));
  const candidate = anniversaryIn(l, year);
  return candidate >= base ? candidate : anniversaryIn(l, year + 1);
}

function amountsOf(l: LeaseRow, rent: number, condo = toCents(l.condoFee), iptu = toCents(l.iptuMonthly)): Amounts {
  const fee = Math.round((rent * Number(l.adminFeePercent)) / 100);
  return { rent, condo, iptu, fee, payout: rent - fee + condo + iptu };
}
const chargeValues = (a: Amounts) => ({
  rent: centsToDecimal(a.rent),
  condoFee: centsToDecimal(a.condo),
  iptu: centsToDecimal(a.iptu),
  adminFee: centsToDecimal(a.fee),
  payout: centsToDecimal(a.payout),
});

function receiptOf(entry: Entry | undefined, today: string): ReceiptStatus {
  if (!entry || entry.status === 'cancelled') return 'cancelled';
  if (entry.status === 'paid') return 'paid';
  return entry.dueDate < today ? 'overdue' : 'pending';
}
const live = (entries: Entry[], sourceId: string) => entries.filter((e) => e.sourceId === sourceId && e.status !== 'cancelled');

@Injectable()
export class LeasesService implements OnModuleInit {
  private readonly logger = new Logger(LeasesService.name);

  constructor(
    private readonly tdb: TenantDb,
    private readonly jobs: ScheduledJobs,
    private readonly settings: ModuleSettingsService,
    private readonly finance: FinanceService,
    private readonly customers: CustomersService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  onModuleInit() {
    // Idempotente: completa as mensalidades, abre reajustes e lembra vencimentos. De hora em hora
    // para os lembretes saírem de manhã; o resto só tem efeito uma vez por dia.
    this.jobs.every('real_estate.leases', 60 * 60_000, () => this.runDaily());
  }

  // ---- Contratos ------------------------------------------------------------------------------

  list(opts: { status?: string; ownerId?: string; renterId?: string; customerId?: string; propertyId?: string; dueThisMonth?: boolean }): Promise<Lease[]> {
    return this.tdb.run(async (tx) => {
      const today = localToday();
      const monthStart = `${today.slice(0, 7)}-01`;
      const monthEnd = addDays(dayOfMonth(today, 1, 1), -1);
      const rows = await this.leaseQuery(tx)
        .where(
          and(
            opts.status ? eq(reLeases.status, opts.status as LeaseRow['status']) : undefined,
            opts.ownerId ? eq(reLeases.ownerId, opts.ownerId) : undefined,
            opts.renterId ? eq(reLeases.renterId, opts.renterId) : undefined,
            opts.customerId ? or(eq(reLeases.ownerId, opts.customerId), eq(reLeases.renterId, opts.customerId)) : undefined,
            opts.propertyId ? eq(reLeases.propertyId, opts.propertyId) : undefined,
            opts.dueThisMonth
              ? sql`exists (select 1 from ${reLeaseCharges} where ${reLeaseCharges.leaseId} = ${reLeases.id} and ${reLeaseCharges.status} = 'active'
                    and ${reLeaseCharges.dueDate} between ${monthStart} and ${monthEnd})`
              : undefined,
          ),
        )
        .orderBy(desc(reLeases.createdAt))
        .limit(500);
      return this.toLeases(tx, rows);
    });
  }

  get(id: string): Promise<LeaseDetail> {
    return this.tdb.run((tx) => this.detail(tx, id));
  }

  /**
   * Assina o contrato: o imóvel fica "Alugado" e as 12 primeiras mensalidades (ou o prazo, se
   * menor) entram no financeiro, com os repasses ao proprietário.
   */
  create(input: LeaseInput): Promise<LeaseDetail> {
    const { tenantId, userId } = requestContext.require();
    return this.tdb.run(async (tx) => {
      const tenantCustomer = await this.customers.findInTx(tx, input.renterId);
      if (!tenantCustomer || tenantCustomer.anonymizedAt) throw badRequest('RENTER_NOT_FOUND', 'Inquilino não encontrado');
      const [property] = await tx.select().from(reProperties).where(eq(reProperties.id, input.propertyId)).for('update');
      if (!property) throw new NotFoundException({ code: 'PROPERTY_NOT_FOUND', message: 'Imóvel não encontrado' });
      if (property.purpose === 'sale') throw badRequest('PROPERTY_NOT_FOR_RENT', 'Este imóvel está cadastrado só para venda');
      if (property.status !== 'available') throw new ConflictException({ code: 'PROPERTY_UNAVAILABLE', message: 'Imóvel não está disponível para locação' });
      if (property.ownerId === tenantCustomer.id) throw badRequest('RENTER_IS_OWNER', 'O inquilino é o próprio proprietário');
      if (input.startDate < '2000-01-01') throw badRequest('INVALID_DATE', 'Data de início inválida');
      // Situação trocada à mão antes da regra atual: com proposta de compra aberta, o imóvel segue reservado.
      const [openDeal] = await tx.select({ number: reDeals.number }).from(reDeals).where(and(eq(reDeals.propertyId, property.id), sql`${reDeals.status} not in ('closed', 'lost')`)).limit(1);
      if (openDeal) throw new ConflictException({ code: 'PROPERTY_UNAVAILABLE', message: `Este imóvel está na proposta de compra nº ${openDeal.number}, ainda aberta` });

      const [lease] = await tx
        .insert(reLeases)
        .values({
          tenantId,
          number: await nextSequence(tx, tenantId, 're_lease'),
          propertyId: property.id,
          renterId: tenantCustomer.id,
          ownerId: property.ownerId,
          startDate: input.startDate,
          termMonths: input.termMonths,
          endDate: endDateOf(input.startDate, input.termMonths),
          initialRent: centsToDecimal(toCents(input.rent)),
          rent: centsToDecimal(toCents(input.rent)),
          dueDay: input.dueDay,
          condoFee: centsToDecimal(toCents(input.condoFee)),
          iptuMonthly: centsToDecimal(toCents(input.iptuMonthly)),
          adjustmentIndex: input.adjustmentIndex,
          adjustmentPercent: input.adjustmentIndex === 'fixed' && input.adjustmentPercent != null ? input.adjustmentPercent.toFixed(2) : null,
          adjustmentMonth: input.adjustmentMonth ?? Number(input.startDate.slice(5, 7)),
          guaranteeType: input.guaranteeType,
          guaranteeAmount: (input.guaranteeType === 'deposit' || input.guaranteeType === 'capitalization') && input.guaranteeAmount ? centsToDecimal(toCents(input.guaranteeAmount)) : null,
          guarantorName: input.guaranteeType === 'guarantor' ? input.guarantorName : null,
          guarantorDocument: input.guaranteeType === 'guarantor' ? input.guarantorDocument : null,
          guaranteeProvider: input.guaranteeType === 'insurance' || input.guaranteeType === 'capitalization' ? input.guaranteeProvider : null,
          guaranteeNumber: input.guaranteeType === 'insurance' || input.guaranteeType === 'capitalization' ? input.guaranteeNumber : null,
          adminFeePercent: input.adminFeePercent.toFixed(2),
          notes: input.notes,
          createdBy: userId,
        })
        .returning();
      await tx.update(reProperties).set({ status: 'rented' }).where(eq(reProperties.id, property.id));

      const ctx: Ctx = { lease: lease!, code: property.code, title: property.title };
      const s = await this.settingsOf(tx);
      await this.generateCharges(tx, ctx, s, { upToSeq: Math.min(HORIZON_MONTHS, lease!.termMonths) });
      // Contrato cadastrado com início no passado: o aluguel informado é o vigente, então os
      // aniversários que já passaram ficam registrados como não aplicados.
      if (lease!.adjustmentIndex !== 'none') {
        const today = localToday();
        for (let due = firstAnniversary(lease!); due < today && due <= lease!.endDate; due = anniversaryIn(lease!, Number(due.slice(0, 4)) + 1)) {
          await tx.insert(reLeaseAdjustments).values({
            tenantId,
            leaseId: lease!.id,
            dueOn: due,
            index: lease!.adjustmentIndex,
            previousRent: lease!.rent,
            status: 'skipped',
            notes: 'Anterior ao cadastro do contrato no sistema',
          });
        }
      }

      await this.customers.addTimeline(tx, {
        customerId: tenantCustomer.id,
        moduleKey: MODULE,
        type: 'lease.created',
        title: `Contrato de locação nº ${lease!.number}: ${property.title}`,
        entity: 're_lease',
        entityId: lease!.id,
      });
      await this.customers.addTimeline(tx, {
        customerId: property.ownerId,
        moduleKey: MODULE,
        type: 'property.rented',
        title: `Imóvel alugado: ${property.title}`,
        entity: 're_lease',
        entityId: lease!.id,
      });
      await this.audit.log(tx, { action: 'real_estate.lease.created', entity: 're_lease', entityId: lease!.id, data: { propertyId: property.id, rent: input.rent, termMonths: input.termMonths } });
      return this.detail(tx, lease!.id);
    });
  }

  /**
   * Edita o contrato ativo: condomínio, IPTU, garantia e observações. Condomínio e IPTU valem daqui
   * para a frente: as mensalidades a partir de `applyFrom` são relançadas (a anterior fica cancelada
   * no financeiro), menos as que já têm recebimento ou repasse baixado, que continuam como estão.
   */
  update(id: string, input: LeaseUpdateInput): Promise<LeaseUpdateResult> {
    return this.tdb.run(async (tx) => {
      const lease = await this.activeLeaseOrFail(tx, id);
      if (input.guaranteeType === 'deposit' && input.guaranteeAmount && input.guaranteeAmount > (toCents(lease.rent) * MAX_DEPOSIT_RENTS) / 100) throw badRequest('DEPOSIT_TOO_HIGH', depositLimitMessage);
      const condo = toCents(input.condoFee);
      const iptu = toCents(input.iptuMonthly);
      const amountsChanged = condo !== toCents(lease.condoFee) || iptu !== toCents(lease.iptuMonthly);
      const [updated] = await tx
        .update(reLeases)
        .set({
          condoFee: centsToDecimal(condo),
          iptuMonthly: centsToDecimal(iptu),
          guaranteeType: input.guaranteeType,
          guaranteeAmount: (input.guaranteeType === 'deposit' || input.guaranteeType === 'capitalization') && input.guaranteeAmount ? centsToDecimal(toCents(input.guaranteeAmount)) : null,
          guarantorName: input.guaranteeType === 'guarantor' ? input.guarantorName : null,
          guarantorDocument: input.guaranteeType === 'guarantor' ? input.guarantorDocument : null,
          guaranteeProvider: input.guaranteeType === 'insurance' || input.guaranteeType === 'capitalization' ? input.guaranteeProvider : null,
          guaranteeNumber: input.guaranteeType === 'insurance' || input.guaranteeType === 'capitalization' ? input.guaranteeNumber : null,
          notes: input.notes,
        })
        .where(eq(reLeases.id, id))
        .returning();

      let applied: LeaseUpdateResult['applied'] = null;
      if (amountsChanged) {
        const from = input.applyFrom ?? localToday();
        const charges = await tx
          .select()
          .from(reLeaseCharges)
          .where(and(eq(reLeaseCharges.leaseId, id), eq(reLeaseCharges.status, 'active')))
          .orderBy(asc(reLeaseCharges.seq));
        // As mensalidades que ainda vão ser lançadas usam o valor novo: "a partir de" não pode ficar depois delas.
        const last = charges.at(-1);
        if (last && from > last.periodStart) throw badRequest('APPLY_FROM_TOO_FAR', `Os valores só podem valer a partir de um mês já lançado (até ${monthLabel(last.periodStart)})`);
        const ctx = await this.ctxOf(tx, updated!);
        const target = charges.filter((ch) => ch.periodStart >= from && (toCents(ch.condoFee) !== condo || toCents(ch.iptu) !== iptu));
        let rebilled = 0;
        for (const ch of target) {
          if (await this.rebill(tx, ctx, ch, amountsOf(updated!, toCents(ch.rent), condo, iptu), ch.payoutDate)) rebilled++;
        }
        applied = { from, rebilled, kept: target.length - rebilled };
        for (const customerId of [lease.renterId, lease.ownerId]) {
          await this.customers.addTimeline(tx, {
            customerId,
            moduleKey: MODULE,
            type: 'lease.updated',
            title: `Contrato de locação nº ${lease.number}: condomínio ${brl(condo)} e IPTU ${brl(iptu)} a partir de ${brDate(from)}`,
            entity: 're_lease',
            entityId: id,
          });
        }
      }
      await this.audit.log(tx, {
        action: 'real_estate.lease.updated',
        entity: 're_lease',
        entityId: id,
        data: {
          condoFee: { from: Number(lease.condoFee), to: condo / 100 },
          iptuMonthly: { from: Number(lease.iptuMonthly), to: iptu / 100 },
          guaranteeType: { from: lease.guaranteeType, to: input.guaranteeType },
          guarantorChanged: lease.guarantorDocument !== (input.guaranteeType === 'guarantor' ? input.guarantorDocument : null),
          applied,
        },
      });
      return { ...(await this.detail(tx, id)), applied };
    });
  }

  // ---- Repasse --------------------------------------------------------------------------------

  /**
   * Baixa do repasse da mensalidade ou da cobrança extra. O repasse sai por aqui (e não pela tela do
   * financeiro) para que pagar antes de receber o aluguel exija uma confirmação explícita, que fica
   * na auditoria. Quem confirma está adiantando o dinheiro do próprio caixa da imobiliária.
   */
  payout(id: string, kind: 'charge' | 'extra', sourceId: string, input: PayoutInput): Promise<LeaseDetail> {
    return this.tdb.run(async (tx) => {
      const [lease] = await tx.select().from(reLeases).where(eq(reLeases.id, id));
      if (!lease) throw notFound();
      const sourceType = kind === 'charge' ? LEASE_CHARGE_SOURCE : LEASE_EXTRA_SOURCE;
      const [source] =
        kind === 'charge'
          ? await tx.select({ id: reLeaseCharges.id, status: reLeaseCharges.status }).from(reLeaseCharges).where(and(eq(reLeaseCharges.id, sourceId), eq(reLeaseCharges.leaseId, id))).for('update')
          : await tx.select({ id: reLeaseExtras.id, status: reLeaseExtras.status }).from(reLeaseExtras).where(and(eq(reLeaseExtras.id, sourceId), eq(reLeaseExtras.leaseId, id))).for('update');
      if (!source || source.status !== 'active') throw new NotFoundException({ code: 'PAYOUT_NOT_FOUND', message: 'Repasse não encontrado' });
      const entries = live(await this.finance.listBySourceInTx(tx, sourceType, sourceId), sourceId);
      const payout = entries.find((e) => e.kind === 'expense');
      if (!payout) throw badRequest('NO_PAYOUT', 'Esta cobrança não tem repasse ao proprietário');
      if (payout.status === 'paid') throw badRequest('PAYOUT_ALREADY_PAID', 'Este repasse já foi pago');
      if (input.paidAt > localToday()) throw badRequest('PAID_IN_FUTURE', 'A data do repasse não pode ser futura');
      const received = entries.find((e) => e.kind === 'income')?.status === 'paid';
      if (!received && !input.acknowledgeUnreceived) {
        throw new ConflictException({ code: 'RENT_NOT_RECEIVED', message: 'O valor ainda não foi recebido do inquilino. Se repassar agora, a imobiliária adianta do próprio caixa: confirme para continuar' });
      }
      const [account] = await tx.select({ id: finAccounts.id }).from(finAccounts).where(and(eq(finAccounts.id, input.accountId), eq(finAccounts.active, true)));
      if (!account) throw badRequest('ACCOUNT_NOT_FOUND', 'Conta não encontrada ou inativa');
      await tx
        .update(finEntries)
        .set({ status: 'paid', paidAt: input.paidAt, accountId: input.accountId, paymentMethod: input.paymentMethod })
        .where(and(eq(finEntries.id, payout.id), eq(finEntries.status, 'pending')));
      await this.audit.log(tx, { action: 'real_estate.lease.payout_paid', entity: 're_lease', entityId: id, data: { entryId: payout.id, kind, sourceId, amount: payout.amount, paidAt: input.paidAt, beforeReceiving: !received } });
      return this.detail(tx, id);
    });
  }

  /** Contas para a baixa do repasse, sem saldo. */
  payoutAccounts() {
    return this.finance.listAccountsBasic();
  }

  /** Prorroga o prazo e lança as mensalidades que faltarem até 12 meses à frente. */
  extend(id: string, months: number): Promise<LeaseDetail> {
    return this.tdb.run(async (tx) => {
      const lease = await this.activeLeaseOrFail(tx, id);
      const termMonths = lease.termMonths + months;
      const [updated] = await tx
        .update(reLeases)
        .set({ termMonths, endDate: endDateOf(lease.startDate, termMonths) })
        .where(eq(reLeases.id, id))
        .returning();
      await this.generateCharges(tx, await this.ctxOf(tx, updated!), await this.settingsOf(tx), { horizon: addMonths(localToday(), HORIZON_MONTHS) });
      await this.audit.log(tx, { action: 'real_estate.lease.extended', entity: 're_lease', entityId: id, data: { months, termMonths } });
      return this.detail(tx, id);
    });
  }

  /**
   * Encerra (na data do fim do prazo ou depois) ou rescinde (antes) o contrato. Mensalidades de
   * meses que começam depois da entrega das chaves são canceladas; o mês em curso é cobrado
   * proporcionalmente aos dias. O que já foi recebido ou repassado não muda. O imóvel volta a
   * ficar disponível.
   */
  terminate(id: string, input: TerminateLeaseInput): Promise<LeaseDetail> {
    const { tenantId } = requestContext.require();
    return this.tdb.run(async (tx) => {
      const lease = await this.activeLeaseOrFail(tx, id);
      if (input.date < lease.startDate) throw badRequest('INVALID_DATE', 'A data é anterior ao início do contrato');
      const status = input.date >= lease.endDate ? 'ended' : 'terminated';
      if (status === 'terminated' && (input.reason?.length ?? 0) < 3) throw badRequest('REASON_REQUIRED', 'Informe o motivo da rescisão');
      const ctx = await this.ctxOf(tx, lease);
      const s = await this.settingsOf(tx);

      const charges = await tx
        .select()
        .from(reLeaseCharges)
        .where(and(eq(reLeaseCharges.leaseId, id), eq(reLeaseCharges.status, 'active')))
        .orderBy(asc(reLeaseCharges.seq));
      const counts = { cancelled: 0, prorated: 0, kept: 0 };
      for (const ch of charges) {
        if (ch.periodStart >= input.date) {
          if (await this.cancelChargeIfOpen(tx, ch)) counts.cancelled++;
          else counts.kept++;
          continue;
        }
        const nextStart = addMonths(lease.startDate, ch.seq);
        const days = daysBetween(ch.periodStart, nextStart);
        const used = daysBetween(ch.periodStart, input.date) + 1;
        if (used >= days) continue;
        const part = (cents: string) => Math.round((toCents(cents) * used) / days);
        if (await this.rebill(tx, ctx, ch, amountsOf(lease, part(ch.rent), part(ch.condoFee), part(ch.iptu)), ch.payoutDate)) counts.prorated++;
        else counts.kept++;
      }

      const extras = await tx
        .select()
        .from(reLeaseExtras)
        .where(and(eq(reLeaseExtras.leaseId, id), eq(reLeaseExtras.status, 'active'), gt(reLeaseExtras.dueDate, input.date)));
      for (const extra of extras) await this.cancelExtraIfOpen(tx, extra);

      await tx
        .update(reLeaseAdjustments)
        .set({ status: 'skipped', notes: status === 'ended' ? 'Contrato encerrado' : 'Contrato rescindido' })
        .where(and(eq(reLeaseAdjustments.leaseId, id), eq(reLeaseAdjustments.status, 'pending')));

      if (input.fine) {
        await this.insertExtra(tx, ctx, s, tenantId, {
          kind: 'fine',
          description: 'Multa rescisória',
          amount: input.fine.amount,
          dueDate: input.fine.dueDate ?? input.date,
          passToOwner: input.fine.passToOwner,
        });
      }

      await tx.update(reLeases).set({ status, terminatedOn: input.date, terminationReason: input.reason }).where(eq(reLeases.id, id));
      await tx.update(reProperties).set({ status: 'available' }).where(and(eq(reProperties.id, lease.propertyId), eq(reProperties.status, 'rented')));
      const verb = status === 'ended' ? 'encerrado' : 'rescindido';
      for (const customerId of [lease.renterId, lease.ownerId]) {
        await this.customers.addTimeline(tx, {
          customerId,
          moduleKey: MODULE,
          type: `lease.${status}`,
          title: `Contrato de locação nº ${lease.number} ${verb}: ${ctx.title}`,
          entity: 're_lease',
          entityId: id,
        });
      }
      await this.audit.log(tx, { action: `real_estate.lease.${status}`, entity: 're_lease', entityId: id, data: { date: input.date, reason: input.reason, fine: input.fine?.amount ?? null, ...counts } });
      return this.detail(tx, id);
    });
  }

  // ---- Cobranças avulsas ----------------------------------------------------------------------

  addExtra(id: string, input: LeaseExtraInput): Promise<LeaseDetail> {
    const { tenantId } = requestContext.require();
    return this.tdb.run(async (tx) => {
      const [lease] = await tx.select().from(reLeases).where(eq(reLeases.id, id));
      if (!lease) throw notFound();
      if (lease.status !== 'active') throw badRequest('LEASE_CLOSED', 'Contrato encerrado não recebe cobrança extra: lance o acerto final no financeiro');
      const extra = await this.insertExtra(tx, await this.ctxOf(tx, lease), await this.settingsOf(tx), tenantId, {
        ...input,
        description: input.description ?? extraKindLabel[input.kind],
      });
      await this.audit.log(tx, { action: 'real_estate.lease.extra_added', entity: 're_lease', entityId: id, data: { extraId: extra.id, kind: input.kind, amount: input.amount } });
      return this.detail(tx, id);
    });
  }

  cancelExtra(id: string, extraId: string): Promise<LeaseDetail> {
    return this.tdb.run(async (tx) => {
      const [extra] = await tx
        .select()
        .from(reLeaseExtras)
        .where(and(eq(reLeaseExtras.id, extraId), eq(reLeaseExtras.leaseId, id)))
        .for('update');
      if (!extra) throw new NotFoundException({ code: 'EXTRA_NOT_FOUND', message: 'Cobrança não encontrada' });
      if (extra.status === 'cancelled') return this.detail(tx, id);
      if (!(await this.cancelExtraIfOpen(tx, extra))) throw badRequest('EXTRA_SETTLED', 'Esta cobrança já foi recebida ou repassada');
      await this.audit.log(tx, { action: 'real_estate.lease.extra_cancelled', entity: 're_lease', entityId: id, data: { extraId } });
      return this.detail(tx, id);
    });
  }

  // ---- Reajustes ------------------------------------------------------------------------------

  listAdjustments(opts: { status?: string; leaseId?: string }): Promise<LeaseAdjustment[]> {
    return this.tdb.run(async (tx) => {
      const rows = await tx
        .select({ a: reLeaseAdjustments, l: reLeases, code: reProperties.code, title: reProperties.title, renterName: renter.name })
        .from(reLeaseAdjustments)
        .innerJoin(reLeases, eq(reLeases.id, reLeaseAdjustments.leaseId))
        .innerJoin(reProperties, eq(reProperties.id, reLeases.propertyId))
        .innerJoin(renter, eq(renter.id, reLeases.renterId))
        .where(
          and(
            opts.status ? eq(reLeaseAdjustments.status, opts.status as AdjustmentRow['status']) : undefined,
            opts.leaseId ? eq(reLeaseAdjustments.leaseId, opts.leaseId) : undefined,
          ),
        )
        .orderBy(asc(reLeaseAdjustments.dueOn))
        .limit(500);
      return rows.map((r) => ({
        ...toAdjustment(r.a),
        lease: { number: r.l.number, propertyCode: r.code, propertyTitle: r.title, renterName: r.renterName, rent: Number(r.l.rent) },
      }));
    });
  }

  /**
   * Aplica o reajuste: novo aluguel = vigente × (1 + %). As mensalidades de meses que começam no
   * aniversário ou depois e ainda estão em aberto são recalculadas (as antigas são canceladas no
   * financeiro e lançadas de novo). O inquilino recebe o aviso.
   */
  applyAdjustment(id: string, input: ApplyAdjustmentInput): Promise<LeaseAdjustment> {
    return this.tdb.run(async (tx) => {
      const [adj] = await tx.select().from(reLeaseAdjustments).where(eq(reLeaseAdjustments.id, id)).for('update');
      if (!adj) throw new NotFoundException({ code: 'ADJUSTMENT_NOT_FOUND', message: 'Reajuste não encontrado' });
      if (adj.status !== 'pending') throw badRequest('ADJUSTMENT_NOT_PENDING', 'Este reajuste já foi resolvido');
      const lease = await this.activeLeaseOrFail(tx, adj.leaseId);
      const percent = input.percent ?? (lease.adjustmentIndex === 'fixed' ? Number(lease.adjustmentPercent) : null);
      if (percent == null) throw badRequest('PERCENT_REQUIRED', `Informe a variação do ${adjustmentIndexLabel[lease.adjustmentIndex]} no período`);
      return toAdjustment(await this.applyInTx(tx, adj, lease, percent));
    });
  }

  /** Reajuste não aplicado neste aniversário (ex.: negociado com o inquilino). */
  skipAdjustment(id: string, notes: string | null): Promise<LeaseAdjustment> {
    return this.tdb.run(async (tx) => {
      const [row] = await tx
        .update(reLeaseAdjustments)
        .set({ status: 'skipped', notes })
        .where(and(eq(reLeaseAdjustments.id, id), eq(reLeaseAdjustments.status, 'pending')))
        .returning();
      if (!row) throw badRequest('ADJUSTMENT_NOT_PENDING', 'Reajuste não encontrado ou já resolvido');
      await this.audit.log(tx, { action: 'real_estate.lease.adjustment_skipped', entity: 're_lease', entityId: row.leaseId, data: { adjustmentId: id, notes } });
      return toAdjustment(row);
    });
  }

  // ---- Extrato do proprietário ----------------------------------------------------------------

  statement(ownerId: string, month: string): Promise<OwnerStatement> {
    const from = `${month}-01`;
    const to = addDays(dayOfMonth(from, 1, 1), -1);
    return this.tdb.run(async (tx) => {
      const ownerRow = await this.customers.findInTx(tx, ownerId);
      if (!ownerRow) throw new NotFoundException({ code: 'CUSTOMER_NOT_FOUND', message: 'Proprietário não encontrado' });
      const base = { number: reLeases.number, leaseId: reLeases.id, code: reProperties.code, title: reProperties.title, renterName: renter.name };
      const [charges, extras] = await Promise.all([
        tx
          .select({ ch: reLeaseCharges, ...base })
          .from(reLeaseCharges)
          .innerJoin(reLeases, eq(reLeases.id, reLeaseCharges.leaseId))
          .innerJoin(reProperties, eq(reProperties.id, reLeases.propertyId))
          .innerJoin(renter, eq(renter.id, reLeases.renterId))
          .where(and(eq(reLeases.ownerId, ownerId), eq(reLeaseCharges.status, 'active'), gte(reLeaseCharges.dueDate, from), lte(reLeaseCharges.dueDate, to)))
          .orderBy(asc(reLeaseCharges.dueDate), asc(reLeases.number)),
        tx
          .select({ ex: reLeaseExtras, ...base })
          .from(reLeaseExtras)
          .innerJoin(reLeases, eq(reLeases.id, reLeaseExtras.leaseId))
          .innerJoin(reProperties, eq(reProperties.id, reLeases.propertyId))
          .innerJoin(renter, eq(renter.id, reLeases.renterId))
          .where(and(eq(reLeases.ownerId, ownerId), eq(reLeaseExtras.status, 'active'), eq(reLeaseExtras.passToOwner, true), gte(reLeaseExtras.dueDate, from), lte(reLeaseExtras.dueDate, to)))
          .orderBy(asc(reLeaseExtras.dueDate)),
      ]);
      const [chargeEntries, extraEntries] = await Promise.all([
        this.finance.listBySourceInTx(tx, LEASE_CHARGE_SOURCE, charges.map((c) => c.ch.id)),
        this.finance.listBySourceInTx(tx, LEASE_EXTRA_SOURCE, extras.map((e) => e.ex.id)),
      ]);
      const today = localToday();
      const lineOf = (
        r: { leaseId: string; number: number; code: number; title: string; renterName: string },
        mine: Entry[],
        v: { description: string; dueDate: string; amount: number; adminFee: number; payout: number; payoutDate: string },
      ): OwnerStatementLine => {
        const income = mine.find((e) => e.kind === 'income');
        const payout = mine.find((e) => e.kind === 'expense');
        return {
          leaseId: r.leaseId,
          leaseNumber: r.number,
          propertyCode: r.code,
          propertyTitle: r.title,
          renterName: r.renterName,
          ...v,
          receipt: receiptOf(income, today),
          receivedAt: income?.paidAt ?? null,
          payoutStatus: (payout?.status as PayoutStatus | undefined) ?? null,
          payoutPaidAt: payout?.paidAt ?? null,
        };
      };
      const lines = [
        ...charges.map((r) =>
          lineOf(r, live(chargeEntries, r.ch.id), {
            description: `Aluguel ${monthLabel(r.ch.periodStart)}`,
            dueDate: r.ch.dueDate,
            amount: (toCents(r.ch.rent) + toCents(r.ch.condoFee) + toCents(r.ch.iptu)) / 100,
            adminFee: Number(r.ch.adminFee),
            payout: Number(r.ch.payout),
            payoutDate: r.ch.payoutDate,
          }),
        ),
        ...extras.map((r) =>
          lineOf(r, live(extraEntries, r.ex.id), {
            description: r.ex.description,
            dueDate: r.ex.dueDate,
            amount: Number(r.ex.amount),
            adminFee: 0,
            payout: Number(r.ex.amount),
            payoutDate: live(extraEntries, r.ex.id).find((e) => e.kind === 'expense')?.dueDate ?? r.ex.dueDate,
          }),
        ),
      ].sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.leaseNumber - b.leaseNumber);
      const sum = (pick: (l: OwnerStatementLine) => number) => lines.reduce((acc, l) => acc + toCents(pick(l)), 0) / 100;
      return {
        owner: { id: ownerRow.id, name: ownerRow.name, document: ownerRow.document },
        month,
        lines,
        totals: {
          charged: sum((l) => l.amount),
          received: sum((l) => (l.receipt === 'paid' ? l.amount : 0)),
          adminFee: sum((l) => l.adminFee),
          payout: sum((l) => l.payout),
          payoutPaid: sum((l) => (l.payoutStatus === 'paid' ? l.payout : 0)),
        },
      };
    });
  }

  // ---- Job ------------------------------------------------------------------------------------

  /** Para cada empresa: completa 12 meses de mensalidades, abre os reajustes e lembra os vencimentos. */
  async runDaily() {
    for (const tenantId of await this.jobs.tenantsWithModule(MODULE)) {
      try {
        await requestContext.run({ tenantId }, () => this.tdb.run((tx) => this.dailyInTx(tx, localToday())));
      } catch (err) {
        this.logger.error(`Locações do tenant ${tenantId}: ${err}`);
      }
    }
  }

  private async dailyInTx(tx: Tx, today: string) {
    const s = await this.settingsOf(tx);
    const active = await tx
      .select({ lease: reLeases, code: reProperties.code, title: reProperties.title })
      .from(reLeases)
      .innerJoin(reProperties, eq(reProperties.id, reLeases.propertyId))
      .where(eq(reLeases.status, 'active'));
    const horizon = addMonths(today, HORIZON_MONTHS);
    for (const ctx of active) {
      await this.generateCharges(tx, ctx, s, { horizon });
      await this.openAdjustment(tx, ctx, s, today);
    }
    await this.sendRentReminders(tx, s, today);
  }

  /** Reajuste do próximo aniversário, `adjustmentNoticeDays` antes. Índice fixo é aplicado na hora. */
  private async openAdjustment(tx: Tx, ctx: Ctx, s: RealEstateSettings, today: string) {
    const { lease } = ctx;
    if (lease.adjustmentIndex === 'none') return;
    const [last] = await tx.select().from(reLeaseAdjustments).where(eq(reLeaseAdjustments.leaseId, lease.id)).orderBy(desc(reLeaseAdjustments.dueOn)).limit(1);
    if (last?.status === 'pending') return;
    const dueOn = last ? anniversaryIn(lease, Number(last.dueOn.slice(0, 4)) + 1) : firstAnniversary(lease);
    if (dueOn > lease.endDate || dueOn > addDays(today, s.adjustmentNoticeDays)) return;
    const [adj] = await tx
      .insert(reLeaseAdjustments)
      .values({ tenantId: lease.tenantId, leaseId: lease.id, dueOn, index: lease.adjustmentIndex, previousRent: lease.rent })
      .onConflictDoNothing()
      .returning();
    if (adj && lease.adjustmentIndex === 'fixed' && lease.adjustmentPercent != null) {
      await this.applyInTx(tx, adj, lease, Number(lease.adjustmentPercent));
      ctx.lease = await this.leaseOrFail(tx, lease.id);
    }
  }

  private async sendRentReminders(tx: Tx, s: RealEstateSettings, today: string) {
    if (!s.rentReminderDays) return;
    const due = await tx
      .select({ ch: reLeaseCharges, renterId: reLeases.renterId, title: reProperties.title, amount: finEntries.amount })
      .from(reLeaseCharges)
      .innerJoin(reLeases, eq(reLeases.id, reLeaseCharges.leaseId))
      .innerJoin(reProperties, eq(reProperties.id, reLeases.propertyId))
      .innerJoin(
        finEntries,
        and(eq(finEntries.sourceType, LEASE_CHARGE_SOURCE), eq(finEntries.sourceId, sql`${reLeaseCharges.id}::text`), eq(finEntries.kind, 'income'), eq(finEntries.status, 'pending')),
      )
      .where(
        and(
          eq(reLeases.status, 'active'),
          eq(reLeaseCharges.status, 'active'),
          isNull(reLeaseCharges.reminderSentAt),
          gte(reLeaseCharges.dueDate, today),
          lte(reLeaseCharges.dueDate, addDays(today, s.rentReminderDays)),
        ),
      );
    for (const r of due) {
      await tx.update(reLeaseCharges).set({ reminderSentAt: new Date() }).where(eq(reLeaseCharges.id, r.ch.id));
      await this.notifications.enqueueInTx(tx, {
        templateKey: 'real_estate.rent_due',
        customerId: r.renterId,
        related: { entity: 're_lease_charge', id: r.ch.id },
        data: { imovel: { titulo: r.title }, aluguel: { valor: brl(toCents(r.amount)), vencimento: brDate(r.ch.dueDate), competencia: monthLabel(r.ch.periodStart) } },
      });
    }
  }

  // ---- internos -------------------------------------------------------------------------------

  private async settingsOf(tx: Tx) {
    return this.settings.getInTx<RealEstateSettings>(tx, MODULE);
  }

  /** Lança as próximas mensalidades: até a `upToSeq` (na assinatura) ou as que vencem até `horizon`. Nunca passa do prazo. */
  private async generateCharges(tx: Tx, ctx: Ctx, s: RealEstateSettings, limit: { upToSeq: number } | { horizon: string }) {
    const { lease } = ctx;
    const [{ max } = { max: 0 }] = await tx
      .select({ max: sql<number>`coalesce(max(${reLeaseCharges.seq}), 0)`.mapWith(Number) })
      .from(reLeaseCharges)
      .where(eq(reLeaseCharges.leaseId, lease.id));
    let created = 0;
    for (let seq = max + 1; seq <= lease.termMonths; seq++) {
      if ('upToSeq' in limit ? seq > limit.upToSeq : dueDateOf(lease, seq) > limit.horizon) break;
      const dueDate = dueDateOf(lease, seq);
      const [row] = await tx
        .insert(reLeaseCharges)
        .values({
          tenantId: lease.tenantId,
          leaseId: lease.id,
          seq,
          periodStart: periodStartOf(lease, seq),
          dueDate,
          payoutDate: addDays(dueDate, s.payoutDelayDays),
          ...chargeValues(amountsOf(lease, toCents(lease.rent))),
        })
        .returning();
      await this.recordChargeEntries(tx, ctx, row!);
      created++;
    }
    return created;
  }

  /** "A receber" do inquilino e "a pagar" do repasse, com baixa pelo financeiro. */
  private async recordChargeEntries(tx: Tx, ctx: Ctx, ch: ChargeRow) {
    const { lease } = ctx;
    const ref = `contrato ${lease.number}, imóvel ${ctx.code}`;
    const month = monthLabel(ch.periodStart);
    const total = toCents(ch.rent) + toCents(ch.condoFee) + toCents(ch.iptu);
    const parts = [toCents(ch.condoFee) > 0 ? 'condomínio' : null, toCents(ch.iptu) > 0 ? 'IPTU' : null].filter(Boolean);
    const base = { status: 'pending' as const, competenceDate: ch.periodStart, sourceType: LEASE_CHARGE_SOURCE, sourceId: ch.id };
    if (total > 0) {
      await this.finance.recordInTx(tx, {
        ...base,
        settleInFinance: true,
        kind: 'income',
        description: `Aluguel ${month}${parts.length ? ` + ${parts.join(' + ')}` : ''} — ${ref}`,
        amount: total / 100,
        dueDate: ch.dueDate,
        customerId: lease.renterId,
        categoryKey: 'other_income',
      });
    }
    if (toCents(ch.payout) > 0) {
      await this.finance.recordInTx(tx, {
        ...base,
        // A baixa do repasse é no contrato, que avisa quando o aluguel não foi recebido.
        settleInFinance: false,
        kind: 'expense',
        description: `Repasse ao proprietário ${month} — ${ref}`,
        amount: Number(ch.payout),
        dueDate: ch.payoutDate,
        customerId: lease.ownerId,
        categoryKey: 'other_expense',
      });
    }
  }

  /** Relança a mensalidade com novos valores, se nada dela foi recebido nem repassado. */
  private async rebill(tx: Tx, ctx: Ctx, ch: ChargeRow, amounts: Amounts, payoutDate: string): Promise<boolean> {
    const entries = live(await this.finance.listBySourceInTx(tx, LEASE_CHARGE_SOURCE, ch.id), ch.id);
    if (entries.some((e) => e.status === 'paid')) return false;
    await this.finance.cancelPendingBySourceInTx(tx, LEASE_CHARGE_SOURCE, ch.id);
    const [row] = await tx
      .update(reLeaseCharges)
      .set({ ...chargeValues(amounts), payoutDate })
      .where(eq(reLeaseCharges.id, ch.id))
      .returning();
    await this.recordChargeEntries(tx, ctx, row!);
    return true;
  }

  private async cancelChargeIfOpen(tx: Tx, ch: ChargeRow): Promise<boolean> {
    const entries = live(await this.finance.listBySourceInTx(tx, LEASE_CHARGE_SOURCE, ch.id), ch.id);
    if (entries.some((e) => e.status === 'paid')) return false;
    await this.finance.cancelPendingBySourceInTx(tx, LEASE_CHARGE_SOURCE, ch.id);
    await tx.update(reLeaseCharges).set({ status: 'cancelled' }).where(eq(reLeaseCharges.id, ch.id));
    return true;
  }

  private async cancelExtraIfOpen(tx: Tx, extra: ExtraRow): Promise<boolean> {
    const entries = live(await this.finance.listBySourceInTx(tx, LEASE_EXTRA_SOURCE, extra.id), extra.id);
    if (entries.some((e) => e.status === 'paid')) return false;
    await this.finance.cancelPendingBySourceInTx(tx, LEASE_EXTRA_SOURCE, extra.id);
    await tx.update(reLeaseExtras).set({ status: 'cancelled' }).where(eq(reLeaseExtras.id, extra.id));
    return true;
  }

  private async insertExtra(tx: Tx, ctx: Ctx, s: RealEstateSettings, tenantId: string, input: { kind: ExtraRow['kind']; description: string; amount: number; dueDate: string; passToOwner: boolean }) {
    const { lease } = ctx;
    const cents = toCents(input.amount);
    const [extra] = await tx
      .insert(reLeaseExtras)
      .values({ tenantId, leaseId: lease.id, kind: input.kind, description: input.description, amount: centsToDecimal(cents), dueDate: input.dueDate, passToOwner: input.passToOwner })
      .returning();
    const ref = `contrato ${lease.number}, imóvel ${ctx.code}`;
    const base = { status: 'pending' as const, sourceType: LEASE_EXTRA_SOURCE, sourceId: extra!.id, amount: cents / 100 };
    await this.finance.recordInTx(tx, { ...base, settleInFinance: true, kind: 'income', description: `${input.description} — ${ref}`, dueDate: input.dueDate, customerId: lease.renterId, categoryKey: 'other_income' });
    if (input.passToOwner) {
      await this.finance.recordInTx(tx, {
        ...base,
        settleInFinance: false,
        kind: 'expense',
        description: `Repasse ao proprietário: ${input.description} — ${ref}`,
        dueDate: addDays(input.dueDate, s.payoutDelayDays),
        competenceDate: input.dueDate,
        customerId: lease.ownerId,
        categoryKey: 'other_expense',
      });
    }
    return extra!;
  }

  private async applyInTx(tx: Tx, adj: AdjustmentRow, lease: LeaseRow, percent: number): Promise<AdjustmentRow> {
    const userId = requestContext.get().userId ?? null;
    const previous = toCents(lease.rent);
    const next = Math.round(previous * (1 + percent / 100));
    const [updated] = await tx.update(reLeases).set({ rent: centsToDecimal(next) }).where(eq(reLeases.id, lease.id)).returning();
    const [row] = await tx
      .update(reLeaseAdjustments)
      .set({ status: 'applied', percent: percent.toFixed(2), previousRent: centsToDecimal(previous), newRent: centsToDecimal(next), appliedAt: new Date(), appliedBy: userId })
      .where(eq(reLeaseAdjustments.id, adj.id))
      .returning();

    const ctx = await this.ctxOf(tx, updated!);
    const future = await tx
      .select()
      .from(reLeaseCharges)
      .where(and(eq(reLeaseCharges.leaseId, lease.id), eq(reLeaseCharges.status, 'active'), gte(reLeaseCharges.periodStart, adj.dueOn)))
      .orderBy(asc(reLeaseCharges.seq));
    let rebilled = 0;
    for (const ch of future) {
      if (await this.rebill(tx, ctx, ch, amountsOf(updated!, next, toCents(ch.condoFee), toCents(ch.iptu)), ch.payoutDate)) rebilled++;
    }

    await this.notifications.enqueueInTx(tx, {
      templateKey: 'real_estate.rent_adjusted',
      customerId: lease.renterId,
      related: { entity: 're_lease', id: lease.id },
      data: {
        imovel: { titulo: ctx.title },
        reajuste: { indice: indexText[lease.adjustmentIndex], percentual: `${percent.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`, vigencia: brDate(adj.dueOn) },
        aluguel: { valor: brl(next) },
      },
    });
    await this.customers.addTimeline(tx, {
      customerId: lease.renterId,
      moduleKey: MODULE,
      type: 'lease.adjusted',
      title: `Aluguel reajustado em ${percent.toLocaleString('pt-BR')}%: ${brl(previous)} → ${brl(next)}`,
      entity: 're_lease',
      entityId: lease.id,
    });
    await this.audit.log(tx, {
      action: 'real_estate.lease.adjusted',
      entity: 're_lease',
      entityId: lease.id,
      data: { adjustmentId: adj.id, percent, previousRent: previous / 100, newRent: next / 100, rebilled, kept: future.length - rebilled },
    });
    return row!;
  }

  private leaseQuery(tx: Tx) {
    return tx
      .select({
        l: reLeases,
        p: reProperties,
        renter: { id: renter.id, name: renter.name, phone: renter.phone, email: renter.email, document: renter.document },
        owner: { id: owner.id, name: owner.name, phone: owner.phone, document: owner.document },
      })
      .from(reLeases)
      .innerJoin(reProperties, eq(reProperties.id, reLeases.propertyId))
      .innerJoin(renter, eq(renter.id, reLeases.renterId))
      .innerJoin(owner, eq(owner.id, reLeases.ownerId))
      .$dynamic();
  }

  private async toLeases(tx: Tx, rows: { l: LeaseRow; p: typeof reProperties.$inferSelect; renter: Lease['renter']; owner: Lease['owner'] }[]): Promise<Lease[]> {
    if (!rows.length) return [];
    const today = localToday();
    const open = await tx
      .select({ leaseId: reLeaseCharges.leaseId, dueDate: finEntries.dueDate, amount: finEntries.amount })
      .from(reLeaseCharges)
      .innerJoin(
        finEntries,
        and(eq(finEntries.sourceType, LEASE_CHARGE_SOURCE), eq(finEntries.sourceId, sql`${reLeaseCharges.id}::text`), eq(finEntries.kind, 'income'), eq(finEntries.status, 'pending')),
      )
      .where(and(inArray(reLeaseCharges.leaseId, rows.map((r) => r.l.id)), eq(reLeaseCharges.status, 'active'), lte(reLeaseCharges.dueDate, addMonths(today, 2))))
      .orderBy(asc(finEntries.dueDate));
    return rows.map(({ l, p, renter: r, owner: o }) => {
      const mine = open.filter((c) => c.leaseId === l.id);
      const next = mine[0];
      return {
        id: l.id,
        number: l.number,
        status: l.status,
        property: { id: p.id, code: p.code, title: p.title, address: addressOf(p) },
        renter: r,
        owner: o,
        startDate: l.startDate,
        termMonths: l.termMonths,
        endDate: l.endDate,
        initialRent: Number(l.initialRent),
        rent: Number(l.rent),
        dueDay: l.dueDay,
        condoFee: Number(l.condoFee),
        iptuMonthly: Number(l.iptuMonthly),
        adjustmentIndex: l.adjustmentIndex,
        adjustmentPercent: l.adjustmentPercent === null ? null : Number(l.adjustmentPercent),
        adjustmentMonth: l.adjustmentMonth,
        guaranteeType: l.guaranteeType,
        guaranteeAmount: l.guaranteeAmount === null ? null : Number(l.guaranteeAmount),
        guarantorName: l.guarantorName,
        guarantorDocument: l.guarantorDocument,
        guaranteeProvider: l.guaranteeProvider,
        guaranteeNumber: l.guaranteeNumber,
        adminFeePercent: Number(l.adminFeePercent),
        notes: l.notes,
        terminatedOn: l.terminatedOn,
        terminationReason: l.terminationReason,
        nextCharge: next ? { dueDate: next.dueDate, amount: Number(next.amount), overdue: next.dueDate < today } : null,
        overdueCount: mine.filter((c) => c.dueDate < today).length,
        createdAt: l.createdAt.toISOString(),
      };
    });
  }

  private async detail(tx: Tx, id: string): Promise<LeaseDetail> {
    const [row] = await this.leaseQuery(tx).where(eq(reLeases.id, id));
    if (!row) throw notFound();
    const [lease] = await this.toLeases(tx, [row]);
    const [charges, extras, adjustments] = await Promise.all([
      tx.select().from(reLeaseCharges).where(eq(reLeaseCharges.leaseId, id)).orderBy(asc(reLeaseCharges.seq)),
      tx.select().from(reLeaseExtras).where(eq(reLeaseExtras.leaseId, id)).orderBy(asc(reLeaseExtras.dueDate), asc(reLeaseExtras.createdAt)),
      tx.select().from(reLeaseAdjustments).where(eq(reLeaseAdjustments.leaseId, id)).orderBy(asc(reLeaseAdjustments.dueOn)),
    ]);
    const [chargeEntries, extraEntries] = await Promise.all([
      this.finance.listBySourceInTx(tx, LEASE_CHARGE_SOURCE, charges.map((c) => c.id)),
      this.finance.listBySourceInTx(tx, LEASE_EXTRA_SOURCE, extras.map((e) => e.id)),
    ]);
    const today = localToday();
    return {
      ...lease!,
      charges: charges.map((c): LeaseCharge => {
        const mine = live(chargeEntries, c.id);
        const income = mine.find((e) => e.kind === 'income');
        const payout = mine.find((e) => e.kind === 'expense');
        return {
          id: c.id,
          seq: c.seq,
          periodStart: c.periodStart,
          dueDate: c.dueDate,
          payoutDate: c.payoutDate,
          rent: Number(c.rent),
          condoFee: Number(c.condoFee),
          iptu: Number(c.iptu),
          total: (toCents(c.rent) + toCents(c.condoFee) + toCents(c.iptu)) / 100,
          adminFee: Number(c.adminFee),
          payout: Number(c.payout),
          status: c.status,
          receipt: c.status === 'cancelled' ? 'cancelled' : receiptOf(income, today),
          receivedAt: income?.paidAt ?? null,
          payoutStatus: c.status === 'cancelled' && !payout ? 'cancelled' : ((payout?.status as PayoutStatus | undefined) ?? null),
          payoutPaidAt: payout?.paidAt ?? null,
        };
      }),
      extras: extras.map((e): LeaseExtra => {
        const income = live(extraEntries, e.id).find((x) => x.kind === 'income');
        const payout = live(extraEntries, e.id).find((x) => x.kind === 'expense');
        return {
          id: e.id,
          kind: e.kind,
          description: e.description,
          amount: Number(e.amount),
          dueDate: e.dueDate,
          passToOwner: e.passToOwner,
          status: e.status,
          receipt: e.status === 'cancelled' ? 'cancelled' : receiptOf(income, today),
          payoutStatus: (payout?.status as PayoutStatus | undefined) ?? null,
        };
      }),
      adjustments: adjustments.map(toAdjustment),
    };
  }

  private async ctxOf(tx: Tx, lease: LeaseRow): Promise<Ctx> {
    const [p] = await tx.select({ code: reProperties.code, title: reProperties.title }).from(reProperties).where(eq(reProperties.id, lease.propertyId));
    return { lease, code: p!.code, title: p!.title };
  }

  private async leaseOrFail(tx: Tx, id: string) {
    const [row] = await tx.select().from(reLeases).where(eq(reLeases.id, id));
    if (!row) throw notFound();
    return row;
  }

  private async activeLeaseOrFail(tx: Tx, id: string) {
    const [row] = await tx.select().from(reLeases).where(eq(reLeases.id, id)).for('update');
    if (!row) throw notFound();
    if (row.status !== 'active') throw badRequest('LEASE_CLOSED', 'Contrato já encerrado');
    return row;
  }
}

function toAdjustment(a: AdjustmentRow): LeaseAdjustment {
  return {
    id: a.id,
    leaseId: a.leaseId,
    dueOn: a.dueOn,
    index: a.index,
    percent: a.percent === null ? null : Number(a.percent),
    previousRent: Number(a.previousRent),
    newRent: a.newRent === null ? null : Number(a.newRent),
    status: a.status,
    notes: a.notes,
    appliedAt: a.appliedAt?.toISOString() ?? null,
  };
}

const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Mês inválido');
const leasesQuery = z.object({
  status: z.enum(leaseStatuses).optional(),
  ownerId: z.string().uuid().optional(),
  renterId: z.string().uuid().optional(),
  /** Inquilino ou proprietário (aba do cliente). */
  customerId: z.string().uuid().optional(),
  propertyId: z.string().uuid().optional(),
  /** Só contratos com aluguel vencendo no mês corrente. */
  dueThisMonth: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});
const adjustmentsQuery = z.object({ status: z.enum(['pending', 'applied', 'skipped']).optional(), leaseId: z.string().uuid().optional() });
const statementQuery = z.object({ ownerId: z.string().uuid('Escolha o proprietário'), month });

@Controller('real-estate/leases')
@ModuleRoute('real_estate')
export class LeasesController {
  constructor(private readonly leases: LeasesService) {}

  @Get()
  @RequirePermission('real_estate.leases.read')
  list(@Query(new ZodPipe(leasesQuery)) q: z.infer<typeof leasesQuery>) {
    return this.leases.list(q);
  }

  /** Rotas fixas antes de :id. */
  @Get('adjustments')
  @RequirePermission('real_estate.leases.read')
  adjustments(@Query(new ZodPipe(adjustmentsQuery)) q: z.infer<typeof adjustmentsQuery>) {
    return this.leases.listAdjustments(q);
  }

  @Get('statement')
  @RequirePermission('real_estate.leases.read')
  statement(@Query(new ZodPipe(statementQuery)) q: z.infer<typeof statementQuery>) {
    return this.leases.statement(q.ownerId, q.month);
  }

  /** A baixa do repasse movimenta dinheiro: exige a mesma permissão da baixa no financeiro. */
  @Get('payout-accounts')
  @RequirePermission('core.finance.write')
  payoutAccounts() {
    return this.leases.payoutAccounts();
  }

  @Post('adjustments/:id/apply')
  @HttpCode(200)
  @RequirePermission('real_estate.leases.write')
  apply(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(applyAdjustmentInput)) body: ApplyAdjustmentInput) {
    return this.leases.applyAdjustment(id, body);
  }

  @Post('adjustments/:id/skip')
  @HttpCode(200)
  @RequirePermission('real_estate.leases.write')
  skip(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(skipAdjustmentInput)) body: z.infer<typeof skipAdjustmentInput>) {
    return this.leases.skipAdjustment(id, body.notes);
  }

  @Get(':id')
  @RequirePermission('real_estate.leases.read')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.leases.get(id);
  }

  @Post()
  @RequirePermission('real_estate.leases.write')
  create(@Body(new ZodPipe(leaseInput)) body: LeaseInput) {
    return this.leases.create(body);
  }

  @Patch(':id')
  @RequirePermission('real_estate.leases.write')
  update(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(leaseUpdateInput)) body: LeaseUpdateInput) {
    return this.leases.update(id, body);
  }

  @Post(':id/charges/:chargeId/payout')
  @HttpCode(200)
  @RequirePermission('core.finance.write')
  payCharge(@Param('id', ParseUUIDPipe) id: string, @Param('chargeId', ParseUUIDPipe) chargeId: string, @Body(new ZodPipe(payoutInput)) body: PayoutInput) {
    return this.leases.payout(id, 'charge', chargeId, body);
  }

  @Post(':id/extras/:extraId/payout')
  @HttpCode(200)
  @RequirePermission('core.finance.write')
  payExtra(@Param('id', ParseUUIDPipe) id: string, @Param('extraId', ParseUUIDPipe) extraId: string, @Body(new ZodPipe(payoutInput)) body: PayoutInput) {
    return this.leases.payout(id, 'extra', extraId, body);
  }

  @Post(':id/extras')
  @RequirePermission('real_estate.leases.write')
  addExtra(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(leaseExtraInput)) body: LeaseExtraInput) {
    return this.leases.addExtra(id, body);
  }

  @Post(':id/extras/:extraId/cancel')
  @HttpCode(200)
  @RequirePermission('real_estate.leases.write')
  cancelExtra(@Param('id', ParseUUIDPipe) id: string, @Param('extraId', ParseUUIDPipe) extraId: string) {
    return this.leases.cancelExtra(id, extraId);
  }

  @Post(':id/extend')
  @HttpCode(200)
  @RequirePermission('real_estate.leases.write')
  extend(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(extendLeaseInput)) body: z.infer<typeof extendLeaseInput>) {
    return this.leases.extend(id, body.months);
  }

  @Post(':id/terminate')
  @HttpCode(200)
  @RequirePermission('real_estate.leases.write')
  terminate(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(terminateLeaseInput)) body: TerminateLeaseInput) {
    return this.leases.terminate(id, body);
  }
}
