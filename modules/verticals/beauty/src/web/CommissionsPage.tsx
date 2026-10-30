import { api, ApiError, formatDate, formatMoney, parseMoney, useCan } from '@all/module-sdk/web';
import { useResources, useServices } from '@all/scheduling/web';
import { Alert, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Spinner, Table, Td, Th } from '@all/ui';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { CommissionReport, CommissionRules } from '../contracts';
import { PayoutsCard, PeriodSelect, rangeOf, type PeriodKey } from './CommissionsExtra';

export function CommissionsPage() {
  const canManage = useCan('beauty.commissions.manage');
  const [periodKey, setPeriodKey] = useState<PeriodKey>('month');
  const range = rangeOf(periodKey);
  const report = useQuery({
    queryKey: ['beauty', 'commissions', range],
    queryFn: () => api<CommissionReport>('/beauty/commissions', { query: range }),
    placeholderData: keepPreviousData,
  });
  const resources = useResources();
  const [open, setOpen] = useState<string | null>(null);
  const [configuring, setConfiguring] = useState<string | null>(null);
  const professionals = (resources.data ?? []).filter((r) => r.kind === 'professional');

  return (
    <>
      <PageHeader
        title="Comissões"
        description="Sobre os atendimentos concluídos no período, pelo valor cobrado de cada serviço. O percentual fica gravado quando o atendimento é concluído."
        actions={<PeriodSelect value={periodKey} onChange={setPeriodKey} />}
      />
      <Card>
        {report.isPending || resources.isPending ? (
          <Spinner />
        ) : report.isError ? (
          <div className="p-4">
            <Alert>{report.error.message}</Alert>
          </div>
        ) : professionals.length === 0 ? (
          <EmptyState title="Nenhum profissional cadastrado" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Profissional</Th>
                <Th className="text-right">Atendimentos</Th>
                <Th className="text-right">Faturado</Th>
                <Th className="text-right">Comissão</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {professionals.map((r) => {
                const p = report.data.professionals.find((x) => x.resourceId === r.id);
                return (
                  <tr key={r.id}>
                    <Td className="font-medium">{r.name}</Td>
                    <Td className="text-right tabular-nums">{p?.appointments ?? 0}</Td>
                    <Td className="text-right tabular-nums">{formatMoney(p?.revenue ?? 0)}</Td>
                    <Td className="text-right font-semibold tabular-nums">{formatMoney(p?.commission ?? 0)}</Td>
                    <Td className="whitespace-nowrap text-right">
                      {p && (
                        <Button variant="ghost" size="sm" onClick={() => setOpen(r.id)}>
                          Detalhar
                        </Button>
                      )}
                      {canManage && (
                        <Button variant="ghost" size="sm" onClick={() => setConfiguring(r.id)}>
                          Percentuais
                        </Button>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
      <PayoutsCard range={range} report={report.data} />

      {open && report.data && (
        <Modal open title={`Comissões — ${report.data.professionals.find((p) => p.resourceId === open)?.name}`} onClose={() => setOpen(null)}>
          <Table>
            <thead>
              <tr>
                <Th>Dia</Th>
                <Th>Cliente</Th>
                <Th>Serviço</Th>
                <Th className="text-right">%</Th>
                <Th className="text-right">Comissão</Th>
              </tr>
            </thead>
            <tbody>
              {report.data.professionals
                .find((p) => p.resourceId === open)
                ?.lines.map((l, i) => (
                  <tr key={i}>
                    <Td className="tabular-nums">{formatDate(l.date)}</Td>
                    <Td>{l.customer}</Td>
                    <Td>
                      {l.service} <span className="text-fg-muted">({formatMoney(l.price)})</span>
                    </Td>
                    <Td className="text-right tabular-nums">{l.rate.toLocaleString('pt-BR')}%</Td>
                    <Td className="text-right tabular-nums">{formatMoney(l.commission)}</Td>
                  </tr>
                ))}
            </tbody>
          </Table>
        </Modal>
      )}
      {configuring && <RulesModal resourceId={configuring} name={professionals.find((r) => r.id === configuring)?.name ?? ''} onClose={() => setConfiguring(null)} />}
    </>
  );
}

function RulesModal({ resourceId, name, onClose }: { resourceId: string; name: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const services = useServices();
  const rules = useQuery({ queryKey: ['beauty', 'rules'], queryFn: () => api<CommissionRules[]>('/beauty/commission-rules') });
  const mine = rules.data?.find((r) => r.resourceId === resourceId);
  const [defaultRate, setDefaultRate] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Record<string, string> | null>(null);
  const currentDefault = defaultRate ?? String(mine?.defaultRate ?? 0).replace('.', ',');
  const currentOverrides = overrides ?? Object.fromEntries((mine?.services ?? []).map((s) => [s.serviceId, String(s.rate).replace('.', ',')]));

  const save = useMutation({
    mutationFn: () =>
      api(`/beauty/commission-rules/${resourceId}`, {
        method: 'PUT',
        body: {
          defaultRate: parseMoney(currentDefault) || 0,
          services: Object.entries(currentOverrides)
            .filter(([, v]) => v.trim() !== '')
            .map(([serviceId, v]) => ({ serviceId, rate: parseMoney(v) })),
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['beauty'] });
      onClose();
    },
  });

  return (
    <Modal
      open
      title={`Percentuais — ${name}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate()}>
            Salvar
          </Button>
        </>
      }
    >
      {rules.isPending || services.isPending ? (
        <Spinner />
      ) : (
        <div className="space-y-4">
          {save.error && <Alert>{save.error instanceof ApiError ? save.error.message : 'Erro ao salvar'}</Alert>}
          <Field label="Comissão padrão (%)" hint="Vale para todos os serviços sem percentual próprio.">
            {(id) => <Input id={id} inputMode="decimal" className="w-32" value={currentDefault} onChange={(e) => setDefaultRate(e.target.value)} />}
          </Field>
          <Table>
            <thead>
              <tr>
                <Th>Serviço</Th>
                <Th className="w-32">% próprio</Th>
              </tr>
            </thead>
            <tbody>
              {services.data
                ?.filter((s) => s.active)
                .map((s) => (
                  <tr key={s.id}>
                    <Td>{s.name}</Td>
                    <Td>
                      <Input
                        aria-label={`Comissão de ${s.name}`}
                        inputMode="decimal"
                        placeholder={currentDefault}
                        value={currentOverrides[s.id] ?? ''}
                        onChange={(e) => setOverrides({ ...currentOverrides, [s.id]: e.target.value })}
                      />
                    </Td>
                  </tr>
                ))}
            </tbody>
          </Table>
        </div>
      )}
    </Modal>
  );
}
