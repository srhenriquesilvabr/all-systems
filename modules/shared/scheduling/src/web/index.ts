import { defineWebModule } from '@all/module-sdk/web';
import { AgendaPage } from './AgendaPage';
import { CustomerAppointmentsTab } from './CustomerAppointmentsTab';
import { ResourcesPage } from './ResourcesPage';
import { SchedulingServicesPage } from './ServicesPage';

export const schedulingWeb = defineWebModule({
  key: 'shared.scheduling',
  routes: [
    { path: 'agenda', permission: 'shared.scheduling.read', Component: AgendaPage },
    { path: 'agenda/profissionais', permission: 'shared.scheduling.manage', Component: ResourcesPage },
    { path: 'agenda/servicos', permission: 'shared.scheduling.manage', Component: SchedulingServicesPage },
  ],
  customerTabs: [{ key: 'appointments', label: 'Agendamentos', permission: 'shared.scheduling.read', Component: CustomerAppointmentsTab }],
});

// Página pública (fora do login), montada pelo admin em /agendar/:slug.
export { PublicBookingPage } from './PublicBookingPage';
// Para verticais: seletor de "para quem é" (ex.: pet) no formulário de horário.
export { OutsideScheduleAlert, registerSubjectPicker, type SubjectPicker, type SubjectValue } from './AppointmentForm';
export { AppointmentDetails, statusTone } from './AppointmentDetails';
export { appointmentStatusLabel } from '../contracts';
export { useAppointments, useResources, useServices, schedulingKey, localToUtc, localDate, localTime, todayLocal, shiftDate } from './hooks';
