import { api, type ImportRow, type ImportSpec } from '@all/module-sdk/web';
import { pricingUnitLabel, pricingUnits } from '../contracts';

const text = (row: ImportRow, k: string) => (row[k] === null || row[k] === undefined ? undefined : String(row[k]));

/** Planilha de serviços: mesmos campos do cadastro manual. */
export const serviceImportSpec: ImportSpec = {
  entity: 'serviços',
  fileName: 'servicos-lavanderia',
  columns: [
    { key: 'name', label: 'Nome', required: true, example: 'Lavar e passar' },
    { key: 'pricingUnit', label: 'Cobrança', required: true, type: 'enum', options: pricingUnits.map((u) => ({ value: u, label: pricingUnitLabel[u] })), example: 'por peça' },
    { key: 'basePrice', label: 'Preço (R$)', required: true, type: 'money', example: '12,90' },
    { key: 'turnaroundHours', label: 'Prazo de entrega (horas)', required: true, type: 'integer', example: 48, hint: 'Em horas: 48 = 2 dias' },
    { key: 'active', label: 'Serviço ativo', type: 'boolean', example: 'Sim', hint: 'Sim ou Não (vazio = Sim)' },
  ],
  create: (row) =>
    api('/laundry/services', {
      method: 'POST',
      body: { name: text(row, 'name'), pricingUnit: row.pricingUnit, basePrice: row.basePrice, turnaroundHours: row.turnaroundHours, active: row.active ?? true },
    }),
};

/** Planilha de tipos de peça: só o nome. */
export const garmentTypeImportSpec: ImportSpec = {
  entity: 'tipos de peça',
  fileName: 'tipos-de-peca',
  columns: [{ key: 'name', label: 'Tipo de peça', required: true, example: 'Vestido de festa', hint: 'De 2 a 40 letras' }],
  create: (row) => api('/laundry/garment-types', { method: 'POST', body: { name: text(row, 'name') } }),
};
