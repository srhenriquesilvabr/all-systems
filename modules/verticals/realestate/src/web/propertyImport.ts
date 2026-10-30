import { api, type ImportRow, type ImportSpec } from '@all/module-sdk/web';
import { manualPropertyStatuses, propertyStatusLabel, propertyTypeLabel, propertyTypes, purposeLabel } from '../contracts';

const text = (row: ImportRow, k: string) => (row[k] === null || row[k] === undefined ? undefined : String(row[k]));
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');
const digitsOf = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '');

interface CustomerHit {
  id: string;
  name: string;
  document: string | null;
}

/** Proprietário pelo CPF/CNPJ ou pelo nome exato. Cada termo é buscado uma vez só por importação. */
function ownerFinder() {
  const cache = new Map<string, Promise<CustomerHit[]>>();
  const search = (q: string) => {
    let hit = cache.get(q);
    if (!hit) {
      hit = api<{ items: CustomerHit[] }>('/customers', { query: { q, limit: 100 } }).then((r) => r.items);
      hit.catch(() => cache.delete(q));
      cache.set(q, hit);
    }
    return hit;
  };
  return async (value: string) => {
    const digits = digitsOf(value);
    const byDocument = !/[a-z]/i.test(value) && digits.length >= 11;
    const items = await search(byDocument ? digits : value.trim());
    const found = items.filter((c) => (byDocument ? c.document === digits : fold(c.name) === fold(value)));
    if (found.length === 1) return found[0]!.id;
    if (found.length > 1) throw new Error(`Proprietário: há mais de um cadastro "${value}"; informe o CPF/CNPJ`);
    throw new Error(`Proprietário: "${value}" não encontrado em Clientes; cadastre antes de importar`);
  };
}

/** Planilha de imóveis: mesmos campos da captação manual (fotos ficam para a ficha do imóvel). */
export function propertyImportSpec(): ImportSpec {
  const findOwner = ownerFinder();
  return {
    entity: 'imóveis',
    fileName: 'imoveis',
    columns: [
      { key: 'owner', label: 'Proprietário', required: true, example: '123.456.789-09', hint: 'CPF/CNPJ do proprietário ou o nome exatamente como está em Clientes' },
      { key: 'title', label: 'Título do anúncio', required: true, example: 'Apartamento 3 quartos com vista para o mar' },
      { key: 'type', label: 'Tipo', required: true, type: 'enum', options: propertyTypes.map((t) => ({ value: t, label: propertyTypeLabel[t] })), example: 'Apartamento' },
      { key: 'purpose', label: 'Finalidade', type: 'enum', options: Object.entries(purposeLabel).map(([value, label]) => ({ value, label })), example: 'Venda', hint: `Um destes: ${Object.values(purposeLabel).join(', ')} (vazio = Venda)` },
      { key: 'status', label: 'Situação', type: 'enum', options: manualPropertyStatuses.map((s) => ({ value: s, label: propertyStatusLabel[s] })), example: 'Disponível', hint: `Um destes: ${manualPropertyStatuses.map((s) => propertyStatusLabel[s]).join(', ')} (vazio = Disponível). Reservado, Vendido e Alugado vêm da proposta e do contrato.` },
      { key: 'zip', label: 'CEP', example: '88015-200' },
      { key: 'street', label: 'Rua', required: true, example: 'Rua Felipe Schmidt' },
      { key: 'number', label: 'Número', example: '500' },
      { key: 'complement', label: 'Complemento', example: 'Apto 801' },
      { key: 'district', label: 'Bairro', required: true, example: 'Centro' },
      { key: 'city', label: 'Cidade', required: true, example: 'Florianópolis' },
      { key: 'state', label: 'UF', required: true, example: 'SC', hint: 'Sigla do estado, 2 letras' },
      { key: 'areaM2', label: 'Área (m²)', type: 'number', example: '92,5' },
      { key: 'landM2', label: 'Área do terreno (m²)', type: 'number', example: '360' },
      { key: 'bedrooms', label: 'Quartos', type: 'integer', example: 3, hint: 'Número inteiro (vazio = 0)' },
      { key: 'suites', label: 'Suítes', type: 'integer', example: 1, hint: 'Número inteiro (vazio = 0)' },
      { key: 'bathrooms', label: 'Banheiros', type: 'integer', example: 2, hint: 'Número inteiro (vazio = 0)' },
      { key: 'parking', label: 'Vagas', type: 'integer', example: 1, hint: 'Número inteiro (vazio = 0)' },
      { key: 'salePrice', label: 'Preço de venda (R$)', type: 'money', example: '650.000,00', hint: 'Obrigatório na finalidade Venda ou Venda e locação' },
      { key: 'rentPrice', label: 'Aluguel (R$/mês)', type: 'money', hint: 'Obrigatório na finalidade Locação ou Venda e locação' },
      { key: 'condoFee', label: 'Condomínio (R$)', type: 'money', example: '850,00' },
      { key: 'iptuYearly', label: 'IPTU anual (R$)', type: 'money', example: '2.400,00' },
      { key: 'financeable', label: 'Aceita financiamento bancário', type: 'boolean', example: 'Sim', hint: 'Sim ou Não (vazio = Sim)' },
      { key: 'description', label: 'Descrição' },
    ],
    create: async (row) =>
      api('/real-estate/properties', {
        method: 'POST',
        body: {
          ownerId: await findOwner(text(row, 'owner')!),
          title: text(row, 'title'),
          type: row.type,
          purpose: row.purpose ?? undefined,
          status: row.status ?? undefined,
          // CEP digitado como número no Excel perde o zero à esquerda.
          zip: text(row, 'zip')?.padStart(8, '0') ?? null,
          street: text(row, 'street'),
          number: text(row, 'number') ?? null,
          complement: text(row, 'complement') ?? null,
          district: text(row, 'district'),
          city: text(row, 'city'),
          state: text(row, 'state'),
          areaM2: row.areaM2,
          landM2: row.landM2,
          bedrooms: row.bedrooms ?? undefined,
          suites: row.suites ?? undefined,
          bathrooms: row.bathrooms ?? undefined,
          parking: row.parking ?? undefined,
          salePrice: row.salePrice,
          rentPrice: row.rentPrice,
          condoFee: row.condoFee,
          iptuYearly: row.iptuYearly,
          financeable: row.financeable ?? true,
          description: text(row, 'description') ?? null,
        },
      }),
  };
}
