import type { AnalysisResult } from '../contracts';

/**
 * Estimativa de aderência sem IA: procura as palavras de cada requisito no texto do currículo e das
 * respostas. Obrigatórios valem o dobro dos desejáveis. É uma aproximação grosseira (não entende
 * sinônimos nem contexto) e aparece na tela como "estimativa sem IA".
 */
export function heuristicScore(job: { requirements: string[]; niceToHave: string[]; title: string }, text: string): AnalysisResult {
  const haystack = ` ${normalize(text)} `;
  const words = new Set(haystack.split(' ').filter(Boolean));
  const check = (req: string) => matches(req, haystack, words);

  const required = job.requirements.map((r) => ({ r, ok: check(r) }));
  const desired = job.niceToHave.map((r) => ({ r, ok: check(r) }));
  const weight = required.length * 2 + desired.length;
  const got = required.filter((x) => x.ok).length * 2 + desired.filter((x) => x.ok).length;

  let score: number;
  if (weight === 0) {
    // Vaga sem requisitos: só o título serve de referência.
    score = check(job.title) ? 60 : 40;
  } else {
    score = Math.round((got / weight) * 100);
  }
  // Pouco texto (PDF digitalizado, currículo vazio): a nota não diz muito; fica no meio, sem extremos.
  const thin = words.size < 25;
  if (thin) score = Math.min(score, 50);

  const strengths = [...required, ...desired].filter((x) => x.ok).map((x) => x.r).slice(0, 8);
  const gaps = required.filter((x) => !x.ok).map((x) => x.r);
  const missingDesired = desired.filter((x) => !x.ok).map((x) => `${x.r} (desejável)`);
  const reqOk = required.filter((x) => x.ok).length;

  const summary = [
    'Estimativa sem IA, por palavras-chave.',
    required.length ? `${reqOk} de ${required.length} requisitos obrigatórios aparecem no currículo ou nas respostas.` : 'A vaga não tem requisitos obrigatórios cadastrados.',
    desired.length ? `${desired.filter((x) => x.ok).length} de ${desired.length} desejáveis.` : '',
    thin ? 'Pouco texto foi lido do currículo (pode ser imagem ou PDF protegido): confira manualmente.' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return { score: clamp(score), strengths, gaps: [...gaps, ...missingDesired].slice(0, 8), summary };
}

const STOPWORDS = new Set(
  'a o as os de da do das dos e em no na nos nas um uma uns umas com para por ou ao aos que se sua seu suas seus como mais ter ser estar experiencia experiência conhecimento conhecimentos desejavel desejável obrigatorio obrigatório nivel nível anos ano minimo mínimo boa bom boas bons area área'
    .split(' ')
    .map(normalize),
);

/** Requisito atendido: a frase inteira aparece, ou ao menos 60% das palavras relevantes. */
function matches(requirement: string, haystack: string, words: Set<string>): boolean {
  const req = normalize(requirement);
  if (!req) return false;
  if (req.length >= 3 && haystack.includes(` ${req} `)) return true;
  const tokens = req.split(' ').filter((w) => w.length >= 2 && !STOPWORDS.has(w) && !/^\d+$/.test(w));
  if (!tokens.length) return false;
  const hits = tokens.filter((w) => words.has(w) || (w.length >= 5 && haystack.includes(` ${w.slice(0, -1)}`))).length;
  return hits / tokens.length >= 0.6;
}

/** Minúsculas, sem acentos, só letras/números (mantém + e # de "C++", "C#"). */
export function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9+#]+/g, ' ')
    .trim();
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
