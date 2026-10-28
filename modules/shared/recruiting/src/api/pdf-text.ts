import { inflateSync } from 'node:zlib';

/**
 * Texto de um PDF, do jeito mais simples possível: lê os operadores de texto (Tj/TJ) dos streams,
 * descomprimindo os FlateDecode. Serve à estimativa sem IA (palavras-chave), não a uma leitura fiel:
 * PDFs com fontes em CID/Identity-H ou digitalizados (imagem) voltam com pouco ou nenhum texto.
 */
export function pdfText(pdf: Buffer, maxChars = 60_000): string {
  const raw = pdf.toString('latin1');
  if (!raw.startsWith('%PDF-')) return '';
  const out: string[] = [];
  let total = 0;
  const streamRe = /(?<!end)stream\r?\n/g;
  let match: RegExpExecArray | null;
  let streams = 0;
  while ((match = streamRe.exec(raw)) && streams++ < 400 && total < maxChars) {
    // Dicionário do mesmo objeto: do "obj" anterior até a palavra "stream".
    const objStart = raw.lastIndexOf('obj', match.index);
    const dict = raw.slice(objStart < 0 ? Math.max(0, match.index - 2000) : objStart, match.index);
    const start = match.index + match[0].length;
    const end = raw.indexOf('endstream', start);
    if (end < 0) break;
    streamRe.lastIndex = end;
    // Imagens e fontes não têm texto.
    if (/\/Subtype\s*\/(Image|Type1C|CIDFontType0C|OpenType)/.test(dict) || /\/Length1|\/FontFile/.test(dict)) continue;
    let body = raw.slice(start, end).replace(/\r?\n$/, '');
    if (/\/FlateDecode/.test(dict)) {
      try {
        // Limite de saída: um PDF malicioso não estoura a memória com um stream comprimido gigante.
        body = inflateSync(Buffer.from(body, 'latin1'), { maxOutputLength: 4 * 1024 * 1024 }).toString('latin1');
      } catch {
        continue;
      }
    } else if (/\/Filter/.test(dict)) {
      continue;
    }
    const text = textOperators(body);
    if (text) {
      out.push(text);
      total += text.length;
    }
  }
  return out.join('\n').replace(/[ \t]+/g, ' ').slice(0, maxChars);
}

/** Junta as strings dos operadores Tj, ' , " e TJ de um content stream. */
function textOperators(content: string): string {
  if (!/\bBT\b/.test(content)) return '';
  const parts: string[] = [];
  // (texto) Tj | [(a) -120 (b)] TJ | T* / Td / TD / ' quebram linha
  const re = /\[((?:\\.|[^\]])*)\]\s*TJ|\(((?:\\.|[^\\)])*)\)\s*(?:Tj|'|")|(T\*|Td|TD|ET)(?![A-Za-z])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) {
    if (m[1] !== undefined) {
      const strings = [...m[1].matchAll(/\(((?:\\.|[^\\)])*)\)/g)].map((s) => unescape(s[1] ?? ''));
      parts.push(strings.join(''));
    } else if (m[2] !== undefined) {
      parts.push(unescape(m[2]));
    } else {
      parts.push('\n');
    }
  }
  return parts.join('').replace(/\n{2,}/g, '\n').trim();
}

function unescape(s: string): string {
  return s.replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_, c: string) => {
    if (/^[0-7]+$/.test(c)) return String.fromCharCode(parseInt(c, 8));
    return ({ n: '\n', r: '\n', t: ' ', b: '', f: '', '(': '(', ')': ')', '\\': '\\' } as Record<string, string>)[c] ?? c;
  });
}
