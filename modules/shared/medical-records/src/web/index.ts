import { defineWebModule } from '@all/module-sdk/web';

/** O prontuário não tem telas próprias: as verticais mostram a linha do tempo onde fizer sentido. */
export const medicalRecordsWeb = defineWebModule({ key: 'shared.medical-records', routes: [] });

export { ListValue, MedicalRecordTimeline, RecordFieldInput, medicalRecordsKey, openAttachment } from './MedicalRecordTimeline';
