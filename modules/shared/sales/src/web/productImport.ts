import { api, ApiError, type ImportColumn, type ImportRow, type ImportSpec } from '@all/module-sdk/web';
import { unitLabel, units, type Product } from '../contracts';

const columns: ImportColumn[] = [
  { key: 'name', label: 'Nome', required: true, example: 'Pão francês' },
  { key: 'barcode', label: 'Código de barras (EAN)', example: '7891234567895', hint: 'De 8 a 14 dígitos. Formate a coluna como texto para não perder zeros à esquerda' },
  { key: 'sku', label: 'Código interno', example: 'PAO-01' },
  { key: 'category', label: 'Categoria', example: 'Pães' },
  { key: 'unit', label: 'Unidade', type: 'enum', options: units.map((u) => ({ value: u, label: unitLabel[u] })), example: 'kg', hint: `${units.join(', ')} ou o nome (${units.map((u) => unitLabel[u]).join(', ')}); vazio = un` },
  { key: 'price', label: 'Preço de venda (R$)', type: 'money', required: true, example: '18,90' },
  { key: 'cost', label: 'Custo (R$)', type: 'money', example: '9,50' },
  { key: 'minStock', label: 'Estoque mínimo', type: 'number', example: 5, hint: 'Abaixo disso aparece em “estoque baixo”' },
  { key: 'trackStock', label: 'Controlar estoque', type: 'boolean', example: 'Sim', hint: 'Sim ou Não (vazio = Sim)' },
  { key: 'active', label: 'Ativo', type: 'boolean', example: 'Sim', hint: 'Sim ou Não (vazio = Sim). Inativo não aparece no caixa' },
];

const initialStock: ImportColumn = {
  key: 'initialStock',
  label: 'Estoque inicial',
  type: 'number',
  example: 20,
  hint: 'Lançado como entrada (compra) logo depois do cadastro, com o custo informado. Só para produtos que controlam estoque',
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A entrada vem depois do produto criado: se a API pedir calma, espera em vez de falhar a linha. */
async function postMove(body: object) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await api('/sales/stock-moves', { method: 'POST', body });
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 429 && attempt < 4)) throw err;
      await sleep(3000 * 2 ** attempt);
    }
  }
}

/** Planilha de produtos. O "Estoque inicial" só aparece para quem pode lançar estoque. */
export function productImportSpec(canStock: boolean): ImportSpec {
  return {
    entity: 'produtos',
    fileName: 'produtos',
    columns: canStock ? [...columns, initialStock] : columns,
    create: async (row: ImportRow) => {
      const text = (k: string) => (row[k] === null || row[k] === undefined ? null : String(row[k]));
      const trackStock = (row.trackStock as boolean | null) ?? true;
      const stock = (row.initialStock as number | null) ?? null;
      if (stock !== null && stock < 0) throw new Error('Estoque inicial: não pode ser negativo');
      if (stock && !trackStock) throw new Error('Estoque inicial: o produto está com "Controlar estoque" = Não');

      const product = await api<Product>('/sales/products', {
        method: 'POST',
        body: {
          name: text('name'),
          barcode: text('barcode'),
          sku: text('sku'),
          category: text('category'),
          unit: row.unit ?? 'un',
          price: row.price,
          cost: row.cost,
          minStock: trackStock ? row.minStock : null,
          trackStock,
          active: row.active ?? true,
        },
      });

      if (stock) {
        try {
          await postMove({ productId: product.id, kind: 'purchase', quantity: stock, unitCost: row.cost, reason: 'Estoque inicial (planilha)' });
        } catch (err) {
          // O produto já existe: avisar para não importar a linha de novo (duplicaria o cadastro).
          const reason = err instanceof Error ? err.message : 'erro desconhecido';
          throw new Error(`Produto cadastrado, mas o estoque inicial não foi lançado (${reason}). Lance pela tela de estoque em vez de importar a linha de novo.`);
        }
      }
      return product;
    },
  };
}
