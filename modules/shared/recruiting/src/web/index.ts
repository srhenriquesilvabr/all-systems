import { defineWebModule } from '@all/module-sdk/web';
import { ApplicationPage } from './ApplicationPage';
import { CandidateFormPage, CandidatePage, CandidatesPage } from './CandidatesPage';
import { JobPage } from './JobPage';
import { JobFormPage, JobsPage } from './JobsPage';
import { RecruitingSettingsPage } from './SettingsPage';

export const recruitingWeb = defineWebModule({
  key: 'recruiting',
  routes: [
    { path: 'recrutamento/vagas', permission: 'recruiting.jobs.read', Component: JobsPage },
    { path: 'recrutamento/vagas/nova', permission: 'recruiting.jobs.manage', Component: JobFormPage },
    { path: 'recrutamento/vagas/:id', permission: 'recruiting.jobs.read', Component: JobPage },
    { path: 'recrutamento/vagas/:id/editar', permission: 'recruiting.jobs.manage', Component: JobFormPage },
    { path: 'recrutamento/candidaturas/:id', permission: 'recruiting.candidates.read', Component: ApplicationPage },
    { path: 'recrutamento/candidatos', permission: 'recruiting.candidates.read', Component: CandidatesPage },
    { path: 'recrutamento/candidatos/novo', permission: 'recruiting.candidates.manage', Component: CandidateFormPage },
    { path: 'recrutamento/candidatos/:id', permission: 'recruiting.candidates.read', Component: CandidatePage },
    { path: 'recrutamento/candidatos/:id/editar', permission: 'recruiting.candidates.manage', Component: CandidateFormPage },
    { path: 'configuracoes/head-hunter', permission: 'core.access.settings', Component: RecruitingSettingsPage },
  ],
});

// Página pública (fora do login), montada pelo admin em /vagas/:slug e /vagas/:slug/:jobId.
export { PublicJobsPage } from './PublicJobsPage';
