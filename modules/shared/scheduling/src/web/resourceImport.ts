import { api, type ImportColumn, type ImportRow, type ImportSpec } from '@all/module-sdk/web';
import type { Service } from '../contracts';
import { nameResolver } from './importNames';

const columns: ImportColumn[] = [
  {
    key: 'name',
    label: 'Nome',
    required: true,
    example: 'Ana Lima',
    hint: 'O horário de trabalho não vem da planilha: começa em seg. a sex. 9h–12h e 13h–18h, sáb. 9h–13h, e é ajustado na tela, em “Horários”',
  },
  {
    key: 'kind',
    label: 'Tipo',
    type: 'enum',
    options: [
      { value: 'professional', label: 'Profissional' },
      { value: 'room', label: 'Sala / equipamento' },
    ],
    example: 'Profissional',
    hint: 'Profissional ou Sala / equipamento (vazio = Profissional)',
  },
  { key: 'color', label: 'Cor na agenda', example: '#2d4bff', hint: 'Código da cor em hexadecimal, ex.: #2d4bff (vazio = azul padrão)' },
  { key: 'services', label: 'Serviços', example: 'Corte feminino; Escova', hint: 'Nomes dos serviços que faz, separados por ; (vazio = faz todos)' },
  { key: 'active', label: 'Ativo', type: 'boolean', example: 'Sim', hint: 'Sim ou Não (vazio = Sim). Inativo não aparece na agenda' },
];

/** Planilha de profissionais e salas. "Serviços" é resolvido pelo nome dos serviços já cadastrados. */
export function resourceImportSpec(): ImportSpec {
  const services = nameResolver('serviço', () => api<Service[]>('/scheduling/services'));
  return {
    entity: 'profissionais',
    fileName: 'profissionais',
    columns,
    create: async (row: ImportRow) => {
      let color = row.color === null ? null : String(row.color).trim();
      if (color && !color.startsWith('#')) color = `#${color}`;
      if (color && !/^#[0-9a-fA-F]{6}$/.test(color)) throw new Error(`Cor na agenda: "${String(row.color)}" não é um código de cor (use o formato #2d4bff)`);
      const serviceIds = await services(row.services);
      return api('/scheduling/resources', {
        method: 'POST',
        body: {
          name: row.name === null ? null : String(row.name),
          kind: row.kind ?? 'professional',
          ...(color ? { color } : {}),
          active: row.active ?? true,
          serviceIds,
        },
      });
    },
  };
}
