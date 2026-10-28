import {
  api,
  ApiError,
  AuthImage,
  draftFromTeamMember,
  emptyTeamMemberDraft,
  formatDate,
  formatDocument,
  formatPhone,
  saveTeamFiles,
  TeamLinks,
  teamKey,
  teamMemberBody,
  TeamMemberFields,
  useCan,
  useTeamMember,
  type PendingTeamFiles,
  type TeamMemberDetail,
  type TeamMemberDraft,
  type TeamMemberSummary,
} from '@all/module-sdk/web';
import { Alert, Badge, Button, Card, EmptyState, Input, Modal, PageHeader, Select, Spinner, Table, Td, Th } from '@all/ui';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';

const PAGE = 50;

/**
 * Equipe: as pessoas da empresa, num cadastro só para profissional da agenda, colaborador do RH e
 * usuário do sistema. `/equipe/:id` abre o cadastro da pessoa.
 */
export function TeamPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const canManage = useCan('core.team.manage');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'active' | 'ended' | 'all'>('active');
  const [page, setPage] = useState(0);
  const [creating, setCreating] = useState(false);

  const list = useQuery({
    queryKey: [...teamKey, 'list', { q, status, page }],
    queryFn: () => api<{ items: TeamMemberSummary[]; total: number }>('/team', { query: { q: q || undefined, status, limit: PAGE, offset: page * PAGE } }),
    placeholderData: keepPreviousData,
  });
  const pages = Math.ceil((list.data?.total ?? 0) / PAGE);

  return (
    <>
      <PageHeader
        title="Equipe"
        description="Quem trabalha na empresa: dados pessoais, documentos e onde cada pessoa atua (agenda, RH)."
        actions={canManage && <Button onClick={() => setCreating(true)}>Nova pessoa</Button>}
      />
      <div className="mb-4 flex flex-wrap gap-3">
        <Input
          type="search"
          aria-label="Buscar na equipe"
          placeholder="Buscar por nome, CPF, e-mail ou telefone"
          className="max-w-md"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(0);
          }}
        />
        <Select
          aria-label="Situação"
          className="max-w-48"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as typeof status);
            setPage(0);
          }}
        >
          <option value="active">Na empresa</option>
          <option value="ended">Encerrados</option>
          <option value="all">Todos</option>
        </Select>
      </div>
      <Card>
        {list.isPending ? (
          <Spinner />
        ) : list.isError ? (
          <div className="p-4">
            <Alert>{list.error.message}</Alert>
          </div>
        ) : list.data.items.length === 0 ? (
          <EmptyState title={q ? 'Ninguém encontrado' : 'Ninguém na equipe ainda'} action={canManage && !q && <Button onClick={() => setCreating(true)}>Cadastrar a primeira pessoa</Button>} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Nome</Th>
                <Th>CPF</Th>
                <Th>Telefone</Th>
                <Th>Na empresa</Th>
                <Th>Atua como</Th>
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((m) => (
                <tr key={m.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/equipe/${m.id}`)}>
                  <Td>
                    <span className="flex items-center gap-2 font-medium">
                      <span className="size-8 shrink-0 overflow-hidden rounded-full bg-muted">
                        {m.photoFileId ? (
                          <AuthImage fileId={m.photoFileId} alt="" className="size-full object-cover" />
                        ) : (
                          <span className="flex size-full items-center justify-center text-xs text-fg-muted" aria-hidden>
                            {m.firstName[0]?.toUpperCase()}
                          </span>
                        )}
                      </span>
                      {m.name}
                    </span>
                  </Td>
                  <Td className="tabular-nums text-fg-muted">{formatDocument(m.cpf)}</Td>
                  <Td className="text-fg-muted">{formatPhone(m.phone)}</Td>
                  <Td className="tabular-nums text-fg-muted">
                    {m.startedOn ? `desde ${formatDate(m.startedOn)}` : '—'}
                    {m.endedOn && (
                      <>
                        {' '}
                        <Badge tone={m.active ? 'warning' : 'neutral'}>até {formatDate(m.endedOn)}</Badge>
                      </>
                    )}
                  </Td>
                  <Td>
                    <TeamLinks links={m.links} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      {pages > 1 && (
        <div className="mt-4 flex items-center justify-end gap-2 text-sm">
          <Button size="sm" variant="secondary" disabled={page === 0} onClick={() => setPage(page - 1)}>
            Anterior
          </Button>
          <span className="text-fg-muted">
            {page + 1} de {pages}
          </span>
          <Button size="sm" variant="secondary" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>
            Próxima
          </Button>
        </div>
      )}
      {creating && (
        <TeamMemberModal
          memberId={null}
          onClose={() => setCreating(false)}
          onSaved={(saved) => {
            setCreating(false);
            navigate(`/equipe/${saved}`);
          }}
        />
      )}
      {id &&<TeamMemberModal key={id} memberId={id} onClose={() => navigate('/equipe')} />}
    </>
  );
}

function TeamMemberModal({ memberId, onClose, onSaved }: { memberId: string | null; onClose: () => void; onSaved?: (id: string) => void }) {
  const queryClient = useQueryClient();
  const canManage = useCan('core.team.manage');
  const member = useTeamMember(memberId);
  const [draft, setDraft] = useState<TeamMemberDraft | null>(memberId ? null : emptyTeamMemberDraft());
  const [files, setFiles] = useState<PendingTeamFiles>({});
  // Pessoa nova já gravada quando o envio da foto/currículo falha: tentar de novo não duplica.
  const [createdId, setCreatedId] = useState<string | null>(null);
  useEffect(() => {
    if (member.data) setDraft(draftFromTeamMember(member.data));
  }, [member.data]);

  const targetId = memberId ?? createdId;
  const save = useMutation({
    mutationFn: async () => {
      const saved = await api<TeamMemberDetail>(targetId ? `/team/${targetId}` : '/team', { method: targetId ? 'PATCH' : 'POST', body: teamMemberBody(draft!) });
      if (!targetId) setCreatedId(saved.id);
      if (files.photo !== undefined || files.resume !== undefined) {
        await saveTeamFiles(saved.id, files);
        setFiles({});
      }
      return saved;
    },
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: teamKey });
      if (onSaved) onSaved(saved.id);
      else onClose();
    },
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate();
  }
  const duplicate = save.error instanceof ApiError && save.error.code === 'DUPLICATE_CPF' ? (save.error.body as { existing?: { id: string; name: string } }).existing : undefined;

  return (
    <Modal
      open
      title={memberId ? (member.data?.name ?? 'Pessoa da equipe') : 'Nova pessoa na equipe'}
      onClose={onClose}
      footer={
        canManage && (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" form="team-member-form" loading={save.isPending} disabled={!draft}>
              Salvar
            </Button>
          </>
        )
      }
    >
      {member.isError ? (
        <Alert>{member.error.message}</Alert>
      ) : !draft ? (
        <Spinner />
      ) : (
        <form id="team-member-form" onSubmit={submit} className="space-y-4">
          {save.error && (
            <Alert>
              {save.error instanceof ApiError ? save.error.message : 'Erro ao salvar'}
              {duplicate && (
                <>
                  {' '}
                  <Link to={`/equipe/${duplicate.id}`} className="underline" onClick={onClose}>
                    Abrir o cadastro de {duplicate.name}
                  </Link>
                </>
              )}
            </Alert>
          )}
          {member.data && member.data.links.length > 0 && (
            <p className="flex flex-wrap items-center gap-2 text-sm text-fg-muted">
              Atua como: <TeamLinks links={member.data.links} renderLink={(l, badge) => <Link to={l.path!}>{badge}</Link>} />
            </p>
          )}
          <TeamMemberFields draft={draft} onChange={setDraft} member={member.data} files={files} onFilesChange={setFiles} readOnly={!canManage} />
        </form>
      )}
    </Modal>
  );
}
