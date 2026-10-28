import { contractTypeLabel, salaryLabel, workModelLabel } from '../contracts';
import type { BoardJob } from './gupy';

// Feed XML de vagas no formato do Indeed (<source><job>…</job></source>), um por empresa, com as
// vagas abertas e o link de candidatura apontando para a página pública.
//
// A CONFIRMAR COM O INDEED: o cadastro do feed é feito pela empresa com o Indeed (conta de
// empregador / gerente de contas), que aprova a URL e a frequência de leitura; o Indeed vem
// substituindo feeds XML orgânicos por integrações de ATS parceiras (Job Sync API) e pode exigir
// campos extras (ex.: e-mail de contato, CNPJ) ou recusar vagas sem salário em algumas regiões.

/** CDATA à prova de "]]>" dentro do texto. */
const cdata = (v: string | number | null | undefined) => `<![CDATA[${String(v ?? '').replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;

/** Tipos de jornada aceitos pelo Indeed (jobtype). */
const JOB_TYPE: Record<BoardJob['contractType'], string> = { clt: 'fulltime', pj: 'contract', internship: 'internship', temporary: 'temporary' };

export function indeedFeed(o: {
  publisher: string;
  publisherUrl: string;
  /** Nome exibido como empresa quando a vaga é confidencial ou da própria empresa. */
  companyName: string;
  jobs: (BoardJob & { openedAt: Date | null; updatedAt: Date })[];
}): string {
  const lastBuild = o.jobs.reduce((max, j) => (j.updatedAt > max ? j.updatedAt : max), new Date(0));
  const items = o.jobs.map((j) => {
    const salary = j.showSalary ? salaryLabel(j.salaryMin, j.salaryMax) : null;
    const description = [
      j.description,
      j.requirements.length ? `Requisitos:\n${j.requirements.map((r) => `• ${r}`).join('\n')}` : '',
      j.niceToHave.length ? `Desejável:\n${j.niceToHave.map((r) => `• ${r}`).join('\n')}` : '',
      j.benefits.length ? `Benefícios:\n${j.benefits.map((r) => `• ${r}`).join('\n')}` : '',
      `Contrato: ${contractTypeLabel[j.contractType]} · Modelo: ${workModelLabel[j.workModel]}`,
    ]
      .filter(Boolean)
      .join('\n\n')
      .replace(/\n/g, '<br>');
    const remote = j.workModel === 'remote' ? 'Fully remote' : j.workModel === 'hybrid' ? 'Hybrid remote' : '';
    return [
      '<job>',
      `<title>${cdata(j.title)}</title>`,
      `<date>${cdata((j.openedAt ?? j.updatedAt).toUTCString())}</date>`,
      `<referencenumber>${cdata(j.id)}</referencenumber>`,
      `<url>${cdata(j.applyUrl)}</url>`,
      `<company>${cdata(j.hiringCompany ?? o.companyName)}</company>`,
      `<sourcename>${cdata(o.publisher)}</sourcename>`,
      `<city>${cdata(j.city)}</city>`,
      `<state>${cdata(j.state)}</state>`,
      `<country>${cdata('BR')}</country>`,
      `<description>${cdata(description)}</description>`,
      salary ? `<salary>${cdata(`${salary} por mês`)}</salary>` : '',
      `<jobtype>${cdata(JOB_TYPE[j.contractType])}</jobtype>`,
      j.area ? `<category>${cdata(j.area)}</category>` : '',
      remote ? `<remotetype>${cdata(remote)}</remotetype>` : '',
      '</job>',
    ]
      .filter(Boolean)
      .join('\n');
  });
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<source>',
    `<publisher>${cdata(o.publisher)}</publisher>`,
    `<publisherurl>${cdata(o.publisherUrl)}</publisherurl>`,
    `<lastBuildDate>${cdata((o.jobs.length ? lastBuild : new Date()).toUTCString())}</lastBuildDate>`,
    ...items,
    '</source>',
    '',
  ].join('\n');
}

/** Texto pronto para postar a vaga no LinkedIn (a API de vagas do LinkedIn é restrita a parceiros). */
export function linkedinPost(j: BoardJob): string {
  const salary = j.showSalary ? salaryLabel(j.salaryMin, j.salaryMax) : null;
  const where = j.workModel === 'remote' ? 'Remoto' : [workModelLabel[j.workModel], [j.city, j.state].filter(Boolean).join('/')].filter(Boolean).join(' · ');
  const lines = [
    `🚀 Vaga aberta: ${j.title}${j.hiringCompany ? ` na ${j.hiringCompany}` : ''}`,
    '',
    `📍 ${where}`,
    `📄 ${contractTypeLabel[j.contractType]}${j.positions > 1 ? ` · ${j.positions} posições` : ''}`,
    salary ? `💰 ${salary}` : '',
    '',
    j.requirements.length ? `O que buscamos:\n${j.requirements.slice(0, 6).map((r) => `✔️ ${r}`).join('\n')}` : '',
    j.benefits.length ? `\nBenefícios:\n${j.benefits.slice(0, 6).map((b) => `• ${b}`).join('\n')}` : '',
    '',
    `Candidate-se: ${j.applyUrl}`,
    '',
    `#vagas #emprego${j.area ? ` #${j.area.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]/g, '')}` : ''}`,
  ];
  return lines
    .filter((l, i, all) => !(l === '' && all[i - 1] === ''))
    .join('\n')
    .trim();
}
