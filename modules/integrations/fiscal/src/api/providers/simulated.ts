import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { accessKeyCheckDigit, docTypeShort, onlyDigits, paymentMethodLabel, type DocType } from '../../contracts';
import { textPdf, xmlText, type PdfLine } from '../files';
import type { CancelResult, CorrectionResult, FiscalProvider, ProviderContext, ProviderDocument, ProviderResult, VoidResult } from './types';

const UF_CODE: Record<string, string> = {
  RO: '11', AC: '12', AM: '13', RR: '14', PA: '15', AP: '16', TO: '17', MA: '21', PI: '22', CE: '23', RN: '24', PB: '25', PE: '26', AL: '27', SE: '28', BA: '29',
  MG: '31', ES: '32', RJ: '33', SP: '35', PR: '41', SC: '42', RS: '43', MS: '50', MT: '51', GO: '52', DF: '53',
};
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const dateTime = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' });

/** Marca do texto que força rejeição (para demonstração e testes). */
export const SIMULATED_REJECT_MARK = 'REJEITAR';

/**
 * Provedor simulado: não fala com ninguém e responde sempre igual para a mesma nota.
 *
 * - NFC-e: autorizada na hora (como a SEFAZ responde a NFC-e); NFS-e e NF-e: "processando" no envio e
 *   autorizadas na primeira consulta (job, webhook ou botão "Atualizar"), como nos provedores reais.
 * - Rejeita (de propósito, de forma previsível):
 *   - NFS-e com alíquota de ISS abaixo de 2% ou acima de 5% (LC 116/2003, art. 8º-A e art. 8º, II);
 *   - NF-e sem CPF/CNPJ ou sem endereço do destinatário;
 *   - qualquer nota com a palavra REJEITAR nas informações complementares.
 * - Cancelamento e carta de correção são aceitos, menos com REJEITAR no texto.
 * - Gera XML e PDF ilustrativos, marcados "SEM VALOR FISCAL".
 */
@Injectable()
export class SimulatedProvider implements FiscalProvider {
  readonly key = 'simulated' as const;

  async emit(ctx: ProviderContext, doc: ProviderDocument): Promise<ProviderResult> {
    const rejection = this.rejection(doc);
    if (rejection) return { status: 'rejected', code: rejection.code, message: rejection.message, errors: [{ code: rejection.code, message: rejection.message, field: rejection.field }] };
    if (doc.type === 'nfce') return this.authorized(ctx, doc);
    return { status: 'processing', message: 'Recebida pelo provedor simulado; autoriza na próxima consulta.', protocol: this.hash(doc.reference, 12) };
  }

  async status(ctx: ProviderContext, doc: Pick<ProviderDocument, 'type' | 'reference'> & Partial<ProviderDocument>): Promise<ProviderResult> {
    if (!doc.items) return { status: 'processing' };
    const full = doc as ProviderDocument;
    const rejection = this.rejection(full);
    if (rejection) return { status: 'rejected', code: rejection.code, message: rejection.message, errors: [{ code: rejection.code, message: rejection.message, field: rejection.field }] };
    return this.authorized(ctx, full);
  }

  async cancel(_ctx: ProviderContext, doc: Pick<ProviderDocument, 'type' | 'reference'>, reason: string): Promise<CancelResult> {
    if (reason.toUpperCase().includes(SIMULATED_REJECT_MARK)) return { ok: false, code: 'SIM-218', message: 'Cancelamento recusado (simulação)' };
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<!-- DOCUMENTO SIMULADO: SEM VALOR FISCAL -->\n<evento tipo="cancelamento"><referencia>${xmlText(doc.reference)}</referencia><justificativa>${xmlText(reason)}</justificativa><protocolo>${this.hash(`${doc.reference}:cancel`, 15, true)}</protocolo></evento>\n`;
    return { ok: true, message: 'Cancelamento homologado (simulação)', protocol: this.hash(`${doc.reference}:cancel`, 15, true), cancelXml: { content: Buffer.from(xml), mime: 'application/xml' } };
  }

  async correct(_ctx: ProviderContext, doc: Pick<ProviderDocument, 'type' | 'reference'>, text: string): Promise<CorrectionResult> {
    if (text.toUpperCase().includes(SIMULATED_REJECT_MARK)) return { ok: false, message: 'Carta de correção recusada (simulação)' };
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<!-- DOCUMENTO SIMULADO: SEM VALOR FISCAL -->\n<evento tipo="carta-de-correcao"><referencia>${xmlText(doc.reference)}</referencia><correcao>${xmlText(text)}</correcao></evento>\n`;
    const pdf = textPdf([{ text: 'CARTA DE CORREÇÃO ELETRÔNICA', size: 14, bold: true }, { text: `Referência: ${doc.reference}` }, { text: text, gap: 8 }], { watermark: 'SEM VALOR FISCAL' });
    return { ok: true, message: 'Evento registrado (simulação)', protocol: this.hash(`${doc.reference}:cce:${text}`, 15, true), xml: { content: Buffer.from(xml), mime: 'application/xml' }, pdf: { content: pdf, mime: 'application/pdf' } };
  }

  async voidRange(_ctx: ProviderContext, input: { type: 'nfce' | 'nfe'; series: string; from: number; to: number; reason: string }): Promise<VoidResult> {
    if (input.reason.toUpperCase().includes(SIMULATED_REJECT_MARK)) return { ok: false, message: 'Inutilização recusada (simulação)' };
    const protocol = this.hash(`${input.type}:${input.series}:${input.from}:${input.to}`, 15, true);
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<!-- DOCUMENTO SIMULADO: SEM VALOR FISCAL -->\n<inutilizacao modelo="${input.type === 'nfe' ? 55 : 65}" serie="${xmlText(input.series)}" inicial="${input.from}" final="${input.to}"><justificativa>${xmlText(input.reason)}</justificativa><protocolo>${protocol}</protocolo></inutilizacao>\n`;
    return { ok: true, protocol, message: 'Inutilização homologada (simulação)', xml: { content: Buffer.from(xml), mime: 'application/xml' } };
  }

  async download(): Promise<Buffer> {
    throw new Error('O provedor simulado devolve os arquivos no corpo da resposta');
  }

  // ---- internos -----------------------------------------------------------------------------------

  private rejection(doc: ProviderDocument): { code: string; message: string; field?: string } | null {
    if (doc.additionalInfo?.toUpperCase().includes(SIMULATED_REJECT_MARK)) {
      return { code: 'SIM-999', message: 'Rejeição simulada: a palavra REJEITAR está nas informações complementares. Retire-a e reenvie.', field: 'additionalInfo' };
    }
    if (doc.type === 'nfse') {
      const rate = doc.items[0]?.issRate ?? 0;
      if (rate < 2 || rate > 5) {
        return {
          code: 'E0625',
          message: `Alíquota do ISS informada (${String(rate).replace('.', ',')}%) fora do permitido pelo município: mínimo de 2% e máximo de 5% (LC 116/2003). Corrija a alíquota e reenvie.`,
          field: 'items.issRate',
        };
      }
    }
    if (doc.type === 'nfe') {
      if (!doc.recipient?.document) return { code: '225', message: 'Rejeição: falha no schema XML — destinatário sem CPF/CNPJ.', field: 'recipient.document' };
      if (!doc.recipient.address?.street || !doc.recipient.address.city) return { code: '225', message: 'Rejeição: endereço do destinatário incompleto.', field: 'recipient.address' };
    }
    return null;
  }

  private authorized(ctx: ProviderContext, doc: ProviderDocument): ProviderResult {
    const protocol = this.hash(`${doc.reference}:prot`, 15, true);
    const accessKey = doc.type === 'nfse' ? this.nfseKey(ctx, doc) : this.accessKey(ctx, doc);
    const verificationCode = doc.type === 'nfse' ? this.hash(doc.reference, 8).toUpperCase() : null;
    const consultUrl = `https://simulador.palmer.local/consulta/${accessKey}`;
    return {
      status: 'authorized',
      number: doc.number,
      series: doc.series,
      accessKey,
      verificationCode,
      protocol,
      message: doc.type === 'nfse' ? 'NFS-e gerada (simulação)' : 'Autorizado o uso da NF-e (simulação)',
      code: doc.type === 'nfse' ? null : '100',
      xml: { content: Buffer.from(this.xml(ctx, doc, accessKey, protocol, verificationCode)), mime: 'application/xml' },
      pdf: { content: this.pdf(ctx, doc, accessKey, protocol, verificationCode), mime: 'application/pdf' },
      consultUrl,
      qrCodeUrl: doc.type === 'nfce' ? `${consultUrl}?p=${accessKey}|2|${ctx.environment === 'production' ? 1 : 2}` : null,
    };
  }

  /** Chave de 44 dígitos no formato oficial (UF, AAMM, CNPJ, modelo, série, número, tpEmis, código, DV). */
  private accessKey(ctx: ProviderContext, doc: ProviderDocument): string {
    const uf = UF_CODE[ctx.company.address?.state ?? 'SP'] ?? '35';
    const local = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: '2-digit', month: '2-digit' }).format(doc.issuedAt).replace('-', '');
    const cnpj = onlyDigits(ctx.company.document ?? '').padStart(14, '0').slice(-14);
    const model = doc.type === 'nfe' ? '55' : '65';
    const series = (doc.series ?? '1').padStart(3, '0').slice(-3);
    const number = String(doc.number ?? 1).padStart(9, '0').slice(-9);
    const code = String(parseInt(this.hash(doc.reference, 8), 16) % 100_000_000).padStart(8, '0');
    const first43 = `${uf}${local}${cnpj}${model}${series}${number}1${code}`;
    return `${first43}${accessKeyCheckDigit(first43)}`;
  }

  /** Chave da NFS-e Nacional (50 posições) — aqui só um número ilustrativo do mesmo tamanho. */
  private nfseKey(ctx: ProviderContext, doc: ProviderDocument): string {
    const municipality = (ctx.settings.municipalityCode || '3550308').padStart(7, '0');
    const cnpj = onlyDigits(ctx.company.document ?? '').padStart(14, '0').slice(-14);
    const number = String(doc.number ?? 1).padStart(13, '0').slice(-13);
    const tail = String(parseInt(this.hash(doc.reference, 10), 16)).padStart(16, '0').slice(-16);
    return `${municipality}${cnpj}${number}${tail}`.slice(0, 50);
  }

  private hash(text: string, len: number, digits = false): string {
    const hex = createHash('sha256').update(text).digest('hex');
    if (!digits) return hex.slice(0, len);
    return BigInt(`0x${hex.slice(0, 24)}`).toString().padStart(len, '0').slice(0, len);
  }

  private xml(ctx: ProviderContext, doc: ProviderDocument, key: string, protocol: string, verification: string | null): string {
    const c = ctx.company;
    const items = doc.items
      .map(
        (i, n) =>
          `    <item n="${n + 1}"><codigo>${xmlText(i.code)}</codigo><descricao>${xmlText(i.description)}</descricao><quantidade>${i.quantity}</quantidade><unidade>${xmlText(i.unit)}</unidade><valorUnitario>${i.unitPrice.toFixed(2)}</valorUnitario><desconto>${i.discount.toFixed(2)}</desconto><total>${i.total.toFixed(2)}</total>` +
          (doc.type === 'nfse'
            ? `<itemLC116>${xmlText(i.lc116)}</itemLC116><cTribNac>${xmlText(i.nationalCode)}</cTribNac><NBS>${xmlText(i.nbs)}</NBS><aliquotaISS>${i.issRate ?? 0}</aliquotaISS>`
            : `<NCM>${xmlText(i.ncm)}</NCM><CFOP>${xmlText(i.cfop)}</CFOP><CEST>${xmlText(i.cest)}</CEST><origem>${i.origin ?? 0}</origem><CST_CSOSN>${xmlText(i.icmsSituation)}</CST_CSOSN>`) +
          `<IBSCBS><CST>${xmlText(i.ibsCbsCst ?? ctx.settings.ibsCbsCst)}</CST><cClassTrib>${xmlText(i.classTrib ?? ctx.settings.classTrib)}</cClassTrib></IBSCBS></item>`,
      )
      .join('\n');
    const t = doc.taxes;
    return `<?xml version="1.0" encoding="UTF-8"?>
<!-- DOCUMENTO SIMULADO: SEM VALOR FISCAL. Gerado pelo modo simulado do sistema para demonstração. -->
<documentoFiscalSimulado tipo="${docTypeShort[doc.type]}" ambiente="${ctx.environment === 'production' ? 1 : 2}">
  <chave>${key}</chave>
  <numero>${doc.number ?? ''}</numero>
  <serie>${xmlText(doc.series)}</serie>
  <emissao>${doc.issuedAt.toISOString()}</emissao>
  <naturezaOperacao>${xmlText(doc.nature)}</naturezaOperacao>
  <emitente><cnpj>${xmlText(onlyDigits(c.document ?? ''))}</cnpj><razaoSocial>${xmlText(c.legalName ?? c.name)}</razaoSocial><IE>${xmlText(c.stateRegistration)}</IE><IM>${xmlText(c.municipalRegistration)}</IM></emitente>
  <destinatario><documento>${xmlText(doc.recipient?.document)}</documento><nome>${xmlText(doc.recipient?.name ?? 'Consumidor não identificado')}</nome></destinatario>
  <itens>
${items}
  </itens>
  <totais><desconto>${doc.discount.toFixed(2)}</desconto><total>${doc.total.toFixed(2)}</total><ISS retido="${t.issWithheld}">${t.iss.toFixed(2)}</ISS><ICMS>${t.icms.toFixed(2)}</ICMS><PIS>${t.pis.toFixed(2)}</PIS><COFINS>${t.cofins.toFixed(2)}</COFINS><IBS>${t.ibs.toFixed(2)}</IBS><CBS>${t.cbs.toFixed(2)}</CBS></totais>
  <protocolo>${protocol}</protocolo>${verification ? `\n  <codigoVerificacao>${verification}</codigoVerificacao>` : ''}
</documentoFiscalSimulado>
`;
  }

  private pdf(ctx: ProviderContext, doc: ProviderDocument, key: string, protocol: string, verification: string | null): Buffer {
    const c = ctx.company;
    const title: Record<DocType, string> = { nfse: 'DANFSe — Documento Auxiliar da NFS-e', nfce: 'DANFE NFC-e — Documento Auxiliar da Nota Fiscal de Consumidor Eletrônica', nfe: 'DANFE — Documento Auxiliar da Nota Fiscal Eletrônica' };
    const lines: PdfLine[] = [
      { text: 'DOCUMENTO SIMULADO — SEM VALOR FISCAL', size: 9, bold: true },
      { text: title[doc.type], size: 13, bold: true, gap: 6 },
      { text: `${c.legalName ?? c.name} — CNPJ ${c.document ?? ''}`, bold: true, gap: 6 },
      { text: [c.address?.street, c.address?.number, c.address?.district, c.address?.city, c.address?.state].filter(Boolean).join(', ') },
      { text: `IE ${c.stateRegistration ?? '—'}   IM ${c.municipalRegistration ?? '—'}` },
      { text: `Número ${doc.number ?? '—'}   Série ${doc.series ?? '—'}   Emissão ${dateTime.format(doc.issuedAt)}   Ambiente: ${ctx.environment === 'production' ? 'produção' : 'homologação'}`, gap: 6 },
      { text: `${doc.type === 'nfse' ? 'Chave' : 'Chave de acesso'}: ${key.replace(/(\d{4})(?=\d)/g, '$1 ')}` },
      { text: `Protocolo: ${protocol}${verification ? `   Código de verificação: ${verification}` : ''}` },
      { text: `Natureza da operação: ${doc.nature}` },
      { text: doc.type === 'nfse' ? 'TOMADOR DO SERVIÇO' : 'DESTINATÁRIO', bold: true, gap: 8 },
      { text: doc.recipient ? `${doc.recipient.name}${doc.recipient.document ? ` — ${doc.recipient.document}` : ''}` : 'Consumidor não identificado' },
      { text: doc.type === 'nfse' ? 'DISCRIMINAÇÃO DOS SERVIÇOS' : 'ITENS', bold: true, gap: 8 },
      ...doc.items.map((i, n) => ({
        text: `${n + 1}. ${i.description} — ${i.quantity} ${i.unit} × ${brl.format(i.unitPrice)}${i.discount ? ` − ${brl.format(i.discount)}` : ''} = ${brl.format(i.total)}   ${
          doc.type === 'nfse' ? `LC 116 ${i.lc116 ?? ''} · cTribNac ${i.nationalCode ?? ''} · ISS ${i.issRate ?? 0}%` : `NCM ${i.ncm ?? ''} · CFOP ${i.cfop ?? ''} · CST/CSOSN ${i.icmsSituation ?? ''}`
        }`,
        size: 9,
      })),
      { text: 'TOTAIS', bold: true, gap: 8 },
      { text: `Desconto ${brl.format(doc.discount)}   Valor total ${brl.format(doc.total)}` },
      {
        text:
          doc.type === 'nfse'
            ? `ISS ${brl.format(doc.taxes.iss)}${doc.taxes.issWithheld ? ' (retido pelo tomador)' : ''}   IBS ${brl.format(doc.taxes.ibs)}   CBS ${brl.format(doc.taxes.cbs)}`
            : `ICMS ${brl.format(doc.taxes.icms)}   PIS ${brl.format(doc.taxes.pis)}   COFINS ${brl.format(doc.taxes.cofins)}   IBS ${brl.format(doc.taxes.ibs)}   CBS ${brl.format(doc.taxes.cbs)}`,
      },
      ...(doc.taxes.approximate ? [{ text: `Valor aproximado dos tributos (Lei 12.741/2012): ${brl.format(doc.taxes.approximate)}` }] : []),
      ...(doc.payments.length ? [{ text: `Pagamento: ${doc.payments.map((p) => `${paymentMethodLabel[p.method]} ${brl.format(p.amount)}`).join(', ')}` }] : []),
      ...(doc.additionalInfo ? [{ text: 'INFORMAÇÕES COMPLEMENTARES', bold: true, gap: 8 }, { text: doc.additionalInfo, size: 9 }] : []),
      { text: 'Este PDF foi gerado pelo modo simulado para demonstração. Não é documento fiscal.', size: 8, gap: 12 },
    ];
    return textPdf(lines, { watermark: 'SEM VALOR FISCAL' });
  }
}
