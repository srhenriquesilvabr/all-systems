import { addMonths, AuditService, centsToDecimal, coreSchema, CustomerDataRegistry, CustomersService, FinanceService, MailService, ModuleHooks, ScheduledJobs, splitCents, TenantDb, toCents } from '@all/core';
import { customers } from '@all/core/schema';
import type { Tx } from '@all/db';
import { requestContext } from '@all/module-sdk';
import { schServices } from '@all/scheduling/schema';
import { BadRequestException, ConflictException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { aliasedTable, and, asc, desc, eq, ilike, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import {
  caseStatusLabel,
  type CaseInput,
  type CaseUpdate,
  type Deadline,
  type DeadlineInput,
  type Fee,
  type FeeInput,
  type LegalCase,
} from '../contracts';
import { legalCases, legalDeadlines, legalFees, legalUpdates } from '../db/schema';

const MODULE = 'legal';
const SOURCE = 'legal_fee';

const SERVICES = [
  { name: 'Consulta inicial', category: 'Atendimento', durationMin: 60, price: '300.00' },
  { name: 'Reunião com cliente', category: 'Atendimento', durationMin: 60, price: '0.00' },
  { name: 'Audiência', category: 'Processo', durationMin: 120, price: '0.00' },
  { name: 'Diligência', category: 'Processo', durationMin: 60, price: '0.00' },
];

const badRequest = (code: string, message: string) => new BadRequestException({ code, message });
const localToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const brDate = (iso: string) => iso.split('-').reverse().join('/');

type CaseRow = typeof legalCases.$inferSelect;

@Injectable()
export class LegalService implements OnModuleInit {
  constructor(
    private readonly tdb: TenantDb,
    private readonly hooks: ModuleHooks,
    private readonly jobs: ScheduledJobs,
    private readonly mail: MailService,
    private readonly finance: FinanceService,
    private readonly customers: CustomersService,
    private readonly customerData: CustomerDataRegistry,
    private readonly audit: AuditService,
  ) {}

  onModuleInit() {
    this.hooks.register(MODULE, { onEnable: (tx, tenantId) => this.seed(tx, tenantId) });
    this.jobs.every('legal.deadline-alerts', 60 * 60_000, () => this.sendDeadlineAlerts());
    this.customerData.register({
      moduleKey: MODULE,
      export: async (tx, customerId) =>
        (await tx.select().from(legalCases).where(eq(legalCases.customerId, customerId))).map((c) => ({ number: c.number, title: c.title, status: c.status, court: c.court })),
      // Processos e honorários ficam: dever de guarda do advogado (Estatuto da OAB) e obrigação fiscal.
      anonymize: async () => undefined,
    });
  }

  // ---- Processos ------------------------------------------------------------------------------

  listCases(opts: { q?: string; status?: string; customerId?: string; limit: number }): Promise<LegalCase[]> {
    return this.tdb.run(async (tx) => {
      const term = opts.q?.trim();
      const like = term ? `%${term.replace(/[%_\\]/g, (c) => `\\${c}`)}%` : undefined;
      const rows = await this.caseQuery(tx)
        .where(
          and(
            opts.status ? eq(legalCases.status, opts.status as CaseRow['status']) : undefined,
            opts.customerId ? eq(legalCases.customerId, opts.customerId) : undefined,
            like ? or(ilike(legalCases.title, like), ilike(legalCases.number, like), ilike(customers.name, like), ilike(legalCases.opposingParty, like)) : undefined,
          ),
        )
        .orderBy(desc(legalCases.updatedAt))
        .limit(opts.limit);
      return this.toCases(tx, rows);
    });
  }

  getCase(id: string): Promise<LegalCase> {
    return this.tdb.run((tx) => this.caseDetail(tx, id));
  }

  /** Para o seletor da agenda e outras telas: o processo, na transação de quem chama. */
  async findCaseInTx(tx: Tx, id: string) {
    const [row] = await tx.select().from(legalCases).where(eq(legalCases.id, id));
    return row;
  }

  createCase(input: CaseInput): Promise<LegalCase> {
    const { tenantId } = requestContext.require();
    return this.tdb.run(async (tx) => {
      const customer = await this.customers.findInTx(tx, input.customerId);
      if (!customer || customer.anonymizedAt) throw badRequest('CUSTOMER_NOT_FOUND', 'Cliente não encontrado');
      await this.checkMember(tx, input.responsibleUserId);
      const [row] = await this.guardNumber(() => tx.insert(legalCases).values({ ...caseRow(input), tenantId, customerId: customer.id }).returning());
      await this.customers.addTimeline(tx, {
        customerId: customer.id,
        moduleKey: MODULE,
        type: 'case.created',
        title: `Processo cadastrado: ${input.title}${input.number ? ` (${input.number})` : ''}`,
        entity: 'legal_case',
        entityId: row!.id,
      });
      await this.audit.log(tx, { action: 'legal.case.created', entity: 'legal_case', entityId: row!.id });
      return this.caseDetail(tx, row!.id);
    });
  }

  updateCase(id: string, input: Partial<CaseInput>): Promise<LegalCase> {
    return this.tdb.run(async (tx) => {
      const current = await this.caseOrFail(tx, id);
      await this.checkMember(tx, input.responsibleUserId);
      const { customerId: _ignored, ...rest } = input;
      const merged = { ...fromCase(current), ...rest };
      await this.guardNumber(() => tx.update(legalCases).set(caseRow(merged)).where(eq(legalCases.id, id)));
      if (input.status && input.status !== current.status) {
        await this.addUpdateRow(tx, id, localToday(), `Situação alterada para: ${caseStatusLabel[input.status]}`);
      }
      await this.audit.log(tx, { action: 'legal.case.updated', entity: 'legal_case', entityId: id, data: { fields: Object.keys(input) } });
      return this.caseDetail(tx, id);
    });
  }

  /** Pessoas da equipe (para responsável e prazos). */
  team() {
    const { tenantId } = requestContext.require();
    return this.tdb.run((tx) =>
      tx
        .select({ id: coreSchema.users.id, name: coreSchema.users.name })
        .from(coreSchema.memberships)
        .innerJoin(coreSchema.users, eq(coreSchema.users.id, coreSchema.memberships.userId))
        // A política de memberships também mostra ao usuário as dele em outras empresas.
        .where(and(eq(coreSchema.memberships.tenantId, tenantId), eq(coreSchema.memberships.status, 'active')))
        .orderBy(asc(coreSchema.users.name)),
    );
  }

  // ---- Andamentos -----------------------------------------------------------------------------

  updates(caseId: string): Promise<CaseUpdate[]> {
    return this.tdb.run(async (tx) => {
      await this.caseOrFail(tx, caseId);
      const rows = await tx
        .select({ u: legalUpdates, author: coreSchema.users.name })
        .from(legalUpdates)
        .leftJoin(coreSchema.users, eq(coreSchema.users.id, legalUpdates.authorId))
        .where(eq(legalUpdates.caseId, caseId))
        .orderBy(desc(legalUpdates.occurredOn), desc(legalUpdates.createdAt));
      return rows.map(({ u, author }) => ({ id: u.id, occurredOn: u.occurredOn, description: u.description, author, createdAt: u.createdAt.toISOString() }));
    });
  }

  addUpdate(caseId: string, input: { occurredOn: string; description: string }) {
    return this.tdb.run(async (tx) => {
      await this.caseOrFail(tx, caseId);
      const row = await this.addUpdateRow(tx, caseId, input.occurredOn, input.description);
      await tx.update(legalCases).set({ updatedAt: new Date() }).where(eq(legalCases.id, caseId));
      return { id: row.id };
    });
  }

  // ---- Prazos ---------------------------------------------------------------------------------

  deadlines(opts: { caseId?: string; until?: string; assignedUserId?: string; status?: 'open' | 'done' }): Promise<Deadline[]> {
    return this.tdb.run(async (tx) => {
      const assigned = aliasedTable(coreSchema.users, 'assigned');
      const rows = await tx
        .select({ d: legalDeadlines, c: { id: legalCases.id, number: legalCases.number, title: legalCases.title }, assigned: { id: assigned.id, name: assigned.name } })
        .from(legalDeadlines)
        .innerJoin(legalCases, eq(legalCases.id, legalDeadlines.caseId))
        .leftJoin(assigned, eq(assigned.id, legalDeadlines.assignedUserId))
        .where(
          and(
            opts.caseId ? eq(legalDeadlines.caseId, opts.caseId) : undefined,
            opts.until ? lte(legalDeadlines.dueOn, opts.until) : undefined,
            opts.assignedUserId ? eq(legalDeadlines.assignedUserId, opts.assignedUserId) : undefined,
            opts.status ? eq(legalDeadlines.status, opts.status) : undefined,
          ),
        )
        .orderBy(asc(legalDeadlines.dueOn), asc(legalDeadlines.createdAt))
        .limit(500);
      return rows.map(({ d, c, assigned: a }) => ({
        id: d.id,
        case: c,
        title: d.title,
        dueOn: d.dueOn,
        alertDays: d.alertDays,
        assigned: a?.id ? { id: a.id, name: a.name } : null,
        status: d.status,
        doneAt: d.doneAt?.toISOString() ?? null,
        notes: d.notes,
      }));
    });
  }

  addDeadline(input: DeadlineInput) {
    const { tenantId } = requestContext.require();
    return this.tdb.run(async (tx) => {
      await this.caseOrFail(tx, input.caseId);
      await this.checkMember(tx, input.assignedUserId);
      const [row] = await tx
        .insert(legalDeadlines)
        .values({ tenantId, caseId: input.caseId, title: input.title, dueOn: input.dueOn, alertDays: input.alertDays, assignedUserId: input.assignedUserId ?? null, notes: input.notes ?? null })
        .returning();
      await this.audit.log(tx, { action: 'legal.deadline.created', entity: 'legal_deadline', entityId: row!.id });
      return { id: row!.id };
    });
  }

  completeDeadline(id: string, done: boolean) {
    return this.tdb.run(async (tx) => {
      const [row] = await tx
        .update(legalDeadlines)
        .set(done ? { status: 'done', doneAt: new Date() } : { status: 'open', doneAt: null })
        .where(eq(legalDeadlines.id, id))
        .returning();
      if (!row) throw new NotFoundException({ code: 'DEADLINE_NOT_FOUND', message: 'Prazo não encontrado' });
      if (done) await this.addUpdateRow(tx, row.caseId, localToday(), `Prazo cumprido: ${row.title}`);
      await this.audit.log(tx, { action: done ? 'legal.deadline.done' : 'legal.deadline.reopened', entity: 'legal_deadline', entityId: id });
    });
  }

  /**
   * Alerta de prazo por e-mail para a equipe: quem foi designado; sem designado, o responsável
   * pelo processo; sem nenhum dos dois, todos do escritório. Um alerta por prazo.
   */
  async sendDeadlineAlerts() {
    for (const tenantId of await this.jobs.tenantsWithModule(MODULE)) {
      const outgoing = await requestContext.run({ tenantId }, () =>
        this.tdb.run(async (tx) => {
          const today = sql`(now() at time zone 'America/Sao_Paulo')::date`;
          const due = await tx
            .select({ d: legalDeadlines, c: legalCases })
            .from(legalDeadlines)
            .innerJoin(legalCases, eq(legalCases.id, legalDeadlines.caseId))
            .where(and(eq(legalDeadlines.status, 'open'), isNull(legalDeadlines.alertedAt), lte(sql`${legalDeadlines.dueOn} - ${legalDeadlines.alertDays}`, today)));
          if (!due.length) return [];
          const team = await tx
            .select({ id: coreSchema.users.id, email: coreSchema.users.email })
            .from(coreSchema.memberships)
            .innerJoin(coreSchema.users, eq(coreSchema.users.id, coreSchema.memberships.userId))
            .where(and(eq(coreSchema.memberships.tenantId, tenantId), eq(coreSchema.memberships.status, 'active')));
          const emailOf = new Map(team.map((u) => [u.id, u.email]));
          const messages: { to: string; subject: string; text: string }[] = [];
          for (const { d, c } of due) {
            const target = d.assignedUserId ?? c.responsibleUserId;
            const to = target && emailOf.has(target) ? [emailOf.get(target)!] : team.map((u) => u.email);
            const label = c.number ? `${c.title} (${c.number})` : c.title;
            for (const email of to) {
              messages.push({
                to: email,
                subject: `Prazo ${d.dueOn <= localToday() ? 'vencendo hoje' : `em ${brDate(d.dueOn)}`}: ${d.title}`,
                text: `Prazo: ${d.title}\nVencimento: ${brDate(d.dueOn)}\nProcesso: ${label}\n${d.notes ? `\n${d.notes}\n` : ''}`,
              });
            }
            await tx.update(legalDeadlines).set({ alertedAt: new Date() }).where(eq(legalDeadlines.id, d.id));
          }
          return messages;
        }),
      );
      // Depois do commit: se o e-mail falhar, o prazo continua visível na tela de prazos.
      for (const m of outgoing) this.mail.sendInBackground(m);
    }
  }

  // ---- Honorários -----------------------------------------------------------------------------

  fees(caseId: string): Promise<Fee[]> {
    return this.tdb.run(async (tx) => {
      await this.caseOrFail(tx, caseId);
      const rows = await tx.select().from(legalFees).where(eq(legalFees.caseId, caseId)).orderBy(asc(legalFees.createdAt));
      const entries = await this.finance.listBySourceInTx(tx, SOURCE, rows.map((r) => r.id));
      return rows.map((r) => {
        const mine = entries.filter((e) => e.sourceId === r.id && e.status !== 'cancelled');
        const total = mine.reduce((s, e) => s + toCents(e.amount), 0);
        const paid = mine.filter((e) => e.status === 'paid').reduce((s, e) => s + toCents(e.amount), 0);
        return {
          id: r.id,
          kind: r.kind,
          description: r.description,
          amount: r.amount === null ? null : Number(r.amount),
          installments: r.installments,
          successPercent: r.successPercent === null ? null : Number(r.successPercent),
          status: r.status,
          receivable: { total: total / 100, paid: paid / 100, open: (total - paid) / 100 },
          createdAt: r.createdAt.toISOString(),
        };
      });
    });
  }

  addFee(input: FeeInput) {
    const { tenantId } = requestContext.require();
    return this.tdb.run(async (tx) => {
      const c = await this.caseOrFail(tx, input.caseId);
      const [fee] = await tx
        .insert(legalFees)
        .values({
          tenantId,
          caseId: c.id,
          customerId: c.customerId,
          kind: input.kind,
          description: input.description ?? null,
          amount: input.amount != null ? centsToDecimal(toCents(input.amount)) : null,
          installments: input.kind === 'success' ? 1 : input.installments,
          successPercent: input.successPercent != null ? input.successPercent.toFixed(2) : null,
        })
        .returning();
      if (input.kind !== 'success') {
        const parts = input.kind === 'fixed' ? splitCents(toCents(input.amount!), input.installments) : Array.from({ length: input.installments }, () => toCents(input.amount!));
        for (const [i, cents] of parts.entries()) {
          await this.finance.recordInTx(tx, {
            kind: 'income',
            status: 'pending',
            description: `Honorários — ${c.title}${parts.length > 1 ? ` (${i + 1}/${parts.length})` : ''}`,
            amount: cents / 100,
            dueDate: addMonths(input.firstDueOn!, i),
            customerId: c.customerId,
            sourceType: SOURCE,
            sourceId: fee!.id,
            categoryKey: 'services',
          });
        }
      }
      await this.audit.log(tx, { action: 'legal.fee.created', entity: 'legal_fee', entityId: fee!.id, data: { kind: input.kind } });
      return { id: fee!.id };
    });
  }

  /** Êxito: lança o percentual sobre o valor obtido como "a receber". */
  registerSuccess(feeId: string, obtainedAmount: number, dueOn: string) {
    return this.tdb.run(async (tx) => {
      const [fee] = await tx.select().from(legalFees).where(eq(legalFees.id, feeId)).for('update');
      if (!fee) throw new NotFoundException({ code: 'FEE_NOT_FOUND', message: 'Honorário não encontrado' });
      if (fee.kind !== 'success' || fee.status !== 'active') throw badRequest('FEE_NOT_PENDING', 'Este honorário não aguarda êxito');
      const c = await this.caseOrFail(tx, fee.caseId);
      const cents = Math.round(toCents(obtainedAmount) * (Number(fee.successPercent) / 100));
      await this.finance.recordInTx(tx, {
        kind: 'income',
        status: 'pending',
        description: `Honorários de êxito (${Number(fee.successPercent).toLocaleString('pt-BR')}%) — ${c.title}`,
        amount: cents / 100,
        dueDate: dueOn,
        customerId: fee.customerId,
        sourceType: SOURCE,
        sourceId: fee.id,
        categoryKey: 'services',
      });
      await tx.update(legalFees).set({ status: 'settled', amount: centsToDecimal(cents) }).where(eq(legalFees.id, feeId));
      await this.addUpdateRow(tx, c.id, localToday(), `Êxito registrado: valor obtido R$ ${obtainedAmount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`);
      await this.audit.log(tx, { action: 'legal.fee.success', entity: 'legal_fee', entityId: feeId, data: { obtainedAmount } });
    });
  }

  cancelFee(feeId: string) {
    return this.tdb.run(async (tx) => {
      const [fee] = await tx.update(legalFees).set({ status: 'cancelled' }).where(and(eq(legalFees.id, feeId), inArray(legalFees.status, ['active', 'settled']))).returning();
      if (!fee) throw new NotFoundException({ code: 'FEE_NOT_FOUND', message: 'Honorário não encontrado ou já cancelado' });
      const cancelled = await this.finance.cancelPendingBySourceInTx(tx, SOURCE, feeId);
      await this.audit.log(tx, { action: 'legal.fee.cancelled', entity: 'legal_fee', entityId: feeId, data: { cancelledInstallments: cancelled } });
    });
  }

  // ---- internos -------------------------------------------------------------------------------

  private async addUpdateRow(tx: Tx, caseId: string, occurredOn: string, description: string) {
    const { tenantId, userId } = requestContext.requireTenant();
    const [row] = await tx.insert(legalUpdates).values({ tenantId, caseId, occurredOn, description, authorId: userId ?? null }).returning();
    return row!;
  }

  private caseQuery(tx: Tx) {
    return tx
      .select({ c: legalCases, customer: { id: customers.id, name: customers.name }, responsible: { id: coreSchema.users.id, name: coreSchema.users.name } })
      .from(legalCases)
      .innerJoin(customers, eq(customers.id, legalCases.customerId))
      .leftJoin(coreSchema.users, eq(coreSchema.users.id, legalCases.responsibleUserId))
      .$dynamic();
  }

  private async caseDetail(tx: Tx, id: string) {
    const [row] = await this.caseQuery(tx).where(eq(legalCases.id, id));
    if (!row) throw new NotFoundException({ code: 'CASE_NOT_FOUND', message: 'Processo não encontrado' });
    return (await this.toCases(tx, [row]))[0]!;
  }

  private async toCases(tx: Tx, rows: { c: CaseRow; customer: { id: string; name: string }; responsible: { id: string | null; name: string | null } | null }[]): Promise<LegalCase[]> {
    const ids = rows.map((r) => r.c.id);
    const next = ids.length
      ? await tx
          .selectDistinctOn([legalDeadlines.caseId], { caseId: legalDeadlines.caseId, id: legalDeadlines.id, title: legalDeadlines.title, dueOn: legalDeadlines.dueOn })
          .from(legalDeadlines)
          .where(and(inArray(legalDeadlines.caseId, ids), eq(legalDeadlines.status, 'open')))
          .orderBy(legalDeadlines.caseId, asc(legalDeadlines.dueOn))
      : [];
    return rows.map(({ c, customer, responsible }) => {
      const n = next.find((d) => d.caseId === c.id);
      return {
        id: c.id,
        customer,
        number: c.number,
        title: c.title,
        area: c.area,
        role: c.role,
        court: c.court,
        opposingParty: c.opposingParty,
        claimValue: c.claimValue === null ? null : Number(c.claimValue),
        responsible: responsible?.id ? { id: responsible.id, name: responsible.name! } : null,
        status: c.status,
        notes: c.notes,
        nextDeadline: n ? { id: n.id, title: n.title, dueOn: n.dueOn } : null,
        createdAt: c.createdAt.toISOString(),
      };
    });
  }

  private async caseOrFail(tx: Tx, id: string) {
    const row = await this.findCaseInTx(tx, id);
    if (!row) throw new NotFoundException({ code: 'CASE_NOT_FOUND', message: 'Processo não encontrado' });
    return row;
  }

  /** Responsável e designado têm de ser da equipe desta empresa. */
  private async checkMember(tx: Tx, userId: string | null | undefined) {
    if (!userId) return;
    const { tenantId } = requestContext.requireTenant();
    const [m] = await tx
      .select({ id: coreSchema.memberships.id })
      .from(coreSchema.memberships)
      .where(and(eq(coreSchema.memberships.tenantId, tenantId), eq(coreSchema.memberships.userId, userId)));
    if (!m) throw badRequest('USER_NOT_MEMBER', 'Pessoa não faz parte da equipe');
  }

  private async guardNumber<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      const code = (err as { cause?: { code?: string }; code?: string }).cause?.code ?? (err as { code?: string }).code;
      if (code === '23505') throw new ConflictException({ code: 'CASE_NUMBER_TAKEN', message: 'Já existe um processo com este número' });
      throw err;
    }
  }

  private async seed(tx: Tx, tenantId: string) {
    const [any] = await tx.select({ id: schServices.id }).from(schServices).where(eq(schServices.tenantId, tenantId)).limit(1);
    if (!any) await tx.insert(schServices).values(SERVICES.map((s) => ({ ...s, tenantId })));
  }
}

function caseRow(input: Omit<CaseInput, 'customerId'>) {
  return {
    number: input.number ?? null,
    title: input.title,
    area: input.area,
    role: input.role,
    court: input.court ?? null,
    opposingParty: input.opposingParty ?? null,
    claimValue: input.claimValue != null ? centsToDecimal(toCents(input.claimValue)) : null,
    responsibleUserId: input.responsibleUserId ?? null,
    status: input.status,
    notes: input.notes ?? null,
  };
}

function fromCase(c: CaseRow): Omit<CaseInput, 'customerId'> {
  return {
    number: c.number,
    title: c.title,
    area: c.area,
    role: c.role,
    court: c.court,
    opposingParty: c.opposingParty,
    claimValue: c.claimValue === null ? null : Number(c.claimValue),
    responsibleUserId: c.responsibleUserId,
    status: c.status,
    notes: c.notes,
  };
}

