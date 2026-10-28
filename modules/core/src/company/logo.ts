// Validação do logo da empresa. O logo é servido numa rota pública do mesmo domínio do admin,
// então nada que o navegador possa executar passa daqui.

export const MAX_LOGO_BYTES = 1024 * 1024;

export type LogoMime = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/svg+xml';

export class LogoError extends Error {
  constructor(
    readonly code: 'INVALID_FILE_TYPE' | 'FILE_TOO_LARGE' | 'UNSAFE_SVG',
    message: string,
  ) {
    super(message);
  }
}

/**
 * Confere tipo (pelos bytes, não só pelo que o navegador declarou) e tamanho. Imagens comuns
 * passam como vieram; SVG passa pela checagem de `sanitizeSvg` e é gravado já sem comentários.
 */
export function checkLogo(file: { buffer: Buffer; mimetype: string; size: number }): { mime: LogoMime; content: Buffer } {
  if (file.size > MAX_LOGO_BYTES || file.buffer.length > MAX_LOGO_BYTES) {
    throw new LogoError('FILE_TOO_LARGE', 'O logo pode ter no máximo 1 MB');
  }
  const mime = sniff(file.buffer);
  if (!mime) throw new LogoError('INVALID_FILE_TYPE', 'Envie o logo em PNG, JPG, SVG ou WebP');
  if (mime === 'image/svg+xml') return { mime, content: Buffer.from(sanitizeSvg(file.buffer.toString('utf8')), 'utf8') };
  return { mime, content: file.buffer };
}

function sniff(buf: Buffer): LogoMime | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  // SVG é texto: começa (depois de BOM, espaços, declaração XML e comentários) com <svg.
  const head = buf.toString('utf8', 0, Math.min(buf.length, 4096)).replace(/^﻿/, '');
  if (/^\s*(<\?xml[^>]*\?>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(head)) return 'image/svg+xml';
  return null;
}

/**
 * Elementos aceitos num logo: desenho, texto, gradientes, máscaras e os metadados que Illustrator
 * e Inkscape costumam deixar. Fora da lista ficam script, foreignObject, a (links), animações
 * (set/animate podem trocar um href para javascript:), iframe/embed/object etc.
 */
const ALLOWED_ELEMENTS = new Set(
  [
    'svg', 'g', 'defs', 'symbol', 'use', 'title', 'desc', 'metadata', 'style',
    'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
    'text', 'tspan', 'textpath',
    'lineargradient', 'radialgradient', 'stop', 'pattern', 'clippath', 'mask', 'image',
    'filter', 'feblend', 'fecolormatrix', 'fecomponenttransfer', 'fecomposite', 'feflood', 'fegaussianblur',
    'femerge', 'femergenode', 'feoffset', 'fefunca', 'fefuncb', 'fefuncg', 'fefuncr', 'fedropshadow', 'femorphology',
  ],
);
/** Prefixos de editores (metadados, sem efeito no desenho). */
const ALLOWED_PREFIXES = ['sodipodi:', 'inkscape:', 'rdf:', 'cc:', 'dc:', 'i:', 'x:'];

const TAG = /<(\/?)([A-Za-z][\w.:-]*)((?:\s+[^\s"'<>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'))?)*)\s*(\/?)>/y;
const ATTR = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'))?/g;

/**
 * Checa um SVG por lista do que é permitido, e recusa o resto (não tenta consertar). Só remove
 * comentários e a declaração XML. Recusa: DOCTYPE/entidades, CDATA, instruções de processamento,
 * elementos fora da lista, atributos `on*`, links que não sejam internos (#id) ou imagem embutida
 * (data:image), `url(...)` externo e `@import`/`expression`/`javascript:` em estilos.
 *
 * É a primeira de duas camadas: a rota pública ainda serve o arquivo com CSP que bloqueia script.
 */
export function sanitizeSvg(input: string): string {
  const unsafe = (detail: string): never => {
    throw new LogoError('UNSAFE_SVG', `Não foi possível aceitar este SVG (${detail}). Exporte de novo como SVG simples ou envie em PNG.`);
  };

  let svg = input.replace(/^﻿/, '').replace(/<!--[\s\S]*?-->/g, '');
  if (/<!--/.test(svg)) unsafe('comentário sem fim');
  svg = svg.replace(/^\s*<\?xml[^>]*\?>/i, '').trim();
  if (/<!DOCTYPE|<!ENTITY|<!\[CDATA\[|<\?/i.test(svg)) unsafe('DOCTYPE, entidades ou CDATA');
  if (/&(?!(amp|lt|gt|quot|apos|#\d{1,7}|#x[0-9a-f]{1,6});)/i.test(svg)) unsafe('entidade desconhecida');

  const stack: string[] = [];
  let root = false;
  let i = 0;
  while (i < svg.length) {
    const lt = svg.indexOf('<', i);
    const text = svg.slice(i, lt === -1 ? svg.length : lt);
    if (text.trim()) {
      if (!stack.length) unsafe('texto fora do <svg>');
      if (stack.at(-1) === 'style') checkCss(text, unsafe);
    }
    if (lt === -1) break;
    TAG.lastIndex = lt;
    const m = TAG.exec(svg);
    if (!m) unsafe('marcação inválida');
    const [whole, closing, rawName, attrs, selfClosing] = m!;
    const name = rawName!.toLowerCase();
    if (!ALLOWED_ELEMENTS.has(name) && !ALLOWED_PREFIXES.some((p) => name.startsWith(p))) unsafe(`elemento <${rawName}>`);

    if (closing) {
      if (stack.pop() !== name) unsafe('tags desencontradas');
    } else {
      if (!stack.length) {
        if (root || name !== 'svg') unsafe('o arquivo precisa ter um único <svg>');
        root = true;
      }
      checkAttributes(name, attrs ?? '', unsafe);
      if (!selfClosing) stack.push(name);
    }
    i = lt + whole!.length;
  }
  if (!root || stack.length) unsafe('o arquivo não fecha o <svg>');
  return svg;
}

function checkAttributes(element: string, attrs: string, unsafe: (detail: string) => never) {
  for (const [, rawName, dq, sq] of attrs.matchAll(ATTR)) {
    const name = rawName!.toLowerCase();
    const value = dq ?? sq ?? '';
    if (name.startsWith('on')) unsafe(`atributo ${rawName}`);
    if (name === 'href' || name.endsWith(':href')) {
      const embedded = element === 'image' && /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=\s]+$/.test(value);
      if (!/^#[\w.:-]+$/.test(value) && !embedded) unsafe('link para fora do arquivo');
    }
    if (/^(xml:base|formaction|action|src|srcdoc|data)$/.test(name)) unsafe(`atributo ${rawName}`);
    checkCss(value, unsafe);
  }
}

/** Valores de atributo e conteúdo de <style>: só url(#id) e nada que carregue ou execute algo. */
function checkCss(value: string, unsafe: (detail: string) => never) {
  // Referências de caractere (&#114;) e escapes de CSS (u\72l = url) poderiam esconder
  // "javascript:" ou "url(" de uma checagem por texto. Logo não precisa de nenhum dos dois.
  if (/&#/.test(value) && /url|script|expression|import/i.test(decodeEntities(value))) unsafe('conteúdo codificado suspeito');
  if (/[\\<]/.test(value)) unsafe('caracteres de escape no estilo ou atributo');
  if (/javascript:|vbscript:|expression\s*\(|@import|behavior\s*:|-moz-binding/i.test(value)) unsafe('estilo ou link executável');
  for (const m of value.matchAll(/url\s*\(\s*(['"]?)([^'")]*)\1\s*\)/gi)) {
    if (!/^#[\w.:-]+$/.test(m[2]!.trim())) unsafe('recurso externo em url()');
  }
}

function decodeEntities(value: string) {
  const char = (code: number) => (code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '');
  return value.replace(/&#x([0-9a-f]+);?/gi, (_, h: string) => char(Number.parseInt(h, 16))).replace(/&#(\d+);?/g, (_, d: string) => char(Number(d)));
}
