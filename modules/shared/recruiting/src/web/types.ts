import type { ApplicationAnswer, ApplicationStatus, ContractType, JobQuestion, JobStage, JobStatus, WorkModel } from '../contracts';

export const recruitingKey = ['recruiting'];

export interface RecruitingStatus {
  aiAvailable: boolean;
  analysis: 'auto' | 'heuristic';
  aiModel: string;
  gupyMode: 'off' | 'api' | 'simulated';
  publicPage: boolean;
  publicUrl: string | null;
  indeedFeedUrl: string | null;
}

export interface JobSummary {
  id: string;
  title: string;
  area: string | null;
  status: JobStatus;
  customerId: string | null;
  company: string | null;
  confidential: boolean;
  workModel: WorkModel;
  city: string | null;
  state: string | null;
  contractType: ContractType;
  positions: number;
  publishGupy: boolean;
  gupySyncStatus: 'none' | 'pending' | 'synced' | 'error';
  openedAt: string | null;
  createdAt: string;
  applications: { total: number; active: number; hired: number; rejected: number };
}

export interface JobDetail {
  id: string;
  title: string;
  area: string | null;
  description: string;
  requirements: string[];
  niceToHave: string[];
  salaryMin: number | null;
  salaryMax: number | null;
  showSalary: boolean;
  benefits: string[];
  workModel: WorkModel;
  city: string | null;
  state: string | null;
  contractType: ContractType;
  positions: number;
  status: JobStatus;
  stages: JobStage[];
  questions: JobQuestion[];
  customerId: string | null;
  confidential: boolean;
  company: string | null;
  publishGupy: boolean;
  gupyJobId: string | null;
  gupySyncStatus: 'none' | 'pending' | 'synced' | 'error';
  gupyError: string | null;
  gupySyncedAt: string | null;
  openedAt: string | null;
  closedAt: string | null;
  stageCounts: { stageId: string; status: ApplicationStatus; n: number }[];
  publication: { publicUrl: string | null; indeedFeedUrl: string | null; gupyMode: 'off' | 'api' | 'simulated'; linkedinText: string | null };
}

export interface BoardApplication {
  id: string;
  stageId: string;
  status: ApplicationStatus;
  score: number | null;
  scoreMethod: 'ai' | 'heuristic' | null;
  analysisStatus: 'pending' | 'running' | 'done' | 'failed';
  rejectionReason: string | null;
  teamMemberId: string | null;
  source: 'public' | 'manual';
  createdAt: string;
  stageChangedAt: string;
  candidate: { id: string; name: string; city: string | null; state: string | null; anonymized: boolean };
}

export interface Candidate {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  linkedinUrl: string | null;
  city: string | null;
  state: string | null;
  notes: string | null;
  source: 'public' | 'manual';
  retainUntil: string | null;
  anonymizedAt: string | null;
  createdAt: string;
}

export interface RecEvent {
  id: string;
  kind: 'applied' | 'note' | 'stage' | 'rejected' | 'reopened' | 'hired' | 'analysis' | 'edited';
  text: string | null;
  userId: string | null;
  applicationId: string | null;
  createdAt: string;
}

export interface Analysis {
  id: string;
  requested: 'auto' | 'heuristic';
  method: 'ai' | 'heuristic' | null;
  status: 'pending' | 'running' | 'done' | 'failed';
  score: number | null;
  strengths: string[];
  gaps: string[];
  summary: string | null;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  error: string | null;
  attempts: number;
  finishedAt: string | null;
  createdAt: string;
}

export interface ResumeFile {
  id: string;
  filename: string;
  mime: string;
  size: number;
}

export interface ApplicationDetail {
  id: string;
  jobId: string;
  candidateId: string;
  stageId: string;
  status: ApplicationStatus;
  rejectionReason: string | null;
  rejectedAt: string | null;
  hiredAt: string | null;
  teamMemberId: string | null;
  salaryExpectation: number | null;
  answers: ApplicationAnswer[];
  source: 'public' | 'manual';
  score: number | null;
  scoreMethod: 'ai' | 'heuristic' | null;
  analysisStatus: 'pending' | 'running' | 'done' | 'failed';
  createdAt: string;
  consent: { version: string; acceptedAt: string; text: string } | null;
  candidate: Candidate;
  job: { id: string; title: string; stages: JobStage[]; status: JobStatus; requirements: string[]; niceToHave: string[] };
  resume: ResumeFile | null;
  analyses: Analysis[];
  events: RecEvent[];
}

export interface CandidateListItem {
  id: string;
  name: string;
  email: string | null;
  city: string | null;
  state: string | null;
  source: 'public' | 'manual';
  anonymizedAt: string | null;
  createdAt: string;
  applications: number;
  activeApplications: number;
  bestScore: number | null;
  lastApplicationAt: string | null;
}

export interface CandidateDetail extends Candidate {
  resume: ResumeFile | null;
  applications: {
    id: string;
    jobId: string;
    jobTitle: string;
    jobStatus: JobStatus;
    company: string | null;
    stageId: string;
    stageName: string;
    status: ApplicationStatus;
    statusLabel: string;
    score: number | null;
    scoreMethod: 'ai' | 'heuristic' | null;
    createdAt: string;
  }[];
  events: RecEvent[];
}

export interface CompanyOption {
  id: string;
  name: string;
  document: string | null;
}
