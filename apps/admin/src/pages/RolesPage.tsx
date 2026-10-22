import { api, ApiError, useCan } from '@all/module-sdk/web';
import { Alert, Badge, Button, Card, Checkbox, Field, Input, Modal, PageHeader, Spinner, Table, Td, Th } from '@all/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';

export interface Role {
  id: string;
  key: string;
  label: string;
  isSystem: boolean;
  isOwner: boolean;
  moduleKey: string | null;
  permissions: string[];
  memberCount: number;
}

interface PermissionGroup {
  module: { key: string; name: string; layer: string };
  permissions: { key: string; label: string }[];
}

const KEY = ['roles'];

export const useRoles = () => useQuery({ queryKey: KEY, queryFn: () => api<Role[]>('/access/roles') });

export function RolesPage() {
  const canManage = useCan('core.access.manage');
  const roles = useRoles();
  const [editing, setEditing] = useState<Role | 'new' | null>(null);

  return (
    <>
      <PageHeader
        title="Papéis"
        description="Conjuntos de permissões atribuídos aos usuários. Os papéis padrão vêm dos módulos contratados."
        actions={canManage && <Button onClick={() => setEditing('new')}>Novo papel</Button>}
      />
      <Card>
        {roles.isPending ? (
          <Spinner />
        ) : roles.isError ? (
          <div className="p-4"><Alert>{roles.error.message}</Alert></div>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Papel</Th>
                <Th>Permissões</Th>
                <Th>Usuários</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {roles.data.map((r) => (
                <tr key={r.id}>
                  <Td>
                    <span className="font-medium">{r.label}</span>{' '}
                    {r.isSystem && <Badge>{r.isOwner ? 'Acesso total' : 'Padrão'}</Badge>}
                  </Td>
                  <Td className="text-fg-muted">{r.isOwner ? 'Todas' : r.permissions.length}</Td>
                  <Td className="text-fg-muted">{r.memberCount}</Td>
                  <Td className="text-right">
                    {!r.isOwner && (
                      <Button variant="ghost" size="sm" onClick={() => setEditing(r)}>
                        {r.isSystem || !canManage ? 'Ver' : 'Editar'}
                      </Button>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      {editing && <RoleModal role={editing === 'new' ? null : editing} readOnly={!canManage || (editing !== 'new' && editing.isSystem)} onClose={() => setEditing(null)} />}
    </>
  );
}

function RoleModal({ role, readOnly, onClose }: { role: Role | null; readOnly: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const catalog = useQuery({ queryKey: ['permissions'], queryFn: () => api<PermissionGroup[]>('/access/permissions') });
  const [label, setLabel] = useState(role?.label ?? '');
  const [permissions, setPermissions] = useState<string[]>(role?.permissions ?? []);

  const done = () => {
    queryClient.invalidateQueries({ queryKey: KEY });
    onClose();
  };
  const save = useMutation({
    mutationFn: () =>
      role
        ? api(`/access/roles/${role.id}`, { method: 'PATCH', body: { label, permissions } })
        : api('/access/roles', { method: 'POST', body: { label, permissions } }),
    onSuccess: done,
  });
  const remove = useMutation({ mutationFn: () => api(`/access/roles/${role!.id}`, { method: 'DELETE' }), onSuccess: done });

  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate();
  }

  const error = save.error ?? remove.error;
  return (
    <Modal
      open
      title={role ? role.label : 'Novo papel'}
      onClose={onClose}
      footer={
        readOnly ? (
          <Button variant="secondary" onClick={onClose}>Fechar</Button>
        ) : (
          <>
            {role && (
              <Button
                variant="danger"
                className="mr-auto"
                loading={remove.isPending}
                onClick={() => confirm(`Excluir o papel "${role.label}"? Os usuários perdem estas permissões.`) && remove.mutate()}
              >
                Excluir
              </Button>
            )}
            <Button variant="secondary" onClick={onClose}>Cancelar</Button>
            <Button type="submit" form="role-form" loading={save.isPending}>Salvar</Button>
          </>
        )
      }
    >
      <form id="role-form" onSubmit={submit} className="space-y-5">
        {error && <Alert>{error instanceof ApiError ? error.message : 'Erro ao salvar'}</Alert>}
        {readOnly && role?.isSystem && <Alert tone="info">Papéis padrão não podem ser alterados. Crie um papel novo para personalizar.</Alert>}
        {!readOnly && (
          <Field label="Nome do papel">{(id) => <Input id={id} required minLength={2} value={label} onChange={(e) => setLabel(e.target.value)} />}</Field>
        )}
        {catalog.isPending ? (
          <Spinner />
        ) : catalog.isError ? (
          <Alert>{catalog.error.message}</Alert>
        ) : (
          catalog.data.map((group) => (
            <fieldset key={group.module.key} className="space-y-2">
              <legend className="mb-2 text-sm font-medium">{group.module.name}</legend>
              {group.permissions.map((p) => (
                <Checkbox
                  key={p.key}
                  label={p.label}
                  disabled={readOnly}
                  checked={permissions.includes(p.key)}
                  onChange={(e) => setPermissions(e.target.checked ? [...permissions, p.key] : permissions.filter((k) => k !== p.key))}
                />
              ))}
            </fieldset>
          ))
        )}
      </form>
    </Modal>
  );
}
