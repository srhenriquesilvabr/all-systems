import { useCan } from '@all/module-sdk/web';
import { Alert, Button, Card, EmptyState, Spinner } from '@all/ui';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { usePets } from './hooks';
import { PetModal } from './PetModal';
import { PetTable } from './PetsPage';

/** Aba "Pets" na ficha do cliente (tutor). */
export function CustomerPetsTab({ customerId }: { customerId: string }) {
  const pets = usePets({ customerId });
  const canWrite = useCan('shared.pets.write');
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();

  if (pets.isPending) return <Spinner />;
  if (pets.isError) return <Alert>{pets.error.message}</Alert>;

  return (
    <>
      {canWrite && pets.data.length > 0 && (
        <div className="mb-3 flex justify-end">
          <Button size="sm" onClick={() => setCreating(true)}>
            Novo pet
          </Button>
        </div>
      )}
      <Card>
        {pets.data.length === 0 ? (
          <EmptyState title="Nenhum pet deste tutor" action={canWrite && <Button onClick={() => setCreating(true)}>Cadastrar pet</Button>} />
        ) : (
          <PetTable pets={pets.data} showTutor={false} onOpen={(p) => navigate(`/pets/${p.id}`)} />
        )}
      </Card>
      {creating && <PetModal pet={null} tutor={{ id: customerId }} onClose={() => setCreating(false)} />}
    </>
  );
}
