import { MedicalRecordTimeline } from '@all/medical-records/web';
import type { Pet } from '@all/pets';

/** Aba "Prontuário" na ficha do pet. */
export function PetRecordsTab({ pet }: { pet: Pet }) {
  return <MedicalRecordTimeline subjectType="pet" subjectId={pet.id} />;
}
