import { api, type ImportRow, type ImportSpec } from '@all/module-sdk/web';
import type { Role } from './RolesPage';

/** Planilha de convites: nome, e-mail e um papel (pelo nome). O papel de dono não entra por planilha. */
export function userImportSpec(roles: Role[]): ImportSpec {
  const options = roles.filter((r) => r.key !== 'core.owner').map((r) => ({ value: r.id, label: r.label }));

  return {
    entity: 'convites',
    fileName: 'usuarios',
    columns: [
      { key: 'name', label: 'Nome', required: true, example: 'Maria Souza' },
      { key: 'email', label: 'E-mail', type: 'email', required: true, example: 'maria@exemplo.com' },
      {
        key: 'roleId',
        label: 'Papel',
        type: 'enum',
        options,
        example: options[0]?.label,
        hint: `Um destes: ${options.map((o) => o.label).join(', ')} (vazio = sem papel)`,
      },
    ],
    // O enum já converte o nome do papel no id.
    create: (row: ImportRow) =>
      api('/users/invite', {
        method: 'POST',
        body: { name: String(row.name), email: String(row.email), roleIds: row.roleId ? [String(row.roleId)] : [] },
      }),
  };
}
