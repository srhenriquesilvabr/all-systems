import type { Tx } from '@all/db';
import type { ServiceOrderWorkflow } from '@all/service-orders';
import { BadRequestException } from '@nestjs/common';
import { and, count, eq, ne } from 'drizzle-orm';
import { laundryItemDetails, laundryLogisticsJobs } from '../db/schema';

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
    ready: ['delivered', 'out_for_delivery', 'in_process', 'cancelled'],
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
  // "Saiu para entrega" desfeito: as peças não saíram, o cliente não precisa de outro "estão prontas".
  silentTransitions: { out_for_delivery: ['ready'] },
  /** "Pronta" só com todas as peças prontas: evita avisar o cliente antes da hora. */
  async beforeTransition({ tx, orderId, from, to }) {
    if (to !== 'ready') return;
    const [pending] = await (tx as Tx)
      .select({ total: count() })
      .from(laundryItemDetails)
      .where(and(eq(laundryItemDetails.orderId, orderId), ne(laundryItemDetails.status, 'ready')));
    if (pending && pending.total > 0) {
      throw new BadRequestException({ code: 'PIECES_NOT_READY', message: `Ainda há ${pending.total} peça(s) em produção` });
    }
    // Só o "Saiu para entrega" marcado à mão volta por aqui: com o motorista em rota, quem decide é a tarefa.
    if (from === 'out_for_delivery') {
      const [route] = await (tx as Tx)
        .select({ id: laundryLogisticsJobs.id })
        .from(laundryLogisticsJobs)
        .where(and(eq(laundryLogisticsJobs.orderId, orderId), eq(laundryLogisticsJobs.kind, 'delivery'), eq(laundryLogisticsJobs.status, 'en_route')));
      if (route) throw new BadRequestException({ code: 'JOB_EN_ROUTE', message: 'Há uma entrega em rota para esta ordem: use Não realizada ou Cancelar em Coletas e entregas' });
    }
  },
  /**
   * O que muda em cada situação. Peças têm etiqueta e etapa: entram e saem pela tela da ordem, nunca
   * por aqui. Com a ordem em rota, valor e prazo ficam parados (o motorista está cobrando esse valor).
   */
  beforeUpdate({ status, input }) {
    if (input.items) throw new BadRequestException({ code: 'ITEMS_MANAGED', message: 'As peças são incluídas e retiradas pela tela da ordem da lavanderia' });
    if (status === 'out_for_delivery' && (input.discount !== undefined || input.dueAt !== undefined)) {
      throw new BadRequestException({ code: 'ORDER_OUT_FOR_DELIVERY', message: 'A ordem saiu para entrega: só as observações podem mudar' });
    }
  },
};
