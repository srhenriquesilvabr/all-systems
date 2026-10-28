// Geração de arquivos sem dependências (rodam no Workers): PDF simples de texto, ZIP sem compressão
// e CSV para planilha. O PDF/XML "ilustrativos" são do modo simulado; os reais vêm do provedor.

// ---- PDF ------------------------------------------------------------------------------------------

export interface PdfLine {
  text: string;
  size?: number;
  bold?: boolean;
  /** Espaço extra antes da linha. */
  gap?: number;
}

/** Caracteres do Windows-1252 (WinAnsiEncoding) fora do Latin-1. */
const CP1252: Record<string, number> = { '€': 0x80, '…': 0x85, '•': 0x95, '–': 0x96, '—': 0x97, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '™': 0x99 };

function pdfString(text: string): number[] {
  const out: number[] = [];
  for (const ch of text) {
    let code = CP1252[ch] ?? ch.charCodeAt(0);
    if (code > 255) code = 63; // "?"
    if (code === 0x28 || code === 0x29 || code === 0x5c) out.push(0x5c);
    out.push(code);
  }
  return out;
}

/** Quebra uma linha longa em várias (estimativa pela largura média da Helvetica). */
function wrap(line: PdfLine, width: number): PdfLine[] {
  const size = line.size ?? 10;
  const max = Math.max(20, Math.floor(width / (size * 0.5)));
  if (line.text.length <= max) return [line];
  const out: PdfLine[] = [];
  let rest = line.text;
  let first = true;
  while (rest.length > max) {
    let cut = rest.lastIndexOf(' ', max);
    if (cut < max * 0.5) cut = max;
    out.push({ ...line, text: rest.slice(0, cut), gap: first ? line.gap : 0 });
    rest = rest.slice(cut).trimStart();
    first = false;
  }
  out.push({ ...line, text: rest, gap: 0 });
  return out;
}

/** PDF A4 só de texto (Helvetica), com quebra de página. */
export function textPdf(lines: PdfLine[], opts: { watermark?: string } = {}): Buffer {
  const pageW = 595;
  const pageH = 842;
  const margin = 40;
  const pages: number[][] = [];
  let ops: number[] = [];
  let y = pageH - margin;
  const push = (s: string) => ops.push(...Buffer.from(s, 'latin1'));
  const newPage = () => {
    if (ops.length) pages.push(ops);
    ops = [];
    y = pageH - margin;
    if (opts.watermark) {
      push('q 0.85 g BT /F2 40 Tf 0.7071 0.7071 -0.7071 0.7071 120 250 Tm (');
      ops.push(...pdfString(opts.watermark));
      push(') Tj ET Q\n');
    }
  };
  newPage();
  for (const raw of lines.flatMap((l) => wrap(l, pageW - margin * 2))) {
    const size = raw.size ?? 10;
    y -= size * 1.35 + (raw.gap ?? 0);
    if (y < margin) {
      newPage();
      y -= size * 1.35;
    }
    push(`BT /${raw.bold ? 'F2' : 'F1'} ${size} Tf ${margin} ${y.toFixed(1)} Td (`);
    ops.push(...pdfString(raw.text));
    push(') Tj ET\n');
  }
  pages.push(ops);

  const objects: Buffer[] = [];
  const pageIds = pages.map((_, i) => 5 + i * 2);
  objects[1] = Buffer.from('<< /Type /Catalog /Pages 2 0 R >>', 'latin1');
  objects[2] = Buffer.from(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`, 'latin1');
  objects[3] = Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>', 'latin1');
  objects[4] = Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>', 'latin1');
  pages.forEach((content, i) => {
    const pageId = pageIds[i]!;
    objects[pageId] = Buffer.from(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Contents ${pageId + 1} 0 R /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> >>`,
      'latin1',
    );
    const stream = Buffer.from(content);
    objects[pageId + 1] = Buffer.concat([Buffer.from(`<< /Length ${stream.length} >>\nstream\n`, 'latin1'), stream, Buffer.from('\nendstream', 'latin1')]);
  });

  const chunks: Buffer[] = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
  const offsets: number[] = [];
  let length = chunks[0]!.length;
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = length;
    const obj = Buffer.concat([Buffer.from(`${id} 0 obj\n`, 'latin1'), objects[id]!, Buffer.from('\nendobj\n', 'latin1')]);
    chunks.push(obj);
    length += obj.length;
  }
  const xref = [`xref\n0 ${objects.length}\n`, '0000000000 65535 f \n', ...offsets.slice(1).map((o) => `${String(o).padStart(10, '0')} 00000 n \n`)].join('');
  chunks.push(Buffer.from(`${xref}trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`, 'latin1'));
  return Buffer.concat(chunks);
}

// ---- ZIP ------------------------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** ZIP sem compressão ("store"): simples, sem dependência e aberto por qualquer descompactador. */
export function zip(files: { name: string; content: Buffer; date?: Date }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const crc = crc32(f.content);
    const d = f.date ?? new Date();
    const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
    const dosDate = ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // nomes em UTF-8
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(f.content.length, 18);
    local.writeUInt32LE(f.content.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, f.content);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(f.content.length, 20);
    central.writeUInt32LE(f.content.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += 30 + name.length + f.content.length;
  }
  const centralSize = centrals.reduce((s, b) => s + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

// ---- CSV ------------------------------------------------------------------------------------------

/** CSV para Excel em português: separador ";", vírgula decimal e BOM para os acentos. */
export function csv(header: string[], rows: (string | number | null | undefined)[][]): string {
  const cell = (v: string | number | null | undefined) => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'number' ? v.toFixed(2).replace('.', ',') : v;
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + [header, ...rows].map((r) => r.map(cell).join(';')).join('\r\n') + '\r\n';
}

/** Escapa texto para XML. */
export const xmlText = (v: unknown) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
