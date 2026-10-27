import { formatPhone, useCan } from '@all/module-sdk/web';
import { Alert, Badge, Button, Card, EmptyState, Input, PageHeader, Spinner, Table, Td, Th } from '@all/ui';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { petAge, speciesLabel, type Pet } from '../contracts';
import { usePets } from './hooks';
import { PetModal } from './PetModal';

export function PetsPage() {
  const [q, setQ] = useState('');
  const pets = usePets({ q: q.trim() || undefined });
  const canWrite = useCan('shared.pets.write');
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();

  return (
    <>
      <PageHeader title="Pets" description="Os animais atendidos e seus tutores." actions={canWrite && <Button onClick={() => setCreating(true)}>Novo pet</Button>} />
      <div className="mb-4 max-w-sm">
        <Input type="search" aria-label="Buscar pet" placeholder="Nome do pet, raça ou tutor" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <Card>
        {pets.isPending ? (
          <Spinner />
        ) : pets.isError ? (
          <div className="p-4">
            <Alert>{pets.error.message}</Alert>
          </div>
        ) : pets.data.length === 0 ? (
          <EmptyState title={q ? 'Nenhum pet encontrado' : 'Nenhum pet cadastrado'} action={canWrite && !q && <Button onClick={() => setCreating(true)}>Cadastrar o primeiro</Button>} />
        ) : (
          <PetTable pets={pets.data} onOpen={(p) => navigate(`/pets/${p.id}`)} />
        )}
      </Card>
      {creating && <PetModal pet={null} onClose={() => setCreating(false)} onSaved={(p) => navigate(`/pets/${p.id}`)} />}
    </>
  );
}

export function PetTable({ pets, onOpen, showTutor = true }: { pets: Pet[]; onOpen: (p: Pet) => void; showTutor?: boolean }) {
  return (
    <Table>
      <thead>
        <tr>
          <Th>Pet</Th>
          <Th>Espécie e raça</Th>
          <Th>Idade</Th>
          {showTutor && <Th>Tutor</Th>}
        </tr>
      </thead>
      <tbody>
        {pets.map((p) => (
          <tr key={p.id} className="cursor-pointer hover:bg-muted/50" onClick={() => onOpen(p)}>
            <Td>
              <span className="font-medium">{p.name}</span> {p.deceased && <Badge>Falecido</Badge>}
            </Td>
            <Td>
              {speciesLabel[p.species]}
              {p.breed && <span className="text-fg-muted"> · {p.breed}</span>}
            </Td>
            <Td className="whitespace-nowrap">{petAge(p.birthDate) || <span className="text-fg-subtle">—</span>}</Td>
            {showTutor && (
              <Td>
                {p.tutor.name}
                {p.tutor.phone && <span className="ml-2 text-sm text-fg-muted">{formatPhone(p.tutor.phone)}</span>}
              </Td>
            )}
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
