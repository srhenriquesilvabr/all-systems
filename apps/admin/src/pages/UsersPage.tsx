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
  const [invitePanel, setInvitePanel] = useState<Member | null>(null);
  const status = useQuery({ queryKey: ['users', 'email-status'], queryFn: () => api<{ emailEnabled: boolean }>('/users/email-status') });
  const emailOff = status.data?.emailEnabled === false;
  const pending = members.data?.filter((m) => m.pendingInvite && m.status === 'active') ?? [];

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
      {emailOff && (
        <div className="mb-4">
          <Alert>
            O envio de e-mail está desligado neste ambiente: convites e links de senha são descartados e não chegam a ninguém.
            {canManage ? ' Para dar acesso, use Copiar link de convite na linha da pessoa e entregue o link por outro canal.' : ' Peça a quem administra os usuários para copiar o link de convite.'}
            {pending.length > 0 && ` ${pending.length === 1 ? 'Há 1 convite pendente' : `Há ${pending.length} convites pendentes`}.`}
          </Alert>
        </div>
      )}
      {invitePanel && <InvitePanel key={invitePanel.membershipId} member={invitePanel} emailOff={emailOff} onClose={() => setInvitePanel(null)} />}
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
                    <Td className="whitespace-nowrap text-right">
                      {m.pendingInvite && m.status === 'active' && (
                        <Button variant="ghost" size="sm" onClick={() => setInvitePanel(m)}>
                          Convite
                        </Button>
                      )}
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

/** Reenviar por e-mail ou copiar o link, para quem ainda não criou a senha. */
function InvitePanel({ member, emailOff, onClose }: { member: Member; emailOff: boolean; onClose: () => void }) {
  const [link, setLink] = useState<{ url: string; expiresAt: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const resend = useMutation({ mutationFn: () => api<{ emailEnabled: boolean }>(`/users/${member.membershipId}/resend-invite`, { method: 'POST' }) });
  const createLink = useMutation({
    mutationFn: () => api<{ url: string; expiresAt: string }>(`/users/${member.membershipId}/invite-link`, { method: 'POST' }),
    onSuccess: async (r) => {
      setLink(r);
      try {
        await navigator.clipboard.writeText(r.url);
        setCopied(true);
      } catch {
        // Sem acesso à área de transferência: o link fica à vista para copiar à mão.
        setCopied(false);
      }
    },
  });
  const error = resend.error ?? createLink.error;
  return (
    <Card className="mb-4 space-y-4 p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-medium">Convite de {member.user.name}</h2>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Fechar
        </Button>
      </div>
      <p className="text-sm text-fg-muted">
        {member.user.email} ainda não criou a senha. O convite vale por 7 dias. Quem tiver o link define a senha desta conta: entregue só à própria pessoa. Gerar outro link invalida o anterior.
      </p>
      {error && <Alert>{error instanceof ApiError ? error.message : 'Não foi possível concluir'}</Alert>}
      {resend.isSuccess && (resend.data.emailEnabled ? <Alert tone="success">Convite reenviado para {member.user.email}.</Alert> : <Alert>O envio de e-mail está desligado: o convite não saiu. Use Copiar link de convite.</Alert>)}
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" loading={resend.isPending} disabled={emailOff} title={emailOff ? 'O envio de e-mail está desligado' : undefined} onClick={() => resend.mutate()}>
          Reenviar convite
        </Button>
        <Button variant={emailOff ? 'primary' : 'secondary'} loading={createLink.isPending} onClick={() => createLink.mutate()}>
          Copiar link de convite
        </Button>
      </div>
      {link && (
        <div className="space-y-1">
          <Field label="Link de convite" hint={copied ? 'Copiado para a área de transferência.' : 'Selecione e copie o link.'}>
            {(id) => <Input id={id} readOnly value={link.url} onFocus={(e) => e.target.select()} />}
          </Field>
        </div>
      )}
    </Card>
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
