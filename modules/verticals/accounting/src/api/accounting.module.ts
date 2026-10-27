import { AuditService, centsToDecimal, coreSchema, CustomersService, FinanceService, MailService, ModuleHooks, ScheduledJobs, TenantDb, toCents, ZodPipe } from '@all/core';
import { customers } from '@all/core/schema';
import type { Tx } from '@all/db';
import { ModuleRoute, RequirePermission, requestContext } from '@all/module-sdk';
import { BadRequestException, Body, ConflictException, Controller, Get, HttpCode, Injectable, Module, NotFoundException, OnModuleInit, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  applies,
  clientInput,
  competencesFor,
  DEFAULT_OBLIGATIONS,
  obligationTypeInput,
  type AccountingClient,
  type ClientInput,
  type Obligation,
  type ObligationType,
  type ObligationTypeInput,
  type TaxRegime,
} from '../contracts';
import { accClients, accFeeInvoices, accObligations, accObligationTypes } from '../db/schema';

const MODULE = 'accounting';
const ALERT_DAYS = 3;
const localToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const brDate = (iso: string) => iso.split('-').reverse().join('/');
const badRequest = (code: string, message: string) => new BadRequestException({ code, message });

@Injectable()
export class AccountingService implements OnModuleInit {
  constructor(
    private readonly tdb: TenantDb,
    private readonly hooks: ModuleHooks,
    private readonly jobs: ScheduledJobs,
    private readonly mail: MailService,
    private readonly finance: FinanceService,
    private readonly customers: CustomersService,
    private readonly audit: AuditService,
  ) {}

  onModuleInit() {
    this.hooks.register(MODULE, { onEnable: (tx, tenantId) => this.seed(tx, tenantId) });
    // Uma vez por dia: gera obrigações e honorários do período e avisa os prazos próximos.
    this.jobs.every('accounting.daily', 24 * 60 * 60_000, () => this.dailyAll());
  }

  // ---- Carteira -------------------------------------------------------------------------------

  listClients(): Promise<AccountingClient[]> {
    return this.tdb.run(async (tx) => {
      const today = localToday();
      const rows = await tx
        .select({
          c: accClients,
          customer: { id: customers.id, name: customers.name, document: customers.document },
          responsible: { id: coreSchema.users.id, name: coreSchema.users.name },
          pending: sql<number>`(select count(*)::int from ${accObligations} o where o.client_id = ${accClients.id} and o.status = 'pending')`,
          overdue: sql<number>`(select count(*)::int from ${accObligations} o where o.client_id = ${accClients.id} and o.status = 'pending' and o.due_on < ${today}::date)`,
        })
        .from(accClients)
        .innerJoin(customers, eq(customers.id, accClients.customerId))
        .leftJoin(coreSchema.users, eq(coreSchema.users.id, accClients.responsibleUserId))
        .orderBy(asc(customers.name));
      return rows.map(({ c, customer, responsible, pending, overdue }) => ({
        id: c.id,
        customer,
        taxRegime: c.taxRegime,
        cnae: c.cnae,
        hasEmployees: c.hasEmployees,
        monthlyFee: Number(c.monthlyFee),
        feeDueDay: c.feeDueDay,
        responsible: responsible?.id ? { id: responsible.id, name: responsible.name! } : null,
        active: c.active,
        notes: c.notes,
        pendingObligations: pending,
        overdueObligations: overdue,
      }));
    });
  }

  saveClient(id: string | null, input: ClientInput) {
    const { tenantId } = requestContext.require();
    return this.tdb.run(async (tx) => {
      const customer = await this.customers.findInTx(tx, input.customerId);
      if (!customer || customer.anonymizedAt) throw badRequest('CUSTOMER_NOT_FOUND', 'Empresa não encontrada');
      if (input.responsibleUserId) await this.checkMember(tx, tenantId, input.responsibleUserId);
      const values = {
        taxRegime: input.taxRegime,
        cnae: input.cnae ?? null,
        hasEmployees: input.hasEmployees,
        monthlyFee: centsToDecimal(toCents(input.monthlyFee)),
        feeDueDay: input.feeDueDay,
        responsibleUserId: input.responsibleUserId ?? null,
        active: input.active,
        notes: input.notes ?? null,
      };
      let clientId = id;
      try {
        if (id) {
          const [row] = await tx.update(accClients).set(values).where(eq(accClients.id, id)).returning({ id: accClients.id });
          if (!row) throw new NotFoundException({ code: 'CLIENT_NOT_FOUND', message: 'Empresa não encontrada na carteira' });
        } else {
          const [row] = await tx.insert(accClients).values({ ...values, tenantId, customerId: customer.id }).returning({ id: accClients.id });
          clientId = row!.id;
        }
      } catch (err) {
        const code = (err as { cause?: { code?: string } }).cause?.code ?? (err as { code?: string }).code;
        if (code === '23505') throw new ConflictException({ code: 'CLIENT_EXISTS', message: 'Esta empresa já está na carteira' });
        throw err;
      }
      // Já gera o calendário do período atual para a empresa (nova ou com regime alterado).
      await this.generateInTx(tx, tenantId, localToday(), clientId!);
      await this.audit.log(tx, { action: id ? 'accounting.client.updated' : 'accounting.client.created', entity: 'acc_client', entityId: clientId! });
      return { id: clientId };
    });
  }

  // ---- Obrigações -----------------------------------------------------------------------------

  types(): Promise<ObligationType[]> {
    return this.tdb.run(async (tx) => (await tx.select().from(accObligationTypes).orderBy(asc(accObligationTypes.frequency), asc(accObligationTypes.code))).map(toType));
  }

  saveType(id: string | null, input: ObligationTypeInput) {
    const { tenantId } = requestContext.require();
    return this.tdb.run(async (tx) => {
      const values = { ...input, dueMonth: input.frequency === 'annual' ? (input.dueMonth ?? 12) : null };
      try {
        if (id) {
          const [row] = await tx.update(accObligationTypes).set(values).where(eq(accObligationTypes.id, id)).returning();
          if (!row) throw new NotFoundException({ code: 'TYPE_NOT_FOUND', message: 'Obrigação não encontrada' });
          return toType(row);
        }
        const [row] = await tx.insert(accObligationTypes).values({ ...values, tenantId }).returning();
        return toType(row!);
      } catch (err) {
        const code = (err as { cause?: { code?: string } }).cause?.code ?? (err as { code?: string }).code;
        if (code === '23505') throw new ConflictException({ code: 'TYPE_EXISTS', message: 'Já existe uma obrigação com este código' });
        throw err;
      }
    });
  }

  list(opts: { from?: string; to?: string; status?: string; clientId?: string }): Promise<Obligation[]> {
    return this.tdb.run(async (tx) => {
      const rows = await tx
        .select({
          o: accObligations,
          client: { id: accClients.id, regime: accClients.taxRegime },
          clientName: customers.name,
          type: { id: accObligationTypes.id, code: accObligationTypes.code, name: accObligationTypes.name },
          responsible: coreSchema.users.name,
        })
        .from(accObligations)
        .innerJoin(accClients, eq(accClients.id, accObligations.clientId))
        .innerJoin(customers, eq(customers.id, accClients.customerId))
        .innerJoin(accObligationTypes, eq(accObligationTypes.id, accObligations.typeId))
        .leftJoin(coreSchema.users, eq(coreSchema.users.id, accClients.responsibleUserId))
        .where(
          and(
            opts.from ? sql`${accObligations.dueOn} >= ${opts.from}::date` : undefined,
            opts.to ? sql`${accObligations.dueOn} <= ${opts.to}::date` : undefined,
            opts.status ? eq(accObligations.status, opts.status as 'pending') : undefined,
            opts.clientId ? eq(accObligations.clientId, opts.clientId) : undefined,
          ),
        )
        .orderBy(asc(accObligations.dueOn), asc(customers.name))
        .limit(2000);
      const doneBy = await this.userNames(tx, rows.map((r) => r.o.doneById).filter((v): v is string => !!v));
      return rows.map(({ o, client, clientName, type, responsible }) => ({
        id: o.id,
        client: { id: client.id, name: clientName, regime: client.regime as TaxRegime },
        type,
        competence: o.competence,
        dueOn: o.dueOn,
        status: o.status,
        doneAt: o.doneAt?.toISOString() ?? null,
        doneBy: o.doneById ? (doneBy.get(o.doneById) ?? null) : null,
        notes: o.notes,
        responsible,
      }));
    });
  }

  setStatus(id: string, status: 'pending' | 'done' | 'waived', notes?: string | null) {
    const { userId } = requestContext.requireTenant();
    return this.tdb.run(async (tx) => {
      const [row] = await tx
        .update(accObligations)
        .set({ status, doneAt: status === 'pending' ? null : new Date(), doneById: status === 'pending' ? null : (userId ?? null), ...(notes !== undefined ? { notes } : {}) })
        .where(eq(accObligations.id, id))
        .returning();
      if (!row) throw new NotFoundException({ code: 'OBLIGATION_NOT_FOUND', message: 'Obrigação não encontrada' });
      await this.audit.log(tx, { action: `accounting.obligation.${status}`, entity: 'acc_obligation', entityId: id });
    });
  }

  /** Roda a geração agora (o job faz isso todo dia). */
  generateNow() {
    const { tenantId } = requestContext.require();
    return this.tdb.run(async (tx) => {
      const created = await this.generateInTx(tx, tenantId, localToday());
      const fees = await this.invoiceFeesInTx(tx, tenantId, localToday());
      return { obligations: created, fees };
    });
  }

  async dailyAll() {
    for (const tenantId of await this.jobs.tenantsWithModule(MODULE)) {
      const outgoing = await requestContext.run({ tenantId }, () =>
        this.tdb.run(async (tx) => {
          const today = localToday();
          await this.generateInTx(tx, tenantId, today);
          await this.invoiceFeesInTx(tx, tenantId, today);
          return this.collectAlertsInTx(tx, tenantId, today);
        }),
      );
      for (const m of outgoing) this.mail.sendInBackground(m);
    }
  }

  // ---- internos -------------------------------------------------------------------------------

  /** Cria as obrigações que se aplicam a cada empresa ativa para as competências em aberto. Idempotente. */
  private async generateInTx(tx: Tx, tenantId: string, today: string, onlyClientId?: string): Promise<number> {
    const [clients, types] = await Promise.all([
      tx.select().from(accClients).where(and(eq(accClients.active, true), onlyClientId ? eq(accClients.id, onlyClientId) : undefined)),
      tx.select().from(accObligationTypes).where(eq(accObligationTypes.active, true)),
    ]);
    const rows = clients.flatMap((c) =>
      types
        .filter((t) => applies({ regimes: t.regimes as TaxRegime[], requiresEmployees: t.requiresEmployees }, c))
        .flatMap((t) => competencesFor(t, today).map((k) => ({ tenantId, clientId: c.id, typeId: t.id, competence: k.competence, dueOn: k.dueOn }))),
    );
    if (!rows.length) return 0;
    const inserted = await tx.insert(accObligations).values(rows).onConflictDoNothing().returning({ id: accObligations.id });
    return inserted.length;
  }

  /** Honorário do mês de cada empresa com valor > 0, uma vez por competência. */
  private async invoiceFeesInTx(tx: Tx, tenantId: string, today: string): Promise<number> {
    const competence = today.slice(0, 7);
    const clients = await tx
      .select({ c: accClients, name: customers.name })
      .from(accClients)
      .innerJoin(customers, eq(customers.id, accClients.customerId))
      .where(and(eq(accClients.active, true), sql`${accClients.monthlyFee} > 0`));
    let count = 0;
    for (const { c } of clients) {
      const [mark] = await tx.insert(accFeeInvoices).values({ tenantId, clientId: c.id, competence }).onConflictDoNothing().returning({ id: accFeeInvoices.id });
      if (!mark) continue;
      const [y, m] = competence.split('-');
      await this.finance.recordInTx(tx, {
        kind: 'income',
        status: 'pending',
        description: `Honorários contábeis ${m}/${y}`,
        amount: Number(c.monthlyFee),
        dueDate: `${competence}-${String(c.feeDueDay).padStart(2, '0')}`,
        customerId: c.customerId,
        sourceType: 'acc_fee',
        settleInFinance: true,
        sourceId: mark.id,
        categoryKey: 'services',
      });
      count++;
    }
    return count;
  }

  /** E-mail ao responsável pela empresa (ou a todos do escritório) dias antes do vencimento. Um por obrigação. */
  private async collectAlertsInTx(tx: Tx, tenantId: string, today: string) {
    const due = await tx
      .select({ o: accObligations, type: accObligationTypes.name, client: customers.name, responsibleId: accClients.responsibleUserId })
      .from(accObligations)
      .innerJoin(accClients, eq(accClients.id, accObligations.clientId))
      .innerJoin(customers, eq(customers.id, accClients.customerId))
      .innerJoin(accObligationTypes, eq(accObligationTypes.id, accObligations.typeId))
      .where(and(eq(accObligations.status, 'pending'), isNull(accObligations.alertedAt), lte(accObligations.dueOn, sql`${today}::date + ${ALERT_DAYS}::int`)));
    if (!due.length) return [];
    const team = await tx
      .select({ id: coreSchema.users.id, email: coreSchema.users.email })
      .from(coreSchema.memberships)
      .innerJoin(coreSchema.users, eq(coreSchema.users.id, coreSchema.memberships.userId))
      .where(and(eq(coreSchema.memberships.tenantId, tenantId), eq(coreSchema.memberships.status, 'active')));
    // Um e-mail por pessoa com a lista dela, em vez de um por obrigação.
    const byEmail = new Map<string, string[]>();
    for (const d of due) {
      const target = team.find((u) => u.id === d.responsibleId);
      for (const email of target ? [target.email] : team.map((u) => u.email)) {
        byEmail.set(email, [...(byEmail.get(email) ?? []), `• ${brDate(d.o.dueOn)} — ${d.type} — ${d.client} (competência ${d.o.competence})`]);
      }
    }
    await tx.update(accObligations).set({ alertedAt: new Date() }).where(inArray(accObligations.id, due.map((d) => d.o.id)));
    return [...byEmail].map(([to, lines]) => ({ to, subject: `${lines.length} obrigação(ões) vencendo nos próximos ${ALERT_DAYS} dias`, text: `Obrigações a entregar:\n\n${lines.join('\n')}\n` }));
  }

  private async userNames(tx: Tx, ids: string[]) {
    if (!ids.length) return new Map<string, string>();
    const rows = await tx.select({ id: coreSchema.users.id, name: coreSchema.users.name }).from(coreSchema.users).where(inArray(coreSchema.users.id, [...new Set(ids)]));
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  private async checkMember(tx: Tx, tenantId: string, userId: string) {
    const [m] = await tx
      .select({ id: coreSchema.memberships.id })
      .from(coreSchema.memberships)
      .where(and(eq(coreSchema.memberships.tenantId, tenantId), eq(coreSchema.memberships.userId, userId)));
    if (!m) throw badRequest('USER_NOT_MEMBER', 'Pessoa não faz parte da equipe');
  }

  private async seed(tx: Tx, tenantId: string) {
    const [any] = await tx.select({ id: accObligationTypes.id }).from(accObligationTypes).where(eq(accObligationTypes.tenantId, tenantId)).limit(1);
    if (!any) await tx.insert(accObligationTypes).values(DEFAULT_OBLIGATIONS.map((o) => ({ ...o, tenantId, dueMonth: o.dueMonth ?? null })));
  }
}

function toType(r: typeof accObligationTypes.$inferSelect): ObligationType {
  return { id: r.id, code: r.code, name: r.name, regimes: r.regimes as TaxRegime[], requiresEmployees: r.requiresEmployees, frequency: r.frequency, dueDay: r.dueDay, dueMonth: r.dueMonth, active: r.active };
}

const listQuery = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  status: z.enum(['pending', 'done', 'waived']).optional(),
  clientId: z.string().uuid().optional(),
});
const statusBody = z.object({ status: z.enum(['pending', 'done', 'waived']), notes: z.string().trim().max(500).nullish() });

@Controller('accounting')
@ModuleRoute('accounting')
export class AccountingController {
  constructor(private readonly acc: AccountingService) {}

  @Get('clients')
  @RequirePermission('accounting.read')
  clients() {
    return this.acc.listClients();
  }

  @Post('clients')
  @RequirePermission('accounting.manage')
  createClient(@Body(new ZodPipe(clientInput)) body: ClientInput) {
    return this.acc.saveClient(null, body);
  }

  @Patch('clients/:id')
  @RequirePermission('accounting.manage')
  updateClient(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(clientInput)) body: ClientInput) {
    return this.acc.saveClient(id, body);
  }

  @Get('obligation-types')
  @RequirePermission('accounting.read')
  types() {
    return this.acc.types();
  }

  @Post('obligation-types')
  @RequirePermission('accounting.manage')
  createType(@Body(new ZodPipe(obligationTypeInput)) body: ObligationTypeInput) {
    return this.acc.saveType(null, body);
  }

  @Patch('obligation-types/:id')
  @RequirePermission('accounting.manage')
  updateType(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(obligationTypeInput)) body: ObligationTypeInput) {
    return this.acc.saveType(id, body);
  }

  @Get('obligations')
  @RequirePermission('accounting.read')
  list(@Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>) {
    return this.acc.list(q);
  }

  @Post('obligations/:id/status')
  @HttpCode(204)
  @RequirePermission('accounting.work')
  status(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(statusBody)) body: z.infer<typeof statusBody>) {
    return this.acc.setStatus(id, body.status, body.notes);
  }

  @Post('generate')
  @HttpCode(200)
  @RequirePermission('accounting.manage')
  generate() {
    return this.acc.generateNow();
  }
}

@Module({ controllers: [AccountingController], providers: [AccountingService] })
export class AccountingModule {}
