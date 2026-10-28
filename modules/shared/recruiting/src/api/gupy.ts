import { Injectable } from '@nestjs/common';
import { contractTypeLabel, salaryLabel, workModelLabel, type ContractType, type JobStatus, type WorkModel } from '../contracts';

// Publicação na Gupy. A interface (JobBoardAdapter) isola o resto do módulo do formato da Gupy:
// trocar de plataforma, ou ajustar o formato quando a Gupy confirmar, mexe só neste arquivo.
//
// A CONFIRMAR COM A GUPY (não há documentação oficial completa no repositório):
// - URL base e versão da API (aqui: https://api.gupy.io/api/v1, sobrescrevível por GUPY_API_URL);
// - autenticação por "Authorization: Bearer <token>" gerado no painel da Gupy pela empresa;
// - criação em POST /jobs, alteração em PATCH /jobs/{id} e os nomes dos campos (name, type,
//   departmentId, roleId, branchId, publicationType, numVacancies, description, responsibilities,
//   prerequisites, additionalInformation, workplaceType, addressCity, addressState, addressCountry, salary);
// - os valores de `type` por tipo de contrato e de `workplaceType`;
// - a mudança de situação (publicar, congelar, encerrar) por PATCH com `status`
//   (published, frozen, closed) — na Gupy a vaga pode exigir aprovação interna antes de publicar;
// - se departmentId/roleId são obrigatórios e de onde vêm (cadastros da empresa na Gupy);
// - a publicação no LinkedIn e em outros portais pela própria Gupy (configuração da conta).

export const gupyConfig = () => ({
  apiUrl: (process.env.GUPY_API_URL ?? 'https://api.gupy.io/api/v1').replace(/\/$/, ''),
});

/** Vaga no formato neutro que os adaptadores recebem. */
export interface BoardJob {
  id: string;
  title: string;
  area: string | null;
  description: string;
  requirements: string[];
  niceToHave: string[];
  benefits: string[];
  workModel: WorkModel;
  city: string | null;
  state: string | null;
  contractType: ContractType;
  positions: number;
  salaryMin: number | null;
  salaryMax: number | null;
  showSalary: boolean;
  status: JobStatus;
  /** Nome da contratante, ou null se confidencial / a própria empresa. */
  hiringCompany: string | null;
  /** Página pública da vaga (candidatura). */
  applyUrl: string;
}

export interface BoardConfig {
  token: string;
  departmentId: string;
  roleId: string;
  branchId: string;
}

/** Plataforma de vagas: publica, atualiza e encerra. Devolve o id externo e a situação lá. */
export interface JobBoardAdapter {
  /** Cria (sem externalId) ou atualiza a vaga, e alinha a situação (publicada/pausada/encerrada). */
  sync(job: BoardJob, externalId: string | null, config: BoardConfig): Promise<{ externalId: string; remoteStatus: string }>;
}

/** Erro da plataforma: `retryable` = vale tentar de novo (rede, 429, 5xx); senão, só corrigindo a vaga/configuração. */
export class JobBoardError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

/** Chamada HTTP à API da Gupy. Isolada para ser trocada nos testes. */
@Injectable()
export class GupyHttp {
  async request(method: 'POST' | 'PATCH' | 'GET', url: string, token: string, body?: unknown): Promise<{ status: number; body: any }> {
    const res = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  }
}

/** Tipo de vaga da Gupy por tipo de contrato (a confirmar). */
const GUPY_TYPE: Record<ContractType, string> = {
  clt: 'vacancy_type_effective',
  pj: 'vacancy_legal_entity',
  internship: 'vacancy_type_internship',
  temporary: 'vacancy_type_temporary',
};
const GUPY_WORKPLACE: Record<WorkModel, string> = { onsite: 'on-site', hybrid: 'hybrid', remote: 'remote' };
/** Situação desejada na Gupy (rascunho não é enviado). */
const GUPY_STATUS: Record<Exclude<JobStatus, 'draft'>, string> = { open: 'published', paused: 'frozen', closed: 'closed' };

const html = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const paragraphs = (s: string) =>
  s
    .split(/\n{2,}/)
    .map((p) => `<p>${html(p.trim()).replace(/\n/g, '<br>')}</p>`)
    .join('');
const ul = (items: string[]) => (items.length ? `<ul>${items.map((i) => `<li>${html(i)}</li>`).join('')}</ul>` : '');

/** Corpo da vaga para a Gupy (exportado para os testes). */
export function gupyPayload(job: BoardJob, config: BoardConfig): Record<string, unknown> {
  const salary = job.showSalary ? salaryLabel(job.salaryMin, job.salaryMax) : null;
  const extra = [
    job.benefits.length ? `<p><strong>Benefícios</strong></p>${ul(job.benefits)}` : '',
    salary ? `<p><strong>Faixa salarial:</strong> ${html(salary)}</p>` : '',
    `<p><strong>Contrato:</strong> ${contractTypeLabel[job.contractType]} · <strong>Modelo:</strong> ${workModelLabel[job.workModel]}</p>`,
    `<p>Candidate-se também pela nossa página: ${html(job.applyUrl)}</p>`,
  ].join('');
  const num = (v: string) => (/^\d+$/.test(v) ? Number(v) : v);
  return {
    name: job.title,
    type: GUPY_TYPE[job.contractType],
    publicationType: 'external',
    numVacancies: job.positions,
    ...(config.departmentId ? { departmentId: num(config.departmentId) } : {}),
    ...(config.roleId ? { roleId: num(config.roleId) } : {}),
    ...(config.branchId ? { branchId: num(config.branchId) } : {}),
    description: paragraphs(job.description || job.title) + (job.hiringCompany ? `<p>Vaga em ${html(job.hiringCompany)}.</p>` : ''),
    responsibilities: paragraphs(job.description || job.title),
    prerequisites: `${ul(job.requirements)}${job.niceToHave.length ? `<p><strong>Desejável</strong></p>${ul(job.niceToHave)}` : ''}` || '<p>-</p>',
    additionalInformation: extra,
    workplaceType: GUPY_WORKPLACE[job.workModel],
    ...(job.city ? { addressCity: job.city } : {}),
    ...(job.state ? { addressState: job.state } : {}),
    addressCountry: 'Brasil',
    ...(job.showSalary && (job.salaryMin != null || job.salaryMax != null)
      ? { salary: { currency: 'R$', startsAt: job.salaryMin ?? job.salaryMax, endsAt: job.salaryMax ?? job.salaryMin } }
      : {}),
  };
}

/** Cliente da API pública da Gupy (formato a confirmar: ver o topo do arquivo). */
export class GupyApiAdapter implements JobBoardAdapter {
  constructor(
    private readonly http: GupyHttp,
    private readonly apiUrl: string,
  ) {}

  async sync(job: BoardJob, externalId: string | null, config: BoardConfig) {
    const payload = gupyPayload(job, config);
    let id = externalId;
    if (!id) {
      const created = await this.call('POST', '/jobs', config.token, payload);
      id = created?.id != null ? String(created.id) : null;
      if (!id) throw new JobBoardError('A Gupy não devolveu o id da vaga criada', false);
    } else {
      await this.call('PATCH', `/jobs/${encodeURIComponent(id)}`, config.token, payload);
    }
    const target = job.status === 'draft' ? null : GUPY_STATUS[job.status];
    if (target) await this.call('PATCH', `/jobs/${encodeURIComponent(id)}`, config.token, { status: target });
    return { externalId: id, remoteStatus: target ?? 'draft' };
  }

  private async call(method: 'POST' | 'PATCH', path: string, token: string, body: unknown) {
    let res: { status: number; body: any };
    try {
      res = await this.http.request(method, `${this.apiUrl}${path}`, token, body);
    } catch (err) {
      throw new JobBoardError(`Sem resposta da Gupy: ${(err as Error).message}`, true);
    }
    if (res.status >= 200 && res.status < 300) return res.body;
    const detail = res.body?.message ?? res.body?.error ?? res.body?.errors ?? res.body;
    const text = typeof detail === 'string' ? detail : JSON.stringify(detail);
    if (res.status === 401 || res.status === 403) throw new JobBoardError(`A Gupy recusou o token (${res.status}). Confira o token nas configurações do Head hunter.`, false);
    throw new JobBoardError(`A Gupy respondeu ${res.status}: ${text.slice(0, 300)}`, res.status === 429 || res.status >= 500);
  }
}

/** Modo simulado: registra a vaga como publicada sem chamar a Gupy (demonstração e testes). */
export class SimulatedGupyAdapter implements JobBoardAdapter {
  async sync(job: BoardJob, externalId: string | null) {
    return { externalId: externalId ?? `simulado-${job.id.slice(0, 8)}`, remoteStatus: job.status === 'draft' ? 'draft' : GUPY_STATUS[job.status] };
  }
}
