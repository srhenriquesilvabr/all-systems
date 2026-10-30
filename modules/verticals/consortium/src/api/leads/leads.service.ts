import { AuditService, CoreConfig, coreSchema, CustomerDataRegistry, CustomersService, financeSchema, FinanceService, ModuleSettingsService, nextSequence, ScheduledJobs, TenantDb, toCents } from '@all/core';
import { CREDIT_BUREAU, CreditBureauService } from '@all/credit-bureau';
import type { Tx } from '@all/db';
import { requestContext } from '@all/module-sdk';
import { ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { and, asc, desc, eq, gte, ilike, inArray, isNull, lt, ne, or, sql, type SQL } from 'drizzle-orm';
import {
  estimateInstallment,
  fillWhatsappTemplate,
  leadAssetLabel,
  leadSourceLabel,
  leadStatusLabel,
  openLeadStatuses,
  rewardStatusLabel,
  type ConversionRow,
  type LeadDetail,
  type LeadInput,
  type LeadListItem,
  type LeadPatch,
  type LeadsReport,
  type LeadStatusInput,
  type LeadTask,
  type LeadTaskInput,
  type Referrer,
} from '../../contracts';
import { consLeadEvents, consLeads, consLeadTasks, consPlans, consQuotas, consReferrers } from '../../db/schema';
import type { ConsortiumSettings } from '../../manifest';
import { badRequest, brl, localToday, MODULE, REWARD_SOURCE } from '../shared';
import { assertTeamMember, LEAD_SOURCE, normalizePhone, planProfilesInTx, referralCode, type LeadRow } from './shared';

/** Dados de um lead novo, de qualquer origem (simulador, anúncio, planilha, manual, indicação). */
export interface NewLead {
  name: string;
  phone: string | null;
  email: string | null;
  city?: string | null;
  state?: string | null;
  assetType?: LeadRow['assetType'];
  creditValue?: number | null;
  termMonths?: number | null;
  source: LeadRow['source'];
  utm?: Record<string, string>;
  campaign?: string | null;
  formId?: string | null;
  adId?: string | null;
  externalId?: string | null;
  channelId?: string | null;
  referrerId?: string | null;
  contactBasis: LeadRow['contactBasis'];
  consent?: LeadRow['consent'];
  ipHash?: string | null;
  notes?: string | null;
  sellerId?: string | null;
  createdBy?: string | null;
}

const { finAccounts, finEntries } = financeSchema;
const sellerUser = coreSchema.users;
const dayStart = (date: string) => sql`(${date}::date)::timestamp at time zone 'America/Sao_Paulo'`;
const dayEnd = (date: string) => sql`((${date}::date + 1)::timestamp at time zone 'America/Sao_Paulo')`;

/**
 * Funil de leads do consórcio: entrada única para todas as origens (com distribuição opcional
 * entre vendedores), etapas, tarefas de retorno, WhatsApp com mensagem pronta, indicação premiada,
 * ligação com a cota vendida e relatório de conversão. Dados pessoais seguem a LGPD (base do
 * contato registrada, retenção configurável e anonimização).
 */
@Injectable()
export class LeadsService implements OnModuleInit {
  private readonly logger = new Logger('ConsortiumLeads');

  constructor(
    private readonly tdb: TenantDb,
    private readonly settings: ModuleSettingsService,
    private readonly audit: AuditService,
    private readonly customers: CustomersService,
    private readonly customerData: CustomerDataRegistry,
    private readonly jobs: ScheduledJobs,
    private readonly config: CoreConfig,
    private readonly credit: CreditBureauService,
    private readonly finance: FinanceService,
  ) {}

  onModuleInit() {
    this.jobs.every('consortium.leads.retention', 24 * 60 * 60_000, () => this.retentionAll());
    this.customerData.register({
      moduleKey: MODULE,
      export: async (tx, customerId) =>
        (await tx.select().from(consLeads).where(eq(consLeads.customerId, customerId))).map((l) => ({
          source: l.source,
          status: l.status,
          assetType: l.assetType,
          creditValue: l.creditValue,
          consent: l.consent,
          createdAt: l.createdAt,
        })),
      anonymize: async (tx, customerId) => {
        const rows = await tx.select({ id: consLeads.id }).from(consLeads).where(eq(consLeads.customerId, customerId));
        for (const r of rows) await this.anonymizeInTx(tx, r.id);
      },
    });
  }

  // ---- Entrada -------------------------------------------------------------------------------

  /** Grava o lead (qualquer origem) na transação de quem chama, com a distribuição automática se ligada. */
  async createInTx(tx: Tx, tenantId: string, data: NewLead): Promise<LeadRow> {
    const settings = await this.settings.getInTx<ConsortiumSettings>(tx, MODULE);
    let sellerId = data.sellerId ?? null;
    let auto = false;
    if (sellerId) await assertTeamMember(tx, tenantId, sellerId);
    else {
      sellerId = await this.roundRobinInTx(tx, tenantId, settings);
      auto = !!sellerId;
    }
    let estimatedInstallment: string | null = null;
    if (data.assetType && data.creditValue && data.termMonths) {
      const est = estimateInstallment(await planProfilesInTx(tx), data.assetType, data.creditValue, data.termMonths);
      if (est) estimatedInstallment = est.min.toFixed(2);
    }
    const now = new Date();
    const [lead] = await tx
      .insert(consLeads)
      .values({
        tenantId,
        number: await nextSequence(tx, tenantId, 'cons_lead'),
        name: data.name,
        phone: data.phone,
        email: data.email,
        city: data.city ?? null,
        state: data.state ?? null,
        assetType: data.assetType ?? null,
        creditValue: data.creditValue != null ? data.creditValue.toFixed(2) : null,
        termMonths: data.termMonths ?? null,
        estimatedInstallment,
        source: data.source,
        utm: data.utm ?? {},
        campaign: data.campaign ?? data.utm?.utm_campaign ?? null,
        formId: data.formId ?? null,
        adId: data.adId ?? null,
        externalId: data.externalId ?? null,
        channelId: data.channelId ?? null,
        referrerId: data.referrerId ?? null,
        rewardStatus: data.referrerId ? 'waiting' : 'none',
        contactBasis: data.contactBasis,
        consent: data.consent ?? null,
        ipHash: data.ipHash ?? null,
        notes: data.notes ?? null,
        sellerId,
        assignedAt: sellerId ? now : null,
        createdBy: data.createdBy ?? null,
      })
      .returning();
    await this.event(tx, lead!, 'created', `Lead recebido: ${leadSourceLabel[data.source]}${lead!.campaign ? ` (${lead!.campaign})` : ''}`, null, data.createdBy ?? null);
    if (sellerId) await this.event(tx, lead!, 'assigned', auto ? 'Distribuído automaticamente' : 'Vendedor definido no cadastro', { sellerId, auto }, data.createdBy ?? null);
    await this.audit.log(tx, { action: 'consortium.lead.created', entity: 'cons_lead', entityId: lead!.id, data: { source: data.source }, userId: data.createdBy ?? null });
    return lead!;
  }

  /** Cadastro manual ou linha de planilha (mesma rota). Lead em aberto com o mesmo telefone ou e-mail é recusado. */
  create(input: LeadInput): Promise<LeadDetail> {
    const { tenantId, userId } = requestContext.require();
    return this.tdb
      .run(async (tx) => {
        const phone = input.phone ? normalizePhone(input.phone) : null;
        if (input.phone && !phone) throw badRequest('INVALID_PHONE', 'Telefone inválido (use DDD + número)');
        await this.assertNoOpenDuplicate(tx, phone, input.email);
        if (input.referrerId) await this.referrerOrFail(tx, input.referrerId);
        const lead = await this.createInTx(tx, tenantId, {
          name: input.name,
          phone,
          email: input.email,
          city: input.city,
          state: input.state,
          assetType: input.assetType ?? null,
          creditValue: input.creditValue ?? null,
          termMonths: input.termMonths ?? null,
          source: input.referrerId ? 'referral' : input.source,
          campaign: input.campaign,
          referrerId: input.referrerId ?? null,
          contactBasis: input.contactBasis,
          notes: input.notes,
          sellerId: input.sellerId ?? null,
          createdBy: userId,
        });
        return lead.id;
      })
      .then((id) => this.get(id));
  }

  private async assertNoOpenDuplicate(tx: Tx, phone: string | null, email: string | null) {
    const match = [phone ? eq(consLeads.phone, phone) : undefined, email ? eq(consLeads.email, email) : undefined].filter(Boolean) as SQL[];
    if (!match.length) return;
    const [dup] = await tx
      .select({ number: consLeads.number })
      .from(consLeads)
      .where(and(or(...match), inArray(consLeads.status, openLeadStatuses)))
      .limit(1);
    if (dup) throw new ConflictException({ code: 'LEAD_EXISTS', message: `Já existe o lead nº ${dup.number} em aberto com este telefone ou e-mail` });
  }

  /** Próximo vendedor da lista (um de cada vez), entre os que continuam ativos na equipe. */
  private async roundRobinInTx(tx: Tx, tenantId: string, settings: ConsortiumSettings): Promise<string | null> {
    if (!settings.leadRoundRobin || !settings.leadSellerIds.length) return null;
    // Dois leads ao mesmo tempo não pegam o mesmo vendedor.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`cons_lead_rr:${tenantId}`}))`);
    const active = new Set(
      (
        await tx
          .select({ userId: coreSchema.memberships.userId })
          .from(coreSchema.memberships)
          .where(and(eq(coreSchema.memberships.tenantId, tenantId), eq(coreSchema.memberships.status, 'active'), inArray(coreSchema.memberships.userId, settings.leadSellerIds)))
      ).map((m) => m.userId),
    );
    const rotation = settings.leadSellerIds.filter((id) => active.has(id));
    if (!rotation.length) return null;
    const [last] = await tx
      .select({ sellerId: sql<string>`${consLeadEvents.data}->>'sellerId'` })
      .from(consLeadEvents)
      .where(and(eq(consLeadEvents.kind, 'assigned'), sql`${consLeadEvents.data}->>'auto' = 'true'`))
      .orderBy(desc(consLeadEvents.createdAt), desc(consLeadEvents.id))
      .limit(1);
    const i = last ? rotation.indexOf(last.sellerId) : -1;
    return rotation[(i + 1) % rotation.length]!;
  }

  // ---- Consulta ------------------------------------------------------------------------------

  /** Lista do funil. Quem não gerencia vê os próprios leads e os sem vendedor (para assumir). */
  list(opts: { status?: string; source?: string; sellerId?: string; q?: string; open?: boolean }): Promise<LeadListItem[]> {
    const { userId, permissions } = requestContext.require();
    const manage = !!permissions?.has('consortium.leads.manage');
    return this.tdb.run(async (tx) => {
      const term = opts.q?.trim();
      const digits = term?.replace(/\D/g, '');
      const rows = await this.listQuery(tx)
        .where(
          and(
            opts.status ? eq(consLeads.status, opts.status as LeadRow['status']) : undefined,
            opts.open ? inArray(consLeads.status, openLeadStatuses) : undefined,
            opts.source ? eq(consLeads.source, opts.source as LeadRow['source']) : undefined,
            opts.sellerId === 'none' ? isNull(consLeads.sellerId) : opts.sellerId ? eq(consLeads.sellerId, opts.sellerId) : undefined,
            manage ? undefined : or(eq(consLeads.sellerId, userId), isNull(consLeads.sellerId)),
            term
              ? or(ilike(consLeads.name, `%${term}%`), ilike(consLeads.email, `%${term}%`), digits && digits.length >= 4 ? ilike(consLeads.phone, `%${digits}%`) : undefined, ilike(consLeads.campaign, `%${term}%`))
              : undefined,
          ),
        )
        .orderBy(desc(consLeads.createdAt))
        .limit(500);
      return this.withExtras(tx, rows);
    });
  }

  get(id: string): Promise<LeadDetail> {
    return this.tdb.run((tx) => this.detailInTx(tx, id));
  }

  private async detailInTx(tx: Tx, id: string): Promise<LeadDetail> {
    const { tenantId, userId, permissions } = requestContext.require();
    const [row] = await this.listQuery(tx).where(eq(consLeads.id, id));
    if (!row) throw new NotFoundException({ code: 'LEAD_NOT_FOUND', message: 'Lead não encontrado' });
    if (!permissions?.has('consortium.leads.manage') && row.lead.sellerId && row.lead.sellerId !== userId) {
      throw new ForbiddenException({ code: 'LEAD_OF_OTHER_SELLER', message: 'Este lead é de outro vendedor' });
    }
    const [item] = await this.withExtras(tx, [row]);
    const l = row.lead;
    const events = await tx
      .select({ e: consLeadEvents, user: coreSchema.users.name })
      .from(consLeadEvents)
      .leftJoin(coreSchema.users, eq(coreSchema.users.id, consLeadEvents.userId))
      .where(eq(consLeadEvents.leadId, id))
      .orderBy(desc(consLeadEvents.createdAt), desc(consLeadEvents.id))
      .limit(200);
    const tasks = await this.tasksInTx(tx, { leadId: id });
    const [quota] = l.quotaId
      ? await tx
          .select({ id: consQuotas.id, number: consQuotas.number, status: consQuotas.status, planName: consPlans.name, institution: consPlans.institution })
          .from(consQuotas)
          .innerJoin(consPlans, eq(consPlans.id, consQuotas.planId))
          .where(eq(consQuotas.id, l.quotaId))
      : [];
    const settings = await this.settings.getInTx<ConsortiumSettings>(tx, MODULE);
    const [tenant] = await tx.select({ name: coreSchema.tenants.name }).from(coreSchema.tenants).where(eq(coreSchema.tenants.id, tenantId));
    const [me] = await tx.select({ name: coreSchema.users.name }).from(coreSchema.users).where(eq(coreSchema.users.id, userId));
    return {
      ...item!,
      utm: l.utm,
      formId: l.formId,
      adId: l.adId,
      contactBasis: l.contactBasis,
      consent: l.consent,
      notes: l.notes,
      quota: quota ?? null,
      events: events.map(({ e, user }) => ({ id: e.id, kind: e.kind, text: e.text, user, createdAt: e.createdAt.toISOString() })),
      tasks,
      whatsappText: this.whatsappText(l, settings.leadWhatsappMessage, { company: tenant?.name ?? '', seller: row.sellerName ?? me?.name ?? '' }),
    };
  }

  private whatsappText(l: LeadRow, template: string, o: { company: string; seller: string }) {
    const first = l.name.split(' ')[0] ?? l.name;
    const sellerFirst = o.seller.split(' ')[0] ?? o.seller;
    if (!l.assetType || !l.creditValue || !l.termMonths) {
      return `Olá, ${first}! Aqui é ${sellerFirst}, da ${o.company}. Recebemos seu contato sobre consórcio. Posso te ajudar a simular a melhor carta de crédito?`;
    }
    return fillWhatsappTemplate(template, {
      nome: first,
      vendedor: sellerFirst,
      empresa: o.company,
      tipo: leadAssetLabel[l.assetType],
      credito: brl.format(Number(l.creditValue)),
      prazo: String(l.termMonths),
      parcela: l.estimatedInstallment ? brl.format(Number(l.estimatedInstallment)) : 'a confirmar',
    });
  }

  private listQuery(tx: Tx) {
    return tx
      .select({ lead: consLeads, sellerName: sellerUser.name, referrerName: consReferrers.name })
      .from(consLeads)
      .leftJoin(sellerUser, eq(sellerUser.id, consLeads.sellerId))
      .leftJoin(consReferrers, eq(consReferrers.id, consLeads.referrerId))
      .$dynamic();
  }

  /** Próxima tarefa em aberto e a decisão de crédito, em duas consultas para a lista toda. */
  private async withExtras(tx: Tx, rows: { lead: LeadRow; sellerName: string | null; referrerName: string | null }[]): Promise<LeadListItem[]> {
    const ids = rows.map((r) => r.lead.id);
    const tasks = ids.length
      ? await tx
          .select({ id: consLeadTasks.id, leadId: consLeadTasks.leadId, title: consLeadTasks.title, dueAt: consLeadTasks.dueAt })
          .from(consLeadTasks)
          .where(and(inArray(consLeadTasks.leadId, ids), isNull(consLeadTasks.doneAt)))
          .orderBy(asc(consLeadTasks.dueAt))
      : [];
    const next = new Map<string, (typeof tasks)[number]>();
    for (const t of tasks) if (!next.has(t.leadId)) next.set(t.leadId, t);
    const credit = requestContext.get().modules?.has(CREDIT_BUREAU) ? await this.credit.decisionsForSourcesInTx(tx, LEAD_SOURCE, ids) : new Map();
    // Baixa dada direto no financeiro: a recompensa aparece paga.
    const dueIds = rows.filter((r) => r.lead.rewardStatus === 'due').map((r) => r.lead.id);
    const paidRewards = new Set((await this.finance.listBySourceInTx(tx, REWARD_SOURCE, dueIds)).filter((e) => e.kind === 'expense' && e.status === 'paid').map((e) => e.sourceId));
    return rows.map(({ lead: l, sellerName, referrerName }) => {
      const t = next.get(l.id);
      return {
        id: l.id,
        number: l.number,
        name: l.name,
        phone: l.phone,
        email: l.email,
        city: l.city,
        state: l.state,
        assetType: l.assetType,
        creditValue: l.creditValue == null ? null : Number(l.creditValue),
        termMonths: l.termMonths,
        estimatedInstallment: l.estimatedInstallment == null ? null : Number(l.estimatedInstallment),
        source: l.source,
        campaign: l.campaign,
        status: l.status,
        lostReason: l.lostReason,
        statusChangedAt: l.statusChangedAt.toISOString(),
        seller: l.sellerId ? { id: l.sellerId, name: sellerName ?? '' } : null,
        referrer: l.referrerId ? { id: l.referrerId, name: referrerName ?? '' } : null,
        rewardStatus: paidRewards.has(l.id) ? 'paid' : l.rewardStatus,
        rewardAmount: l.rewardAmount == null ? null : Number(l.rewardAmount),
        quotaId: l.quotaId,
        customerId: l.customerId,
        nextTask: t ? { id: t.id, title: t.title, dueAt: t.dueAt.toISOString() } : null,
        credit: credit.get(l.id) ?? null,
        anonymized: !!l.anonymizedAt,
        createdAt: l.createdAt.toISOString(),
      };
    });
  }

  // ---- Trabalho no lead ----------------------------------------------------------------------

  update(id: string, patch: LeadPatch): Promise<LeadDetail> {
    return this.tdb
      .run(async (tx) => {
        const lead = await this.leadForWorkInTx(tx, id);
        const phone = patch.phone === undefined ? lead.phone : patch.phone ? normalizePhone(patch.phone) : null;
        if (patch.phone && !phone) throw badRequest('INVALID_PHONE', 'Telefone inválido (use DDD + número)');
        const next = {
          name: patch.name ?? lead.name,
          phone,
          email: patch.email === undefined ? lead.email : patch.email,
          city: patch.city === undefined ? lead.city : patch.city,
          state: patch.state === undefined ? lead.state : patch.state,
          assetType: patch.assetType === undefined ? lead.assetType : (patch.assetType ?? null),
          creditValue: patch.creditValue === undefined ? lead.creditValue : patch.creditValue == null ? null : patch.creditValue.toFixed(2),
          termMonths: patch.termMonths === undefined ? lead.termMonths : (patch.termMonths ?? null),
          campaign: patch.campaign === undefined ? lead.campaign : patch.campaign,
          notes: patch.notes === undefined ? lead.notes : patch.notes,
        };
        let estimatedInstallment = lead.estimatedInstallment;
        if (next.assetType && next.creditValue && next.termMonths) {
          const est = estimateInstallment(await planProfilesInTx(tx), next.assetType, Number(next.creditValue), next.termMonths);
          estimatedInstallment = est ? est.min.toFixed(2) : null;
        }
        await tx.update(consLeads).set({ ...next, estimatedInstallment }).where(eq(consLeads.id, id));
        await this.audit.log(tx, { action: 'consortium.lead.updated', entity: 'cons_lead', entityId: id, data: { fields: Object.keys(patch) } });
      })
      .then(() => this.get(id));
  }

  /** Move no funil. "Venda" vem da cota (adesão aceita); voltar de "perdido" reabre o lead. */
  setStatus(id: string, input: LeadStatusInput): Promise<LeadDetail> {
    return this.tdb
      .run(async (tx) => {
        const lead = await this.leadForWorkInTx(tx, id);
        if (lead.status === 'won') throw badRequest('LEAD_WON', 'Lead já virou venda');
        if (lead.status === input.status) return;
        await tx
          .update(consLeads)
          .set({ status: input.status, lostReason: input.status === 'lost' ? input.lostReason : null, statusChangedAt: new Date() })
          .where(eq(consLeads.id, id));
        const text = `${leadStatusLabel[lead.status]} → ${leadStatusLabel[input.status]}${input.status === 'lost' ? `: ${input.lostReason}` : ''}`;
        await this.event(tx, lead, 'status', text, { from: lead.status, to: input.status, lostReason: input.lostReason ?? null });
        // Perdido: tarefas de retorno em aberto deixam de fazer sentido.
        if (input.status === 'lost') await tx.update(consLeadTasks).set({ doneAt: new Date(), doneBy: requestContext.require().userId }).where(and(eq(consLeadTasks.leadId, id), isNull(consLeadTasks.doneAt)));
        if (input.status === 'lost' && lead.rewardStatus === 'waiting') await tx.update(consLeads).set({ rewardStatus: 'cancelled' }).where(eq(consLeads.id, id));
      })
      .then(() => this.get(id));
  }

  /** Distribuição manual (gestão) ou "assumir" um lead sem vendedor (quem atende). */
  assign(id: string, sellerId: string | null, mode: 'manage' | 'claim'): Promise<LeadDetail> {
    const { tenantId, userId } = requestContext.require();
    return this.tdb
      .run(async (tx) => {
        const [lead] = await tx.select().from(consLeads).where(eq(consLeads.id, id)).for('update');
        if (!lead) throw new NotFoundException({ code: 'LEAD_NOT_FOUND', message: 'Lead não encontrado' });
        const target = mode === 'claim' ? userId : sellerId;
        if (mode === 'claim' && lead.sellerId && lead.sellerId !== userId) throw badRequest('LEAD_TAKEN', 'Este lead já tem vendedor');
        if (target) await assertTeamMember(tx, tenantId, target);
        if (target === lead.sellerId) return;
        await tx.update(consLeads).set({ sellerId: target, assignedAt: target ? new Date() : null }).where(eq(consLeads.id, id));
        const [user] = target ? await tx.select({ name: coreSchema.users.name }).from(coreSchema.users).where(eq(coreSchema.users.id, target)) : [];
        await this.event(tx, lead, 'assigned', target ? `${mode === 'claim' ? 'Assumido por' : 'Distribuído para'} ${user?.name ?? 'vendedor'}` : 'Sem vendedor', { sellerId: target, auto: false });
        // Tarefas em aberto acompanham o lead.
        await tx.update(consLeadTasks).set({ assignedTo: target }).where(and(eq(consLeadTasks.leadId, id), isNull(consLeadTasks.doneAt)));
        await this.audit.log(tx, { action: 'consortium.lead.assigned', entity: 'cons_lead', entityId: id, data: { from: lead.sellerId, to: target } });
      })
      .then(() => this.get(id));
  }

  addNote(id: string, text: string): Promise<LeadDetail> {
    return this.tdb
      .run(async (tx) => {
        const lead = await this.leadForWorkInTx(tx, id);
        await this.event(tx, lead, 'note', text);
      })
      .then(() => this.get(id));
  }

  /** Registra que a equipe chamou no WhatsApp (o link é aberto na tela) e tira o lead de "novo". */
  whatsapp(id: string): Promise<LeadDetail> {
    return this.tdb
      .run(async (tx) => {
        const lead = await this.leadForWorkInTx(tx, id);
        if (!lead.phone) throw badRequest('NO_PHONE', 'Lead sem telefone');
        await this.event(tx, lead, 'whatsapp', 'Mensagem pronta aberta no WhatsApp');
        if (lead.status === 'new') {
          await tx.update(consLeads).set({ status: 'contacting', statusChangedAt: new Date() }).where(eq(consLeads.id, id));
          await this.event(tx, lead, 'status', `${leadStatusLabel.new} → ${leadStatusLabel.contacting}`, { from: 'new', to: 'contacting' });
        }
      })
      .then(() => this.get(id));
  }

  /**
   * Cliente do lead, para vender a cota: o cadastro com o mesmo telefone ou e-mail, se houver um
   * só; senão um cadastro novo com os dados do lead.
   */
  async ensureCustomer(id: string): Promise<{ customerId: string; created: boolean }> {
    const lead = await this.tdb.run((tx) => this.leadForWorkInTx(tx, id));
    if (lead.customerId) return { customerId: lead.customerId, created: false };
    if (lead.anonymizedAt) throw badRequest('LEAD_ANONYMIZED', 'Lead anonimizado');
    const dups = (await this.customers.findDuplicates({ email: lead.email, phone: lead.phone })) as { id: string }[];
    const customerId = dups.length === 1 ? dups[0]!.id : (await this.customers.create({ type: 'person', name: lead.name, email: lead.email, phone: lead.phone, notes: `Cliente vindo do lead nº ${lead.number}` }, { allowDuplicates: dups.length > 1 })).id;
    await this.tdb.run(async (tx) => {
      await tx.update(consLeads).set({ customerId }).where(eq(consLeads.id, id));
      await this.event(tx, lead, 'customer', dups.length === 1 ? 'Ligado ao cliente já cadastrado' : 'Cliente cadastrado a partir do lead', { customerId });
    });
    return { customerId, created: dups.length !== 1 };
  }

  /** Exclusão dos dados pessoais a pedido do titular (LGPD). O lead fica para as estatísticas. */
  anonymize(id: string): Promise<LeadDetail> {
    return this.tdb
      .run(async (tx) => {
        const [lead] = await tx.select().from(consLeads).where(eq(consLeads.id, id));
        if (!lead) throw new NotFoundException({ code: 'LEAD_NOT_FOUND', message: 'Lead não encontrado' });
        await this.anonymizeInTx(tx, id);
        await this.audit.log(tx, { action: 'consortium.lead.anonymized', entity: 'cons_lead', entityId: id });
      })
      .then(() => this.get(id));
  }

  private async anonymizeInTx(tx: Tx, id: string) {
    await tx
      .update(consLeads)
      .set({ name: 'Anonimizado', phone: null, email: null, city: null, notes: null, ipHash: null, utm: {}, anonymizedAt: new Date() })
      .where(and(eq(consLeads.id, id), isNull(consLeads.anonymizedAt)));
    await tx.update(consLeadEvents).set({ text: null, data: null }).where(and(eq(consLeadEvents.leadId, id), eq(consLeadEvents.kind, 'note')));
  }

  /** Leads que não compraram, parados há mais que o prazo de guarda: anonimizados (job diário). */
  async retentionAll() {
    for (const tenantId of await this.jobs.tenantsWithModule(MODULE)) {
      await requestContext.run({ tenantId }, () =>
        this.tdb.run(async (tx) => {
          const { leadRetentionMonths } = await this.settings.getInTx<ConsortiumSettings>(tx, MODULE);
          const stale = await tx
            .select({ id: consLeads.id })
            .from(consLeads)
            .where(and(isNull(consLeads.anonymizedAt), isNull(consLeads.customerId), ne(consLeads.status, 'won'), lt(consLeads.updatedAt, sql`now() - make_interval(months => ${leadRetentionMonths})`)))
            .limit(500);
          for (const r of stale) await this.anonymizeInTx(tx, r.id);
          if (stale.length) {
            await this.audit.log(tx, { action: 'consortium.lead.retention', entity: 'cons_lead', entityId: 'retention', data: { count: stale.length, months: leadRetentionMonths }, userId: null });
            this.logger.log(`${stale.length} leads anonimizados por prazo de guarda (${tenantId})`);
          }
        }),
      );
    }
  }

  // ---- Tarefas de retorno --------------------------------------------------------------------

  addTask(id: string, input: LeadTaskInput): Promise<LeadDetail> {
    const { tenantId, userId } = requestContext.require();
    return this.tdb
      .run(async (tx) => {
        const lead = await this.leadForWorkInTx(tx, id);
        if (lead.status === 'won' || lead.status === 'lost') throw badRequest('LEAD_CLOSED', 'Lead encerrado: reabra antes de agendar retorno');
        const assignedTo = input.assignedTo ?? lead.sellerId ?? userId;
        await assertTeamMember(tx, tenantId, assignedTo, 'Responsável');
        await tx.insert(consLeadTasks).values({ tenantId, leadId: id, title: input.title, dueAt: new Date(input.dueAt), assignedTo, createdBy: userId });
        await this.event(tx, lead, 'task', `Retorno agendado: ${input.title}`, { dueAt: input.dueAt });
      })
      .then(() => this.get(id));
  }

  completeTask(taskId: string): Promise<LeadTask> {
    const { userId } = requestContext.require();
    return this.tdb.run(async (tx) => {
      const [task] = await tx.select().from(consLeadTasks).where(eq(consLeadTasks.id, taskId)).for('update');
      if (!task) throw new NotFoundException({ code: 'TASK_NOT_FOUND', message: 'Tarefa não encontrada' });
      const lead = await this.leadForWorkInTx(tx, task.leadId);
      if (!task.doneAt) {
        await tx.update(consLeadTasks).set({ doneAt: new Date(), doneBy: userId }).where(eq(consLeadTasks.id, taskId));
        await this.event(tx, lead, 'task_done', `Retorno feito: ${task.title}`);
      }
      return (await this.tasksInTx(tx, { id: taskId }))[0]!;
    });
  }

  /** Retornos: os meus (padrão) ou de todos (gestão), em aberto, por data. */
  tasks(opts: { all?: boolean }): Promise<LeadTask[]> {
    const { userId, permissions } = requestContext.require();
    const all = opts.all && permissions?.has('consortium.leads.manage');
    return this.tdb.run((tx) => this.tasksInTx(tx, { assignedTo: all ? undefined : userId, open: true }));
  }

  private async tasksInTx(tx: Tx, f: { id?: string; leadId?: string; assignedTo?: string; open?: boolean }): Promise<LeadTask[]> {
    const rows = await tx
      .select({ t: consLeadTasks, leadName: consLeads.name, leadNumber: consLeads.number, user: coreSchema.users.name })
      .from(consLeadTasks)
      .innerJoin(consLeads, eq(consLeads.id, consLeadTasks.leadId))
      .leftJoin(coreSchema.users, eq(coreSchema.users.id, consLeadTasks.assignedTo))
      .where(
        and(
          f.id ? eq(consLeadTasks.id, f.id) : undefined,
          f.leadId ? eq(consLeadTasks.leadId, f.leadId) : undefined,
          f.assignedTo ? eq(consLeadTasks.assignedTo, f.assignedTo) : undefined,
          f.open ? isNull(consLeadTasks.doneAt) : undefined,
        ),
      )
      .orderBy(asc(consLeadTasks.dueAt))
      .limit(300);
    return rows.map(({ t, leadName, leadNumber, user }) => ({
      id: t.id,
      leadId: t.leadId,
      leadName,
      leadNumber,
      title: t.title,
      dueAt: t.dueAt.toISOString(),
      assignedTo: t.assignedTo ? { id: t.assignedTo, name: user ?? '' } : null,
      doneAt: t.doneAt?.toISOString() ?? null,
    }));
  }

  // ---- Ligação com a cota (venda) ------------------------------------------------------------

  /** Venda da cota a partir do lead (na transação da venda): lead em "proposta", ligado à cota e ao cliente. */
  async linkQuotaInTx(tx: Tx, leadId: string, quota: { id: string; number: number; customerId: string }) {
    const [lead] = await tx.select().from(consLeads).where(eq(consLeads.id, leadId)).for('update');
    if (!lead) throw badRequest('LEAD_NOT_FOUND', 'Lead não encontrado');
    if (lead.status === 'won') throw badRequest('LEAD_WON', 'Este lead já virou venda');
    if (lead.customerId && lead.customerId !== quota.customerId) throw badRequest('LEAD_OTHER_CUSTOMER', 'O lead está ligado a outro cliente');
    await tx
      .update(consLeads)
      .set({ status: 'proposal', statusChangedAt: lead.status === 'proposal' ? lead.statusChangedAt : new Date(), lostReason: null, quotaId: quota.id, customerId: quota.customerId })
      .where(eq(consLeads.id, leadId));
    await this.event(tx, lead, 'quota', `Adesão enviada: cota nº ${quota.number}`, { quotaId: quota.id });
  }

  /** Resposta da administradora à cota de um lead: aceita vira venda (e a recompensa da indicação fica a pagar). */
  async quotaOutcomeInTx(tx: Tx, quotaId: string, outcome: 'won' | 'rejected') {
    const [lead] = await tx.select().from(consLeads).where(eq(consLeads.quotaId, quotaId)).for('update');
    if (!lead) return;
    if (outcome === 'rejected') {
      await this.event(tx, lead, 'quota', 'Adesão não aceita pela administradora: o lead continua em proposta', { quotaId }, null);
      return;
    }
    if (lead.status === 'won') return;
    const settings = await this.settings.getInTx<ConsortiumSettings>(tx, MODULE);
    const reward = lead.rewardStatus === 'waiting' ? { rewardStatus: 'due' as const, rewardAmount: settings.referralRewardAmount ? settings.referralRewardAmount.toFixed(2) : lead.rewardAmount } : {};
    await tx.update(consLeads).set({ status: 'won', statusChangedAt: new Date(), ...reward }).where(eq(consLeads.id, lead.id));
    if (reward.rewardStatus) await this.syncRewardEntryInTx(tx, lead, reward.rewardAmount);
    await tx.update(consLeadTasks).set({ doneAt: new Date() }).where(and(eq(consLeadTasks.leadId, lead.id), isNull(consLeadTasks.doneAt)));
    await this.event(tx, lead, 'status', `${leadStatusLabel[lead.status]} → ${leadStatusLabel.won}: adesão aceita`, { from: lead.status, to: 'won', quotaId }, null);
    if (reward.rewardStatus) await this.event(tx, lead, 'reward', 'Recompensa da indicação a pagar', null, null);
  }

  /**
   * Cota cancelada: o lead que tinha virado venda fica Perdido (pode ser reaberto para outra venda);
   * em Proposta, continua lá. Dentro do prazo de estorno, a recompensa volta: a pagar é cancelada no
   * financeiro e a já paga vira um valor a recuperar de quem indicou. Fora do prazo, fica como está.
   */
  async quotaCancelledInTx(tx: Tx, quota: { id: string; number: number }, opts: { reason: string; withinReversal: boolean }) {
    const [lead] = await tx.select().from(consLeads).where(eq(consLeads.quotaId, quota.id)).for('update');
    if (!lead) return null;
    if (lead.status === 'won') {
      const lostReason = `Cota nº ${quota.number} cancelada: ${opts.reason}`;
      await tx.update(consLeads).set({ status: 'lost', lostReason, statusChangedAt: new Date() }).where(eq(consLeads.id, lead.id));
      await this.event(tx, lead, 'status', `${leadStatusLabel.won} → ${leadStatusLabel.lost}: ${lostReason}`, { from: 'won', to: 'lost', quotaId: quota.id });
    } else {
      await this.event(tx, lead, 'quota', `Cota nº ${quota.number} cancelada: ${opts.reason}`, { quotaId: quota.id });
    }
    let reward: { from: LeadRow['rewardStatus']; to: LeadRow['rewardStatus']; cancelledPending: number; toRecover: number } | null = null;
    if (lead.rewardStatus === 'due' || lead.rewardStatus === 'paid') {
      if (opts.withinReversal) reward = await this.reverseRewardInTx(tx, lead, quota.number);
      else await this.event(tx, lead, 'reward', 'Cota cancelada fora do prazo de estorno: a recompensa da indicação foi mantida', { quotaId: quota.id });
    }
    return { leadId: lead.id, from: lead.status, reward };
  }

  private async reverseRewardInTx(tx: Tx, lead: LeadRow, quotaNumber: number) {
    const entries = (await this.finance.listBySourceInTx(tx, REWARD_SOURCE, lead.id)).filter((e) => e.kind === 'expense');
    const cancelledPending = entries.filter((e) => e.status === 'pending').reduce((sum, e) => sum + toCents(e.amount), 0);
    const paid = entries.filter((e) => e.status === 'paid').reduce((sum, e) => sum + toCents(e.amount), 0);
    // Paga antes de a recompensa entrar no financeiro: vale o valor anotado no lead.
    const toRecover = paid || (lead.rewardStatus === 'paid' && lead.rewardAmount ? toCents(lead.rewardAmount) : 0);
    if (cancelledPending) await this.finance.cancelPendingBySourceInTx(tx, REWARD_SOURCE, lead.id);
    if (toRecover) {
      const referrer = await this.referrerOrFail(tx, lead.referrerId!);
      await this.finance.recordInTx(tx, {
        kind: 'income',
        status: 'pending',
        description: `Estorno de recompensa de indicação — ${referrer.name}, lead nº ${lead.number} (cota nº ${quotaNumber} cancelada)`,
        amount: toRecover / 100,
        dueDate: localToday(),
        customerId: referrer.customerId,
        sourceType: REWARD_SOURCE,
        sourceId: lead.id,
        settleInFinance: true,
        categoryKey: 'other_income',
      });
    }
    const to = toRecover ? ('reversed' as const) : ('cancelled' as const);
    await tx.update(consLeads).set({ rewardStatus: to }).where(eq(consLeads.id, lead.id));
    await this.event(tx, lead, 'reward', toRecover ? `Recompensa estornada: ${brl.format(toRecover / 100)} a recuperar de quem indicou` : 'Recompensa cancelada: a cota caiu dentro do prazo de estorno', { quotaNumber });
    return { from: lead.rewardStatus, to, cancelledPending: cancelledPending / 100, toRecover: toRecover / 100 };
  }

  /**
   * Mantém a despesa "a pagar" da recompensa no financeiro: uma só por lead. Valor mudou, a anterior
   * é cancelada e outra é lançada; sem valor, nada entra (fica na tela até informarem o valor).
   */
  private async syncRewardEntryInTx(tx: Tx, lead: LeadRow, amount: string | number | null | undefined) {
    const cents = amount == null ? 0 : toCents(amount);
    const entries = (await this.finance.listBySourceInTx(tx, REWARD_SOURCE, lead.id)).filter((e) => e.kind === 'expense');
    if (entries.some((e) => e.status === 'paid')) return;
    const pending = entries.filter((e) => e.status === 'pending');
    if (pending.length === 1 && toCents(pending[0]!.amount) === cents) return;
    if (pending.length) await this.finance.cancelPendingBySourceInTx(tx, REWARD_SOURCE, lead.id);
    if (!cents) return;
    const referrer = await this.referrerOrFail(tx, lead.referrerId!);
    await this.finance.recordInTx(tx, {
      kind: 'expense',
      status: 'pending',
      description: `Recompensa de indicação — ${referrer.name}, lead nº ${lead.number}`,
      amount: cents / 100,
      dueDate: localToday(),
      customerId: referrer.customerId,
      sourceType: REWARD_SOURCE,
      sourceId: lead.id,
      settleInFinance: true,
      categoryKey: 'other_expense',
    });
  }

  /** Baixa da recompensa em aberto, feita pela ficha do lead: é a mesma despesa do financeiro, sem duplicar. */
  private async payRewardEntryInTx(tx: Tx, lead: LeadRow, amount: string | number, accountId?: string | null) {
    await this.syncRewardEntryInTx(tx, lead, amount);
    const account = accountId ?? (await this.finance.defaultAccountId(tx));
    if (!account) throw badRequest('ACCOUNT_REQUIRED', 'Cadastre uma conta no financeiro para dar baixa na recompensa');
    const [valid] = await tx.select({ id: finAccounts.id }).from(finAccounts).where(and(eq(finAccounts.id, account), eq(finAccounts.active, true)));
    if (!valid) throw badRequest('ACCOUNT_NOT_FOUND', 'Conta não encontrada ou inativa');
    await tx
      .update(finEntries)
      .set({ status: 'paid', paidAt: localToday(), accountId: account })
      .where(and(eq(finEntries.sourceType, REWARD_SOURCE), eq(finEntries.sourceId, lead.id), eq(finEntries.kind, 'expense'), eq(finEntries.status, 'pending')));
  }

  // ---- Indicação premiada --------------------------------------------------------------------

  listReferrers(): Promise<Referrer[]> {
    const { tenantId } = requestContext.require();
    return this.tdb.run(async (tx) => {
      const base = await this.publicBase(tx, tenantId);
      const paidInFinance = sql`exists (select 1 from ${finEntries} where ${finEntries.sourceType} = ${REWARD_SOURCE} and ${finEntries.sourceId} = ${consLeads.id}::text and ${finEntries.kind} = 'expense' and ${finEntries.status} = 'paid')`;
      const rows = await tx
        .select({
          r: consReferrers,
          leads: sql<number>`count(${consLeads.id})`.mapWith(Number),
          won: sql<number>`count(${consLeads.id}) filter (where ${consLeads.status} = 'won')`.mapWith(Number),
          due: sql<number>`count(${consLeads.id}) filter (where ${consLeads.rewardStatus} = 'due' and not ${paidInFinance})`.mapWith(Number),
          paid: sql<number>`count(${consLeads.id}) filter (where ${consLeads.rewardStatus} = 'paid' or (${consLeads.rewardStatus} = 'due' and ${paidInFinance}))`.mapWith(Number),
        })
        .from(consReferrers)
        .leftJoin(consLeads, eq(consLeads.referrerId, consReferrers.id))
        .groupBy(consReferrers.id)
        .orderBy(asc(consReferrers.name));
      return rows.map(({ r, leads, won, due, paid }) => ({
        id: r.id,
        code: r.code,
        kind: r.kind,
        name: r.name,
        customerId: r.customerId,
        userId: r.userId,
        active: r.active,
        url: `${base}?ind=${r.code}`,
        leads,
        won,
        rewardsDue: due,
        rewardsPaid: paid,
      }));
    });
  }

  /** Link de indicação de um cliente ou vendedor (um por pessoa: pedir de novo devolve o mesmo). */
  createReferrer(input: { kind: 'customer' | 'seller'; customerId?: string | null; userId?: string | null }): Promise<Referrer> {
    const { tenantId } = requestContext.require();
    return this.tdb
      .run(async (tx) => {
        let name: string;
        if (input.kind === 'customer') {
          const c = await this.customers.findInTx(tx, input.customerId!);
          if (!c || c.anonymizedAt) throw badRequest('CUSTOMER_NOT_FOUND', 'Cliente não encontrado');
          name = c.name;
          const [existing] = await tx.select({ id: consReferrers.id }).from(consReferrers).where(eq(consReferrers.customerId, c.id));
          if (existing) return existing.id;
        } else {
          await assertTeamMember(tx, tenantId, input.userId!);
          const [u] = await tx.select({ name: coreSchema.users.name }).from(coreSchema.users).where(eq(coreSchema.users.id, input.userId!));
          name = u?.name ?? 'Vendedor';
          const [existing] = await tx.select({ id: consReferrers.id }).from(consReferrers).where(eq(consReferrers.userId, input.userId!));
          if (existing) return existing.id;
        }
        const [row] = await tx
          .insert(consReferrers)
          .values({ tenantId, code: referralCode(), kind: input.kind, customerId: input.kind === 'customer' ? input.customerId! : null, userId: input.kind === 'seller' ? input.userId! : null, name })
          .returning();
        await this.audit.log(tx, { action: 'consortium.referrer.created', entity: 'cons_referrer', entityId: row!.id, data: { kind: input.kind } });
        return row!.id;
      })
      .then(async (id) => (await this.listReferrers()).find((r) => r.id === id)!);
  }

  setReferrerActive(id: string, active: boolean): Promise<Referrer> {
    return this.tdb
      .run(async (tx) => {
        const [row] = await tx.update(consReferrers).set({ active }).where(eq(consReferrers.id, id)).returning();
        if (!row) throw new NotFoundException({ code: 'REFERRER_NOT_FOUND', message: 'Indicação não encontrada' });
        await this.audit.log(tx, { action: 'consortium.referrer.updated', entity: 'cons_referrer', entityId: id, data: { active } });
      })
      .then(async () => (await this.listReferrers()).find((r) => r.id === id)!);
  }

  /**
   * Recompensa da indicação: a pagar (valor), paga ou cancelada. O financeiro acompanha: despesa a
   * pagar, baixa ou cancelamento da mesma despesa. O que já foi pago só sai pelo estorno da cota.
   */
  setReward(id: string, input: { status: 'due' | 'paid' | 'cancelled'; amount?: number | null; accountId?: string | null }): Promise<LeadDetail> {
    return this.tdb
      .run(async (tx) => {
        const [lead] = await tx.select().from(consLeads).where(eq(consLeads.id, id)).for('update');
        if (!lead) throw new NotFoundException({ code: 'LEAD_NOT_FOUND', message: 'Lead não encontrado' });
        if (!lead.referrerId) throw badRequest('NOT_REFERRED', 'Este lead não veio de indicação');
        if (lead.rewardStatus === 'reversed') throw badRequest('REWARD_REVERSED', 'Esta recompensa foi estornada');
        const entries = (await this.finance.listBySourceInTx(tx, REWARD_SOURCE, id)).filter((e) => e.kind === 'expense');
        const alreadyPaid = lead.rewardStatus === 'paid' || entries.some((e) => e.status === 'paid');
        if (alreadyPaid && input.status !== 'paid') throw badRequest('REWARD_ALREADY_PAID', 'Esta recompensa já foi paga: não pode voltar nem ser cancelada por aqui');
        if (input.status === 'paid' && lead.status !== 'won' && lead.rewardStatus !== 'due') throw badRequest('REWARD_NOT_DUE', 'A recompensa só é paga depois da venda');
        const amount = input.amount ?? lead.rewardAmount;
        if (input.status === 'paid' && !alreadyPaid) {
          if (!amount || !toCents(amount)) throw badRequest('REWARD_AMOUNT_REQUIRED', 'Informe o valor da recompensa');
          await this.payRewardEntryInTx(tx, lead, amount, input.accountId);
        }
        if (input.status === 'due') await this.syncRewardEntryInTx(tx, lead, amount);
        if (input.status === 'cancelled') await this.finance.cancelPendingBySourceInTx(tx, REWARD_SOURCE, id);
        await tx
          .update(consLeads)
          .set({
            rewardStatus: input.status,
            rewardAmount: amount == null ? null : Number(amount).toFixed(2),
            rewardPaidAt: input.status === 'paid' ? (lead.rewardPaidAt ?? new Date()) : null,
          })
          .where(eq(consLeads.id, id));
        await this.event(tx, lead, 'reward', `Recompensa da indicação: ${rewardStatusLabel[input.status]}${input.amount != null ? ` (${brl.format(input.amount)})` : ''}`);
        await this.audit.log(tx, { action: 'consortium.referral.reward', entity: 'cons_lead', entityId: id, data: { from: lead.rewardStatus, to: input.status, amount: input.amount ?? null } });
      })
      .then(() => this.get(id));
  }

  /** Endereço do simulador público da empresa (base do link de indicação). */
  async publicBase(tx: Tx, tenantId: string) {
    const [t] = await tx.select({ slug: coreSchema.tenants.slug }).from(coreSchema.tenants).where(eq(coreSchema.tenants.id, tenantId));
    return `${this.config.adminUrl.replace(/\/$/, '')}/consorcio/${t?.slug ?? ''}`;
  }

  // ---- Relatório -----------------------------------------------------------------------------

  /** Conversão por origem, por vendedor e por campanha dos leads criados no período. */
  report(opts: { from?: string; to?: string }): Promise<LeadsReport> {
    const today = localToday();
    const from = opts.from ?? `${today.slice(0, 7)}-01`;
    const to = opts.to ?? today;
    return this.tdb.run(async (tx) => {
      const period = and(gte(consLeads.createdAt, dayStart(from)), lt(consLeads.createdAt, dayEnd(to)));
      const metrics = {
        total: sql<number>`count(*)`.mapWith(Number),
        contacted: sql<number>`count(*) filter (where ${consLeads.status} <> 'new')`.mapWith(Number),
        proposals: sql<number>`count(*) filter (where ${consLeads.status} in ('proposal', 'won') or ${consLeads.quotaId} is not null)`.mapWith(Number),
        won: sql<number>`count(*) filter (where ${consLeads.status} = 'won')`.mapWith(Number),
        lost: sql<number>`count(*) filter (where ${consLeads.status} = 'lost')`.mapWith(Number),
        wonCredit: sql<number>`coalesce(sum(${consPlans.creditValue}) filter (where ${consLeads.status} = 'won'), 0)`.mapWith(Number),
      };
      // Sem `group` = uma linha só (o total); o Postgres não aceita constante no GROUP BY.
      const grouped = async (key: SQL, label: SQL, group = true) => {
        const q = tx
          .select({ key: sql<string>`${key}`, label: sql<string>`${label}`, ...metrics })
          .from(consLeads)
          .leftJoin(consQuotas, eq(consQuotas.id, consLeads.quotaId))
          .leftJoin(consPlans, eq(consPlans.id, consQuotas.planId))
          .leftJoin(sellerUser, eq(sellerUser.id, consLeads.sellerId))
          .where(period)
          .$dynamic();
        return group ? q.groupBy(key, label) : q;
      };
      const rate = (r: Omit<ConversionRow, 'conversion'>): ConversionRow => ({ ...r, key: r.key ?? 'none', label: r.label ?? '', conversion: r.total ? Math.round((r.won / r.total) * 1000) / 10 : 0 });
      const bySource = (await grouped(sql`${consLeads.source}`, sql`${consLeads.source}`)).map((r) => rate({ ...r, label: leadSourceLabel[r.key as LeadRow['source']] ?? r.key }));
      const bySeller = (await grouped(sql`coalesce(${consLeads.sellerId}::text, 'none')`, sql`coalesce(${sellerUser.name}, 'Sem vendedor')`)).map(rate);
      const byCampaign = (await grouped(sql`coalesce(${consLeads.campaign}, '')`, sql`coalesce(${consLeads.campaign}, '(sem campanha)')`)).map((r) => rate({ ...r, key: r.key || 'none' }));
      const [totals] = await grouped(sql`'all'`, sql`'Total'`, false);
      const lostReasons = await tx
        .select({ reason: sql<string>`coalesce(${consLeads.lostReason}, 'Sem motivo')`, count: sql<number>`count(*)`.mapWith(Number) })
        .from(consLeads)
        .where(and(period, eq(consLeads.status, 'lost')))
        .groupBy(sql`coalesce(${consLeads.lostReason}, 'Sem motivo')`)
        .orderBy(desc(sql`count(*)`));
      const sort = (rows: ConversionRow[]) => rows.sort((a, b) => b.won - a.won || b.total - a.total || a.label.localeCompare(b.label));
      return {
        from,
        to,
        totals: rate(totals ?? { key: 'all', label: 'Total', total: 0, contacted: 0, proposals: 0, won: 0, lost: 0, wonCredit: 0 }),
        bySource: sort(bySource),
        bySeller: sort(bySeller),
        byCampaign: sort(byCampaign),
        lostReasons,
      };
    });
  }

  // ---- internos ------------------------------------------------------------------------------

  /** Lead para trabalhar: quem não gerencia só mexe nos próprios (ou nos sem vendedor). */
  private async leadForWorkInTx(tx: Tx, id: string): Promise<LeadRow> {
    const { userId, permissions } = requestContext.require();
    const [lead] = await tx.select().from(consLeads).where(eq(consLeads.id, id)).for('update');
    if (!lead) throw new NotFoundException({ code: 'LEAD_NOT_FOUND', message: 'Lead não encontrado' });
    if (!permissions?.has('consortium.leads.manage') && lead.sellerId && lead.sellerId !== userId) {
      throw new ForbiddenException({ code: 'LEAD_OF_OTHER_SELLER', message: 'Este lead é de outro vendedor' });
    }
    if (lead.anonymizedAt) throw badRequest('LEAD_ANONYMIZED', 'Lead anonimizado');
    return lead;
  }

  private async referrerOrFail(tx: Tx, id: string) {
    const [r] = await tx.select().from(consReferrers).where(eq(consReferrers.id, id));
    if (!r) throw badRequest('REFERRER_NOT_FOUND', 'Indicação não encontrada');
    return r;
  }

  private async event(tx: Tx, lead: LeadRow, kind: string, text: string | null, data: Record<string, unknown> | null = null, userId?: string | null) {
    await tx.insert(consLeadEvents).values({ tenantId: lead.tenantId, leadId: lead.id, kind, text, data, userId: userId === undefined ? (requestContext.get().userId ?? null) : userId });
  }
}
