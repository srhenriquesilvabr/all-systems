import { api, type ImportRow, type ImportSpec } from '@all/module-sdk/web';
import { contactBases, contactBasisLabel, leadAssetLabel, leadAssetTypes } from '../../contracts';

const text = (row: ImportRow, k: string) => (row[k] === null || row[k] === undefined || row[k] === '' ? null : String(row[k]));
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * Planilha de leads: só contatos que pediram para ser chamados (formulário de evento, exportação da
 * plataforma de anúncios, lista do balcão). Cada linha vai para a mesma rota do cadastro manual.
 */
export function leadImportSpec(): ImportSpec {
  let team: Promise<{ id: string; name: string }[]> | undefined;
  const findSeller = async (name: string) => {
    team ??= api<{ id: string; name: string }[]>('/users/team');
    const found = (await team).filter((u) => fold(u.name) === fold(name));
    if (found.length === 1) return found[0]!.id;
    throw new Error(found.length ? `Vendedor: mais de um usuário chamado "${name}"` : `Vendedor: "${name}" não está na equipe`);
  };
  return {
    entity: 'leads',
    fileName: 'leads-de-consorcio',
    columns: [
      { key: 'name', label: 'Nome', required: true, example: 'Mariana Souza' },
      { key: 'phone', label: 'Celular (com DDD)', example: '(11) 98888-7777', hint: 'Telefone ou e-mail: pelo menos um' },
      { key: 'email', label: 'E-mail', type: 'email', example: 'mariana@exemplo.com' },
      { key: 'city', label: 'Cidade', example: 'São Paulo' },
      { key: 'state', label: 'UF', example: 'SP' },
      { key: 'assetType', label: 'Tipo de bem', type: 'enum', options: leadAssetTypes.map((t) => ({ value: t, label: leadAssetLabel[t] })), example: 'imóvel' },
      { key: 'creditValue', label: 'Crédito desejado (R$)', type: 'money', example: '250.000,00' },
      { key: 'termMonths', label: 'Prazo (meses)', type: 'integer', example: 180 },
      { key: 'campaign', label: 'Campanha/origem', example: 'Feira de imóveis out/2026', hint: 'Para o relatório de conversão' },
      {
        key: 'contactBasis',
        label: 'Base do contato',
        type: 'enum',
        options: contactBases.map((b) => ({ value: b, label: contactBasisLabel[b] })),
        example: contactBasisLabel.requested_contact,
        hint: 'Por que podemos chamar esta pessoa (vazio = pediu contato)',
      },
      { key: 'seller', label: 'Vendedor', example: 'Ana Lima', hint: 'Nome do usuário da equipe (vazio = distribuição automática ou sem vendedor)' },
      { key: 'notes', label: 'Observações' },
    ],
    create: async (row) =>
      api('/consortium/leads', {
        method: 'POST',
        body: {
          name: text(row, 'name'),
          phone: text(row, 'phone'),
          email: text(row, 'email'),
          city: text(row, 'city'),
          state: text(row, 'state'),
          assetType: text(row, 'assetType'),
          creditValue: row.creditValue ?? null,
          termMonths: row.termMonths ?? null,
          campaign: text(row, 'campaign'),
          contactBasis: text(row, 'contactBasis') ?? 'requested_contact',
          sellerId: text(row, 'seller') ? await findSeller(text(row, 'seller')!) : null,
          notes: text(row, 'notes'),
          source: 'import',
        },
      }),
  };
}
