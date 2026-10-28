import { AuditService, CoreConfig, CustomerDataRegistry, ModuleHooks, OutboxService, ScheduledJobs, SecretBox, TenantDb } from '@all/core';
import type { Tx } from '@all/db';
import { requestContext } from '@all/module-sdk';
import { BadGatewayException, BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import {
  PROPOSAL_UPDATED,
  pendingStatuses,
  type BankConnection,
  type ConnectionInput,
  type ConsortiumPlanOffer,
  type ManualStatusInput,
  type Offer,
  type Proposal,
  type ProposalInput,
  type ProposalStatus,
  type ProposalUpdated,
  type SimulationInput,
} from '../contracts';
import { bankConnections, bankProposalEvents, bankProposals, bankWebhookRoutes } from '../db/schema';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { VendorAdapters } from './adapters';
import { BankApiError, ManualProvider, normalizeStatus, RestProvider, SimulatedProvider, type BankProvider, type ResolvedConnection, type SubmitPayload } from './providers';

const MODULE = 'integration.banking';
type ConnectionRow = typeof bankConnections.$inferSelect;
type ProposalRow = typeof bankProposals.$inferSelect;

/** Instituições simuladas criadas ao contratar o módulo (a empresa troca pelas reais quando tiver contrato). */
const SEED = [
  { name: 'Banco Parceiro A (simulação)', products: ['vehicle_financing', 'real_estate_financing'], vehicleMonthlyRate: '1.89', realEstateYearlyRate: '10.99', tacFee: '600' },
  { name: 'Financeira Parceira B (simulação)', products: ['vehicle_financing'], vehicleMonthlyRate: '2.19', realEstateYearlyRate: '12.5', tacFee: '0' },
  { name: 'Banco Parceiro C (simulação)', products: ['real_estate_financing'], vehicleMonthlyRate: '2.4', realEstateYearlyRate: '11.49', tacFee: '0' },
  { name: 'Administradora de Consórcio D (simulação)', products: ['consortium'], vehicleMonthlyRate: '0', realEstateYearlyRate: '0', tacFee: '0' },
];

@Injectable()
export class BankingService implements OnModuleInit {
  private readonly logger = new Logger('Banking');

  constructor(
    private readonly tdb: TenantDb,
    private readonly secrets: SecretBox,
    private readonly hooks: ModuleHooks,
    private readonly jobs: ScheduledJobs,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
    private readonly customerData: CustomerDataRegistry,
    private readonly config: CoreConfig,
    private readonly simulated: SimulatedProvider,
    private readonly rest: RestProvider,
    private readonly manual: ManualProvider,
    private readonly vendors: VendorAdapters,
  ) {}

  onModuleInit() {
    this.hooks.register(MODULE, { onEnable: (tx, tenantId) => this.seed(tx, tenantId) });
    this.jobs.every('banking.poll', 10 * 60_000, () => this.pollAll());
    this.customerData.register({
      moduleKey: MODULE,
      export: async (tx, customerId) =>
        (await tx.select().from(bankProposals).where(eq(bankProposals.customerId, customerId))).map((p) => ({ product: p.product, amount: Number(p.amount), status: p.status, applicant: p.applicant, createdAt: p.createdAt })),
      // A proposta fica (registro da operação), mas os dados pessoais enviados saem.
      anonymize: async (tx, customerId) => {
        await tx.update(bankProposals).set({ applicant: { anonymized: true } }).where(eq(bankProposals.customerId, customerId));
      },
    });
  }

  // ---- Conexões -------------------------------------------------------------------------------

  listConnections(): Promise<BankConnection[]> {
    return this.tdb.run(async (tx) => (await tx.select().from(bankConnections).orderBy(asc(bankConnections.createdAt))).map((c) => this.toConnection(c)));
  }

  saveConnection(id: string | null, input: ConnectionInput): Promise<BankConnection> {
    const { tenantId } = requestContext.require();
    return this.tdb.run(async (tx) => {
      const values = {
        name: input.name,
        catalogKey: input.catalogKey,
        mode: input.mode,
        adapter: input.adapter,
        manualPlans: input.mode === 'manual' ? input.manualPlans : [],
        products: input.products,
        baseUrl: input.baseUrl,
        clientId: input.clientId ?? null,
        vehicleMonthlyRate: input.vehicleMonthlyRate.toFixed(4),
        realEstateYearlyRate: input.realEstateYearlyRate.toFixed(4),
        tacFee: input.tacFee.toFixed(2),
        active: input.active,
        // Segredo em branco = mantém o que já estava.
        ...(input.clientSecret ? { clientSecretEnc: this.secrets.encrypt(input.clientSecret) } : {}),
        ...(input.webhookSecret ? { webhookSecretEnc: this.secrets.encrypt(input.webhookSecret) } : {}),
      };
      let row: ConnectionRow | undefined;
      if (id) {
        [row] = await tx.update(bankConnections).set(values).where(eq(bankConnections.id, id)).returning();
        if (!row) throw new NotFoundException({ code: 'CONNECTION_NOT_FOUND', message: 'Instituição não encontrada' });
      } else {
        [row] = await tx.insert(bankConnections).values({ ...values, tenantId }).returning();
        await tx.insert(bankWebhookRoutes).values({ connectionId: row!.id, tenantId });
      }
      await this.audit.log(tx, { action: id ? 'banking.connection.updated' : 'banking.connection.created', entity: 'bank_connection', entityId: row!.id, data: { name: input.name, mode: input.mode, catalogKey: input.catalogKey, adapter: input.adapter } });
      return this.toConnection(row!);
    });
  }

  // ---- Simulação e propostas ------------------------------------------------------------------

  /** Simula em todas as instituições ativas que oferecem o produto; as que falharem ficam de fora. */
  simulate(input: SimulationInput): Promise<{ offers: Offer[]; failures: { institution: string; message: string }[] }> {
    return this.tdb.run(async (tx) => {
      const connections = (await this.activeConnections(tx)).filter((c) => c.products.includes(input.product));
      const results = await Promise.allSettled(connections.map((c) => this.provider(c).simulate(c, input)));
      const offers: Offer[] = [];
      const failures: { institution: string; message: string }[] = [];
      results.forEach((r, i) => (r.status === 'fulfilled' ? offers.push(r.value) : failures.push({ institution: connections[i]!.name, message: (r.reason as Error).message })));
      offers.sort((a, b) => a.firstInstallment - b.firstInstallment);
      return { offers, failures };
    });
  }

  consortiumPlans(): Promise<(ConsortiumPlanOffer & { connectionId: string; institution: string })[]> {
    return this.tdb.run(async (tx) => {
      const connections = (await this.activeConnections(tx)).filter((c) => c.products.includes('consortium'));
      // Uma administradora que falha derruba a sincronização inteira (502 com a mensagem dela): pular
      // calado deixaria os planos dela como "fora de oferta".
      const lists = await Promise.all(connections.map(async (c) => (await this.guard(() => this.provider(c).consortiumPlans(c))).map((p) => ({ ...p, connectionId: c.id, institution: c.name }))));
      return lists.flat();
    });
  }

  /** Envia a proposta: a simulação é refeita na instituição escolhida e vai junto. */
  submit(input: ProposalInput): Promise<Proposal> {
    const { tenantId } = requestContext.require();
    return this.tdb.run(async (tx) => {
      const c = await this.connectionOrFail(tx, input.connectionId);
      if (!c.products.includes(input.product)) throw new BadRequestException({ code: 'PRODUCT_NOT_OFFERED', message: `${c.name} não oferece este produto` });
      const open = await tx
        .select({ id: bankProposals.id })
        .from(bankProposals)
        .where(and(eq(bankProposals.sourceType, input.sourceType), eq(bankProposals.sourceId, input.sourceId), eq(bankProposals.connectionId, c.id), inArray(bankProposals.status, [...pendingStatuses, 'approved'])));
      if (open.length) throw new BadRequestException({ code: 'PROPOSAL_OPEN', message: `Já existe proposta em andamento em ${c.name}` });

      const provider = this.provider(c);
      const offer = input.product === 'consortium' ? null : await this.guard(() => provider.simulate(c, { product: input.product as 'vehicle_financing', amount: input.amount, termMonths: input.termMonths, system: input.system }));
      const [row] = await tx
        .insert(bankProposals)
        .values({
          tenantId,
          connectionId: c.id,
          product: input.product,
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          customerId: input.customerId,
          amount: input.amount.toFixed(2),
          termMonths: input.termMonths,
          offer,
          applicant: input.applicant,
          details: input.details,
          status: 'submitted',
        })
        .returning();
      const sent = await this.guard(() => provider.submit(c, this.payload(row!)));
      await tx.update(bankProposals).set({ externalId: sent.externalId }).where(eq(bankProposals.id, row!.id));
      await this.applyStatus(tx, { ...row!, externalId: sent.externalId }, sent, 'submit');
      await this.audit.log(tx, { action: 'banking.proposal.submitted', entity: 'bank_proposal', entityId: row!.id, data: { institution: c.name, product: input.product } });
      return this.detailInTx(tx, row!.id);
    });
  }

  /** Para as verticais: propostas de uma origem (com a instituição), na transação de quem chama. */
  async proposalsForInTx(tx: Tx, sourceType: string, sourceId: string) {
    return tx
      .select({ id: bankProposals.id, status: bankProposals.status, institution: bankConnections.name, result: bankProposals.result, amount: bankProposals.amount })
      .from(bankProposals)
      .innerJoin(bankConnections, eq(bankConnections.id, bankProposals.connectionId))
      .where(and(eq(bankProposals.sourceType, sourceType), eq(bankProposals.sourceId, sourceId)))
      .orderBy(desc(bankProposals.createdAt));
  }

  list(opts: { sourceType?: string; sourceId?: string; customerId?: string }): Promise<Proposal[]> {
    return this.tdb.run(async (tx) => {
      const rows = await tx
        .select({ id: bankProposals.id })
        .from(bankProposals)
        .where(
          and(
            opts.sourceType ? eq(bankProposals.sourceType, opts.sourceType) : undefined,
            opts.sourceId ? eq(bankProposals.sourceId, opts.sourceId) : undefined,
            opts.customerId ? eq(bankProposals.customerId, opts.customerId) : undefined,
          ),
        )
        .orderBy(desc(bankProposals.createdAt))
        .limit(100);
      return Promise.all(rows.map((r) => this.detailInTx(tx, r.id)));
    });
  }

  /** Consulta o status agora (botão "Atualizar" e job periódico). */
  refresh(id: string): Promise<Proposal> {
    return this.tdb.run(async (tx) => {
      const p = await this.proposalOrFail(tx, id);
      await this.poll(tx, p);
      return this.detailInTx(tx, id);
    });
  }

  /** Marcar como contratada (assinatura do contrato) ou cancelar, pela equipe. */
  setStatus(id: string, status: 'contracted' | 'cancelled', message?: string | null): Promise<Proposal> {
    return this.tdb.run(async (tx) => {
      const p = await this.proposalOrFail(tx, id);
      const allowed: Record<string, ProposalStatus[]> = { contracted: ['approved'], cancelled: ['submitted', 'under_review', 'approved'] };
      if (!allowed[status]!.includes(p.status)) throw new BadRequestException({ code: 'INVALID_STATUS', message: 'Esta proposta não pode mudar para este status' });
      await this.applyStatus(tx, p, { status, message: message ?? null }, 'manual');
      return this.detailInTx(tx, id);
    });
  }

  /**
   * Resposta de uma instituição sem API (modo manual), registrada pela equipe: em análise, aprovada
   * (consórcio: com grupo e cota), recusada, cancelada ou contratada. Publica o mesmo evento que o
   * webhook e a consulta, então a vertical acompanha igual.
   */
  registerManual(id: string, input: ManualStatusInput): Promise<Proposal> {
    return this.tdb.run(async (tx) => {
      const p = await this.proposalOrFail(tx, id);
      const c = await this.connectionOrFail(tx, p.connectionId, false);
      if (c.mode !== 'manual') throw new BadRequestException({ code: 'NOT_MANUAL', message: 'Esta instituição responde pela API; use "Consultar status"' });
      const allowed: Record<ManualStatusInput['status'], ProposalStatus[]> = {
        under_review: ['submitted'],
        approved: ['submitted', 'under_review'],
        rejected: ['submitted', 'under_review'],
        cancelled: ['submitted', 'under_review', 'approved'],
        contracted: ['approved'],
      };
      if (!allowed[input.status].includes(p.status)) throw new BadRequestException({ code: 'INVALID_STATUS', message: 'Esta proposta não pode mudar para este status' });
      if (input.status === 'approved' && p.product === 'consortium' && (!input.groupCode || !input.quotaNumber)) {
        throw new BadRequestException({ code: 'GROUP_REQUIRED', message: 'Informe o grupo e a cota que a administradora atribuiu' });
      }
      const result: Record<string, unknown> = {};
      if (input.groupCode) result.groupCode = input.groupCode;
      if (input.quotaNumber) result.quotaNumber = input.quotaNumber;
      if (input.approvedAmount) result.approvedAmount = input.approvedAmount;
      if (input.externalId && input.externalId !== p.externalId) await tx.update(bankProposals).set({ externalId: input.externalId }).where(eq(bankProposals.id, id));
      await this.applyStatus(tx, { ...p, externalId: input.externalId || p.externalId }, { status: input.status, message: input.message ?? null, result }, 'manual', { registeredBy: requestContext.get().userId ?? null, ...input });
      await this.audit.log(tx, { action: 'banking.proposal.manual_status', entity: 'bank_proposal', entityId: id, data: { status: input.status, institution: c.name } });
      return this.detailInTx(tx, id);
    });
  }

  /** Webhook da instituição: valida a assinatura com o segredo da conexão e aplica o status. */
  async webhook(connectionId: string, raw: Buffer, signature: string | undefined, body: { proposalId?: string; status?: string; message?: string; result?: Record<string, unknown> }) {
    const [route] = await this.tdb.db.select().from(bankWebhookRoutes).where(eq(bankWebhookRoutes.connectionId, connectionId));
    if (!route) return { ok: false as const, reason: 'unknown' };
    return requestContext.run({ tenantId: route.tenantId }, () =>
      this.tdb.run(async (tx) => {
        const [c] = await tx.select().from(bankConnections).where(eq(bankConnections.id, connectionId));
        const secret = c?.webhookSecretEnc ? this.secrets.decrypt(c.webhookSecretEnc) : '';
        if (!secret || !validSignature(raw, signature, secret)) return { ok: false as const, reason: 'signature' };
        const [p] = await tx
          .select()
          .from(bankProposals)
          .where(and(eq(bankProposals.connectionId, connectionId), eq(bankProposals.externalId, String(body.proposalId ?? ''))));
        if (!p) return { ok: true as const, applied: false };
        await this.applyStatus(tx, p, { status: normalizeStatus(body.status), message: body.message ?? null, result: body.result }, 'webhook', body);
        return { ok: true as const, applied: true };
      }),
    );
  }

  async pollAll() {
    for (const tenantId of await this.jobs.tenantsWithModule(MODULE)) {
      await requestContext.run({ tenantId }, () =>
        this.tdb.run(async (tx) => {
          const pending = await tx.select().from(bankProposals).where(inArray(bankProposals.status, pendingStatuses)).limit(200);
          for (const p of pending) {
            await this.poll(tx, p).catch((err) => this.logger.warn(`Consulta da proposta ${p.id} falhou: ${(err as Error).message}`));
          }
        }),
      );
    }
  }

  // ---- internos -------------------------------------------------------------------------------

  private async poll(tx: Tx, p: ProposalRow) {
    if (!pendingStatuses.includes(p.status) || !p.externalId) return;
    const c = await this.connectionOrFail(tx, p.connectionId, false);
    // Sem API não há o que consultar: a resposta chega pelo registro da equipe.
    if (c.mode === 'manual') return;
    const result = await this.guard(() => this.provider(c).status(c, p.externalId!, this.payload(p)));
    await tx.update(bankProposals).set({ lastCheckedAt: new Date() }).where(eq(bankProposals.id, p.id));
    await this.applyStatus(tx, p, result, 'poll');
  }

  /** Registra o evento e, se o status mudou, publica para a vertical reagir. */
  private async applyStatus(
    tx: Tx,
    p: ProposalRow,
    next: { status: ProposalStatus; message?: string | null; result?: Record<string, unknown> },
    source: 'submit' | 'poll' | 'webhook' | 'manual',
    payload?: unknown,
  ) {
    const changed = next.status !== p.status || source === 'submit';
    const result = { ...p.result, ...(next.result ?? {}) };
    await tx.update(bankProposals).set({ status: next.status, statusMessage: next.message ?? p.statusMessage, result }).where(eq(bankProposals.id, p.id));
    if (!changed) return;
    await tx.insert(bankProposalEvents).values({ tenantId: p.tenantId, proposalId: p.id, status: next.status, message: next.message ?? null, source, payload: payload ?? null });
    const event: ProposalUpdated = { proposalId: p.id, status: next.status, sourceType: p.sourceType, sourceId: p.sourceId, customerId: p.customerId, product: p.product, result };
    await this.outbox.publish(tx, PROPOSAL_UPDATED, { ...event });
  }

  private payload(p: ProposalRow): SubmitPayload {
    return {
      reference: p.id,
      product: p.product,
      amount: Number(p.amount),
      termMonths: p.termMonths,
      applicant: p.applicant as SubmitPayload['applicant'],
      details: p.details as Record<string, unknown>,
      offer: (p.offer as Offer | null) ?? null,
    };
  }

  private provider(c: ResolvedConnection): BankProvider {
    if (c.mode === 'manual') return this.manual;
    if (c.mode === 'api') return c.adapter === 'vendor' ? this.vendors.for(c.catalogKey) : this.rest;
    return this.simulated;
  }

  /** Falha da instituição vira 502 com mensagem legível (e não derruba a transação silenciosamente). */
  private async guard<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof BankApiError) throw new BadGatewayException({ code: 'BANK_API_ERROR', message: err.message });
      if ((err as Error).name === 'TimeoutError' || (err as Error).name === 'TypeError') throw new BadGatewayException({ code: 'BANK_UNREACHABLE', message: 'Instituição não respondeu' });
      throw err;
    }
  }

  private async activeConnections(tx: Tx): Promise<ResolvedConnection[]> {
    return (await tx.select().from(bankConnections).where(eq(bankConnections.active, true)).orderBy(asc(bankConnections.createdAt))).map((c) => this.resolve(c));
  }

  private async connectionOrFail(tx: Tx, id: string, requireActive = true): Promise<ResolvedConnection> {
    const [c] = await tx.select().from(bankConnections).where(eq(bankConnections.id, id));
    if (!c || (requireActive && !c.active)) throw new NotFoundException({ code: 'CONNECTION_NOT_FOUND', message: 'Instituição não encontrada ou inativa' });
    return this.resolve(c);
  }

  private resolve(c: ConnectionRow): ResolvedConnection {
    return {
      id: c.id,
      name: c.name,
      catalogKey: c.catalogKey,
      mode: c.mode,
      adapter: c.adapter,
      manualPlans: c.manualPlans,
      products: c.products as ResolvedConnection['products'],
      baseUrl: c.baseUrl,
      clientId: c.clientId,
      clientSecret: c.clientSecretEnc ? this.secrets.decrypt(c.clientSecretEnc) : null,
      vehicleMonthlyRate: Number(c.vehicleMonthlyRate),
      realEstateYearlyRate: Number(c.realEstateYearlyRate),
      tacFee: Number(c.tacFee),
    };
  }

  private toConnection(c: ConnectionRow): BankConnection {
    const api = process.env.PUBLIC_API_URL ?? this.config.adminUrl.replace(/:5173$/, ':3000');
    return {
      id: c.id,
      name: c.name,
      catalogKey: c.catalogKey,
      mode: c.mode,
      adapter: c.adapter,
      manualPlans: c.manualPlans,
      products: c.products as BankConnection['products'],
      baseUrl: c.baseUrl,
      clientId: c.clientId,
      hasClientSecret: !!c.clientSecretEnc,
      hasWebhookSecret: !!c.webhookSecretEnc,
      vehicleMonthlyRate: Number(c.vehicleMonthlyRate),
      realEstateYearlyRate: Number(c.realEstateYearlyRate),
      tacFee: Number(c.tacFee),
      active: c.active,
      webhookUrl: `${api}/api/public/banking/webhook/${c.id}`,
    };
  }

  private async proposalOrFail(tx: Tx, id: string) {
    const [p] = await tx.select().from(bankProposals).where(eq(bankProposals.id, id));
    if (!p) throw new NotFoundException({ code: 'PROPOSAL_NOT_FOUND', message: 'Proposta não encontrada' });
    return p;
  }

  private async detailInTx(tx: Tx, id: string): Promise<Proposal> {
    const [row] = await tx
      .select({ p: bankProposals, c: { id: bankConnections.id, name: bankConnections.name, mode: bankConnections.mode } })
      .from(bankProposals)
      .innerJoin(bankConnections, eq(bankConnections.id, bankProposals.connectionId))
      .where(eq(bankProposals.id, id));
    if (!row) throw new NotFoundException({ code: 'PROPOSAL_NOT_FOUND', message: 'Proposta não encontrada' });
    const events = await tx.select().from(bankProposalEvents).where(eq(bankProposalEvents.proposalId, id)).orderBy(asc(bankProposalEvents.at), asc(bankProposalEvents.id));
    const { p, c } = row;
    return {
      id: p.id,
      connection: c,
      product: p.product,
      sourceType: p.sourceType,
      sourceId: p.sourceId,
      customerId: p.customerId,
      amount: Number(p.amount),
      termMonths: p.termMonths,
      offer: (p.offer as Offer | null) ?? null,
      status: p.status,
      statusMessage: p.statusMessage,
      externalId: p.externalId,
      result: p.result,
      events: events.map((e) => ({ status: e.status as ProposalStatus, message: e.message, source: e.source, at: e.at.toISOString() })),
      createdAt: p.createdAt.toISOString(),
    };
  }

  private async seed(tx: Tx, tenantId: string) {
    const [any] = await tx.select({ id: bankConnections.id }).from(bankConnections).where(eq(bankConnections.tenantId, tenantId)).limit(1);
    if (any) return;
    const rows = await tx
      .insert(bankConnections)
      .values(SEED.map((s) => ({ ...s, tenantId, mode: 'simulated' as const })))
      .returning({ id: bankConnections.id });
    await tx.insert(bankWebhookRoutes).values(rows.map((r) => ({ connectionId: r.id, tenantId })));
  }
}

function validSignature(raw: Buffer, header: string | undefined, secret: string) {
  if (!header?.startsWith('sha256=')) return false;
  const expected = Buffer.from(createHmac('sha256', secret).update(raw).digest('hex'));
  const received = Buffer.from(header.slice('sha256='.length));
  return expected.length === received.length && timingSafeEqual(expected, received);
}
