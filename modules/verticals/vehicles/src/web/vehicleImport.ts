import { api, type ImportOption, type ImportRow, type ImportSpec } from '@all/module-sdk/web';
import { fuelLabel, transmissionLabel, vehicleKindLabel, vehicleStatusLabel } from '../contracts';

const text = (row: ImportRow, k: string) => (row[k] === null || row[k] === undefined ? undefined : String(row[k]));
const options = (labels: Record<string, string>): ImportOption[] => Object.entries(labels).map(([value, label]) => ({ value, label }));

/** Planilha de estoque: mesmos campos do cadastro manual (fotos ficam para a ficha do veículo). */
export const vehicleImportSpec: ImportSpec = {
  entity: 'veículos',
  fileName: 'estoque-veiculos',
  columns: [
    { key: 'kind', label: 'Tipo', type: 'enum', options: options(vehicleKindLabel), example: 'Carro', hint: `Um destes: ${Object.values(vehicleKindLabel).join(', ')} (vazio = Carro)` },
    { key: 'brand', label: 'Marca', required: true, example: 'Volkswagen' },
    { key: 'model', label: 'Modelo', required: true, example: 'Polo' },
    { key: 'version', label: 'Versão', example: '1.0 Turbo Highline' },
    { key: 'yearManufacture', label: 'Ano fabricação', required: true, type: 'integer', example: 2022 },
    { key: 'yearModel', label: 'Ano modelo', required: true, type: 'integer', example: 2023, hint: 'Igual ao de fabricação ou o ano seguinte' },
    { key: 'plate', label: 'Placa', example: 'ABC1D23', hint: 'ABC1D23 ou ABC-1234' },
    { key: 'color', label: 'Cor', example: 'Prata' },
    { key: 'km', label: 'Quilometragem', type: 'integer', example: 35000, hint: 'Número inteiro, sem "km" (vazio = 0)' },
    { key: 'fuel', label: 'Combustível', type: 'enum', options: options(fuelLabel), example: 'Flex', hint: `Um destes: ${Object.values(fuelLabel).join(', ')} (vazio = Flex)` },
    { key: 'transmission', label: 'Câmbio', type: 'enum', options: options(transmissionLabel), example: 'Manual', hint: `Um destes: ${Object.values(transmissionLabel).join(', ')} (vazio = Manual)` },
    { key: 'fipeCode', label: 'Código FIPE', example: '005340-6', hint: 'Formato 000000-0 (formate a célula como texto)' },
    { key: 'fipePrice', label: 'Valor FIPE (R$)', type: 'money', example: '89.500,00' },
    { key: 'cost', label: 'Custo (R$)', type: 'money', example: '78.000,00' },
    { key: 'price', label: 'Preço de venda (R$)', required: true, type: 'money', example: '92.900,00' },
    { key: 'status', label: 'Situação', type: 'enum', options: options(vehicleStatusLabel), example: 'Disponível', hint: `Um destes: ${Object.values(vehicleStatusLabel).join(', ')} (vazio = Disponível)` },
    { key: 'notes', label: 'Observações (opcionais, itens, revisões)' },
  ],
  create: (row) =>
    api('/vehicles/stock', {
      method: 'POST',
      body: {
        kind: row.kind ?? undefined,
        brand: text(row, 'brand'),
        model: text(row, 'model'),
        version: text(row, 'version') ?? null,
        yearManufacture: row.yearManufacture,
        yearModel: row.yearModel,
        plate: text(row, 'plate') ?? null,
        color: text(row, 'color') ?? null,
        km: row.km ?? 0,
        fuel: row.fuel ?? undefined,
        transmission: row.transmission ?? undefined,
        fipeCode: text(row, 'fipeCode') ?? null,
        fipePrice: row.fipePrice,
        cost: row.cost,
        price: row.price,
        status: row.status ?? undefined,
        notes: text(row, 'notes') ?? null,
      },
    }),
};
