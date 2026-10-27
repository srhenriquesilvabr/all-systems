import { formatDate, formatPhone, useCan, useSession } from '@all/module-sdk/web';
import { Alert, Badge, Button, Card, PageHeader, Spinner, Tabs } from '@all/ui';
import { useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { petAge, sizeLabel, speciesLabel } from '../contracts';
import { registeredPetTabs, usePet } from './hooks';
import { PetModal } from './PetModal';

const sexLabel = { male: 'Macho', female: 'Fêmea', unknown: '' } as const;

/** Ficha do pet: dados e as abas registradas pelas verticais (vacinas, prontuário…). */
export function PetPage() {
  const { id = '' } = useParams();
  const pet = usePet(id);
  const session = useSession();
  const canWrite = useCan('shared.pets.write');
  const [editing, setEditing] = useState(false);
  const active = new Set(session.modules.map((m) => m.key));
  const tabs = registeredPetTabs().filter((t) => active.has(t.moduleKey) && (!t.permission || session.permissions.includes(t.permission)));
  const [tab, setTab] = useState<string | null>(null);
  const current = tabs.find((t) => t.key === tab) ?? tabs[0];

  if (pet.isPending) return <Spinner />;
  if (pet.isError) return <Alert>{pet.error.message}</Alert>;
  const p = pet.data;

  return (
    <>
      <PageHeader
        title={p.name}
        description={[speciesLabel[p.species], p.breed, sexLabel[p.sex], petAge(p.birthDate)].filter(Boolean).join(' · ')}
        actions={
          canWrite && (
            <Button variant="secondary" onClick={() => setEditing(true)}>
              Editar
            </Button>
          )
        }
      />
      <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
        <Card className="h-fit space-y-3 p-5 text-sm">
          {p.deceased && <Badge>Falecido</Badge>}
          <Info label="Tutor">
            <Link to={`/clientes/${p.tutor.id}`} className="font-medium text-brand-700 hover:underline">
              {p.tutor.name}
            </Link>
            {p.tutor.phone && <div className="text-fg-muted">{formatPhone(p.tutor.phone)}</div>}
          </Info>
          {p.birthDate && <Info label="Nascimento">{formatDate(p.birthDate)}</Info>}
          {p.weightKg != null && <Info label="Peso">{String(p.weightKg).replace('.', ',')} kg</Info>}
          {p.size && <Info label="Porte">{sizeLabel[p.size]}</Info>}
          {p.coat && <Info label="Pelagem">{p.coat}</Info>}
          <Info label="Castrado(a)">{p.neutered ? 'Sim' : 'Não'}</Info>
          {p.microchip && <Info label="Microchip">{p.microchip}</Info>}
          {p.notes && (
            <Info label="Observações">
              <p className="whitespace-pre-line">{p.notes}</p>
            </Info>
          )}
        </Card>
        <div className="min-w-0">
          {current ? (
            <>
              {tabs.length > 1 && <Tabs items={tabs.map((t) => ({ key: t.key, label: t.label }))} active={current.key} onChange={setTab} />}
              <div className="mt-4">
                <current.Component pet={p} />
              </div>
            </>
          ) : (
            <Card className="p-5 text-sm text-fg-muted">Histórico de atendimentos aparece na ficha do tutor, na aba Agendamentos.</Card>
          )}
        </div>
      </div>
      {editing && <PetModal pet={p} onClose={() => setEditing(false)} />}
    </>
  );
}

function Info({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-fg-muted">{label}</div>
      <div>{children}</div>
    </div>
  );
}
