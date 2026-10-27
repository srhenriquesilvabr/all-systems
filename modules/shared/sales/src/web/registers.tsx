import { api, ApiError, formatDateTime, parseMoney, useCan, useSession } from '@all/module-sdk/web';
import { Alert, Badge, Button, Card, Field, Input, Modal, Select, Spinner, Table, Td, Textarea, Th } from '@all/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import {
  countedMethods,
  registerMoveLabel,
  salePaymentLabel,
  type CashRegister,
  type CountedMethod,
  type RegisterMoveKind,
  type RegisterSession,
  type RegistersOverview,
} from '../contracts';
import { brl, registersKey, salesKey, useRegisterSession } from './hooks';

const cents = (n: number) => Math.round(n * 100);
const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);


/** "Sobra R$ 2,00" / "Quebra R$ 5,00" / "Sem diferença". */
export function DifferenceBadge({ value }: { value: number | null }) {
  if (value === null) return <span className="text-fg-subtle">—</span>;
  if (cents(value) === 0) return <Badge tone="success">Sem diferença</Badge>;
  return value > 0 ? <Badge tone="warning">Sobra {brl(value)}</Badge> : <Badge tone="danger">Quebra {brl(-value)}</Badge>;
}

// ---- Escolher e abrir o caixa ------------------------------------------------------------------

/**
 * Escolhe o caixa deste computador e, com permissão, abre a sessão com o troco inicial.
 * Quem só vende escolhe o caixa e espera um responsável abrir.
 */
export function OpenRegisterForm({
  overview,
  registerId,
  onRegisterChange,
  onOpened,
}: {
  overview: RegistersOverview;
  registerId: string | null;
  onRegisterChange: (id: string | null) => void;
  onOpened?: () => void;
}) {
  const queryClient = useQueryClient();
  const canOpen = useCan('shared.sales.register');
  const active = overview.registers.filter((r) => r.active);
  const selected = active.find((r) => r.id === registerId) ?? null;
  const [creating, setCreating] = useState(active.length === 0);
  const [name, setName] = useState(active.length === 0 ? 'Caixa 1' : '');
  const [float, setFloat] = useState('');

  const create = useMutation({
    mutationFn: () => api<CashRegister>('/sales/registers', { method: 'POST', body: { name } }),
    onSuccess: (register) => {
      onRegisterChange(register.id);
      setCreating(false);
      setName('');
      queryClient.invalidateQueries({ queryKey: registersKey });
    },
  });
  const open = useMutation({
    mutationFn: () => api<RegisterSession>('/sales/registers/sessions', { method: 'POST', body: { registerId: selected!.id, openingFloat: cents(floatValue) / 100 } }),
    onSuccess: async () => {
      setFloat('');
      await queryClient.invalidateQueries({ queryKey: registersKey });
      onOpened?.();
    },
  });
  const floatValue = float.trim() === '' ? 0 : parseMoney(float);
  const floatValid = Number.isFinite(floatValue) && floatValue >= 0;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (selected && !selected.openSession && floatValid) open.mutate();
  }

  return (
    <div className="space-y-4">
      {creating && canOpen ? (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim().length >= 2) create.mutate();
          }}
        >
          {create.error && <Alert>{errorText(create.error, 'Erro ao cadastrar o caixa')}</Alert>}
          <Field label="Nome do caixa" hint='Um por computador ou gaveta, ex.: "Caixa 1", "Balcão".'>
            {(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoFocus />}
          </Field>
          <div className="flex gap-2">
            <Button type="submit" loading={create.isPending} disabled={name.trim().length < 2}>
              Cadastrar caixa
            </Button>
            {active.length > 0 && (
              <Button type="button" variant="ghost" onClick={() => setCreating(false)}>
                Voltar
              </Button>
            )}
          </div>
        </form>
      ) : active.length === 0 ? (
        <Alert tone="info">Nenhum caixa cadastrado. Peça a um responsável para cadastrar e abrir o caixa.</Alert>
      ) : (
        <form className="space-y-3" onSubmit={submit}>
          {open.error && <Alert>{errorText(open.error, 'Erro ao abrir o caixa')}</Alert>}
          <Field label="Caixa deste computador">
            {(id) => (
              <div className="flex gap-2">
                <Select id={id} className="flex-1" value={selected?.id ?? ''} onChange={(e) => onRegisterChange(e.target.value || null)}>
                  <option value="">Escolha…</option>
                  {active.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                      {r.openSession ? ' (aberto)' : ''}
                    </option>
                  ))}
                </Select>
                {canOpen && (
                  <Button type="button" variant="secondary" onClick={() => setCreating(true)}>
                    Novo caixa
                  </Button>
                )}
              </div>
            )}
          </Field>
          {selected?.openSession ? (
            <p className="text-sm text-fg-muted">
              Aberto em {formatDateTime(selected.openSession.openedAt)}
              {selected.openSession.openedByName && ` por ${selected.openSession.openedByName}`}.
            </p>
          ) : selected && canOpen ? (
            <>
              <Field label="Troco inicial" hint="Dinheiro que está na gaveta agora.">
                {(id) => <Input id={id} inputMode="decimal" className="w-40 text-right tabular-nums" placeholder="0,00" value={float} onChange={(e) => setFloat(e.target.value)} autoFocus />}
              </Field>
              <Button type="submit" loading={open.isPending} disabled={!floatValid}>
                Abrir caixa
              </Button>
            </>
          ) : (
            selected && <Alert tone="info">{selected.name} está fechado. Peça a um responsável para abrir o caixa.</Alert>
          )}
        </form>
      )}
    </div>
  );
}

// ---- Sessão aberta: resumo, sangria, suprimento, fechamento -------------------------------------

/** Painel da sessão aberta (no PDV). Ao fechar, devolve a sessão fechada para imprimir. */
export function SessionPanel({
  sessionId,
  overview,
  onClose,
  onClosed,
}: {
  sessionId: string;
  overview: RegistersOverview;
  onClose: () => void;
  onClosed: (session: RegisterSession) => void;
}) {
  const session = useRegisterSession(sessionId);
  const canManage = useCan('shared.sales.register');
  const [moving, setMoving] = useState<RegisterMoveKind | null>(null);
  const [closing, setClosing] = useState(false);
  const s = session.data;

  return (
    <>
      <Modal
        open
        title={s ? `${s.register.name} · sessão #${s.number}` : 'Caixa'}
        onClose={onClose}
        footer={
          s && s.status === 'open' && canManage ? (
            <>
              <Button variant="secondary" onClick={() => setMoving('withdrawal')}>
                Sangria
              </Button>
              <Button variant="secondary" onClick={() => setMoving('deposit')}>
                Suprimento
              </Button>
              <Button onClick={() => setClosing(true)}>Fechar caixa</Button>
            </>
          ) : undefined
        }
      >
        {session.isPending ? <Spinner /> : session.isError ? <Alert>{session.error.message}</Alert> : <SessionDetails session={session.data} />}
      </Modal>
      {s && moving && <MoveModal session={s} kind={moving} overview={overview} onClose={() => setMoving(null)} />}
      {s && closing && (
        <CloseModal
          session={s}
          onClose={() => setClosing(false)}
          onClosed={(closed) => {
            setClosing(false);
            onClosed(closed);
          }}
        />
      )}
    </>
  );
}

/** Resumo, totais por forma, sangrias/suprimentos. Usado no PDV e no histórico. */
export function SessionDetails({ session: s }: { session: RegisterSession }) {
  return (
    <div className="space-y-5 text-sm">
      <p className="text-fg-muted">
        Aberto em {formatDateTime(s.openedAt)}
        {s.openedByName && ` por ${s.openedByName}`}
        {s.closedAt && ` · fechado em ${formatDateTime(s.closedAt)}`}
        {s.closedByName && ` por ${s.closedByName}`}
      </p>
      <dl className="grid gap-3 sm:grid-cols-4">
        <Info label="Troco inicial" value={brl(s.openingFloat)} />
        <Info label={`Vendas (${s.salesCount})`} value={brl(s.salesTotal)} />
        <Info label="Suprimentos" value={brl(s.deposits)} />
        <Info label="Sangrias" value={brl(s.withdrawals)} />
      </dl>
      <Card>
        <Table>
          <thead>
            <tr>
              <Th>Forma</Th>
              <Th className="text-right">Esperado</Th>
              <Th className="text-right">Contado</Th>
              <Th className="text-right">Diferença</Th>
            </tr>
          </thead>
          <tbody>
            {s.totals.map((t) => (
              <tr key={t.method}>
                <Td>{t.method === 'cash' ? 'Dinheiro (gaveta)' : salePaymentLabel[t.method]}</Td>
                <Td className="text-right tabular-nums">{brl(t.expected)}</Td>
                <Td className="text-right tabular-nums">{t.counted === null ? <span className="text-fg-subtle">—</span> : brl(t.counted)}</Td>
                <Td className="text-right">{t.method === 'on_account' ? <span className="text-fg-subtle">—</span> : <DifferenceBadge value={t.difference} />}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
      {s.moves.length > 0 && (
        <div>
          <h2 className="mb-2 font-medium">Sangrias e suprimentos</h2>
          <ul className="divide-y divide-line">
            {s.moves.map((m) => (
              <li key={m.id} className="flex justify-between gap-3 py-1.5">
                <span>
                  <span className="font-medium">{registerMoveLabel[m.kind]}</span> · {m.reason}
                  <span className="text-fg-muted">
                    {' '}
                    · {formatDateTime(m.createdAt)}
                    {m.userName && ` · ${m.userName}`}
                    {m.accountName && ` · ${m.kind === 'withdrawal' ? 'para' : 'de'} ${m.accountName}`}
                  </span>
                </span>
                <span className="whitespace-nowrap tabular-nums">
                  {m.kind === 'withdrawal' ? '−' : '+'}
                  {brl(m.amount)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {s.notes && (
        <p>
          <span className="font-medium">Observações:</span> {s.notes}
        </p>
      )}
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-muted px-4 py-3">
      <dt className="text-fg-muted">{label}</dt>
      <dd className="mt-0.5 font-medium tabular-nums">{value}</dd>
    </div>
  );
}

function MoveModal({ session, kind, overview, onClose }: { session: RegisterSession; kind: RegisterMoveKind; overview: RegistersOverview; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [accountId, setAccountId] = useState('');
  const others = overview.accounts.filter((a) => a.id !== overview.cashAccountId);
  const value = parseMoney(amount);
  const valid = value > 0 && reason.trim().length >= 3;
  const save = useMutation({
    mutationFn: () => api<RegisterSession>(`/sales/registers/sessions/${session.id}/moves`, { method: 'POST', body: { kind, amount: cents(value) / 100, reason, accountId: accountId || null } }),
    onSuccess: (updated) => {
      queryClient.setQueryData([...registersKey, 'session', session.id], updated);
      queryClient.invalidateQueries({ queryKey: registersKey });
      onClose();
    },
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    if (valid) save.mutate();
  }
  const withdrawal = kind === 'withdrawal';
  return (
    <Modal
      open
      title={`${registerMoveLabel[kind]} · ${session.register.name}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="register-move-form" loading={save.isPending} disabled={!valid}>
            Registrar {registerMoveLabel[kind].toLowerCase()}
          </Button>
        </>
      }
    >
      <form id="register-move-form" onSubmit={submit} className="space-y-4">
        {save.error && <Alert>{errorText(save.error, 'Erro ao registrar')}</Alert>}
        <p className="text-sm text-fg-muted">
          {withdrawal ? 'Dinheiro retirado da gaveta.' : 'Dinheiro colocado na gaveta (reforço de troco).'} Dinheiro esperado agora: {brl(session.expectedCash)}.
        </p>
        <Field label="Valor">
          {(id) => <Input id={id} inputMode="decimal" className="w-40 text-right tabular-nums" placeholder="0,00" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />}
        </Field>
        <Field label="Motivo">{(id) => <Input id={id} value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder={withdrawal ? 'Depósito no banco, excesso de dinheiro…' : 'Reforço de troco…'} />}</Field>
        <Field
          label={withdrawal ? 'Para onde vai o dinheiro' : 'De onde vem o dinheiro'}
          hint={accountId ? 'Transferência entre contas no financeiro (não é receita nem despesa).' : withdrawal ? 'Lançada como despesa no financeiro.' : 'Lançado como receita no financeiro.'}
        >
          {(id) => (
            <Select id={id} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              <option value="">{withdrawal ? 'Saiu do negócio (despesa, pagamento em dinheiro)' : 'Entrou no negócio (aporte, outra receita)'}</option>
              {others.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </form>
    </Modal>
  );
}

function CloseModal({ session, onClose, onClosed }: { session: RegisterSession; onClose: () => void; onClosed: (s: RegisterSession) => void }) {
  const queryClient = useQueryClient();
  const expected = new Map(session.totals.map((t) => [t.method, t.expected]));
  // Dinheiro sempre; cartões, Pix e outro só se houve venda nessa forma.
  const methods = countedMethods.filter((m) => m === 'cash' || expected.has(m));
  const [values, setValues] = useState<Partial<Record<CountedMethod, string>>>({});
  const [notes, setNotes] = useState('');
  const parsed = (m: CountedMethod) => {
    const raw = values[m]?.trim();
    return raw ? cents(parseMoney(raw)) / 100 : null;
  };
  const cash = parsed('cash');
  const invalid = cash === null || !(cash >= 0) || methods.some((m) => {
    const v = parsed(m);
    return v !== null && !(v >= 0);
  });
  const close = useMutation({
    mutationFn: () =>
      api<RegisterSession>(`/sales/registers/sessions/${session.id}/close`, {
        method: 'POST',
        body: { counted: Object.fromEntries(methods.map((m) => [m, parsed(m)])), notes: notes.trim() || null },
      }),
    onSuccess: (closed) => {
      queryClient.setQueryData([...registersKey, 'session', session.id], closed);
      queryClient.invalidateQueries({ queryKey: salesKey });
      onClosed(closed);
    },
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    if (!invalid) close.mutate();
  }

  return (
    <Modal
      open
      title={`Fechar ${session.register.name}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          <Button type="submit" form="register-close-form" loading={close.isPending} disabled={invalid}>
            Fechar caixa
          </Button>
        </>
      }
    >
      <form id="register-close-form" onSubmit={submit} className="space-y-4">
        {close.error && <Alert>{errorText(close.error, 'Erro ao fechar o caixa')}</Alert>}
        <p className="text-sm text-fg-muted">
          Conte o dinheiro da gaveta e, se quiser, confira os comprovantes de cartão e Pix. Depois de fechado, o caixa não pode mais ser alterado.
        </p>
        <Table>
          <thead>
            <tr>
              <Th>Forma</Th>
              <Th className="text-right">Esperado</Th>
              <Th className="text-right">Contado</Th>
              <Th className="text-right">Diferença</Th>
            </tr>
          </thead>
          <tbody>
            {methods.map((m) => {
              const exp = expected.get(m) ?? 0;
              const v = parsed(m);
              return (
                <tr key={m}>
                  <Td>{m === 'cash' ? 'Dinheiro' : salePaymentLabel[m]}</Td>
                  <Td className="text-right tabular-nums">{brl(exp)}</Td>
                  <Td className="text-right">
                    <Input
                      aria-label={`Contado em ${salePaymentLabel[m]}`}
                      inputMode="decimal"
                      className="ml-auto w-32 text-right tabular-nums"
                      placeholder={m === 'cash' ? '0,00' : 'não conferido'}
                      value={values[m] ?? ''}
                      onChange={(e) => setValues({ ...values, [m]: e.target.value })}
                      required={m === 'cash'}
                      autoFocus={m === 'cash'}
                    />
                  </Td>
                  <Td className="text-right">{v === null || !(v >= 0) ? <span className="text-fg-subtle">—</span> : <DifferenceBadge value={(cents(v) - cents(exp)) / 100} />}</Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
        {expected.has('on_account') && <p className="text-sm text-fg-muted">Fiado (a receber): {brl(expected.get('on_account')!)}, não entra na conferência.</p>}
        <Field label="Observações">{(id) => <Textarea id={id} value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} />}</Field>
      </form>
    </Modal>
  );
}

// ---- Relatório de fechamento (impressora térmica 80 mm) ---------------------------------------

/** Relatório de fechamento para impressora térmica (80 mm). Fica escondido na tela, aparece na impressão. */
export function ClosingReport({ session: s }: { session: RegisterSession }) {
  const { tenant } = useSession();
  const line = <div className="my-1 border-t border-dashed border-black" />;
  const row = (label: string, value: string, bold = false) => (
    <div className={bold ? 'flex justify-between font-bold' : 'flex justify-between'}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
  return (
    <div className="hidden w-[72mm] font-mono text-[11px] leading-snug text-black print:block">
      <div className="text-center font-bold">{tenant.name}</div>
      <div className="text-center font-bold">FECHAMENTO DE CAIXA</div>
      <div className="text-center">
        {s.register.name} · sessão #{s.number}
      </div>
      {line}
      {row('Abertura', new Date(s.openedAt).toLocaleString('pt-BR'))}
      {s.openedByName && row('  por', s.openedByName)}
      {s.closedAt && row('Fechamento', new Date(s.closedAt).toLocaleString('pt-BR'))}
      {s.closedByName && row('  por', s.closedByName)}
      {s.status === 'open' && <div className="text-center font-bold">PARCIAL (CAIXA ABERTO)</div>}
      {line}
      {row('Troco inicial', brl(s.openingFloat))}
      {row(`Vendas (${s.salesCount})`, brl(s.salesTotal))}
      {row('Suprimentos', brl(s.deposits))}
      {row('Sangrias', `-${brl(s.withdrawals)}`)}
      {line}
      {s.totals.map((t) => (
        <div key={t.method} className="mb-1">
          <div className="font-bold">{t.method === 'cash' ? 'Dinheiro (gaveta)' : salePaymentLabel[t.method]}</div>
          {row('  Esperado', brl(t.expected))}
          {t.counted !== null && row('  Contado', brl(t.counted))}
          {t.difference !== null && row(t.difference > 0 ? '  Sobra' : t.difference < 0 ? '  Quebra' : '  Diferença', brl(Math.abs(t.difference)))}
        </div>
      ))}
      {s.moves.length > 0 && (
        <>
          {line}
          {s.moves.map((m) => (
            <div key={m.id}>
              {row(`${registerMoveLabel[m.kind]} ${new Date(m.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`, `${m.kind === 'withdrawal' ? '-' : ''}${brl(m.amount)}`)}
              <div>  {m.reason}</div>
            </div>
          ))}
        </>
      )}
      {s.notes && (
        <>
          {line}
          <div>Obs.: {s.notes}</div>
        </>
      )}
      {line}
      <div className="mt-6 border-t border-black text-center">Operador</div>
      <div className="mt-6 border-t border-black text-center">Conferente</div>
      <div className="mt-2 text-center">Não é documento fiscal</div>
    </div>
  );
}


