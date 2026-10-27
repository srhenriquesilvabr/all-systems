import { api, ApiError, SpreadsheetImport, useCan, useSession } from '@all/module-sdk/web';
import { Alert, Badge, Button, Card, Checkbox, Field, Input, Modal, PageHeader, Spinner, Table, Td, Th } from '@all/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useRoles, type Role } from './RolesPage';
import { userImportSpec } from './userImport';

interface Member {
  membershipId: string;
  status: 'active' | 'disabled';
  pendingInvite: boolean;
  user: { id: string; name: string; email: string; lastLoginAt: string | null };
  roles: { id: string; key: string; label: string }[];
}

const KEY = ['users'];
const dateTime = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

export function UsersPage() {
  const canManage = useCan('core.users.manage');
  const members = useQuery({ queryKey: KEY, queryFn: () => api<Member[]>('/users') });
  const roles = useRoles();
  const queryClient = useQueryClient();
  const [inviting, setInviting] = useState(false);
  const [editing, setEditing] = useState<Member | null>(null);

  return (
    <>
      <PageHeader
        title="Usuários"
        description="Quem acessa o sistema desta empresa e com quais papéis."
        actions={
          canManage && (
            <>
              {roles.data && <SpreadsheetImport spec={userImportSpec(roles.data)} onImported={() => queryClient.invalidateQueries({ queryKey: KEY })} />}
              <Button onClick={() => setInviting(true)}>Convidar usuário</Button>
            </>
          )
        }
      />
      <Card>
        {members.isPending ? (
          <Spinner />
        ) : members.isError ? (
          <div className="p-4"><Alert>{members.error.message}</Alert></div>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Nome</Th>
                <Th>Papéis</Th>
                <Th>Situação</Th>
                <Th>Último acesso</Th>
                {canManage && <Th />}
              </tr>
            </thead>
            <tbody>
              {members.data.map((m) => (
                <tr key={m.membershipId}>
                  <Td>
                    <p className="font-medium">{m.user.name}</p>
                    <p className="text-xs text-fg-muted">{m.user.email}</p>
                  </Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      {m.roles.length ? m.roles.map((r) => <Badge key={r.id} tone={r.key === 'core.owner' ? 'brand' : 'neutral'}>{r.label}</Badge>) : <span className="text-fg-subtle">—</span>}
                    </div>
                  </Td>
                  <Td>
                    {m.status === 'disabled' ? (
                      <Badge tone="danger">Desativado</Badge>
                    ) : m.pendingInvite ? (
                      <Badge tone="warning">Convite pendente</Badge>
                    ) : (
                      <Badge tone="success">Ativo</Badge>
                    )}
                  </Td>
                  <Td className="text-fg-muted">{m.user.lastLoginAt ? dateTime.format(new Date(m.user.lastLoginAt)) : 'Nunca'}</Td>
                  {canManage && (
                    <Td className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => setEditing(m)}>
                        Editar
                      </Button>
                    </Td>
                  )}
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {inviting && <InviteModal onClose={() => setInviting(false)} />}
      {editing && <EditModal member={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function RolePicker({ selected, onChange }: { selected: string[]; onChange: (ids: string[]) => void }) {
  const { isOwner } = useSession();
  const roles = useRoles();
  if (roles.isPending) return <Spinner />;
  if (roles.isError) return <Alert>{roles.error.message}</Alert>;

  // Só um dono pode conceder o papel de dono.
  const available = roles.data.filter((r: Role) => isOwner || !r.isOwner);
  return (
    <fieldset className="space-y-2">
      <legend className="mb-2 text-sm font-medium">Papéis</legend>
      {available.map((r) => (
        <Checkbox
          key={r.id}
          label={r.label}
          checked={selected.includes(r.id)}
          onChange={(e) => onChange(e.target.checked ? [...selected, r.id] : selected.filter((id) => id !== r.id))}
        />
      ))}
    </fieldset>
  );
}

function InviteModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const invite = useMutation({
    mutationFn: () => api('/users/invite', { method: 'POST', body: { email, name, roleIds } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: KEY });
      onClose();
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    invite.mutate();
  }

  return (
    <Modal
      open
      title="Convidar usuário"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button type="submit" form="invite-form" loading={invite.isPending}>Enviar convite</Button>
        </>
      }
    >
      <form id="invite-form" onSubmit={submit} className="space-y-4">
        {invite.error && <Alert>{invite.error instanceof ApiError ? invite.error.message : 'Erro ao convidar'}</Alert>}
        <p className="text-sm text-fg-muted">A pessoa recebe um e-mail para criar a senha. Se ela já usa o sistema em outra empresa, o acesso é liberado na hora.</p>
        <Field label="Nome">{(id) => <Input id={id} required minLength={2} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        <Field label="E-mail">{(id) => <Input id={id} type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
        <RolePicker selected={roleIds} onChange={setRoleIds} />
      </form>
    </Modal>
  );
}

function EditModal({ member, onClose }: { member: Member; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { user } = useSession();
  const [roleIds, setRoleIds] = useState(member.roles.map((r) => r.id));
  const [active, setActive] = useState(member.status === 'active');
  const isSelf = member.user.id === user.id;

  const save = useMutation({
    mutationFn: () =>
      api(`/users/${member.membershipId}`, { method: 'PATCH', body: { roleIds, status: active ? 'active' : 'disabled' } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: KEY });
      onClose();
    },
  });

  return (
    <Modal
      open
      title={member.user.name}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => save.mutate()} loading={save.isPending}>Salvar</Button>
        </>
      }
    >
      <div className="space-y-4">
        {save.error && <Alert>{save.error instanceof ApiError ? save.error.message : 'Erro ao salvar'}</Alert>}
        <RolePicker selected={roleIds} onChange={setRoleIds} />
        <Checkbox
          label={isSelf ? 'Acesso ativo (você não pode desativar o próprio acesso)' : 'Acesso ativo'}
          checked={active}
          disabled={isSelf}
          onChange={(e) => setActive(e.target.checked)}
        />
      </div>
    </Modal>
  );
}
