import { BankingModule, BankingService, creditProductLabel, PROPOSAL_UPDATED, type ProposalUpdated } from '@all/banking';
import { AuditService, centsToDecimal, coreSchema, CustomersService, FilesService, FinanceService, MAX_IMAGE_BYTES, ModuleHooks, nextSequence, OutboxHandlers, TenantDb, toCents, ZodPipe, type UploadedFile as StoredFile } from '@all/core';
import { customers } from '@all/core/schema';
import type { Tx } from '@all/db';
import { ModuleRoute, RequirePermission, requestContext } from '@all/module-sdk';
import { NotificationsModule, NotificationsService } from '@all/notifications';
import { schServices } from '@all/scheduling/schema';
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  Injectable,
  Module,
  NotFoundException,
  OnModuleInit,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { and, desc, eq, gte, ilike, lte, ne, or } from 'drizzle-orm';
import { z } from 'zod';
import { addressOf, dealInput, MAX_LTV, propertyInput, type Deal, type DealInput, type DealStatus, type Property, type PropertyInput } from '../contracts';
import { reDeals, reProperties } from '../db/schema';

const MODULE = 'real_estate';
const FILE_OWNER = 're_property';
const SOURCE = 'real_estate_deal';

type PropertyRow = typeof reProperties.$inferSelect;
type DealRow = typeof reDeals.$inferSelect;

const badRequest = (code: string, message: string) => new BadRequestException({ code, message });
const localToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const num = (v: string | null) => (v === null ? null : Number(v));

@Injectable()
export class RealEstateService implements OnModuleInit {
  constructor(
    private readonly tdb: TenantDb,
    private readonly hooks: ModuleHooks,
    private readonly files: FilesService,
    private readonly finance: FinanceService,
    private readonly customers: CustomersService,
    private readonly notifications: NotificationsService,
    private readonly handlers: OutboxHandlers,
    private readonly audit: AuditService,
    private readonly banking: BankingService,
  ) {}

  onModuleInit() {
    this.hooks.register(MODULE, { onEnable: (tx, tenantId) => this.seed(tx, tenantId) });
    this.handlers.on<ProposalUpdated>(PROPOSAL_UPDATED, 'real_estate.credit', (e) => this.onCredit(e.payload));
  }

  // ---- Imóveis --------------------------------------------------------------------------------

  list(opts: { q?: string; status?: string; type?: string; minBedrooms?: number; maxPrice?: number }): Promise<Property[]> {
    return this.tdb.run(async (tx) => {
      const term = opts.q?.trim();
      const like = term ? `%${term.replace(/[%_\\]/g, (c) => `\\${c}`)}%` : undefined;
      const code = term && /^\d+$/.test(term) ? Number(term) : undefined;
      const rows = await this.propertyQuery(tx)
        .where(
          and(
            opts.status ? eq(reProperties.status, opts.status as PropertyRow['status']) : undefined,
            opts.type ? eq(reProperties.type, opts.type as PropertyRow['type']) : undefined,
            opts.minBedrooms ? gte(reProperties.bedrooms, opts.minBedrooms) : undefined,
            opts.maxPrice ? lte(reProperties.salePrice, opts.maxPrice.toFixed(2)) : undefined,
            like
              ? or(ilike(reProperties.title, like), ilike(reProperties.district, like), ilike(reProperties.city, like), ilike(reProperties.street, like), code ? eq(reProperties.code, code) : undefined)
              : undefined,
          ),
        )
        .orderBy(desc(reProperties.createdAt))
        .limit(300);
      return this.toProperties(tx, rows);
    });
  }

  get(id: string): Promise<Property> {
    return this.tdb.run(async (tx) => {
      const [row] = await this.propertyQuery(tx).where(eq(reProperties.id, id));
      if (!row) throw new NotFoundException({ code: 'PROPERTY_NOT_FOUND', message: 'Imóvel não encontrado' });
      return (await this.toProperties(tx, [row]))[0]!;
    });
  }

  save(id: string | null, input: PropertyInput): Promise<Property> {
    const { tenantId } = requestContext.require();
    return this.tdb.run(async (tx) => {
      const owner = await this.customers.findInTx(tx, input.ownerId);
      if (!owner || owner.anonymizedAt) throw badRequest('OWNER_NOT_FOUND', 'Proprietário não encontrado');
      const values = propertyRow(input);
      let rowId = id;
      if (id) {
        const [row] = await tx.update(reProperties).set(values).where(eq(reProperties.id, id)).returning({ id: reProperties.id });
        if (!row) throw new NotFoundException({ code: 'PROPERTY_NOT_FOUND', message: 'Imóvel não encontrado' });
      } else {
        const [row] = await tx
          .insert(reProperties)
          .values({ ...values, tenantId, code: await nextSequence(tx, tenantId, 're_property') })
          .returning({ id: reProperties.id });
        rowId = row!.id;
        await this.customers.addTimeline(tx, { customerId: owner.id, moduleKey: MODULE, type: 'property.listed', title: `Imóvel captado: ${input.title}`, entity: 're_property', entityId: rowId });
      }
      await this.audit.log(tx, { action: id ? 'real_estate.property.updated' : 'real_estate.property.created', entity: 're_property', entityId: rowId! });
      const [row] = await this.propertyQuery(tx).where(eq(reProperties.id, rowId!));
      return (await this.toProperties(tx, [row!]))[0]!;
    });
  }

  addPhoto(id: string, file: StoredFile) {
    return this.tdb.run(async (tx) => {
      await this.propertyOrFail(tx, id);
      return this.files.saveImageInTx(tx, file, { entity: FILE_OWNER, id });
    });
  }

  removePhoto(id: string, fileId: string) {
    return this.tdb.run((tx) => this.files.removeInTx(tx, fileId, { entity: FILE_OWNER, id }));
  }

  /** Para o seletor da agenda (visitas): imóveis disponíveis. */
  async findInTx(tx: Tx, id: string) {
    const [row] = await tx.select().from(reProperties).where(eq(reProperties.id, id));
    return row;
  }

  // ---- Propostas ------------------------------------------------------------------------------

  listDeals(opts: { status?: string; customerId?: string; propertyId?: string }): Promise<Deal[]> {
    return this.tdb.run(async (tx) => {
      const rows = await this.dealQuery(tx)
        .where(
          and(
            opts.status ? eq(reDeals.status, opts.status as DealStatus) : undefined,
            opts.customerId ? eq(reDeals.customerId, opts.customerId) : undefined,
            opts.propertyId ? eq(reDeals.propertyId, opts.propertyId) : undefined,
          ),
        )
        .orderBy(desc(reDeals.createdAt))
        .limit(300);
      return rows.map(toDeal);
    });
  }

  getDeal(id: string) {
    return this.tdb.run((tx) => this.dealDetail(tx, id));
  }

  createDeal(input: DealInput): Promise<Deal> {
    const { tenantId, userId } = requestContext.requireTenant();
    return this.tdb.run(async (tx) => {
      const customer = await this.customers.findInTx(tx, input.customerId);
      if (!customer || customer.anonymizedAt) throw badRequest('CUSTOMER_NOT_FOUND', 'Comprador não encontrado');
      const [property] = await tx.select().from(reProperties).where(eq(reProperties.id, input.propertyId)).for('update');
      if (!property) throw new NotFoundException({ code: 'PROPERTY_NOT_FOUND', message: 'Imóvel não encontrado' });
      if (property.status !== 'available' || property.purpose === 'rent') throw new ConflictException({ code: 'PROPERTY_UNAVAILABLE', message: 'Imóvel não está disponível para venda' });
      if (property.ownerId === customer.id) throw badRequest('BUYER_IS_OWNER', 'O comprador é o próprio proprietário');
      checkAmounts(input, property.financeable);
      const [deal] = await tx
        .insert(reDeals)
        .values({
          tenantId,
          number: await nextSequence(tx, tenantId, 're_deal'),
          customerId: customer.id,
          propertyId: property.id,
          price: centsToDecimal(toCents(input.price)),
          paymentType: input.paymentType,
          downPayment: centsToDecimal(toCents(input.downPayment)),
          fgtsAmount: centsToDecimal(toCents(input.fgtsAmount)),
          commissionPercent: input.commissionPercent.toFixed(2),
          brokerId: userId ?? null,
          notes: input.notes ?? null,
        })
        .returning();
      await tx.update(reProperties).set({ status: 'reserved' }).where(eq(reProperties.id, property.id));
      await this.customers.addTimeline(tx, { customerId: customer.id, moduleKey: MODULE, type: 'deal.created', title: `Proposta de compra: ${property.title}`, entity: 're_deal', entityId: deal!.id });
      await this.audit.log(tx, { action: 'real_estate.deal.created', entity: 're_deal', entityId: deal!.id });
      return this.dealDetail(tx, deal!.id);
    });
  }

  /**
   * Fecha a venda. O dinheiro do imóvel vai para o proprietário; a receita da imobiliária é a
   * comissão, lançada como "a receber" na data de hoje.
   */
  closeDeal(id: string): Promise<Deal> {
    return this.tdb.run(async (tx) => {
      const deal = await this.dealOrFail(tx, id, true);
      if (deal.status === 'closed' || deal.status === 'lost') throw badRequest('DEAL_CLOSED', 'Proposta já encerrada');
      if (deal.paymentType === 'financing') {
        const ok = (await this.banking.proposalsForInTx(tx, SOURCE, id)).some((p) => p.status === 'approved' || p.status === 'contracted');
        if (!ok) throw badRequest('CREDIT_NOT_APPROVED', 'Financiamento ainda não aprovado');
      }
      const [property] = await tx.select().from(reProperties).where(eq(reProperties.id, deal.propertyId));
      const commission = Math.round((toCents(deal.price) * Number(deal.commissionPercent)) / 100);
      if (commission > 0) {
        await this.finance.recordInTx(tx, {
          kind: 'income',
          status: 'pending',
          description: `Comissão de venda — imóvel ${property!.code} (${Number(deal.commissionPercent).toLocaleString('pt-BR')}%)`,
          amount: commission / 100,
          dueDate: localToday(),
          customerId: property!.ownerId,
          sourceType: SOURCE,
          settleInFinance: true,
          sourceId: id,
          categoryKey: 'services',
        });
      }
      await tx.update(reProperties).set({ status: 'sold' }).where(eq(reProperties.id, deal.propertyId));
      await tx.update(reDeals).set({ status: 'closed', closedAt: new Date() }).where(eq(reDeals.id, id));
      await this.customers.addTimeline(tx, { customerId: deal.customerId, moduleKey: MODULE, type: 'deal.closed', title: `Comprou o imóvel ${property!.title}`, entity: 're_deal', entityId: id });
      await this.customers.addTimeline(tx, { customerId: property!.ownerId, moduleKey: MODULE, type: 'property.sold', title: `Imóvel vendido: ${property!.title}`, entity: 're_deal', entityId: id });
      await this.audit.log(tx, { action: 'real_estate.deal.closed', entity: 're_deal', entityId: id });
      return this.dealDetail(tx, id);
    });
  }

  loseDeal(id: string, reason: string): Promise<Deal> {
    return this.tdb.run(async (tx) => {
      const deal = await this.dealOrFail(tx, id, true);
      if (deal.status === 'closed' || deal.status === 'lost') throw badRequest('DEAL_CLOSED', 'Proposta já encerrada');
      if ((await this.banking.proposalsForInTx(tx, SOURCE, id)).some((p) => ['submitted', 'under_review', 'approved'].includes(p.status))) {
        throw badRequest('PROPOSAL_OPEN', 'Cancele a proposta de financiamento em andamento antes');
      }
      await tx.update(reDeals).set({ status: 'lost', lostReason: reason }).where(eq(reDeals.id, id));
      await tx.update(reProperties).set({ status: 'available' }).where(and(eq(reProperties.id, deal.propertyId), eq(reProperties.status, 'reserved')));
      await this.audit.log(tx, { action: 'real_estate.deal.lost', entity: 're_deal', entityId: id, data: { reason } });
      return this.dealDetail(tx, id);
    });
  }

  private onCredit(e: ProposalUpdated) {
    if (e.sourceType !== SOURCE) return Promise.resolve();
    return this.tdb.run(async (tx) => {
      const [deal] = await tx.select().from(reDeals).where(and(eq(reDeals.id, e.sourceId), ne(reDeals.status, 'closed'), ne(reDeals.status, 'lost')));
      if (!deal) return;
      const next: DealStatus =
        e.status === 'approved' || e.status === 'contracted' ? 'credit_approved' : e.status === 'rejected' ? 'credit_rejected' : e.status === 'cancelled' ? 'negotiating' : 'credit_analysis';
      if (next === deal.status) return;
      await tx.update(reDeals).set({ status: next }).where(eq(reDeals.id, deal.id));
      const [property] = await tx.select().from(reProperties).where(eq(reProperties.id, deal.propertyId));
      const proposal = (await this.banking.proposalsForInTx(tx, SOURCE, deal.id)).find((p) => p.id === e.proposalId);
      await this.customers.addTimeline(tx, {
        customerId: deal.customerId,
        moduleKey: MODULE,
        type: `deal.${next}`,
        title: `${creditProductLabel[e.product]} (${proposal?.institution ?? 'banco'}): ${next === 'credit_approved' ? 'aprovado' : next === 'credit_rejected' ? 'recusado' : 'em análise'}`,
        entity: 're_deal',
        entityId: deal.id,
      });
      if (next === 'credit_approved' && e.status === 'approved') {
        await this.notifications.enqueueInTx(tx, {
          templateKey: 'real_estate.credit_approved',
          customerId: deal.customerId,
          related: { entity: 're_deal', id: deal.id },
          data: { imovel: { titulo: property!.title }, credito: { instituicao: proposal?.institution ?? '' } },
        });
      }
    });
  }

  // ---- internos -------------------------------------------------------------------------------

  private propertyQuery(tx: Tx) {
    return tx
      .select({ p: reProperties, owner: { id: customers.id, name: customers.name, phone: customers.phone } })
      .from(reProperties)
      .innerJoin(customers, eq(customers.id, reProperties.ownerId))
      .$dynamic();
  }

  private async toProperties(tx: Tx, rows: { p: PropertyRow; owner: Property['owner'] }[]): Promise<Property[]> {
    const photos = await this.files.listByOwners(tx, FILE_OWNER, rows.map((r) => r.p.id));
    return rows.map(({ p, owner }) => {
      const area = num(p.areaM2);
      const sale = num(p.salePrice);
      return {
        id: p.id,
        code: p.code,
        purpose: p.purpose,
        type: p.type,
        title: p.title,
        owner,
        street: p.street,
        number: p.number,
        complement: p.complement,
        district: p.district,
        city: p.city,
        state: p.state,
        zip: p.zip,
        areaM2: area,
        landM2: num(p.landM2),
        bedrooms: p.bedrooms,
        suites: p.suites,
        bathrooms: p.bathrooms,
        parking: p.parking,
        salePrice: sale,
        rentPrice: num(p.rentPrice),
        condoFee: num(p.condoFee),
        iptuYearly: num(p.iptuYearly),
        financeable: p.financeable,
        status: p.status,
        description: p.description,
        photos: photos.filter((f) => f.ownerId === p.id).map((f) => ({ id: f.id })),
        pricePerM2: area && sale ? Math.round((sale / area) * 100) / 100 : null,
        createdAt: p.createdAt.toISOString(),
      };
    });
  }

  private dealQuery(tx: Tx) {
    return tx
      .select({
        d: reDeals,
        customer: { id: customers.id, name: customers.name, phone: customers.phone, email: customers.email, document: customers.document },
        property: reProperties,
        brokerName: coreSchema.users.name,
      })
      .from(reDeals)
      .innerJoin(customers, eq(customers.id, reDeals.customerId))
      .innerJoin(reProperties, eq(reProperties.id, reDeals.propertyId))
      .leftJoin(coreSchema.users, eq(coreSchema.users.id, reDeals.brokerId))
      .$dynamic();
  }

  private async dealDetail(tx: Tx, id: string) {
    const [row] = await this.dealQuery(tx).where(eq(reDeals.id, id));
    if (!row) throw new NotFoundException({ code: 'DEAL_NOT_FOUND', message: 'Proposta não encontrada' });
    return toDeal(row);
  }

  private async dealOrFail(tx: Tx, id: string, lock = false) {
    const q = tx.select().from(reDeals).where(eq(reDeals.id, id));
    const [row] = lock ? await q.for('update') : await q;
    if (!row) throw new NotFoundException({ code: 'DEAL_NOT_FOUND', message: 'Proposta não encontrada' });
    return row;
  }

  private async propertyOrFail(tx: Tx, id: string) {
    const row = await this.findInTx(tx, id);
    if (!row) throw new NotFoundException({ code: 'PROPERTY_NOT_FOUND', message: 'Imóvel não encontrado' });
    return row;
  }

  private async seed(tx: Tx, tenantId: string) {
    const [any] = await tx.select({ id: schServices.id }).from(schServices).where(eq(schServices.tenantId, tenantId)).limit(1);
    if (!any) {
      await tx.insert(schServices).values([
        { tenantId, name: 'Visita ao imóvel', category: 'Atendimento', durationMin: 60, price: '0.00' },
        { tenantId, name: 'Avaliação de imóvel', category: 'Captação', durationMin: 90, price: '0.00' },
        { tenantId, name: 'Assinatura de contrato', category: 'Fechamento', durationMin: 60, price: '0.00' },
      ]);
    }
  }
}

/** Financiamento habitacional: até 80% do valor; entrada + FGTS cobrem o resto. */
function checkAmounts(input: DealInput, financeable: boolean) {
  const price = toCents(input.price);
  const own = toCents(input.downPayment) + toCents(input.fgtsAmount);
  if (own > price) throw badRequest('INVALID_DOWN_PAYMENT', 'Entrada e FGTS passam do valor da proposta');
  if (input.paymentType === 'cash' && input.fgtsAmount > 0) throw badRequest('FGTS_NEEDS_FINANCING', 'FGTS só entra junto com o financiamento habitacional');
  if (input.paymentType === 'financing') {
    if (!financeable) throw badRequest('NOT_FINANCEABLE', 'Este imóvel não aceita financiamento');
    if (price - own > price * MAX_LTV) throw badRequest('LTV_EXCEEDED', `Os bancos financiam até ${MAX_LTV * 100}% do valor: entrada + FGTS precisam somar pelo menos ${(1 - MAX_LTV) * 100}%`);
  }
}

function toDeal(row: { d: DealRow; customer: Deal['customer']; property: PropertyRow; brokerName: string | null }): Deal {
  const { d, property: p } = row;
  const price = Number(d.price);
  const own = Number(d.downPayment) + Number(d.fgtsAmount);
  return {
    id: d.id,
    number: d.number,
    customer: row.customer,
    property: { id: p.id, code: p.code, title: p.title, address: addressOf(p), askingPrice: num(p.salePrice) },
    price,
    paymentType: d.paymentType,
    downPayment: Number(d.downPayment),
    fgtsAmount: Number(d.fgtsAmount),
    financedAmount: d.paymentType === 'financing' ? Math.round((price - own) * 100) / 100 : 0,
    commissionPercent: Number(d.commissionPercent),
    commission: Math.round(price * Number(d.commissionPercent)) / 100,
    status: d.status,
    lostReason: d.lostReason,
    brokerName: row.brokerName,
    notes: d.notes,
    closedAt: d.closedAt?.toISOString() ?? null,
    createdAt: d.createdAt.toISOString(),
  };
}

function propertyRow(input: PropertyInput) {
  const m = (v: number | null | undefined) => (v != null ? centsToDecimal(toCents(v)) : null);
  return {
    purpose: input.purpose,
    type: input.type,
    title: input.title,
    ownerId: input.ownerId,
    street: input.street,
    number: input.number ?? null,
    complement: input.complement ?? null,
    district: input.district,
    city: input.city,
    state: input.state,
    zip: input.zip ?? null,
    areaM2: input.areaM2 != null ? input.areaM2.toFixed(2) : null,
    landM2: input.landM2 != null ? input.landM2.toFixed(2) : null,
    bedrooms: input.bedrooms,
    suites: input.suites,
    bathrooms: input.bathrooms,
    parking: input.parking,
    salePrice: m(input.salePrice),
    rentPrice: m(input.rentPrice),
    condoFee: m(input.condoFee),
    iptuYearly: m(input.iptuYearly),
    financeable: input.financeable,
    status: input.status,
    description: input.description ?? null,
  };
}

const propertiesQuery = z.object({
  q: z.string().max(100).optional(),
  status: z.string().max(20).optional(),
  type: z.string().max(20).optional(),
  minBedrooms: z.coerce.number().int().min(0).max(20).optional(),
  maxPrice: z.coerce.number().positive().optional(),
});
const dealsQuery = z.object({ status: z.string().max(30).optional(), customerId: z.string().uuid().optional(), propertyId: z.string().uuid().optional() });

@Controller('real-estate')
@ModuleRoute('real_estate')
export class RealEstateController {
  constructor(private readonly re: RealEstateService) {}

  @Get('properties')
  @RequirePermission('real_estate.properties.read')
  list(@Query(new ZodPipe(propertiesQuery)) q: z.infer<typeof propertiesQuery>) {
    return this.re.list(q);
  }

  @Get('properties/:id')
  @RequirePermission('real_estate.properties.read')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.re.get(id);
  }

  @Post('properties')
  @RequirePermission('real_estate.properties.write')
  create(@Body(new ZodPipe(propertyInput)) body: PropertyInput) {
    return this.re.save(null, body);
  }

  @Patch('properties/:id')
  @RequirePermission('real_estate.properties.write')
  update(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(propertyInput)) body: PropertyInput) {
    return this.re.save(id, body);
  }

  @Post('properties/:id/photos')
  @RequirePermission('real_estate.properties.write')
  @UseInterceptors(FileInterceptor('photo', { limits: { fileSize: MAX_IMAGE_BYTES, files: 1 } }))
  addPhoto(@Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: StoredFile | undefined) {
    if (!file) throw new BadRequestException({ code: 'FILE_REQUIRED', message: 'Envie a foto no campo "photo"' });
    return this.re.addPhoto(id, file);
  }

  @Delete('properties/:id/photos/:fileId')
  @HttpCode(204)
  @RequirePermission('real_estate.properties.write')
  removePhoto(@Param('id', ParseUUIDPipe) id: string, @Param('fileId', ParseUUIDPipe) fileId: string) {
    return this.re.removePhoto(id, fileId);
  }

  @Get('deals')
  @RequirePermission('real_estate.deals.read')
  deals(@Query(new ZodPipe(dealsQuery)) q: z.infer<typeof dealsQuery>) {
    return this.re.listDeals(q);
  }

  @Get('deals/:id')
  @RequirePermission('real_estate.deals.read')
  deal(@Param('id', ParseUUIDPipe) id: string) {
    return this.re.getDeal(id);
  }

  @Post('deals')
  @RequirePermission('real_estate.deals.write')
  createDeal(@Body(new ZodPipe(dealInput)) body: DealInput) {
    return this.re.createDeal(body);
  }

  @Post('deals/:id/close')
  @HttpCode(200)
  @RequirePermission('real_estate.deals.write')
  close(@Param('id', ParseUUIDPipe) id: string) {
    return this.re.closeDeal(id);
  }

  @Post('deals/:id/lose')
  @HttpCode(200)
  @RequirePermission('real_estate.deals.write')
  lose(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(z.object({ reason: z.string().trim().min(3).max(300) }))) body: { reason: string }) {
    return this.re.loseDeal(id, body.reason);
  }
}

@Module({ imports: [BankingModule, NotificationsModule], controllers: [RealEstateController], providers: [RealEstateService] })
export class RealEstateModule {}
