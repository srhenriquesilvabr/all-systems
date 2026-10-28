import { coreSchema } from '@all/core';
import type { Tx } from '@all/db';
import { salesSchema } from '@all/sales';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { reservingStatuses } from '../contracts';
import { storeOrderItems, storeOrders } from '../db/schema';

export const { salesProducts } = salesSchema;

/** Dono das fotos dos anúncios e do banner em `files`. */
export const PHOTO_OWNER = 'store_photo';
export const BANNER_OWNER = 'store_banner';
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
export const MAX_PHOTOS = 8;
export const MAX_BANNER_BYTES = 5 * 1024 * 1024;

export const ORDER_PLACED = 'store.order.placed';
export const ORDER_STATUS_CHANGED = 'store.order.status_changed';
/** Sequência do número do pedido em `tenant_sequences`. */
export const ORDER_SEQUENCE = 'store_order';
/** Origem dos lançamentos do financeiro feitos pela loja (taxa de entrega). */
export const FINANCE_SOURCE = 'store_order';

export type OrderRow = typeof storeOrders.$inferSelect;
export type ProductRow = typeof salesProducts.$inferSelect;

export type ImageMime = 'image/png' | 'image/jpeg' | 'image/webp';

/** Tipo da imagem pelos bytes (não pelo que o navegador declarou). Outros formatos: null. */
export function sniffImage(buf: Buffer): ImageMime | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

export const extOf = (mime: ImageMime) => (mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg');

/** Endereço público da loja e das imagens. */
export const storeUrl = (adminUrl: string, slug: string) => `${adminUrl.replace(/\/$/, '')}/loja/${slug}`;
export const photoUrl = (slug: string, fileId: string) => `/api/public/store/${slug}/photos/${fileId}`;
export const bannerUrl = (slug: string, fileId: string) => `/api/public/store/${slug}/banner?v=${fileId}`;

/**
 * Quantidade de cada produto segurada por pedidos confirmados e ainda em aberto. A reserva não
 * mexe no saldo do PDV: é descontada só no que a loja oferece e no que ela deixa confirmar.
 */
export async function reservedByProduct(tx: Tx, productIds?: string[], excludeOrderId?: string): Promise<Map<string, number>> {
  if (productIds && !productIds.length) return new Map();
  const rows = await tx
    .select({ productId: storeOrderItems.productId, quantity: sql<string>`sum(${storeOrderItems.quantity})` })
    .from(storeOrderItems)
    .innerJoin(storeOrders, eq(storeOrders.id, storeOrderItems.orderId))
    .where(
      and(
        inArray(storeOrders.status, [...reservingStatuses]),
        productIds ? inArray(storeOrderItems.productId, productIds) : undefined,
        excludeOrderId ? sql`${storeOrders.id} <> ${excludeOrderId}` : undefined,
      ),
    )
    .groupBy(storeOrderItems.productId);
  return new Map(rows.map((r) => [r.productId, Number(r.quantity)]));
}

/** Nome, telefone e endereço público da empresa (tenant) do contexto atual. */
export async function currentTenant(tx: Tx, tenantId: string) {
  const [t] = await tx
    .select({ name: coreSchema.tenants.name, slug: coreSchema.tenants.slug, phone: coreSchema.tenants.phone })
    .from(coreSchema.tenants)
    .where(eq(coreSchema.tenants.id, tenantId));
  return t ?? { name: '', slug: null, phone: null };
}

/** Módulo ativo na empresa do contexto (ex.: notificações, que são opcionais para a loja). */
export async function moduleActive(tx: Tx, key: string): Promise<boolean> {
  const [row] = await tx
    .select({ status: coreSchema.tenantModules.status })
    .from(coreSchema.tenantModules)
    .where(and(eq(coreSchema.tenantModules.moduleKey, key), eq(coreSchema.tenantModules.status, 'active')));
  return !!row;
}

