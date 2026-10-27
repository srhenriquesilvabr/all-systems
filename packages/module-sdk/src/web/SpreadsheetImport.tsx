import { Alert, Badge, Button, Modal, Table, Td, Th } from '@all/ui';
import { useRef, useState, type ChangeEvent } from 'react';
import { ApiError } from './api';
import { downloadErrors, downloadTemplate, parseRows, readSpreadsheet, type ImportColumn, type ImportRow, type ParsedRow } from './spreadsheet';

export interface ImportSpec {
  /** No plural e minúsculo, para as mensagens: "clientes", "produtos". */
  entity: string;
  /** Nome do arquivo do modelo, sem extensão. */
  fileName: string;
  columns: ImportColumn[];
  /** Cadastra uma linha já convertida (mesma rota e validação do cadastro manual). */
  create: (row: ImportRow) => Promise<unknown>;
}

type Step = { kind: 'pick' } | { kind: 'preview'; rows: ParsedRow[]; missing: string[] } | { kind: 'running'; done: number; total: number } | { kind: 'done'; ok: number; failed: Failed[] };
type Failed = { row: ParsedRow; message: string };

const PARALLEL = 3;
const PREVIEW = 50;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function messageOf(err: unknown) {
  if (err instanceof ApiError) return err.message;
  return err instanceof Error ? err.message : 'Erro ao cadastrar';
}

/** Cadastra uma linha, esperando e tentando de novo se a API pedir calma (limite de requisições). */
async function createWithRetry(spec: ImportSpec, row: ImportRow) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await spec.create(row);
    } catch (err) {
      if (err instanceof ApiError && err.status === 429 && attempt < 5) {
        await sleep(3000 * 2 ** attempt);
        continue;
      }
      throw err;
    }
  }
}

/**
 * Botões "Baixar modelo" e "Importar planilha" de uma tela de cadastro. A planilha é lida no
 * navegador; cada linha válida vai para a mesma rota do cadastro manual, e o que a API recusar
 * volta num relatório para corrigir e importar de novo.
 */
export function SpreadsheetImport({ spec, onImported }: { spec: ImportSpec; onImported?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" onClick={() => downloadTemplate(`modelo-${spec.fileName}`, spec.columns)}>
        Baixar modelo
      </Button>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Importar planilha
      </Button>
      {open && (
        <ImportPanel
          spec={spec}
          onClose={() => setOpen(false)}
          onImported={onImported}
        />
      )}
    </>
  );
}

function ImportPanel({ spec, onClose, onImported }: { spec: ImportSpec; onClose: () => void; onImported?: () => void }) {
  const [step, setStep] = useState<Step>({ kind: 'pick' });
  const [readError, setReadError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const shown = spec.columns.slice(0, 3);

  async function pick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setReadError(null);
    try {
      const { header, rows } = await readSpreadsheet(file);
      const parsed = parseRows(spec.columns, header, rows);
      if (!parsed.rows.length) return setReadError('A planilha não tem linhas preenchidas.');
      setStep({ kind: 'preview', rows: parsed.rows, missing: parsed.missingColumns });
    } catch {
      setReadError('Não foi possível ler o arquivo. Use .xlsx, .xls ou .csv.');
    }
  }

  async function run(rows: ParsedRow[]) {
    const valid = rows.filter((r) => !r.errors.length);
    const failed: Failed[] = rows.filter((r) => r.errors.length).map((row) => ({ row, message: row.errors.join('; ') }));
    let ok = 0;
    let done = 0;
    setStep({ kind: 'running', done, total: valid.length });
    const queue = [...valid];
    await Promise.all(
      Array.from({ length: PARALLEL }, async () => {
        for (let row = queue.shift(); row; row = queue.shift()) {
          try {
            await createWithRetry(spec, row.values);
            ok++;
          } catch (err) {
            failed.push({ row, message: messageOf(err) });
          }
          setStep({ kind: 'running', done: ++done, total: valid.length });
        }
      }),
    );
    failed.sort((a, b) => a.row.line - b.row.line);
    setStep({ kind: 'done', ok, failed });
    if (ok) onImported?.();
  }

  const footer =
    step.kind === 'preview' ? (
      <>
        <Button variant="secondary" onClick={() => setStep({ kind: 'pick' })}>
          Escolher outro arquivo
        </Button>
        <Button disabled={!step.rows.some((r) => !r.errors.length) || step.missing.length > 0} onClick={() => run(step.rows)}>
          Importar {step.rows.filter((r) => !r.errors.length).length} linha(s)
        </Button>
      </>
    ) : step.kind === 'done' ? (
      <>
        {step.failed.length > 0 && (
          <Button variant="secondary" onClick={() => downloadErrors(spec.fileName, spec.columns, step.failed)}>
            Baixar linhas com erro
          </Button>
        )}
        <Button onClick={onClose}>Concluir</Button>
      </>
    ) : step.kind === 'pick' ? (
      <Button variant="secondary" onClick={onClose}>
        Cancelar
      </Button>
    ) : undefined;

  return (
    <Modal open title={`Importar ${spec.entity}`} onClose={step.kind === 'running' ? () => {} : onClose} footer={footer}>
      {step.kind === 'pick' && (
        <div className="space-y-4 text-sm">
          <p className="text-fg-muted">
            Use o modelo: ele traz as colunas aceitas e, na aba “Instruções”, o que é obrigatório e como preencher cada uma. Cada linha é validada como no
            cadastro manual; as que tiverem problema voltam num relatório para você corrigir.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => input.current?.click()}>Escolher planilha</Button>
            <Button variant="secondary" onClick={() => downloadTemplate(`modelo-${spec.fileName}`, spec.columns)}>
              Baixar modelo
            </Button>
          </div>
          <input ref={input} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={pick} />
          {readError && <Alert>{readError}</Alert>}
        </div>
      )}

      {step.kind === 'preview' && (
        <div className="space-y-4">
          {step.missing.length > 0 && <Alert>Faltam colunas obrigatórias na planilha: {step.missing.join(', ')}. Use o modelo.</Alert>}
          <p className="text-sm text-fg-muted">
            {step.rows.length} linha(s) lida(s): <strong className="text-fg">{step.rows.filter((r) => !r.errors.length).length} pronta(s)</strong> e{' '}
            {step.rows.filter((r) => r.errors.length).length} com problema (não serão importadas).
            {step.rows.length > PREVIEW && ` Mostrando as ${PREVIEW} primeiras.`}
          </p>
          <div className="overflow-x-auto rounded-xl border border-line">
            <Table>
              <thead>
                <tr>
                  <Th>Linha</Th>
                  {shown.map((c) => (
                    <Th key={c.key}>{c.label}</Th>
                  ))}
                  <Th>Situação</Th>
                </tr>
              </thead>
              <tbody>
                {step.rows.slice(0, PREVIEW).map((r) => (
                  <tr key={r.line}>
                    <Td className="tabular-nums text-fg-muted">{r.line}</Td>
                    {shown.map((c) => (
                      <Td key={c.key}>{String(r.raw[c.label] ?? '')}</Td>
                    ))}
                    <Td>{r.errors.length ? <span className="text-sm text-danger-700">{r.errors.join('; ')}</span> : <Badge tone="success">Pronta</Badge>}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        </div>
      )}

      {step.kind === 'running' && (
        <div className="space-y-3 py-4" aria-live="polite">
          <p className="text-sm">
            Importando {step.done} de {step.total}… Não feche esta tela.
          </p>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-brand-600 transition-[width]" style={{ width: `${step.total ? (step.done / step.total) * 100 : 0}%` }} />
          </div>
        </div>
      )}

      {step.kind === 'done' && (
        <div className="space-y-4">
          <Alert tone={step.failed.length ? 'info' : 'success'}>
            {step.ok} {spec.entity} importado(s).{step.failed.length > 0 && ` ${step.failed.length} linha(s) não entraram: baixe o relatório, corrija e importe só elas de novo.`}
          </Alert>
          {step.failed.length > 0 && (
            <ul className="max-h-80 space-y-1 overflow-y-auto text-sm">
              {step.failed.map((f) => (
                <li key={f.row.line}>
                  <span className="tabular-nums text-fg-muted">Linha {f.row.line}:</span> {f.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Modal>
  );
}
