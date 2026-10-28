import { api, type ImportColumn, type ImportRow, type ImportSpec } from '@all/module-sdk/web';
import { productKindLabel, productKinds, productUnitLabel, productUnits } from '../../contracts';

const columns: ImportColumn[] = [
  { key: 'name', label: 'Produto', required: true, example: 'Toxina botulínica 100 U', hint: 'Se ainda não existir, é cadastrado com o tipo e a unidade da linha' },
  { key: 'brand', label: 'Marca / fabricante', example: 'Botox (Allergan)' },
  {
    key: 'kind',
    label: 'Tipo',
    type: 'enum',
    options: productKinds.map((k) => ({ value: k, label: productKindLabel[k] })),
    example: productKindLabel.toxin,
    hint: productKinds.map((k) => productKindLabel[k]).join(', '),
  },
  { key: 'unit', label: 'Unidade', type: 'enum', options: productUnits.map((u) => ({ value: u, label: productUnitLabel[u] })), example: 'U', hint: productUnits.join(', ') },
  { key: 'anvisaRegistration', label: 'Registro Anvisa', example: '1004300120024', hint: 'Formate a coluna como texto para não perder zeros' },
  { key: 'unitsPerPackage', label: 'Quantidade por embalagem', type: 'number', example: 100, hint: 'Ex.: 100 (U por frasco), 1 (ml por seringa). Usado na baixa do estoque' },
  { key: 'lot', label: 'Lote', required: true, example: 'C7845A2' },
  { key: 'expiresOn', label: 'Validade', type: 'date', required: true, example: '31/12/2027' },
  { key: 'receivedOn', label: 'Recebido em', type: 'date', example: '15/10/2026' },
  { key: 'quantity', label: 'Quantidade recebida', type: 'number', example: 300, hint: 'Na unidade do produto (ex.: 300 U = 3 frascos)' },
];

/** Planilha de lotes (e dos produtos, se ainda não cadastrados): mesma rota do cadastro manual. */
export const lotImportSpec: ImportSpec = {
  entity: 'lotes',
  fileName: 'lotes-de-produtos',
  columns,
  create: (row: ImportRow) => {
    const text = (k: string) => (row[k] === null || row[k] === undefined || row[k] === '' ? null : String(row[k]));
    return api('/aesthetics/lots', {
      method: 'POST',
      body: {
        product: {
          name: text('name'),
          brand: text('brand'),
          kind: row.kind ?? undefined,
          unit: row.unit ?? undefined,
          anvisaRegistration: text('anvisaRegistration'),
          unitsPerPackage: row.unitsPerPackage ?? null,
        },
        lot: text('lot'),
        expiresOn: row.expiresOn,
        receivedOn: row.receivedOn ?? null,
        quantity: row.quantity ?? null,
      },
    });
  },
};
