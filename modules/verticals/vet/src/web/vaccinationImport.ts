import { api, type ImportRow, type ImportSpec } from '@all/module-sdk/web';

const text = (row: ImportRow, k: string) => (row[k] === null || row[k] === undefined ? undefined : String(row[k]));
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');
const digitsOf = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '');

interface CustomerHit {
  id: string;
  name: string;
  document: string | null;
  phone: string | null;
}

/** Busca feita uma vez só por chave durante a importação (falha de rede não fica guardada). */
function cached<T>(load: (key: string) => Promise<T>) {
  const cache = new Map<string, Promise<T>>();
  return (key: string) => {
    let hit = cache.get(key);
    if (!hit) {
      hit = load(key);
      hit.catch(() => cache.delete(key));
      cache.set(key, hit);
    }
    return hit;
  };
}

/**
 * Histórico de vacinas (migração de outro sistema). O pet é achado pelo tutor (CPF, telefone
 * ou nome exato em Clientes) + nome do pet entre os pets desse tutor.
 */
export function vaccinationImportSpec(): ImportSpec {
  const searchCustomers = cached((q) => api<{ items: CustomerHit[] }>('/customers', { query: { q, limit: 100 } }).then((r) => r.items));
  const petsOf = cached((customerId) => api<{ id: string; name: string }[]>('/pets', { query: { customerId, limit: 200 } }));

  async function findTutor(value: string) {
    const digits = digitsOf(value);
    const byNumber = !/[a-z]/i.test(value) && digits.length >= 10;
    const items = await searchCustomers(byNumber ? digits : value.trim());
    const found = byNumber
      ? items.filter((c) => c.document === digits || digitsOf(c.phone) === digits || digitsOf(c.phone) === `55${digits}`)
      : items.filter((c) => fold(c.name) === fold(value));
    if (found.length === 1) return found[0]!.id;
    if (found.length > 1) throw new Error(`Tutor: há mais de um cadastro "${value}"; informe o CPF`);
    throw new Error(`Tutor: "${value}" não encontrado em Clientes`);
  }

  async function findPet(tutor: string, name: string) {
    const found = (await petsOf(await findTutor(tutor))).filter((p) => fold(p.name) === fold(name));
    if (found.length === 1) return found[0]!.id;
    throw new Error(found.length ? `Pet: o tutor tem mais de um pet chamado "${name}"` : `Pet: "${name}" não está cadastrado para o tutor ${tutor}`);
  }

  return {
    entity: 'vacinas',
    fileName: 'historico-de-vacinas',
    columns: [
      { key: 'tutor', label: 'Tutor', required: true, example: '123.456.789-09', hint: 'CPF ou telefone do tutor, ou o nome exatamente como está em Clientes' },
      { key: 'pet', label: 'Pet', required: true, example: 'Thor', hint: 'Nome do pet, como está na ficha do tutor' },
      { key: 'vaccine', label: 'Vacina', required: true, example: 'V10 (polivalente canina)' },
      { key: 'dose', label: 'Dose', example: 'Reforço' },
      { key: 'appliedOn', label: 'Aplicada em', required: true, type: 'date', example: '10/03/2025' },
      { key: 'nextDueOn', label: 'Próximo reforço', type: 'date', example: '10/03/2026', hint: 'Data no formato dd/mm/aaaa; o tutor é lembrado antes' },
      { key: 'batch', label: 'Lote', example: 'AB1234' },
      { key: 'manufacturer', label: 'Fabricante', example: 'Zoetis' },
      { key: 'veterinarian', label: 'Veterinário', example: 'Dra. Paula Reis', hint: 'Quem aplicou; vai para as observações' },
      { key: 'notes', label: 'Observações' },
    ],
    create: async (row) => {
      const vet = text(row, 'veterinarian');
      const notes = [vet && `Aplicada por ${vet}`, text(row, 'notes')].filter(Boolean).join('. ');
      return api('/vet/vaccinations', {
        method: 'POST',
        body: {
          petId: await findPet(text(row, 'tutor')!, text(row, 'pet')!),
          vaccine: text(row, 'vaccine'),
          // Importar a mesma planilha de novo não duplica: a mesma vacina na mesma data é ignorada.
          skipDuplicate: true,
          dose: text(row, 'dose') ?? null,
          appliedOn: row.appliedOn,
          nextDueOn: row.nextDueOn,
          batch: text(row, 'batch') ?? null,
          manufacturer: text(row, 'manufacturer') ?? null,
          notes: notes || null,
        },
      });
    },
  };
}
