import { api, ApiError, formatDateTime } from '@all/module-sdk/web';
import { ordersKey } from '@all/service-orders/web';
import { Alert, Badge, Button, Card, cn, EmptyState, Input, PageHeader, Select, Spinner } from '@all/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { pieceStatuses, pieceStatusLabel, type PieceStatus, type ProductionPiece } from '../contracts';
import { laundryKey, useProduction } from './hooks';

const next = (s: PieceStatus): PieceStatus | undefined => pieceStatuses[pieceStatuses.indexOf(s) + 1];

export function ProductionPage() {
  const queryClient = useQueryClient();
  const board = useProduction();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkTarget, setBulkTarget] = useState<PieceStatus>('washing');

  const move = useMutation({
    mutationFn: ({ itemIds, status }: { itemIds: string[]; status: PieceStatus }) =>
      api<ProductionPiece[]>('/laundry/pieces/status', { method: 'POST', body: { itemIds, status } }),
    onSuccess: () => {
      setSelected(new Set());
      queryClient.invalidateQueries({ queryKey: laundryKey });
      queryClient.invalidateQueries({ queryKey: ordersKey });
    },
  });

  const toggle = (id: string) => {
    const s = new Set(selected);
    if (s.has(id)) s.delete(id);
    else s.add(id);
    setSelected(s);
  };

  return (
    <>
      <PageHeader title="Produção" description="Peças das ordens em andamento, das mais urgentes para as menos. Atualiza sozinho a cada 30 segundos." />
      <TagReader onMoved={() => queryClient.invalidateQueries({ queryKey: laundryKey })} />

      {selected.size > 0 && (
        <div className="sticky top-0 z-10 mb-4 flex flex-wrap items-center gap-2 rounded-md border border-brand-200 bg-brand-50 p-3 text-sm">
          <span className="font-medium">{selected.size} peça(s) selecionada(s)</span>
          <Select aria-label="Mover para" className="w-40" value={bulkTarget} onChange={(e) => setBulkTarget(e.target.value as PieceStatus)}>
            {pieceStatuses.map((s) => (
              <option key={s} value={s}>
                {pieceStatusLabel[s]}
              </option>
            ))}
          </Select>
          <Button size="sm" loading={move.isPending} onClick={() => move.mutate({ itemIds: [...selected], status: bulkTarget })}>
            Mover
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            Limpar seleção
          </Button>
        </div>
      )}
      {move.error && (
        <div className="mb-4">
          <Alert>{move.error instanceof ApiError ? move.error.message : 'Erro ao mover'}</Alert>
        </div>
      )}

      {board.isPending ? (
        <Spinner />
      ) : board.isError ? (
        <Alert>{board.error.message}</Alert>
      ) : board.data.length === 0 ? (
        <Card>
          <EmptyState title="Nenhuma peça em produção" description="As peças aparecem aqui assim que a ordem é aberta no balcão." />
        </Card>
      ) : (
        <div className="grid auto-cols-[minmax(13rem,1fr)] grid-flow-col gap-3 overflow-x-auto pb-2">
          {pieceStatuses.map((status) => {
            const pieces = board.data.filter((p) => p.status === status);
            return (
              <section key={status} aria-label={pieceStatusLabel[status]} className="rounded-lg bg-muted/60 p-2">
                <h2 className="mb-2 flex items-center justify-between px-1 text-sm font-medium">
                  {pieceStatusLabel[status]}
                  <span className="text-fg-muted">{pieces.length}</span>
                </h2>
                <div className="space-y-2">
                  {pieces.map((p) => (
                    <PieceCard
                      key={p.itemId}
                      piece={p}
                      selected={selected.has(p.itemId)}
                      onToggle={() => toggle(p.itemId)}
                      onAdvance={(to) => move.mutate({ itemIds: [p.itemId], status: to })}
                      busy={move.isPending}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}

function PieceCard({
  piece,
  selected,
  onToggle,
  onAdvance,
  busy,
}: {
  piece: ProductionPiece;
  selected: boolean;
  onToggle: () => void;
  onAdvance: (to: PieceStatus) => void;
  busy: boolean;
}) {
  const late = piece.dueAt && new Date(piece.dueAt) < new Date();
  const to = next(piece.status);
  return (
    <Card className={cn('p-3 text-sm', selected && 'ring-2 ring-brand-600')}>
      <div className="flex items-start gap-2">
        <input type="checkbox" aria-label={`Selecionar ${piece.tagCode}`} className="mt-1 size-4 accent-brand-600" checked={selected} onChange={onToggle} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono font-semibold">{piece.tagCode}</span>
            <Link to={`/lavanderia/ordens/${piece.orderId}`} className="text-xs text-brand-700 hover:underline">
              OS {piece.orderNumber}
            </Link>
          </div>
          <p className="truncate">{piece.description}</p>
          <p className="truncate text-xs text-fg-muted">{piece.customerName}</p>
          {piece.dueAt && <p className={cn('text-xs', late ? 'font-medium text-danger-700' : 'text-fg-muted')}>{late ? 'Atrasada · ' : ''}{formatDateTime(piece.dueAt)}</p>}
          <div className="mt-1 flex flex-wrap gap-1">
            {piece.intakeNotes && <Badge tone="warning">Avaria na entrada</Badge>}
            {piece.incidentNotes && <Badge tone="danger">Ocorrência</Badge>}
            {piece.reworkCount > 0 && <Badge tone="warning">Retrabalho</Badge>}
            {piece.photos.length > 0 && <Badge>{piece.photos.length} foto(s)</Badge>}
          </div>
        </div>
      </div>
      {to && (
        <Button size="sm" variant="secondary" className="mt-2 w-full" disabled={busy} onClick={() => onAdvance(to)}>
          → {pieceStatusLabel[to]}
        </Button>
      )}
    </Card>
  );
}

/**
 * Modo leitura: escolhe a etapa e lê (ou digita) as etiquetas; cada leitura move a peça.
 * Leitores de código de barras/QR funcionam como teclado e terminam com Enter.
 */
function TagReader({ onMoved }: { onMoved: () => void }) {
  const [target, setTarget] = useState<PieceStatus>('washing');
  const [tag, setTag] = useState('');
  const [log, setLog] = useState<{ tag: string; ok: boolean; text: string }[]>([]);
  const read = useMutation({
    mutationFn: async (code: string) => {
      const piece = await api<ProductionPiece>(`/laundry/pieces/by-tag/${encodeURIComponent(code)}`);
      await api('/laundry/pieces/status', { method: 'POST', body: { itemIds: [piece.itemId], status: target } });
      return piece;
    },
    onSuccess: (piece) => {
      setLog([{ tag: piece.tagCode, ok: true, text: `${piece.description} → ${pieceStatusLabel[target]}` }, ...log].slice(0, 5));
      onMoved();
    },
    onError: (err, code) => setLog([{ tag: code, ok: false, text: err instanceof ApiError ? err.message : 'Erro' }, ...log].slice(0, 5)),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    const code = tag.trim();
    if (code) read.mutate(code);
    setTag('');
  }

  return (
    <Card className="mb-4 p-4">
      <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">Ler etiqueta e mover para</span>
        <Select aria-label="Etapa de destino" className="w-40" value={target} onChange={(e) => setTarget(e.target.value as PieceStatus)}>
          {pieceStatuses.map((s) => (
            <option key={s} value={s}>
              {pieceStatusLabel[s]}
            </option>
          ))}
        </Select>
        <Input aria-label="Código da etiqueta" placeholder="Ex.: 123-01" className="w-40 font-mono" value={tag} onChange={(e) => setTag(e.target.value)} />
        <Button type="submit" variant="secondary" loading={read.isPending}>
          Mover
        </Button>
      </form>
      {log.length > 0 && (
        <ul className="mt-3 space-y-0.5 text-sm" aria-live="polite">
          {log.map((l, i) => (
            <li key={i} className={l.ok ? 'text-fg-muted' : 'text-danger-700'}>
              <span className="font-mono">{l.tag}</span> {l.text}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
