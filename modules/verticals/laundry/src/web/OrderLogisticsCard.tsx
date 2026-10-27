import { formatDate, formatMoney, useCan } from '@all/module-sdk/web';
import type { OrderDetail } from '@all/service-orders';
import { Button, Card } from '@all/ui';
import { useState } from 'react';
import { Link } from 'react-router';
import { JobBadges, JobProof, ScheduleModal, useJobs, useRefreshLogistics, windowText } from './logistics';

/** Status em que a entrega ainda pode ser agendada (antes de sair). */
const SCHEDULABLE = ['received', 'in_process', 'ready'];

/** Na ordem: "Entregar no endereço", a entrega agendada (com comprovante) e a coleta de origem. */
export function OrderLogisticsCard({ order, onChanged }: { order: OrderDetail; onChanged: () => void }) {
  const canManage = useCan('laundry.logistics.manage');
  const refresh = useRefreshLogistics();
  const jobs = useJobs({ orderId: order.id }, canManage);
  const [scheduling, setScheduling] = useState(false);
  if (!canManage || !jobs.data) return null;

  const deliveries = jobs.data.filter((j) => j.kind === 'delivery' && j.status !== 'cancelled');
  const current = deliveries.find((j) => j.status !== 'done') ?? deliveries.find((j) => j.status === 'done');
  const pickup = jobs.data.find((j) => j.kind === 'pickup');
  const canSchedule = !current && SCHEDULABLE.includes(order.status);
  if (!current && !pickup && !canSchedule) return null;

  return (
    <Card className="space-y-3 p-5 text-sm">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-medium">Entrega</h2>
        {current && <JobBadges job={current} />}
      </div>
      {pickup && (
        <p className="text-fg-muted">
          Veio da coleta de {formatDate(pickup.date)}
          {pickup.itemsCount ? ` (${pickup.itemsCount} peças)` : ''}.
        </p>
      )}
      {current ? (
        <div className="space-y-2">
          <p className="tabular-nums">
            {formatDate(current.date)} · {windowText(current)}
          </p>
          <p className="text-fg-muted">{current.addressText}</p>
          <p className="text-fg-muted">
            {current.driver ? `Motorista: ${current.driver.name}` : 'Sem motorista'}
            {current.fee > 0 && ` · taxa ${formatMoney(current.fee)}${current.feeStatus === 'paid' ? ' (recebida)' : ''}`}
          </p>
          <JobProof job={current} />
          <Link to="/lavanderia/logistica" className="inline-block text-brand-700 hover:underline">
            Ver no quadro de coletas e entregas
          </Link>
        </div>
      ) : (
        canSchedule && (
          <>
            <p className="text-fg-muted">Retirada no balcão. Para levar até o cliente, agende a entrega.</p>
            <Button variant="secondary" className="w-full" onClick={() => setScheduling(true)}>
              Entregar no endereço
            </Button>
          </>
        )
      )}
      {scheduling && (
        <ScheduleModal
          kind="delivery"
          orderId={order.id}
          customer={order.customer}
          onClose={() => setScheduling(false)}
          onSaved={() => {
            setScheduling(false);
            refresh();
            onChanged();
          }}
        />
      )}
    </Card>
  );
}
