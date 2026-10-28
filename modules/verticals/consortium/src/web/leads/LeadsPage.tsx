import { api, formatMoney, SpreadsheetImport, useCan, useSession } from '@all/module-sdk/web';
import { Alert, Badge, Button, Card, EmptyState, Input, PageHeader, Select, Spinner, Table, Tabs, Td, Th, cn } from '@all/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import {
  LEGAL_NOTICE,
  leadAssetLabel,
  leadSourceLabel,
  leadSources,
  leadStatuses,
  leadStatusLabel,
  openLeadStatuses,
  type LeadListItem,
  type LeadStatus,
  type LeadTask,
} from '../../contracts';
import { errorText, useTeam } from '../common';
import { leadsKey, leadTone, shortDateTime } from './common';
import { leadImportSpec } from './leadImport';

const tabs = [
  { key: 'board', label: 'Funil' },
  { key: 'list', label: 'Lista' },
  { key: 'tasks', label: 'Retornos' },
];

/** Leads do consórcio: funil por etapa, lista com filtros e os retornos agendados. */
export function LeadsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const canManage = useCan('consortium.leads.manage');
  const [tab, setTab] = useState('board');
  const [legal, setLegal] = useState(false);
  return (
    <>
      <PageHeader
        title="Leads"
        description="Pessoas que pediram contato: simulador do site, anúncios, indicação, planilha ou cadastro da equipe."
        actions={
          canManage && (
            <>
              <SpreadsheetImport spec={leadImportSpec()} onImported={() => queryClient.invalidateQueries({ queryKey: leadsKey })} />
              <Button onClick={() => navigate('/consorcio/leads/novo')}>Novo lead</Button>
            </>
          )
        }
      />
      <div className="mb-4 rounded-xl border border-line bg-muted/30 p-3 text-sm">
        <button type="button" className="font-medium text-brand-700 hover:underline" onClick={() => setLegal(!legal)}>
          {legal ? 'Esconder' : 'Uso legal dos dados: de onde vêm os leads'}
        </button>
        {legal && <p className="mt-2 text-fg-muted">{LEGAL_NOTICE}</p>}
      </div>
      <Tabs items={tabs} active={tab} onChange={setTab} />
      {tab === 'board' && <Board />}
      {tab === 'list' && <LeadList />}
      {tab === 'tasks' && <Tasks />}
    </>
  );
}

function useLeads(query: Record<string, string | undefined>) {
  return useQuery({ queryKey: [...leadsKey, 'list', query], queryFn: () => api<LeadListItem[]>('/consortium/leads', { query }) });
}

/** Colunas do funil (etapas em aberto) e o resumo de vendas/perdidos. */
function Board() {
  const { user } = useSession();
  const [mine, setMine] = useState(false);
  const list = useLeads({ open: '1', sellerId: mine ? user.id : undefined });
  const wonList = useLeads({ status: 'won', sellerId: mine ? user.id : undefined });
  const lostList = useLeads({ status: 'lost', sellerId: mine ? user.id : undefined });
  if (list.isPending) return <Spinner />;
  if (list.isError) return <Alert>{list.error.message}</Alert>;
  const won = wonList.data?.length ?? 0;
  const lost = lostList.data?.length ?? 0;
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Só os meus
        </label>
        <span className="text-fg-muted">
          Vendas: <strong className="text-fg">{won}</strong> · Perdidos: <strong className="text-fg">{lost}</strong>
        </span>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {openLeadStatuses.map((status) => {
          const items = list.data.filter((l) => l.status === status);
          return (
            <div key={status} className="rounded-2xl border border-line bg-muted/30 p-2">
              <div className="mb-2 flex items-center justify-between px-1 text-sm">
                <span className="font-medium">{leadStatusLabel[status]}</span>
                <Badge tone={leadTone[status]}>{items.length}</Badge>
              </div>
              <div className="space-y-2">
                {items.map((l) => (
                  <LeadCard key={l.id} lead={l} />
                ))}
                {!items.length && <p className="px-1 py-4 text-center text-xs text-fg-muted">Nenhum lead</p>}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

function LeadCard({ lead: l }: { lead: LeadListItem }) {
  const overdue = l.nextTask && Date.parse(l.nextTask.dueAt) < Date.now();
  return (
    <Link to={`/consorcio/leads/${l.id}`} className="block rounded-xl border border-line bg-surface p-3 text-sm transition hover:border-brand-600">
      <span className="block font-medium">{l.name}</span>
      <span className="block text-xs text-fg-muted">
        {[l.assetType && leadAssetLabel[l.assetType], l.creditValue && formatMoney(l.creditValue), l.city].filter(Boolean).join(' · ') || 'Sem simulação'}
      </span>
      <span className="mt-1 flex flex-wrap items-center gap-1 text-xs">
        <Badge>{leadSourceLabel[l.source]}</Badge>
        {l.credit && <Badge tone={l.credit.decision === 'approved' ? 'success' : l.credit.decision === 'rejected' ? 'danger' : 'warning'}>Crédito {l.credit.score ?? ''}</Badge>}
      </span>
      <span className="mt-1 block text-xs text-fg-muted">{l.seller?.name ?? 'Sem vendedor'}</span>
      {l.nextTask && <span className={cn('mt-1 block text-xs', overdue ? 'text-danger-600' : 'text-fg-muted')}>Retorno {shortDateTime(l.nextTask.dueAt)}</span>}
    </Link>
  );
}

function LeadList() {
  const team = useTeam();
  const [status, setStatus] = useState('');
  const [source, setSource] = useState('');
  const [sellerId, setSellerId] = useState('');
  const [q, setQ] = useState('');
  const list = useLeads({ status: status || undefined, source: source || undefined, sellerId: sellerId || undefined, q: q.trim().length >= 2 ? q.trim() : undefined });
  return (
    <>
      <div className="mb-4 flex flex-wrap gap-3">
        <Input aria-label="Buscar" placeholder="Nome, telefone, e-mail ou campanha" className="max-w-72" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select aria-label="Etapa" className="max-w-48" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Todas as etapas</option>
          {leadStatuses.map((s) => (
            <option key={s} value={s}>
              {leadStatusLabel[s]}
            </option>
          ))}
        </Select>
        <Select aria-label="Origem" className="max-w-56" value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="">Todas as origens</option>
          {leadSources.map((s) => (
            <option key={s} value={s}>
              {leadSourceLabel[s]}
            </option>
          ))}
        </Select>
        <Select aria-label="Vendedor" className="max-w-56" value={sellerId} onChange={(e) => setSellerId(e.target.value)}>
          <option value="">Todos os vendedores</option>
          {team.data?.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
          <option value="none">Sem vendedor</option>
        </Select>
      </div>
      <Card>
        {list.isPending ? (
          <Spinner />
        ) : list.isError ? (
          <div className="p-4">
            <Alert>{list.error.message}</Alert>
          </div>
        ) : list.data.length === 0 ? (
          <EmptyState title="Nenhum lead" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Nº</Th>
                <Th>Nome</Th>
                <Th>Simulação</Th>
                <Th>Origem</Th>
                <Th>Vendedor</Th>
                <Th>Etapa</Th>
              </tr>
            </thead>
            <tbody>
              {list.data.map((l) => (
                <tr key={l.id}>
                  <Td className="tabular-nums">{l.number}</Td>
                  <Td>
                    <Link to={`/consorcio/leads/${l.id}`} className="text-brand-700 hover:underline">
                      {l.name}
                    </Link>
                    <div className="text-xs text-fg-muted">{[l.city, l.state].filter(Boolean).join('/')}</div>
                  </Td>
                  <Td className="text-sm">
                    {l.creditValue ? `${l.assetType ? leadAssetLabel[l.assetType] : ''} ${formatMoney(l.creditValue)}${l.termMonths ? ` em ${l.termMonths}x` : ''}` : '—'}
                    {l.estimatedInstallment && <div className="text-xs text-fg-muted">parcela ~{formatMoney(l.estimatedInstallment)}</div>}
                  </Td>
                  <Td className="text-sm">
                    {leadSourceLabel[l.source]}
                    {l.campaign && <div className="text-xs text-fg-muted">{l.campaign}</div>}
                    {l.referrer && <div className="text-xs text-fg-muted">indicado por {l.referrer.name}</div>}
                  </Td>
                  <Td className="text-sm">{l.seller?.name ?? '—'}</Td>
                  <Td>
                    <Badge tone={leadTone[l.status]}>{leadStatusLabel[l.status as LeadStatus]}</Badge>
                    {l.lostReason && <div className="text-xs text-fg-muted">{l.lostReason}</div>}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}

/** Retornos em aberto (os meus; a gestão pode ver os de todos). */
function Tasks() {
  const queryClient = useQueryClient();
  const canManage = useCan('consortium.leads.manage');
  const canWork = useCan('consortium.leads.work');
  const [all, setAll] = useState(false);
  const list = useQuery({ queryKey: [...leadsKey, 'tasks', all], queryFn: () => api<LeadTask[]>('/consortium/lead-tasks', { query: { all: all ? '1' : undefined } }) });
  const done = useMutation({ mutationFn: (id: string) => api(`/consortium/lead-tasks/${id}/done`, { method: 'POST' }), onSuccess: () => queryClient.invalidateQueries({ queryKey: leadsKey }) });
  return (
    <>
      {canManage && (
        <label className="mb-3 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Retornos de toda a equipe
        </label>
      )}
      {done.error && <Alert>{errorText(done.error, 'Erro ao concluir')}</Alert>}
      <Card>
        {list.isPending ? (
          <Spinner />
        ) : list.isError ? (
          <div className="p-4">
            <Alert>{list.error.message}</Alert>
          </div>
        ) : list.data.length === 0 ? (
          <EmptyState title="Nenhum retorno em aberto" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Quando</Th>
                <Th>Lead</Th>
                <Th>Retorno</Th>
                <Th>Responsável</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {list.data.map((t) => {
                const overdue = Date.parse(t.dueAt) < Date.now();
                return (
                  <tr key={t.id}>
                    <Td className={cn('whitespace-nowrap text-sm', overdue && 'font-medium text-danger-600')}>{shortDateTime(t.dueAt)}</Td>
                    <Td>
                      <Link to={`/consorcio/leads/${t.leadId}`} className="text-brand-700 hover:underline">
                        {t.leadName}
                      </Link>
                    </Td>
                    <Td className="text-sm">{t.title}</Td>
                    <Td className="text-sm">{t.assignedTo?.name ?? '—'}</Td>
                    <Td className="text-right">
                      {canWork && (
                        <Button size="sm" variant="secondary" loading={done.isPending && done.variables === t.id} onClick={() => done.mutate(t.id)}>
                          Feito
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
    </>
  );
}
