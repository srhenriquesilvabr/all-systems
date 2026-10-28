import { CepHttp, companyLogoUrl, FilesService, ModuleSettingsService, TenancyService, TenantDb } from '@all/core';
import type { Tx } from '@all/db';
import { requestContext } from '@all/module-sdk';
import { BadRequestException, ConflictException, HttpException, HttpStatus, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { and, asc, count, desc, eq, gt, inArray } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import {
  CONSENT_VERSION,
  consentText,
  effectivePrice,
  fractionalUnits,
  normalizePhone,
  STORE,
  type ConsentRecord,
  type PlacedOrder,
  type PublicOrderInput,
  type PublicProduct,
  type PublicStore,
  type StoreSettings,
} from '../contracts';
import { storeListingPhotos, storeListings, storeOrders } from '../db/schema';
import { StoreCatalogService } from './catalog.service';
import { StoreOrdersService } from './orders.service';
import { StorePaymentProviders } from './payments';
import { BANNER_OWNER, bannerUrl, currentTenant, moduleActive, PHOTO_OWNER, photoUrl, reservedByProduct, salesProducts } from './shared';

/** Limites de pedidos pela vitrine (por empresa). */
const MAX_PER_IP_HOUR = 10;
const MAX_PER_PHONE_DAY = 10;
/** Pedido enviado antes disto (desde que a página abriu) é de robô. */
const MIN_FILL_MS = 3000;
/** Vitrine com muitos produtos: as lojinhas são pequenas, o resto fica de fora. */
const MAX_PRODUCTS = 500;

type Tenant = NonNullable<Awaited<ReturnType<TenancyService['tenantBySlug']>>>;

/**
 * Vitrine pública (/loja/<slug>): catálogo, fotos, busca de CEP e pedido sem login. Só funciona
 * com o módulo ativo; pausada, mostra os produtos mas não aceita pedidos.
 */
@Injectable()
export class StorePublicService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly tdb: TenantDb,
    private readonly settings: ModuleSettingsService,
    private readonly files: FilesService,
    private readonly orders: StoreOrdersService,
    private readonly catalog: StoreCatalogService,
    private readonly payments: StorePaymentProviders,
    private readonly cep: CepHttp,
  ) {}

  storefront(slug: string): Promise<PublicStore> {
    return this.withTenant(slug, (tenant, settings) =>
      this.tdb.run(async (tx) => {
        const [products, banner, paymentModes] = await Promise.all([
          this.publicProducts(tx, tenant.slug ?? slug, settings),
          this.catalog.bannerInTx(tx, tenant.id),
          this.payments.availableModes(tx, settings.paymentModes),
        ]);
        return {
          company: { name: tenant.name, logoUrl: companyLogoUrl(tenant), brandColor: tenant.brandColor },
          slug: tenant.slug ?? slug,
          open: settings.open,
          pausedMessage: settings.pausedMessage,
          welcome: settings.welcome,
          bannerUrl: banner ? bannerUrl(tenant.slug ?? slug, banner.id) : null,
          exchangePolicy: settings.exchangePolicy,
          pickup: settings.pickup,
          delivery: settings.delivery,
          paymentModes,
          consent: { version: CONSENT_VERSION, text: consentText({ company: tenant.name, privacyEmail: settings.privacyEmail || null }) },
          categories: [...new Set(products.flatMap((p) => (p.category ? [p.category] : [])))].sort((a, b) => a.localeCompare(b, 'pt-BR')),
          products,
        };
      }),
    );
  }

  /** Foto de um anúncio publicado. */
  photo(slug: string, fileId: string) {
    return this.withTenant(slug, async () => {
      const [found] = await this.tdb.run((tx) =>
        tx
          .select({ id: storeListingPhotos.id })
          .from(storeListingPhotos)
          .innerJoin(storeListings, eq(storeListings.id, storeListingPhotos.listingId))
          .where(and(eq(storeListingPhotos.fileId, fileId), eq(storeListings.visible, true))),
      );
      if (!found) throw new NotFoundException({ code: 'PHOTO_NOT_FOUND', message: 'Foto não encontrada' });
      return this.files.open(fileId, PHOTO_OWNER);
    });
  }

  /** Banner atual da loja (`fileId` para o cache). */
  banner(slug: string) {
    return this.withTenant(slug, async (tenant) => {
      const banner = await this.tdb.run((tx) => this.catalog.bannerInTx(tx, tenant.id));
      if (!banner) throw new NotFoundException({ code: 'BANNER_NOT_FOUND', message: 'Esta loja não tem banner' });
      return { fileId: banner.id, ...(await this.files.open(banner.id, BANNER_OWNER)) };
    });
  }

  /** Busca de CEP para o endereço de entrega, sem login (mesmo serviço do cadastro). */
  async lookupCep(slug: string, raw: string) {
    const cep = raw.replace(/\D/g, '');
    if (cep.length !== 8) throw new BadRequestException({ code: 'INVALID_CEP', message: 'O CEP tem 8 dígitos' });
    await this.withTenant(slug, async () => undefined);
    let result: Awaited<ReturnType<CepHttp['get']>>;
    try {
      result = await this.cep.get(cep);
    } catch {
      throw new ServiceUnavailableException({ code: 'CEP_UNAVAILABLE', message: 'A busca de CEP não respondeu. Preencha o endereço à mão.' });
    }
    const body = result.body;
    if (result.status === 400 || (result.status === 200 && (!body || body.erro === true || body.erro === 'true'))) {
      throw new NotFoundException({ code: 'CEP_NOT_FOUND', message: 'CEP não encontrado' });
    }
    if (!body) throw new ServiceUnavailableException({ code: 'CEP_UNAVAILABLE', message: 'A busca de CEP não respondeu. Preencha o endereço à mão.' });
    return {
      zip: `${cep.slice(0, 5)}-${cep.slice(5)}`,
      street: body.logradouro ?? '',
      district: body.bairro ?? '',
      city: body.localidade ?? '',
      state: (body.uf ?? '').toUpperCase(),
      complement: body.complemento ?? '',
    };
  }

  /** Pedido pela vitrine. Robô (campo escondido ou envio instantâneo) recebe "ok" sem nada gravado. */
  place(slug: string, input: PublicOrderInput, ip: string | undefined): Promise<PlacedOrder> {
    if (input.website || (input.startedAt && Date.now() - input.startedAt < MIN_FILL_MS)) return Promise.resolve({ ok: true });
    return this.withTenant(slug, (tenant, settings) =>
      this.tdb.run(async (tx) => {
        const { tenantId } = requestContext.requireTenant();
        if (!settings.open) throw new ConflictException({ code: 'STORE_CLOSED', message: settings.pausedMessage || 'A loja não está recebendo pedidos agora' });
        if (input.consentVersion !== CONSENT_VERSION) {
          throw new BadRequestException({ code: 'CONSENT_OUTDATED', message: 'O texto de uso dos dados mudou. Recarregue a página e confira antes de enviar.' });
        }
        const modes = await this.payments.availableModes(tx, settings.paymentModes);
        const provider = this.payments.get(input.paymentMode);
        if (!modes.includes(input.paymentMode) || !provider) {
          throw new BadRequestException({ code: 'PAYMENT_MODE_UNAVAILABLE', message: 'Esta forma de finalizar não está disponível. Escolha outra.' });
        }
        const ipHash = ip ? createHash('sha256').update(`${tenantId}:${ip}`).digest('hex').slice(0, 32) : null;
        await this.checkLimits(tx, ipHash, normalizePhone(input.phone));

        const company = await currentTenant(tx, tenantId);
        const consent: ConsentRecord = {
          version: CONSENT_VERSION,
          text: consentText({ company: tenant.name, privacyEmail: settings.privacyEmail || null }),
          acceptedAt: new Date().toISOString(),
          ip: ip ?? null,
        };
        const { order, items } = await this.orders.placeInTx(tx, input, { source: 'public', settings, consent, ipHash });
        const next = await provider.checkoutInTx(tx, {
          tenantId,
          company: { name: tenant.name, slug: tenant.slug ?? slug, whatsapp: settings.whatsapp || company.phone },
          order: {
            id: order.id,
            number: order.number,
            customerName: order.customerName,
            customerPhone: order.customerPhone!,
            customerEmail: order.customerEmail,
            items: items.map((i) => ({ productId: i.productId, name: i.name, quantity: Number(i.quantity), unit: i.unit, unitPrice: Number(i.unitPrice), total: Number(i.total) })),
            subtotal: Number(order.subtotal),
            deliveryFee: Number(order.deliveryFee),
            total: Number(order.total),
            fulfillment: order.fulfillment,
            address: order.address,
            paymentMode: order.paymentMode,
            notes: order.notes,
          },
        });
        return { ok: true, order: { id: order.id, number: order.number, total: Number(order.total), paymentMode: order.paymentMode }, next };
      }),
    );
  }

  private async publicProducts(tx: Tx, slug: string, settings: StoreSettings): Promise<PublicProduct[]> {
    const rows = await tx
      .select({ l: storeListings, p: salesProducts })
      .from(storeListings)
      .innerJoin(salesProducts, eq(salesProducts.id, storeListings.productId))
      .where(and(eq(storeListings.visible, true), eq(salesProducts.active, true)))
      .orderBy(desc(storeListings.featured), asc(salesProducts.name))
      .limit(MAX_PRODUCTS);
    if (!rows.length) return [];
    const [photos, reserved] = await Promise.all([
      tx
        .select({ listingId: storeListingPhotos.listingId, fileId: storeListingPhotos.fileId })
        .from(storeListingPhotos)
        .where(
          inArray(
            storeListingPhotos.listingId,
            rows.map((r) => r.l.id),
          ),
        )
        .orderBy(asc(storeListingPhotos.position), asc(storeListingPhotos.createdAt)),
      reservedByProduct(
        tx,
        rows.map((r) => r.p.id),
      ),
    ]);
    const out: PublicProduct[] = [];
    for (const { l, p } of rows) {
      const available = p.trackStock ? Number(p.stock) - (reserved.get(p.id) ?? 0) : null;
      const max = available === null ? null : fractionalUnits.includes(p.unit) ? Math.floor(available * 1000) / 1000 : Math.floor(available);
      const soldOut = max !== null && max <= 0;
      if (soldOut && settings.outOfStock === 'hide') continue;
      const price = Number(p.price);
      const promo = { promoPrice: l.promoPrice == null ? null : Number(l.promoPrice), promoUntil: l.promoUntil };
      const finalPrice = effectivePrice(price, promo);
      out.push({
        id: p.id,
        title: l.title || p.name,
        description: l.description,
        category: l.category || p.category,
        unit: p.unit,
        price,
        finalPrice,
        promoUntil: finalPrice < price ? l.promoUntil : null,
        featured: l.featured,
        photos: photos.filter((ph) => ph.listingId === l.id).map((ph) => photoUrl(slug, ph.fileId)),
        soldOut,
        maxQuantity: max === null ? null : Math.max(max, 0),
      });
    }
    return out;
  }

  /** Limite por IP (hora) e por celular (dia), contados nos pedidos da empresa. */
  private async checkLimits(tx: Tx, ipHash: string | null, phone: string | null) {
    const hourAgo = new Date(Date.now() - 60 * 60_000);
    const dayAgo = new Date(Date.now() - 24 * 60 * 60_000);
    if (ipHash) {
      const [{ n }] = (await tx.select({ n: count() }).from(storeOrders).where(and(eq(storeOrders.ipHash, ipHash), gt(storeOrders.createdAt, hourAgo)))) as [{ n: number }];
      if (n >= MAX_PER_IP_HOUR) throw tooMany();
    }
    if (phone) {
      const [{ n }] = (await tx
        .select({ n: count() })
        .from(storeOrders)
        .where(and(eq(storeOrders.customerPhone, phone), eq(storeOrders.source, 'public'), gt(storeOrders.createdAt, dayAgo)))) as [{ n: number }];
      if (n >= MAX_PER_PHONE_DAY) throw tooMany();
    }
  }

  /** Resolve a empresa pelo slug e roda no escopo dela, sem usuário logado. */
  private async withTenant<T>(slug: string, fn: (tenant: Tenant, settings: StoreSettings) => Promise<T>): Promise<T> {
    const ip = requestContext.get().ip;
    const tenant = await this.tenancy.tenantBySlug(slug);
    if (!tenant) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Loja não encontrada' });
    return requestContext.run({ tenantId: tenant.id, modules: new Set([STORE]), ip }, async () => {
      const settings = await this.tdb.run(async (tx) => ((await moduleActive(tx, STORE)) ? this.settings.getInTx<StoreSettings>(tx, STORE) : null));
      if (!settings) throw new NotFoundException({ code: 'STORE_NOT_FOUND', message: 'Esta empresa não tem loja online aqui' });
      return fn(tenant, settings);
    });
  }
}

const tooMany = () => new HttpException({ code: 'TOO_MANY_ORDERS', message: 'Muitos pedidos seguidos. Tente de novo mais tarde ou fale com a loja.' }, HttpStatus.TOO_MANY_REQUESTS);
