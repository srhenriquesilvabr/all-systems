import { api, apiDownload, ApiError, formatDate, formatDateTime, formatMoney, formatPhone, useCan } from '@all/module-sdk/web';
import { Alert, Badge, Button, Card, cn, EmptyState, PageHeader, Select, Spinner, Table, Td, Th } from '@all/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';

export type Segment = 'champions' | 'loyal' | 'promising' | 'new' | 'at_risk' | 'hibernating' | 'lost';

/** Ordem de leitura: dos melhores clientes aos que precisam de reconquista. */
export const segmentInfo: Record<Segment, { label: string; tone: 'success' | 'brand' | 'warning' | 'neutral' | 'danger'; meaning: string; action: string }> = {
  champions: { label: 'Campeões', tone: 'success', meaning: 'Compraram há pouco, compram muito e gastam mais.', action: 'Agradeça e ofereça novidades em primeira mão.' },
  loyal: { label: 'Leais', tone: 'success', meaning: 'Compram com frequência.', action: 'Programa de fidelidade ou indicação.' },
  promising: { label: 'Promissores', tone: 'brand', meaning: 'Compraram recentemente, ainda com pouca frequência.', action: 'Convide para voltar com uma oferta do próximo serviço.' },
  new: { label: 'Novos', tone: 'brand', meaning: 'Primeira compra nos últimos 60 dias.', action: 'Boas-vindas e pós-venda: como foi a experiência?' },
  at_risk: { label: 'Em risco', tone: 'warning', meaning: 'Compravam bastante, mas sumiram.', action: 'Contato pessoal e um cupom de retorno.' },
  hibernating: { label: 'Hibernando', tone: 'neutral', meaning: 'Pouca compra e faz tempo.', action: 'Campanha de reativação com condição especial.' },
  lost: { label: 'Perdidos', tone: 'danger', meaning: 'A última compra foi há muito tempo.', action: 'Pesquisa de motivo; reconquista só se valer a pena.' },
};
const order = Object.keys(segmentInfo) as Segment[];

interface Summary {
  segments: { segment: Segment; customers: number; monetary: number; avgRecencyDays: number }[];
  customers: number;
  withoutPurchases: number;
  computedAt: string | null;
}

interface Row {
  customer: { id: string; name: string; phone: string | null; email: string | null };
  marketingEmail: boolean;
  marketingWhatsapp: boolean;
  segment: Segment;
  r: number;
  f: number;
  m: number;
  recencyDays: number;
  frequency: number;
  monetary: number;
  lastPurchaseOn: string;
}

/** Clusterização de clientes, etapa 1: RFM com regras, explicável e com uma ação para cada grupo. */
export function SegmentsPage() {
  const queryClient = useQueryClient();
  const canManage = useCan('core.segmentation.manage');
  const summary = useQuery({ queryKey: ['segmentation', 'summary'], queryFn: () => api<Summary>('/segmentation/summary') });
  const [selected, setSelected] = useState<Segment | null>(null);
  const rows = useQuery({
    queryKey: ['segmentation', 'customers', selected],
    queryFn: () => api<Row[]>('/segmentation/customers', { query: { segment: selected ?? undefined, limit: 500 } }),
    enabled: !!selected,
  });
  const recompute = useMutation({
    mutationFn: () => api('/segmentation/recompute', { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['segmentation'] }),
  });
  const [consent, setConsent] = useState<'' | 'marketing_email' | 'marketing_whatsapp'>('');
  const download = useMutation({
    mutationFn: (s: Segment) => apiDownload('/segmentation/customers.csv', `clientes-${segmentInfo[s].label.toLowerCase().replace(/\s/g, '-')}.csv`, { query: { segment: s, consent: consent || undefined } }),
  });

  if (summary.isPending) return <Spinner />;
  if (summary.isError) return <Alert>{summary.error.message}</Alert>;
  const count = (s: Segment) => summary.data.segments.find((x) => x.segment === s);
  const segmented = summary.data.customers - summary.data.withoutPurchases;

  return (
    <>
      <PageHeader
        title="Segmentos de clientes"
        description={`Pela recência, frequência e valor das compras dos últimos 12 meses. ${summary.data.computedAt ? `Atualizado em ${formatDateTime(summary.data.computedAt)}.` : 'Nenhum cliente com recebimento registrado no financeiro ainda.'}`}
        actions={
          canManage && (
            <Button variant="secondary" loading={recompute.isPending} onClick={() => recompute.mutate()}>
              Recalcular agora
            </Button>
          )
        }
      />
      {recompute.error && <Alert>{recompute.error instanceof ApiError ? recompute.error.message : 'Erro ao recalcular'}</Alert>}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {order.map((s) => {
          const c = count(s);
          const share = segmented ? (c?.customers ?? 0) / segmented : 0;
          return (
            <button
              key={s}
              type="button"
              onClick={() => setSelected(selected === s ? null : s)}
              className={cn('rounded-2xl border bg-surface p-4 text-left transition hover:border-fg', selected === s ? 'border-brand-600 ring-2 ring-brand-600/20' : 'border-line')}
            >
              <div className="flex items-center justify-between gap-2">
                <Badge tone={segmentInfo[s].tone}>{segmentInfo[s].label}</Badge>
                <span className="font-display text-2xl font-semibold tabular-nums">{c?.customers ?? 0}</span>
              </div>
              <div className="mt-2 h-1.5 rounded-full bg-muted" aria-hidden>
                <div className="h-full rounded-full bg-brand-600" style={{ width: `${share * 100}%` }} />
              </div>
              <p className="mt-2 text-xs text-fg-muted">
                {Math.round(share * 100)}% dos clientes{c ? ` · ${formatMoney(c.monetary)} em 12 meses` : ''}
              </p>
              <p className="mt-2 text-sm">{segmentInfo[s].meaning}</p>
            </button>
          );
        })}
        <Card className="p-4">
          <div className="flex items-center justify-between gap-2">
            <Badge>Sem compras</Badge>
            <span className="font-display text-2xl font-semibold tabular-nums">{summary.data.withoutPurchases}</span>
          </div>
          <p className="mt-2 text-sm text-fg-muted">Cadastrados, mas sem nenhum recebimento no financeiro.</p>
        </Card>
      </div>

      {selected && (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-4">
            <div>
              <h2 className="font-medium">{segmentInfo[selected].label}</h2>
              <p className="text-sm text-fg-muted">Ação sugerida: {segmentInfo[selected].action}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Select aria-label="Quem entra na planilha" className="max-w-64" value={consent} onChange={(e) => setConsent(e.target.value as typeof consent)}>
                <option value="">Todos do segmento</option>
                <option value="marketing_email">Só quem autorizou ofertas por e-mail</option>
                <option value="marketing_whatsapp">Só quem autorizou ofertas por WhatsApp</option>
              </Select>
              <Button variant="secondary" size="sm" loading={download.isPending} onClick={() => download.mutate(selected)}>
                Exportar planilha
              </Button>
            </div>
            <p className="w-full text-xs text-fg-muted">A planilha só traz o e-mail de quem autorizou ofertas por e-mail e o telefone de quem autorizou ofertas por WhatsApp. Os demais ficam na lista sem o contato. A exportação fica na auditoria.</p>
          </div>
          {rows.isPending ? (
            <Spinner />
          ) : rows.isError ? (
            <div className="p-4">
              <Alert>{rows.error.message}</Alert>
            </div>
          ) : rows.data.length === 0 ? (
            <EmptyState title="Nenhum cliente neste segmento" />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Cliente</Th>
                  <Th>Última compra</Th>
                  <Th className="text-right">Compras (12m)</Th>
                  <Th className="text-right">Valor (12m)</Th>
                  <Th className="text-center">R · F · M</Th>
                  <Th>Autoriza ofertas</Th>
                </tr>
              </thead>
              <tbody>
                {rows.data.map((r) => (
                  <tr key={r.customer.id}>
                    <Td>
                      <Link to={`/clientes/${r.customer.id}`} className="font-medium text-brand-700 hover:underline">
                        {r.customer.name}
                      </Link>
                      {r.customer.phone && <span className="ml-2 text-sm text-fg-muted">{formatPhone(r.customer.phone)}</span>}
                    </Td>
                    <Td className="whitespace-nowrap tabular-nums">
                      {formatDate(r.lastPurchaseOn)} <span className="text-xs text-fg-muted">({r.recencyDays} dias)</span>
                    </Td>
                    <Td className="text-right tabular-nums">{r.frequency}</Td>
                    <Td className="text-right tabular-nums">{formatMoney(r.monetary)}</Td>
                    <Td className="text-center tabular-nums text-fg-muted">
                      {r.r} · {r.f} · {r.m}
                    </Td>
                    <Td className="whitespace-nowrap text-sm">
                      {r.marketingEmail || r.marketingWhatsapp ? [r.marketingEmail && 'E-mail', r.marketingWhatsapp && 'WhatsApp'].filter(Boolean).join(' · ') : <span className="text-fg-subtle">Não</span>}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      )}
    </>
  );
}

/** Linha com o segmento do cliente, na ficha. Some se não houver segmento ou permissão. */
export function CustomerSegment({ customerId }: { customerId: string }) {
  const canRead = useCan('core.segmentation.read');
  const rfm = useQuery({
    queryKey: ['segmentation', 'customer', customerId],
    // Cliente sem compras: a API responde vazio, e o React Query não aceita `undefined`.
    queryFn: async () => (await api<{ segment: Segment; recencyDays: number; frequency: number; monetary: number } | null>(`/segmentation/customers/${customerId}`)) ?? null,
    enabled: canRead,
  });
  if (!rfm.data || !('segment' in rfm.data)) return null;
  const info = segmentInfo[rfm.data.segment];
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
      <Badge tone={info.tone}>{info.label}</Badge>
      <span className="text-fg-muted">
        {rfm.data.frequency} compra{rfm.data.frequency === 1 ? '' : 's'} e {formatMoney(rfm.data.monetary)} em 12 meses · última há {rfm.data.recencyDays} dia{rfm.data.recencyDays === 1 ? '' : 's'}.
      </span>
      <span className="text-fg-muted">Sugestão: {info.action}</span>
    </div>
  );
}
