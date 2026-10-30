import { api, ApiError, useCan } from '@all/module-sdk/web';
import { Alert, Button, Card, Field, Input, PageHeader, Spinner } from '@all/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { taxTables, type TaxTables } from '../contracts';
import { hrKey } from './hrKey';

type Settings = { tables: TaxTables; payDay: number };
type InssRow = { upTo: string; rate: string };
type IrrfRow = { upTo: string; rate: string; deduction: string };

const text = (n: number) => String(n).replace('.', ',');
const percent = (rate: number) => text(Math.round(rate * 10_000) / 100);
const num = (s: string) => Number(s.trim().replace(/\./g, '').replace(',', '.'));
const ascending = (values: number[]) => values.every((v, i) => i === 0 || v > values[i - 1]!);

/** Tabelas de INSS e IRRF da folha. Valem para as folhas abertas daqui em diante. */
export function TaxTablesPage() {
  const queryClient = useQueryClient();
  const canEdit = useCan('core.access.settings');
  const settings = useQuery({ queryKey: [...hrKey, 'settings'], queryFn: () => api<Settings>('/modules/hr/settings') });
  const [label, setLabel] = useState('');
  const [inss, setInss] = useState<InssRow[]>([]);
  const [irrf, setIrrf] = useState<IrrfRow[]>([]);
  const [dependent, setDependent] = useState('');
  const [simplified, setSimplified] = useState('');
  const [payDay, setPayDay] = useState('5');
  const [saved, setSaved] = useState(false);
  const [invalid, setInvalid] = useState<string | null>(null);

  function fill(t: TaxTables, day: number) {
    setLabel(t.label);
    setInss(t.inss.map((b) => ({ upTo: text(b.upTo), rate: percent(b.rate) })));
    setIrrf(t.irrf.map((b) => ({ upTo: b.upTo === null ? '' : text(b.upTo), rate: percent(b.rate), deduction: text(b.deduction) })));
    setDependent(text(t.dependentDeduction));
    setSimplified(text(t.simplifiedDiscount));
    setPayDay(String(day));
  }
  useEffect(() => {
    if (settings.data) fill(settings.data.tables, settings.data.payDay);
  }, [settings.data]);

  const save = useMutation({
    mutationFn: (body: Settings) => api('/modules/hr/settings', { method: 'PUT', body }),
    onSuccess: () => {
      setSaved(true);
      queryClient.invalidateQueries({ queryKey: hrKey });
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setSaved(false);
    const inssBands = inss.map((b) => ({ upTo: num(b.upTo), rate: num(b.rate) / 100 }));
    const irrfBands = irrf.map((b, i) => ({ upTo: i === irrf.length - 1 ? null : num(b.upTo), rate: num(b.rate) / 100, deduction: num(b.deduction) }));
    const limits = irrfBands.slice(0, -1).map((b) => b.upTo as number);
    const numbers = [...inssBands.flatMap((b) => [b.upTo, b.rate]), ...irrfBands.flatMap((b) => [b.upTo ?? 0, b.rate, b.deduction]), num(dependent), num(simplified)];
    if (numbers.some((n) => !Number.isFinite(n) || n < 0)) return setInvalid('Confira os valores: use só números, como 1.621,00.');
    if (!ascending(inssBands.map((b) => b.upTo)) || !ascending(limits)) return setInvalid('Os limites de cada tabela precisam estar em ordem crescente.');
    setInvalid(null);
    save.mutate({ payDay: Number(payDay), tables: { ...settings.data!.tables, label, inss: inssBands, irrf: irrfBands, dependentDeduction: num(dependent), simplifiedDiscount: num(simplified) } });
  }

  if (settings.isPending) return <Spinner />;
  if (settings.isError) return <Alert>{settings.error.message}</Alert>;
  const standard = taxTables.parse({});

  return (
    <>
      <PageHeader title="Tabelas da folha" description="INSS e IRRF usados no cálculo. Confira sempre com a contabilidade quando o governo publicar valores novos." />
      <form onSubmit={submit} className="max-w-3xl space-y-4">
        {invalid && <Alert>{invalid}</Alert>}
        {save.error && <Alert>{save.error instanceof ApiError ? save.error.message : 'Erro ao salvar'}</Alert>}
        {saved && <Alert tone="success">Tabelas salvas. Valem para as folhas abertas daqui em diante.</Alert>}
        <Alert tone="info">Folha já fechada não muda. Folha mensal aberta continua com as tabelas de quando foi aberta, até você clicar em &quot;Usar tabelas atuais&quot; nela.</Alert>
        <Card className="space-y-4 p-5">
          <Field label="Nome destas tabelas (aparece no cabeçalho da folha)">{(id) => <Input id={id} required maxLength={120} disabled={!canEdit} value={label} onChange={(e) => setLabel(e.target.value)} />}</Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Dedução por dependente (R$)">{(id) => <Input id={id} required inputMode="decimal" disabled={!canEdit} value={dependent} onChange={(e) => setDependent(e.target.value)} />}</Field>
            <Field label="Desconto simplificado (R$)">{(id) => <Input id={id} required inputMode="decimal" disabled={!canEdit} value={simplified} onChange={(e) => setSimplified(e.target.value)} />}</Field>
            <Field label="Dia do pagamento (1 a 10)">{(id) => <Input id={id} type="number" required min={1} max={10} disabled={!canEdit} value={payDay} onChange={(e) => setPayDay(e.target.value)} />}</Field>
          </div>
        </Card>
        <Card className="p-5">
          <h2 className="mb-3 font-medium">INSS do empregado</h2>
          <div className="space-y-2">
            {inss.map((b, i) => (
              <div key={i} className="grid grid-cols-2 gap-3">
                <Field label={`Faixa ${i + 1}: até (R$)`}>{(id) => <Input id={id} required inputMode="decimal" disabled={!canEdit} value={b.upTo} onChange={(e) => setInss(inss.map((x, j) => (j === i ? { ...x, upTo: e.target.value } : x)))} />}</Field>
                <Field label="Alíquota (%)">{(id) => <Input id={id} required inputMode="decimal" disabled={!canEdit} value={b.rate} onChange={(e) => setInss(inss.map((x, j) => (j === i ? { ...x, rate: e.target.value } : x)))} />}</Field>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-fg-muted">Acima da última faixa, o desconto para no teto.</p>
        </Card>
        <Card className="p-5">
          <h2 className="mb-3 font-medium">IRRF mensal</h2>
          <div className="space-y-2">
            {irrf.map((b, i) => (
              <div key={i} className="grid grid-cols-3 gap-3">
                {i === irrf.length - 1 ? (
                  <Field label={`Faixa ${i + 1}`}>{(id) => <Input id={id} disabled value="Acima da anterior" />}</Field>
                ) : (
                  <Field label={`Faixa ${i + 1}: até (R$)`}>{(id) => <Input id={id} required inputMode="decimal" disabled={!canEdit} value={b.upTo} onChange={(e) => setIrrf(irrf.map((x, j) => (j === i ? { ...x, upTo: e.target.value } : x)))} />}</Field>
                )}
                <Field label="Alíquota (%)">{(id) => <Input id={id} required inputMode="decimal" disabled={!canEdit} value={b.rate} onChange={(e) => setIrrf(irrf.map((x, j) => (j === i ? { ...x, rate: e.target.value } : x)))} />}</Field>
                <Field label="Parcela a deduzir (R$)">{(id) => <Input id={id} required inputMode="decimal" disabled={!canEdit} value={b.deduction} onChange={(e) => setIrrf(irrf.map((x, j) => (j === i ? { ...x, deduction: e.target.value } : x)))} />}</Field>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-fg-muted">A redução da Lei 15.270/2025 (isenção até R$ 5.000 e redução parcial até R$ 7.350) é aplicada automaticamente depois desta tabela.</p>
        </Card>
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <Button type="submit" loading={save.isPending}>
              Salvar
            </Button>
            <Button variant="secondary" onClick={() => fill(standard, 5)}>
              Voltar aos valores de fábrica
            </Button>
          </div>
        )}
      </form>
    </>
  );
}
