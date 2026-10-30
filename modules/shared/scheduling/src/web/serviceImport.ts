import { api, type ImportColumn, type ImportRow, type ImportSpec } from '@all/module-sdk/web';
import type { Resource } from '../contracts';
import { nameResolver } from './importNames';

const columns: ImportColumn[] = [
  { key: 'name', label: 'Nome', required: true, example: 'Corte feminino' },
  { key: 'category', label: 'Categoria', example: 'Cabelo' },
  { key: 'durationMin', label: 'Duração (min)', type: 'integer', required: true, example: 60, hint: 'Minutos, de 5 a 720' },
  { key: 'bufferMin', label: 'Intervalo depois (min)', type: 'integer', example: 10, hint: 'Limpeza, preparo. Minutos, de 0 a 240 (vazio = 0)' },
  { key: 'price', label: 'Preço (R$)', type: 'money', required: true, example: '80,00' },
  { key: 'description', label: 'Descrição', example: 'Lavagem, corte e finalização', hint: 'Aparece no agendamento online' },
  { key: 'resources', label: 'Quem faz', example: 'Ana; Bruno', hint: 'Nomes dos profissionais separados por ; (vazio = qualquer profissional)' },
  { key: 'online', label: 'Pode ser marcado online', type: 'boolean', example: 'Sim', hint: 'Sim ou Não (vazio = Não: só entra no link quem a empresa liberar)' },
  { key: 'active', label: 'Ativo', type: 'boolean', example: 'Sim', hint: 'Sim ou Não (vazio = Sim)' },
];

/** Planilha de serviços da agenda. "Quem faz" é resolvido pelo nome dos profissionais já cadastrados. */
export function serviceImportSpec(): ImportSpec {
  const professionals = nameResolver('profissional', async () => (await api<Resource[]>('/scheduling/resources')).filter((r) => r.kind === 'professional'));
  return {
    entity: 'serviços',
    fileName: 'servicos-agenda',
    columns,
    create: async (row: ImportRow) => {
      const text = (k: string) => (row[k] === null || row[k] === undefined ? null : String(row[k]));
      const resourceIds = await professionals(row.resources);
      return api('/scheduling/services', {
        method: 'POST',
        body: {
          name: text('name'),
          category: text('category'),
          durationMin: row.durationMin,
          bufferMin: row.bufferMin ?? 0,
          price: row.price,
          description: text('description'),
          online: row.online ?? false,
          active: row.active ?? true,
          resourceIds,
        },
      });
    },
  };
}
