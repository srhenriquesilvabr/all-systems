import type { Tx } from '@all/db';
import type { ServiceOrderWorkflow } from '@all/service-orders';
import { BadRequestException } from '@nestjs/common';
import { and, count, eq, ne } from 'drizzle-orm';
import { laundryItemDetails } from '../db/schema';

export const LAUNDRY_WORKFLOW = 'laundry';

/**
 * Fluxo da ordem na lavanderia. A ordem anda sozinha conforme as peças (ver LaundryOrdersService):
 * primeira peça em produção → "Em produção"; todas prontas → "Pronta".
 */
export const laundryWorkflow: ServiceOrderWorkflow = {
  key: LAUNDRY_WORKFLOW,
  label: 'Lavanderia',
  moduleKey: 'laundry',
  customCreate: true,
  detailPath: '/lavanderia/ordens/:id',
  newPath: '/lavanderia/ordens/nova',
  initial: 'received',
  statuses: [
    { key: 'received', label: 'Recebida', tone: 'brand' },
    { key: 'in_process', label: 'Em produção', tone: 'warning' },
    { key: 'ready', label: 'Pronta', tone: 'success' },
    { key: 'out_for_delivery', label: 'Saiu para entrega', tone: 'brand' },
    { key: 'delivered', label: 'Entregue', tone: 'neutral', terminal: true },
    { key: 'cancelled', label: 'Cancelada', tone: 'danger', terminal: true, cancelled: true },
  ],
  transitions: {
    received: ['in_process', 'cancelled'],
    in_process: ['ready', 'cancelled'],
    ready: ['delivered', 'out_for_delivery', 'in_process'],
    out_for_delivery: ['delivered', 'ready'],
    delivered: [],
    cancelled: [],
  },
  notify: {
    received: 'laundry.order.received',
    ready: 'laundry.order.ready',
    out_for_delivery: 'laundry.order.out_for_delivery',
    delivered: 'laundry.order.delivered',
  },
  /** "Pronta" só com todas as peças prontas: evita avisar o cliente antes da hora. */
  async beforeTransition({ tx, orderId, to }) {
    if (to !== 'ready') return;
    const [pending] = await (tx as Tx)
      .select({ total: count() })
      .from(laundryItemDetails)
      .where(and(eq(laundryItemDetails.orderId, orderId), ne(laundryItemDetails.status, 'ready')));
    if (pending && pending.total > 0) {
      throw new BadRequestException({ code: 'PIECES_NOT_READY', message: `Ainda há ${pending.total} peça(s) em produção` });
    }
  },
};
