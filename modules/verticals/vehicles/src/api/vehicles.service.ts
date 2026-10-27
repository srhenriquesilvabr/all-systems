import { AuditService, centsToDecimal, coreSchema, CustomersService, FilesService, FinanceService, nextSequence, OutboxHandlers, TenantDb, toCents, type UploadedFile } from '@all/core';
import { customers } from '@all/core/schema';
import { BankingService, creditProductLabel, PROPOSAL_UPDATED, type ProposalUpdated } from '@all/banking';
import type { Tx } from '@all/db';
import { requestContext } from '@all/module-sdk';
import { NotificationsService } from '@all/notifications';
import { BadRequestException, BadGatewayException, ConflictException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { and, desc, eq, ilike, ne, or } from 'drizzle-orm';
import { vehicleTitle, type Deal, type DealInput, type DealStatus, type FipePrice, type Vehicle, type VehicleInput } from '../contracts';
import { vehDeals, vehVehicles } from '../db/schema';

const MODULE = 'vehicles';
const FILE_OWNER = 'veh_vehicle';
const SOURCE = 'vehicle_deal';

type VehicleRow = typeof vehVehicles.$inferSelect;
type DealRow = typeof vehDeals.$inferSelect;

const badRequest = (code: string, message: string) => new BadRequestException({ code, message });
const localToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const plusDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Tabela FIPE pela BrasilAPI (pública, sem chave). Isolada para ser trocada nos testes. */
@Injectable()
export class FipeHttp {
  async price(code: string): Promise<FipePrice[]> {
    const res = await fetch(`https://brasilapi.com.br/api/fipe/preco/v1/${encodeURIComponent(code)}`, { signal: AbortSignal.timeout(10_000) });
    if (res.status === 404 || res.status === 400) return [];
    if (!res.ok) throw new BadGatewayException({ code: 'FIPE_UNAVAILABLE', message: 'Consulta à tabela FIPE indisponível agora' });
    const body = (await res.json()) as { codigoFipe: string; marca: string; modelo: string; anoModelo: number; combustivel: string; valor: string; mesReferencia: string }[];
    return body.map((b) => ({ ...b, valor: Number(b.valor.replace(/[^\d,]/g, '').replace(',', '.')) }));
  }
}

@Injectable()
export class VehiclesService implements OnModuleInit {
  constructor(
    private readonly tdb: TenantDb,
    private readonly files: FilesService,
    private readonly finance: FinanceService,
    private readonly customers: CustomersService,
    private readonly notifications: NotificationsService,
    private readonly handlers: OutboxHandlers,
    private readonly audit: AuditService,
    private readonly fipe: FipeHttp,
    private readonly banking: BankingService,
  ) {}

  onModuleInit() {
    this.handlers.on<ProposalUpdated>(PROPOSAL_UPDATED, 'vehicles.credit', (e) => this.onCredit(e.payload));
  }

  // ---- Estoque --------------------------------------------------------------------------------

  list(opts: { q?: string; status?: string }): Promise<Vehicle[]> {
    return this.tdb.run(async (tx) => {
      const term = opts.q?.trim();
      const like = term ? `%${term.replace(/[%_\\]/g, (c) => `\\${c}`)}%` : undefined;
      const rows = await tx
        .select()
        .from(vehVehicles)
        .where(
          and(
            opts.status ? eq(vehVehicles.status, opts.status as VehicleRow['status']) : undefined,
            like ? or(ilike(vehVehicles.brand, like), ilike(vehVehicles.model, like), ilike(vehVehicles.version, like), ilike(vehVehicles.plate, like)) : undefined,
          ),
        )
        .orderBy(desc(vehVehicles.createdAt))
        .limit(300);
      return this.toVehicles(tx, rows);
    });
  }

  get(id: string): Promise<Vehicle> {
    return this.tdb.run(async (tx) => (await this.toVehicles(tx, [await this.vehicleOrFail(tx, id)]))[0]!);
  }

  save(id: string | null, input: VehicleInput): Promise<Vehicle> {
    const { tenantId } = requestContext.require();
    return this.tdb.run(async (tx) => {
      const values = vehicleRow(input);
      let row: VehicleRow | undefined;
      try {
        if (id) {
          const current = await this.vehicleOrFail(tx, id);
          if (current.status === 'sold' && input.status !== 'sold') throw badRequest('VEHICLE_SOLD', 'Veículo vendido não volta ao estoque por aqui');
          [row] = await tx.update(vehVehicles).set(values).where(eq(vehVehicles.id, id)).returning();
        } else {
          [row] = await tx.insert(vehVehicles).values({ ...values, tenantId }).returning();
        }
      } catch (err) {
        const code = (err as { cause?: { code?: string } }).cause?.code ?? (err as { code?: string }).code;
        if (code === '23505') throw new ConflictException({ code: 'PLATE_TAKEN', message: 'Já existe um veículo com esta placa' });
        throw err;
      }
      await this.audit.log(tx, { action: id ? 'vehicles.vehicle.updated' : 'vehicles.vehicle.created', entity: 'veh_vehicle', entityId: row!.id, data: { price: input.price } });
      return (await this.toVehicles(tx, [row!]))[0]!;
    });
  }

  addPhoto(id: string, file: UploadedFile) {
    return this.tdb.run(async (tx) => {
      await this.vehicleOrFail(tx, id);
      return this.files.saveImageInTx(tx, file, { entity: FILE_OWNER, id });
    });
  }

  removePhoto(id: string, fileId: string) {
    return this.tdb.run((tx) => this.files.removeInTx(tx, fileId, { entity: FILE_OWNER, id }));
  }

  fipePrice(code: string) {
    return this.fipe.price(code);
  }

  // ---- Negociações ----------------------------------------------------------------------------

  listDeals(opts: { status?: string; customerId?: string; vehicleId?: string }): Promise<Deal[]> {
    return this.tdb.run(async (tx) => {
      const rows = await this.dealQuery(tx)
        .where(
          and(
            opts.status ? eq(vehDeals.status, opts.status as DealStatus) : undefined,
            opts.customerId ? eq(vehDeals.customerId, opts.customerId) : undefined,
            opts.vehicleId ? eq(vehDeals.vehicleId, opts.vehicleId) : undefined,
          ),
        )
        .orderBy(desc(vehDeals.createdAt))
        .limit(300);
      return rows.map(toDeal);
    });
  }

  getDeal(id: string): Promise<Deal> {
    return this.tdb.run((tx) => this.dealDetail(tx, id));
  }

  /** Abre a negociação e reserva o veículo (um veículo, uma negociação ativa). */
  createDeal(input: DealInput): Promise<Deal> {
    const { tenantId, userId } = requestContext.requireTenant();
    return this.tdb.run(async (tx) => {
      const customer = await this.customers.findInTx(tx, input.customerId);
      if (!customer || customer.anonymizedAt) throw badRequest('CUSTOMER_NOT_FOUND', 'Cliente não encontrado');
      const [vehicle] = await tx.select().from(vehVehicles).where(eq(vehVehicles.id, input.vehicleId)).for('update');
      if (!vehicle) throw new NotFoundException({ code: 'VEHICLE_NOT_FOUND', message: 'Veículo não encontrado' });
      if (vehicle.status !== 'available') throw new ConflictException({ code: 'VEHICLE_UNAVAILABLE', message: 'Veículo reservado, vendido ou fora de venda' });
      checkAmounts(input);
      const [deal] = await tx
        .insert(vehDeals)
        .values({
          tenantId,
          number: await nextSequence(tx, tenantId, 'vehicle_deal'),
          customerId: customer.id,
          vehicleId: vehicle.id,
          price: centsToDecimal(toCents(input.price)),
          discount: centsToDecimal(toCents(input.discount)),
          paymentType: input.paymentType,
          downPayment: centsToDecimal(toCents(input.downPayment)),
          tradeIn: input.tradeIn ?? null,
          sellerId: userId ?? null,
          notes: input.notes ?? null,
        })
        .returning();
      await tx.update(vehVehicles).set({ status: 'reserved' }).where(eq(vehVehicles.id, vehicle.id));
      await this.customers.addTimeline(tx, { customerId: customer.id, moduleKey: MODULE, type: 'deal.created', title: `Negociação aberta: ${vehicleTitle(vehicle)}`, entity: 'veh_deal', entityId: deal!.id });
      await this.audit.log(tx, { action: 'vehicles.deal.created', entity: 'veh_deal', entityId: deal!.id });
      return this.dealDetail(tx, deal!.id);
    });
  }

  updateDeal(id: string, input: Pick<DealInput, 'price' | 'discount' | 'paymentType' | 'downPayment' | 'tradeIn' | 'notes'>): Promise<Deal> {
    return this.tdb.run(async (tx) => {
      const deal = await this.dealOrFail(tx, id);
      if (!['negotiating', 'credit_rejected'].includes(deal.status)) throw badRequest('DEAL_LOCKED', 'Com crédito em análise ou aprovado, os valores não mudam; cancele a proposta antes');
      checkAmounts(input);
      await tx
        .update(vehDeals)
        .set({
          price: centsToDecimal(toCents(input.price)),
          discount: centsToDecimal(toCents(input.discount)),
          paymentType: input.paymentType,
          downPayment: centsToDecimal(toCents(input.downPayment)),
          tradeIn: input.tradeIn ?? null,
          notes: input.notes ?? null,
          status: 'negotiating',
        })
        .where(eq(vehDeals.id, id));
      return this.dealDetail(tx, id);
    });
  }

  /**
   * Fecha a venda: à vista, ou financiada com proposta aprovada/contratada. O veículo sai do
   * estoque, a troca entra, e o financeiro recebe a entrada (do cliente) e o repasse (do banco).
   */
  closeDeal(id: string): Promise<Deal> {
    const { tenantId } = requestContext.requireTenant();
    return this.tdb.run(async (tx) => {
      const deal = await this.dealOrFail(tx, id, true);
      if (deal.status === 'closed' || deal.status === 'lost') throw badRequest('DEAL_CLOSED', 'Negociação já encerrada');
      const [vehicle] = await tx.select().from(vehVehicles).where(eq(vehVehicles.id, deal.vehicleId));
      const totals = dealTotals(deal);
      let bankName: string | null = null;
      if (deal.paymentType === 'financing') {
        const approved = (await this.banking.proposalsForInTx(tx, SOURCE, id)).find((p) => p.status === 'approved' || p.status === 'contracted');
        if (!approved) throw badRequest('CREDIT_NOT_APPROVED', 'Financiamento ainda não aprovado');
        bankName = approved.institution;
      }
      const title = vehicleTitle(vehicle!);
      const today = localToday();
      const fromCustomer = deal.paymentType === 'cash' ? totals.net - totals.tradeIn : totals.downPayment;
      if (fromCustomer > 0) {
        await this.finance.recordInTx(tx, {
          kind: 'income',
          status: 'pending',
          description: `Venda ${title} — ${deal.paymentType === 'cash' ? 'pagamento' : 'entrada'}`,
          amount: fromCustomer / 100,
          dueDate: today,
          customerId: deal.customerId,
          sourceType: SOURCE,
          settleInFinance: true,
          sourceId: id,
          categoryKey: 'products',
        });
      }
      if (deal.paymentType === 'financing' && totals.financed > 0) {
        await this.finance.recordInTx(tx, {
          kind: 'income',
          status: 'pending',
          description: `Venda ${title} — repasse do financiamento (${bankName})`,
          amount: totals.financed / 100,
          dueDate: plusDays(today, 7),
          customerId: deal.customerId,
          sourceType: SOURCE,
          settleInFinance: true,
          sourceId: id,
          categoryKey: 'products',
        });
      }
      const trade = deal.tradeIn as DealInput['tradeIn'];
      if (trade) {
        // O carro dado na troca entra no estoque pelo valor da troca (preço de venda a definir).
        await tx.insert(vehVehicles).values({
          tenantId,
          kind: 'car',
          brand: trade.brand,
          model: trade.model,
          yearManufacture: trade.yearModel,
          yearModel: trade.yearModel,
          plate: trade.plate?.replace('-', '') || null,
          km: trade.km ?? 0,
          fuel: 'flex',
          transmission: 'manual',
          cost: centsToDecimal(toCents(trade.value)),
          price: centsToDecimal(toCents(trade.value)),
          status: 'inactive',
          notes: `Entrou na troca da negociação nº ${deal.number}. Revisar dados e preço antes de anunciar.`,
        });
      }
      await tx.update(vehVehicles).set({ status: 'sold' }).where(eq(vehVehicles.id, deal.vehicleId));
      await tx.update(vehDeals).set({ status: 'closed', closedAt: new Date() }).where(eq(vehDeals.id, id));
      await this.customers.addTimeline(tx, { customerId: deal.customerId, moduleKey: MODULE, type: 'deal.closed', title: `Comprou ${title}`, entity: 'veh_deal', entityId: id });
      await this.audit.log(tx, { action: 'vehicles.deal.closed', entity: 'veh_deal', entityId: id });
      return this.dealDetail(tx, id);
    });
  }

  loseDeal(id: string, reason: string): Promise<Deal> {
    return this.tdb.run(async (tx) => {
      const deal = await this.dealOrFail(tx, id, true);
      if (deal.status === 'closed' || deal.status === 'lost') throw badRequest('DEAL_CLOSED', 'Negociação já encerrada');
      const pending = (await this.banking.proposalsForInTx(tx, SOURCE, id)).some((p) => ['submitted', 'under_review', 'approved'].includes(p.status));
      if (pending) throw badRequest('PROPOSAL_OPEN', 'Cancele a proposta de financiamento em andamento antes');
      await tx.update(vehDeals).set({ status: 'lost', lostReason: reason }).where(eq(vehDeals.id, id));
      await tx.update(vehVehicles).set({ status: 'available' }).where(and(eq(vehVehicles.id, deal.vehicleId), eq(vehVehicles.status, 'reserved')));
      await this.audit.log(tx, { action: 'vehicles.deal.lost', entity: 'veh_deal', entityId: id, data: { reason } });
      return this.dealDetail(tx, id);
    });
  }

  /** Resposta do banco: a negociação acompanha e o cliente é avisado da aprovação. */
  private onCredit(e: ProposalUpdated) {
    if (e.sourceType !== SOURCE) return Promise.resolve();
    return this.tdb.run(async (tx) => {
      const [deal] = await tx.select().from(vehDeals).where(and(eq(vehDeals.id, e.sourceId), ne(vehDeals.status, 'closed'), ne(vehDeals.status, 'lost')));
      if (!deal) return;
      const next: DealStatus | null =
        e.status === 'approved' || e.status === 'contracted' ? 'credit_approved' : e.status === 'rejected' ? 'credit_rejected' : e.status === 'cancelled' ? 'negotiating' : 'credit_analysis';
      if (next === deal.status) return;
      await tx.update(vehDeals).set({ status: next }).where(eq(vehDeals.id, deal.id));
      const [vehicle] = await tx.select().from(vehVehicles).where(eq(vehVehicles.id, deal.vehicleId));
      const proposal = (await this.banking.proposalsForInTx(tx, SOURCE, deal.id)).find((p) => p.id === e.proposalId);
      await this.customers.addTimeline(tx, {
        customerId: deal.customerId,
        moduleKey: MODULE,
        type: `deal.${next}`,
        title: `${creditProductLabel[e.product]} (${proposal?.institution ?? 'banco'}): ${next === 'credit_approved' ? 'aprovado' : next === 'credit_rejected' ? 'recusado' : 'em análise'}`,
        entity: 'veh_deal',
        entityId: deal.id,
      });
      if (next === 'credit_approved' && e.status === 'approved') {
        await this.notifications.enqueueInTx(tx, {
          templateKey: 'vehicles.credit_approved',
          customerId: deal.customerId,
          related: { entity: 'veh_deal', id: deal.id },
          data: { veiculo: { nome: vehicleTitle(vehicle!) }, credito: { instituicao: proposal?.institution ?? '' } },
        });
      }
    });
  }

  // ---- internos -------------------------------------------------------------------------------

  private async toVehicles(tx: Tx, rows: VehicleRow[]): Promise<Vehicle[]> {
    const photos = await this.files.listByOwners(tx, FILE_OWNER, rows.map((r) => r.id));
    const canSeeCost = requestContext.get()?.permissions?.has('vehicles.costs.read') ?? false;
    const now = Date.now();
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      brand: r.brand,
      model: r.model,
      version: r.version,
      yearManufacture: r.yearManufacture,
      yearModel: r.yearModel,
      plate: r.plate,
      color: r.color,
      km: r.km,
      fuel: r.fuel,
      transmission: r.transmission,
      fipeCode: r.fipeCode,
      fipePrice: r.fipePrice === null ? null : Number(r.fipePrice),
      cost: canSeeCost && r.cost !== null ? Number(r.cost) : null,
      price: Number(r.price),
      status: r.status,
      notes: r.notes,
      photos: photos.filter((p) => p.ownerId === r.id).map((p) => ({ id: p.id })),
      daysInStock: Math.floor((now - r.createdAt.getTime()) / 86_400_000),
      createdAt: r.createdAt.toISOString(),
    }));
  }

  private dealQuery(tx: Tx) {
    return tx
      .select({
        d: vehDeals,
        customer: { id: customers.id, name: customers.name, phone: customers.phone, email: customers.email, document: customers.document },
        vehicle: vehVehicles,
        sellerName: coreSchema.users.name,
      })
      .from(vehDeals)
      .innerJoin(customers, eq(customers.id, vehDeals.customerId))
      .innerJoin(vehVehicles, eq(vehVehicles.id, vehDeals.vehicleId))
      .leftJoin(coreSchema.users, eq(coreSchema.users.id, vehDeals.sellerId))
      .$dynamic();
  }

  private async dealDetail(tx: Tx, id: string) {
    const [row] = await this.dealQuery(tx).where(eq(vehDeals.id, id));
    if (!row) throw new NotFoundException({ code: 'DEAL_NOT_FOUND', message: 'Negociação não encontrada' });
    return toDeal(row);
  }

  private async dealOrFail(tx: Tx, id: string, lock = false) {
    const q = tx.select().from(vehDeals).where(eq(vehDeals.id, id));
    const [row] = lock ? await q.for('update') : await q;
    if (!row) throw new NotFoundException({ code: 'DEAL_NOT_FOUND', message: 'Negociação não encontrada' });
    return row;
  }

  private async vehicleOrFail(tx: Tx, id: string) {
    const [row] = await tx.select().from(vehVehicles).where(eq(vehVehicles.id, id));
    if (!row) throw new NotFoundException({ code: 'VEHICLE_NOT_FOUND', message: 'Veículo não encontrado' });
    return row;
  }
}

function checkAmounts(input: Pick<DealInput, 'price' | 'discount' | 'downPayment' | 'tradeIn' | 'paymentType'>) {
  const net = toCents(input.price) - toCents(input.discount);
  if (net <= 0) throw badRequest('INVALID_DISCOUNT', 'Desconto maior que o preço');
  const covered = toCents(input.downPayment) + toCents(input.tradeIn?.value ?? 0);
  if (covered > net) throw badRequest('INVALID_DOWN_PAYMENT', 'Entrada e troca passam do valor da venda');
  if (input.paymentType === 'financing' && covered === net) throw badRequest('NOTHING_TO_FINANCE', 'Não sobra valor para financiar');
}

/** Valores da negociação em centavos. */
function dealTotals(d: DealRow) {
  const net = toCents(d.price) - toCents(d.discount);
  const tradeIn = toCents((d.tradeIn as { value?: number } | null)?.value ?? 0);
  const downPayment = toCents(d.downPayment);
  const financed = d.paymentType === 'financing' ? net - tradeIn - downPayment : 0;
  return { net, tradeIn, downPayment, financed };
}

function toDeal(row: { d: DealRow; customer: Deal['customer']; vehicle: VehicleRow; sellerName: string | null }): Deal {
  const { d } = row;
  return {
    id: d.id,
    number: d.number,
    customer: row.customer,
    vehicle: { id: row.vehicle.id, title: vehicleTitle(row.vehicle), plate: row.vehicle.plate, price: Number(row.vehicle.price) },
    price: Number(d.price),
    discount: Number(d.discount),
    tradeIn: (d.tradeIn as Deal['tradeIn']) ?? null,
    downPayment: Number(d.downPayment),
    paymentType: d.paymentType,
    financedAmount: dealTotals(d).financed / 100,
    status: d.status,
    lostReason: d.lostReason,
    sellerName: row.sellerName,
    notes: d.notes,
    closedAt: d.closedAt?.toISOString() ?? null,
    createdAt: d.createdAt.toISOString(),
  };
}

function vehicleRow(input: VehicleInput) {
  return {
    kind: input.kind,
    brand: input.brand,
    model: input.model,
    version: input.version ?? null,
    yearManufacture: input.yearManufacture,
    yearModel: input.yearModel,
    plate: input.plate ?? null,
    color: input.color ?? null,
    km: input.km,
    fuel: input.fuel,
    transmission: input.transmission,
    fipeCode: input.fipeCode ?? null,
    fipePrice: input.fipePrice != null ? centsToDecimal(toCents(input.fipePrice)) : null,
    cost: input.cost != null ? centsToDecimal(toCents(input.cost)) : null,
    price: centsToDecimal(toCents(input.price)),
    status: input.status,
    notes: input.notes ?? null,
  };
}

