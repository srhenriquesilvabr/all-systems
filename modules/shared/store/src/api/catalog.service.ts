import { AuditService, CoreConfig, FilesService, ModuleSettingsService, TenantDb, centsToDecimal, toCents, type UploadedFile } from '@all/core';
import type { Tx } from '@all/db';
import { requestContext } from '@all/module-sdk';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, ilike, inArray, isNotNull, isNull, max, or, sql } from 'drizzle-orm';
import { STORE, type Listing, type ListingImportInput, type ListingInput, type StoreProduct, type StoreSettings } from '../contracts';
import { storeListingPhotos, storeListings } from '../db/schema';
import { StorePaymentProviders } from './payments';
import { BANNER_OWNER, currentTenant, extOf, MAX_BANNER_BYTES, MAX_PHOTO_BYTES, MAX_PHOTOS, moduleActive, PHOTO_OWNER, reservedByProduct, salesProducts, sniffImage, storeUrl, type ProductRow } from './shared';

const badRequest = (code: string, message: string) => new BadRequestException({ code, message });
type ListingRow = typeof storeListings.$inferSelect;

/** Anúncios (produto do PDV na loja), fotos, banner e configurações da loja. */
@Injectable()
export class StoreCatalogService {
  constructor(
    private readonly tdb: TenantDb,
    private readonly files: FilesService,
    private readonly audit: AuditService,
    private readonly settings: ModuleSettingsService,
    private readonly payments: StorePaymentProviders,
    private readonly config: CoreConfig,
  ) {}

  /** Endereço público, situação e o que está ligado (cabeçalho das telas). */
  status() {
    const { tenantId } = requestContext.requireTenant();
    return this.tdb.run(async (tx) => {
      const [tenant, settings, banner] = await Promise.all([currentTenant(tx, tenantId), this.settings.getInTx<StoreSettings>(tx, STORE), this.bannerInTx(tx, tenantId)]);
      const online = this.payments.get('online');
      return {
        slug: tenant.slug,
        publicUrl: tenant.slug ? storeUrl(this.config.adminUrl, tenant.slug) : null,
        open: settings.open,
        companyPhone: tenant.phone,
        notifications: await moduleActive(tx, 'shared.notifications'),
        whatsappApi: await moduleActive(tx, 'integration.whatsapp'),
        paymentModes: await this.payments.availableModes(tx, settings.paymentModes),
        onlinePaymentAvailable: online ? await online.available(tx) : false,
        bannerFileId: banner?.id ?? null,
      };
    });
  }

  getSettings() {
    return this.settings.get(STORE);
  }

  saveSettings(body: unknown) {
    return this.settings.save(STORE, body);
  }

  /** Produtos do PDV (ativos, ou já anunciados) com o anúncio, as fotos e o estoque disponível. */
  products(q: { q?: string; listed?: boolean; limit: number }): Promise<StoreProduct[]> {
    return this.tdb.run(async (tx) => {
      const term = q.q?.trim();
      const like = term ? `%${term.replace(/[%_\\]/g, (c) => `\\${c}`)}%` : undefined;
      const rows = await tx
        .select({ p: salesProducts, l: storeListings })
        .from(salesProducts)
        .leftJoin(storeListings, eq(storeListings.productId, salesProducts.id))
        .where(
          and(
            or(eq(salesProducts.active, true), isNotNull(storeListings.id)),
            like
              ? or(ilike(salesProducts.name, like), ilike(storeListings.title, like), ilike(salesProducts.category, like), ilike(storeListings.category, like), eq(salesProducts.barcode, term!), eq(salesProducts.sku, term!))
              : undefined,
            q.listed === true ? isNotNull(storeListings.id) : q.listed === false ? isNull(storeListings.id) : undefined,
          ),
        )
        .orderBy(asc(salesProducts.name))
        .limit(q.limit);
      return this.toProducts(tx, rows);
    });
  }

  /** Categorias já usadas (loja e PDV), para sugerir no cadastro. */
  categories(): Promise<string[]> {
    return this.tdb.run(async (tx) => {
      const rows = await tx.execute<{ category: string }>(sql`
        select distinct category from (
          select category from store_listings where category is not null
          union select category from sales_products where category is not null and active
        ) c order by category`);
      return rows.rows.map((r) => r.category);
    });
  }

  saveListing(productId: string, input: ListingInput): Promise<StoreProduct> {
    return this.tdb.run(async (tx) => {
      const product = await this.productOrFail(tx, productId);
      return this.saveListingInTx(tx, product, input);
    });
  }

  /** Linha da planilha: acha o produto pelo código de barras, código interno ou nome exato. */
  importListing(input: ListingImportInput): Promise<StoreProduct> {
    return this.tdb.run(async (tx) => {
      const ref = input.product.trim();
      const matches = await tx
        .select()
        .from(salesProducts)
        .where(or(eq(salesProducts.barcode, ref), sql`lower(${salesProducts.sku}) = lower(${ref})`, sql`lower(${salesProducts.name}) = lower(${ref})`))
        .limit(3);
      if (!matches.length) throw badRequest('PRODUCT_NOT_FOUND', `Produto "${ref}" não encontrado no PDV (use o código de barras, o código interno ou o nome exato)`);
      if (matches.length > 1) throw badRequest('AMBIGUOUS_PRODUCT', `Há mais de um produto "${ref}" no PDV: use o código de barras ou o código interno`);
      const { product: _ref, ...listing } = input;
      return this.saveListingInTx(tx, matches[0]!, listing);
    });
  }

  async addPhoto(productId: string, file: UploadedFile): Promise<StoreProduct> {
    const mime = sniffImage(file.buffer);
    if (!mime) throw badRequest('INVALID_FILE_TYPE', 'Envie a foto em JPG, PNG ou WebP');
    if (file.size > MAX_PHOTO_BYTES || file.buffer.length > MAX_PHOTO_BYTES) throw badRequest('FILE_TOO_LARGE', 'A foto pode ter no máximo 5 MB');
    const { tenantId } = requestContext.requireTenant();
    return this.tdb.run(async (tx) => {
      const product = await this.productOrFail(tx, productId);
      const listing = await this.ensureListing(tx, tenantId, product.id);
      const [{ n, last }] = (await tx
        .select({ n: sql<number>`count(*)::int`, last: max(storeListingPhotos.position) })
        .from(storeListingPhotos)
        .where(eq(storeListingPhotos.listingId, listing.id))) as [{ n: number; last: number | null }];
      if (n >= MAX_PHOTOS) throw badRequest('TOO_MANY_PHOTOS', `Cada anúncio pode ter até ${MAX_PHOTOS} fotos`);
      const saved = await this.files.saveImageInTx(tx, { ...file, mimetype: mime, originalname: `foto-${n + 1}.${extOf(mime)}` }, { entity: PHOTO_OWNER, id: listing.id });
      await tx.insert(storeListingPhotos).values({ tenantId, listingId: listing.id, fileId: saved.id, position: (last ?? -1) + 1 });
      await this.audit.log(tx, { action: 'store.listing.photo_added', entity: 'store_listing', entityId: listing.id, data: { fileId: saved.id } });
      return this.productInTx(tx, product.id);
    });
  }

  removePhoto(productId: string, fileId: string): Promise<StoreProduct> {
    return this.tdb.run(async (tx) => {
      const listing = await this.listingOrFail(tx, productId);
      const [photo] = await tx
        .delete(storeListingPhotos)
        .where(and(eq(storeListingPhotos.listingId, listing.id), eq(storeListingPhotos.fileId, fileId)))
        .returning();
      if (!photo) throw new NotFoundException({ code: 'PHOTO_NOT_FOUND', message: 'Foto não encontrada' });
      await this.files.removeInTx(tx, fileId, { entity: PHOTO_OWNER, id: listing.id }).catch((err: unknown) => {
        if (!(err instanceof NotFoundException)) throw err;
      });
      await this.audit.log(tx, { action: 'store.listing.photo_removed', entity: 'store_listing', entityId: listing.id, data: { fileId } });
      return this.productInTx(tx, productId);
    });
  }

  /** Nova ordem da galeria: a primeira foto é a capa. Precisa listar todas as fotos do anúncio. */
  reorderPhotos(productId: string, fileIds: string[]): Promise<StoreProduct> {
    return this.tdb.run(async (tx) => {
      const listing = await this.listingOrFail(tx, productId);
      const current = await tx.select().from(storeListingPhotos).where(eq(storeListingPhotos.listingId, listing.id)).for('update');
      const same = current.length === fileIds.length && new Set(fileIds).size === fileIds.length && fileIds.every((id) => current.some((p) => p.fileId === id));
      if (!same) throw badRequest('PHOTOS_CHANGED', 'As fotos do anúncio mudaram. Recarregue a página.');
      for (const [position, fileId] of fileIds.entries()) {
        await tx.update(storeListingPhotos).set({ position }).where(eq(storeListingPhotos.fileId, fileId));
      }
      return this.productInTx(tx, productId);
    });
  }

  async setBanner(file: UploadedFile) {
    const mime = sniffImage(file.buffer);
    if (!mime) throw badRequest('INVALID_FILE_TYPE', 'Envie o banner em JPG, PNG ou WebP');
    if (file.size > MAX_BANNER_BYTES || file.buffer.length > MAX_BANNER_BYTES) throw badRequest('FILE_TOO_LARGE', 'O banner pode ter no máximo 5 MB');
    const { tenantId } = requestContext.requireTenant();
    return this.tdb.run(async (tx) => {
      // Trava a sequência de banners da empresa: dois envios ao mesmo tempo não deixam dois banners.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`store.banner:${tenantId}`}))`);
      const previous = await this.files.listByOwners(tx, BANNER_OWNER, [tenantId]);
      const saved = await this.files.saveImageInTx(tx, { ...file, mimetype: mime, originalname: `banner.${extOf(mime)}` }, { entity: BANNER_OWNER, id: tenantId });
      await this.audit.log(tx, { action: 'store.banner_updated', entity: 'store', entityId: tenantId, data: { fileId: saved.id } });
      for (const old of previous) await this.files.removeInTx(tx, old.id, { entity: BANNER_OWNER, id: tenantId });
      return { bannerFileId: saved.id };
    });
  }

  removeBanner() {
    const { tenantId } = requestContext.requireTenant();
    return this.tdb.run(async (tx) => {
      const previous = await this.files.listByOwners(tx, BANNER_OWNER, [tenantId]);
      for (const old of previous) await this.files.removeInTx(tx, old.id, { entity: BANNER_OWNER, id: tenantId });
      if (previous.length) await this.audit.log(tx, { action: 'store.banner_removed', entity: 'store', entityId: tenantId });
    });
  }

  /** Banner atual (o mais recente). */
  async bannerInTx(tx: Tx, tenantId: string) {
    const list = await this.files.listByOwners(tx, BANNER_OWNER, [tenantId]);
    return list.at(-1) ?? null;
  }

  // ---- internos -------------------------------------------------------------------------------

  private async saveListingInTx(tx: Tx, product: ProductRow, input: ListingInput): Promise<StoreProduct> {
    const { tenantId } = requestContext.requireTenant();
    if (input.visible && !product.active) throw badRequest('PRODUCT_INACTIVE', `${product.name} está inativo no PDV: ative o produto antes de publicar`);
    if (input.promoPrice != null && toCents(input.promoPrice) >= toCents(product.price)) {
      throw badRequest('INVALID_PROMO', 'O preço promocional precisa ser menor que o preço do produto');
    }
    if (input.promoPrice == null && input.promoUntil) throw badRequest('INVALID_PROMO', 'Informe o preço promocional ou apague a validade');
    const values = {
      visible: input.visible,
      title: input.title,
      description: input.description,
      category: input.category,
      featured: input.featured,
      promoPrice: input.promoPrice == null ? null : centsToDecimal(toCents(input.promoPrice)),
      promoUntil: input.promoUntil,
    };
    const [before] = await tx.select().from(storeListings).where(eq(storeListings.productId, product.id));
    const [saved] = await tx
      .insert(storeListings)
      .values({ tenantId, productId: product.id, ...values })
      .onConflictDoUpdate({ target: [storeListings.tenantId, storeListings.productId], set: { ...values, updatedAt: new Date() } })
      .returning();
    // Publicar/tirar da loja e mexer no preço promocional ficam na auditoria.
    const changes: Record<string, unknown> = {};
    if ((before?.visible ?? false) !== saved!.visible) changes.visible = saved!.visible;
    if ((before?.promoPrice ?? null) !== saved!.promoPrice || (before?.promoUntil ?? null) !== saved!.promoUntil) {
      changes.promo = { from: before?.promoPrice == null ? null : Number(before.promoPrice), to: input.promoPrice, until: input.promoUntil };
    }
    await this.audit.log(tx, { action: before ? 'store.listing.updated' : 'store.listing.created', entity: 'store_listing', entityId: saved!.id, data: Object.keys(changes).length ? changes : undefined });
    return this.productInTx(tx, product.id);
  }

  private async ensureListing(tx: Tx, tenantId: string, productId: string): Promise<ListingRow> {
    await tx.insert(storeListings).values({ tenantId, productId }).onConflictDoNothing({ target: [storeListings.tenantId, storeListings.productId] });
    const [row] = await tx.select().from(storeListings).where(eq(storeListings.productId, productId)).for('update');
    return row!;
  }

  private async listingOrFail(tx: Tx, productId: string): Promise<ListingRow> {
    const [row] = await tx.select().from(storeListings).where(eq(storeListings.productId, productId));
    if (!row) throw new NotFoundException({ code: 'LISTING_NOT_FOUND', message: 'Este produto ainda não tem anúncio' });
    return row;
  }

  private async productOrFail(tx: Tx, id: string): Promise<ProductRow> {
    const [row] = await tx.select().from(salesProducts).where(eq(salesProducts.id, id));
    if (!row) throw new NotFoundException({ code: 'PRODUCT_NOT_FOUND', message: 'Produto não encontrado' });
    return row;
  }

  private async productInTx(tx: Tx, productId: string): Promise<StoreProduct> {
    const rows = await tx
      .select({ p: salesProducts, l: storeListings })
      .from(salesProducts)
      .leftJoin(storeListings, eq(storeListings.productId, salesProducts.id))
      .where(eq(salesProducts.id, productId));
    const [product] = await this.toProducts(tx, rows);
    if (!product) throw new ConflictException({ code: 'PRODUCT_NOT_FOUND', message: 'Produto não encontrado' });
    return product;
  }

  private async toProducts(tx: Tx, rows: { p: ProductRow; l: ListingRow | null }[]): Promise<StoreProduct[]> {
    const listingIds = rows.flatMap((r) => (r.l ? [r.l.id] : []));
    const [photos, reserved] = await Promise.all([
      listingIds.length
        ? tx.select().from(storeListingPhotos).where(inArray(storeListingPhotos.listingId, listingIds)).orderBy(asc(storeListingPhotos.position), asc(storeListingPhotos.createdAt))
        : Promise.resolve([]),
      reservedByProduct(
        tx,
        rows.map((r) => r.p.id),
      ),
    ]);
    return rows.map(({ p, l }) => {
      const held = reserved.get(p.id) ?? 0;
      return {
        productId: p.id,
        name: p.name,
        category: p.category,
        sku: p.sku,
        barcode: p.barcode,
        unit: p.unit,
        price: Number(p.price),
        active: p.active,
        trackStock: p.trackStock,
        stock: Number(p.stock),
        reserved: held,
        available: p.trackStock ? Math.round((Number(p.stock) - held) * 1000) / 1000 : null,
        listing: l ? toListing(l, photos.filter((ph) => ph.listingId === l.id)) : null,
      };
    });
  }
}

function toListing(l: ListingRow, photos: { fileId: string }[]): Listing {
  return {
    id: l.id,
    visible: l.visible,
    title: l.title,
    description: l.description,
    category: l.category,
    featured: l.featured,
    promoPrice: l.promoPrice == null ? null : Number(l.promoPrice),
    promoUntil: l.promoUntil,
    photos: photos.map((p) => ({ fileId: p.fileId })),
    updatedAt: l.updatedAt.toISOString(),
  };
}
