import { Injectable } from '@nestjs/common';
import { isSimples, onlyDigits, type DocType, type DocumentItem, type FiscalPaymentMethod } from '../../contracts';
import { basicAuth, FiscalHttp, type HttpResult } from './http';
import {
  FiscalProviderError,
  type CancelResult,
  type CorrectionResult,
  type FiscalProvider,
  type ProviderContext,
  type ProviderDocument,
  type ProviderFile,
  type ProviderResult,
  type ProviderStatus,
  type VoidResult,
} from './types';

/**
 * Focus NFe (https://doc.focusnfe.com.br). REST com HTTP Basic (token da empresa como usuário,
 * senha vazia), uma base por ambiente e a nota identificada pela nossa referência (`ref`).
 *
 * Conferido na documentação pública (out/2026): bases, autenticação, rotas de emissão/consulta/
 * cancelamento de NFS-e, NFS-e Nacional (`/v2/nfsen`), NFC-e (síncrona) e NF-e (assíncrona), carta de
 * correção (`/v2/nfe/{ref}/carta_correcao`, 15–1000 caracteres), inutilização (`/v2/{nfe|nfce}/inutilizacao`,
 * justificativa ≥ 15), webhooks (`POST /v2/hooks` com `event`, `url`, `authorization`, `authorization_header`)
 * e os campos marcados como confirmados abaixo.
 *
 * A CONFIRMAR com a Focus antes de produção (marcados com "a confirmar" no código):
 * - NFS-e Nacional: nomes de `razao_social_tomador`, `email_tomador`, `inscricao_municipal_prestador`,
 *   `codigo_nbs`, `percentual_aliquota_iss`, `tipo_retencao_iss` e dos campos de IBS/CBS (a página da
 *   rota lista só parte do leiaute; o completo está em campos.focusnfe.com.br);
 * - NFC-e/NF-e: `cest`, `pis_situacao_tributaria`/`cofins_situacao_tributaria` por item, `formas_pagamento`
 *   na NF-e, `email_destinatario`, campos de IBS/CBS por item e os sinais de contingência offline;
 * - formato do corpo do webhook (usamos só a `ref` e consultamos a nota de novo);
 * - se os caminhos `caminho_*` são relativos ao host da API do ambiente (é o que assumimos);
 * - cadastro da empresa (`/v2/empresas`): exige o token da conta principal (FOCUS_ACCOUNT_TOKEN).
 */
@Injectable()
export class FocusProvider implements FiscalProvider {
  readonly key = 'focus' as const;

  constructor(private readonly http: FiscalHttp) {}

  // ---- emissão ------------------------------------------------------------------------------------

  async emit(ctx: ProviderContext, doc: ProviderDocument): Promise<ProviderResult> {
    const path = `${this.resource(ctx, doc.type)}?ref=${encodeURIComponent(doc.reference)}`;
    const body = doc.type === 'nfse' ? (ctx.settings.nfseStandard === 'national' ? nfsenPayload(ctx, doc) : nfsePayload(ctx, doc)) : productPayload(ctx, doc);
    const res = await this.call(ctx, 'POST', path, 'emissão', body);
    if (res.ok) return this.toResult(ctx, res.body);
    // Já recebida antes (reenvio do outbox depois de uma falha nossa): vale a situação atual.
    const code = String(res.body?.codigo ?? '');
    if (['already_processed', 'nfe_autorizada', 'pending_operation'].includes(code) || /j[aá] (existe|foi)/i.test(String(res.body?.mensagem ?? ''))) {
      return this.status(ctx, doc);
    }
    // Recusa de validação pela própria Focus: a nota volta para correção, com o motivo.
    return { status: 'rejected', code: code || String(res.status), message: res.body?.mensagem ?? `Recusada pelo provedor (HTTP ${res.status})`, errors: focusErrors(res.body), raw: res.body };
  }

  async status(ctx: ProviderContext, doc: Pick<ProviderDocument, 'type' | 'reference'>): Promise<ProviderResult> {
    const res = await this.call(ctx, 'GET', `${this.resource(ctx, doc.type)}/${encodeURIComponent(doc.reference)}`, 'consulta');
    if (!res.ok) {
      if (res.status === 404) return { status: 'processing', message: 'Ainda não encontrada no provedor', raw: res.body };
      throw new FiscalProviderError('Focus NFe', 'consulta', res.status, res.body?.mensagem);
    }
    return this.toResult(ctx, res.body);
  }

  async cancel(ctx: ProviderContext, doc: Pick<ProviderDocument, 'type' | 'reference'>, reason: string): Promise<CancelResult> {
    const res = await this.call(ctx, 'DELETE', `${this.resource(ctx, doc.type)}/${encodeURIComponent(doc.reference)}`, 'cancelamento', { justificativa: reason });
    const status = String(res.body?.status ?? '');
    if (res.ok && status === 'cancelado') {
      return { ok: true, message: res.body?.mensagem_sefaz ?? null, cancelXml: this.file(ctx, res.body?.caminho_xml_cancelamento, 'application/xml'), raw: res.body };
    }
    return { ok: false, code: res.body?.status_sefaz ?? res.body?.codigo ?? null, message: res.body?.mensagem_sefaz ?? res.body?.mensagem ?? focusErrors(res.body)[0]?.message ?? 'Cancelamento recusado', raw: res.body };
  }

  async correct(ctx: ProviderContext, doc: Pick<ProviderDocument, 'type' | 'reference'>, text: string): Promise<CorrectionResult> {
    const res = await this.call(ctx, 'POST', `/v2/nfe/${encodeURIComponent(doc.reference)}/carta_correcao`, 'carta de correção', { correcao: text });
    if (res.ok && res.body?.status === 'autorizado') {
      return {
        ok: true,
        sequence: Number(res.body.numero_carta_correcao) || undefined,
        message: res.body.mensagem_sefaz ?? null,
        xml: this.file(ctx, res.body.caminho_xml_carta_correcao, 'application/xml'),
        pdf: this.file(ctx, res.body.caminho_pdf_carta_correcao, 'application/pdf'),
        raw: res.body,
      };
    }
    return { ok: false, message: res.body?.mensagem_sefaz ?? res.body?.mensagem ?? 'Carta de correção recusada', raw: res.body };
  }

  async voidRange(ctx: ProviderContext, input: { type: 'nfce' | 'nfe'; series: string; from: number; to: number; reason: string }): Promise<VoidResult> {
    const res = await this.call(ctx, 'POST', `/v2/${input.type}/inutilizacao`, 'inutilização', {
      cnpj: onlyDigits(ctx.company.document ?? ''),
      serie: input.series,
      numero_inicial: input.from,
      numero_final: input.to,
      justificativa: input.reason,
    });
    if (res.ok && res.body?.status === 'autorizado') {
      return { ok: true, protocol: res.body.protocolo_sefaz ?? null, message: res.body.mensagem_sefaz ?? null, xml: this.file(ctx, res.body.caminho_xml, 'application/xml'), raw: res.body };
    }
    return { ok: false, message: res.body?.mensagem_sefaz ?? res.body?.mensagem ?? 'Inutilização recusada', raw: res.body };
  }

  async download(ctx: ProviderContext, url: string): Promise<Buffer> {
    const res = await this.http.bytes(url, { Authorization: basicAuth(ctx.token) });
    if (!res.ok) throw new FiscalProviderError('Focus NFe', 'download de arquivo', res.status);
    return res.content;
  }

  /**
   * Cadastra/atualiza a empresa na Focus (certificado, CSC, séries). A API de empresas só existe na
   * base de produção e usa o token da conta principal (variável FOCUS_ACCOUNT_TOKEN, nossa, não do cliente).
   * Campos conferidos na documentação; a obrigatoriedade do token principal está "a confirmar".
   */
  async syncCompany(ctx: ProviderContext): Promise<{ message: string; companyId?: string; tokens?: { production?: string; homologation?: string } }> {
    const account = process.env.FOCUS_ACCOUNT_TOKEN;
    if (!account) throw new FiscalProviderError('Focus NFe', 'cadastro da empresa', null, 'configure FOCUS_ACCOUNT_TOKEN (token da conta principal) ou cadastre a empresa no painel da Focus');
    const c = ctx.company;
    const s = ctx.settings;
    const body: Record<string, unknown> = {
      nome: c.legalName ?? c.name,
      nome_fantasia: c.name,
      cnpj: onlyDigits(c.document ?? ''),
      inscricao_estadual: c.stateRegistration ? onlyDigits(c.stateRegistration) || undefined : undefined,
      inscricao_municipal: c.municipalRegistration ? onlyDigits(c.municipalRegistration) || undefined : undefined,
      regime_tributario: focusRegime(s.taxRegime),
      email: c.email ?? undefined,
      telefone: c.phone ? onlyDigits(c.phone) : undefined,
      logradouro: c.address?.street,
      numero: c.address?.number,
      complemento: c.address?.complement,
      bairro: c.address?.district,
      municipio: c.address?.city,
      uf: c.address?.state,
      cep: c.address?.zip ? onlyDigits(c.address.zip) : undefined,
      habilita_nfe: true,
      habilita_nfce: !!(s.cscTokenProduction || s.cscTokenHomologation),
      habilita_nfse: s.nfseStandard === 'municipal',
      habilita_nfsen_producao: s.nfseStandard === 'national',
      habilita_nfsen_homologacao: s.nfseStandard === 'national',
      csc_nfce_producao: s.cscTokenProduction || undefined,
      id_token_nfce_producao: s.cscIdProduction ? Number(s.cscIdProduction) : undefined,
      csc_nfce_homologacao: s.cscTokenHomologation || undefined,
      id_token_nfce_homologacao: s.cscIdHomologation ? Number(s.cscIdHomologation) : undefined,
    };
    if (ctx.certificate) {
      body.arquivo_certificado_base64 = ctx.certificate.pfx.toString('base64');
      body.senha_certificado = ctx.certificate.password;
    }
    const base = 'https://api.focusnfe.com.br';
    const url = s.providerCompanyId ? `${base}/v2/empresas/${encodeURIComponent(s.providerCompanyId)}` : `${base}/v2/empresas`;
    const res = await this.http.request(s.providerCompanyId ? 'PUT' : 'POST', url, { headers: { Authorization: basicAuth(account) }, json: body });
    if (!res.ok) throw new FiscalProviderError('Focus NFe', 'cadastro da empresa', res.status, res.body?.mensagem ?? focusErrors(res.body)[0]?.message);
    return {
      message: res.body?.certificado_valido_ate ? `Empresa atualizada na Focus. Certificado válido até ${String(res.body.certificado_valido_ate).slice(0, 10)}.` : 'Empresa atualizada na Focus.',
      companyId: res.body?.id ? String(res.body.id) : undefined,
      tokens: { production: res.body?.token_producao, homologation: res.body?.token_homologacao },
    };
  }

  /** Webhooks da NFS-e e da NF-e (a NFC-e é síncrona). O segredo volta no cabeçalho X-Fiscal-Token. */
  async registerWebhook(ctx: ProviderContext, url: string, secret: string): Promise<{ message: string }> {
    const events = [ctx.settings.nfseStandard === 'national' ? 'nfsen' : 'nfse', 'nfe'];
    for (const event of events) {
      const res = await this.call(ctx, 'POST', '/v2/hooks', 'cadastro de webhook', {
        cnpj: onlyDigits(ctx.company.document ?? ''),
        event,
        url,
        authorization: secret,
        authorization_header: 'X-Fiscal-Token',
      });
      if (!res.ok) throw new FiscalProviderError('Focus NFe', `webhook ${event}`, res.status, res.body?.mensagem);
    }
    return { message: `Webhooks cadastrados na Focus (${events.join(', ')}).` };
  }

  // ---- internos -----------------------------------------------------------------------------------

  private resource(ctx: ProviderContext, type: DocType) {
    if (type === 'nfse') return ctx.settings.nfseStandard === 'national' ? '/v2/nfsen' : '/v2/nfse';
    return `/v2/${type}`;
  }

  private base(ctx: ProviderContext) {
    return ctx.environment === 'production' ? 'https://api.focusnfe.com.br' : 'https://homologacao.focusnfe.com.br';
  }

  private async call(ctx: ProviderContext, method: 'GET' | 'POST' | 'DELETE', path: string, operation: string, json?: unknown): Promise<HttpResult> {
    if (!ctx.token) throw new FiscalProviderError('Focus NFe', operation, null, 'token da API não configurado para este ambiente');
    const res = await this.http.request(method, `${this.base(ctx)}${path}`, { headers: { Authorization: basicAuth(ctx.token) }, json });
    // Falhas que a correção da nota não resolve: tenta de novo depois (outbox) ou avisa a configuração.
    if (res.status === 401 || res.status === 403) throw new FiscalProviderError('Focus NFe', operation, res.status, 'acesso negado: confira o token do ambiente');
    if (res.status === 429 || res.status >= 500) throw new FiscalProviderError('Focus NFe', operation, res.status, res.body?.mensagem);
    return res;
  }

  private file(ctx: ProviderContext, path: unknown, mime: string): ProviderFile | null {
    if (typeof path !== 'string' || !path) return null;
    return { url: /^https?:\/\//.test(path) ? path : `${this.base(ctx)}${path.startsWith('/') ? '' : '/'}${path}`, mime };
  }

  private toResult(ctx: ProviderContext, b: any): ProviderResult {
    const status = focusStatus(b?.status);
    const errors = focusErrors(b);
    // NFC-e/NF-e: DANFE em `caminho_danfe` (HTML na NFC-e, PDF na NF-e); NFS-e Nacional: `url_danfse`.
    const danfe = b?.url_danfse ?? b?.caminho_danfe ?? b?.caminho_pdf_nota_fiscal;
    const danfeMime = typeof danfe === 'string' && /\.html?($|\?)/i.test(danfe) ? 'text/html' : 'application/pdf';
    return {
      status,
      number: b?.numero ? Number(b.numero) : null,
      series: b?.serie ? String(b.serie) : null,
      accessKey: b?.chave_nfe ? String(b.chave_nfe).replace(/^NFe/, '') : (b?.chave_nfse ?? b?.codigo_verificacao_nfse ?? null),
      verificationCode: b?.codigo_verificacao ?? null,
      protocol: b?.numero_protocolo ?? b?.protocolo ?? null,
      code: b?.status_sefaz ? String(b.status_sefaz) : (errors[0]?.code ?? null),
      message: b?.mensagem_sefaz ?? (errors.length ? errors.map((e) => e.message).join(' | ') : (b?.mensagem ?? null)),
      errors,
      contingency: !!(b?.contingencia_offline_efetivada || b?.contingencia_offline),
      xml: this.file(ctx, b?.caminho_xml_nota_fiscal, 'application/xml'),
      pdf: this.file(ctx, danfe, danfeMime),
      cancelXml: this.file(ctx, b?.caminho_xml_cancelamento, 'application/xml'),
      consultUrl: b?.url_consulta_nf ?? b?.url ?? null,
      qrCodeUrl: b?.qrcode_url ?? null,
      raw: b,
    };
  }
}

export function focusStatus(s: unknown): ProviderStatus {
  switch (String(s ?? '')) {
    case 'autorizado':
    case 'autorizada':
      return 'authorized';
    case 'cancelado':
    case 'cancelada':
      return 'cancelled';
    case 'erro_autorizacao':
      return 'rejected';
    case 'denegado':
    case 'negado':
      return 'denied';
    default:
      return 'processing';
  }
}

function focusErrors(b: any): { code?: string; message: string; field?: string }[] {
  const list = Array.isArray(b?.erros) ? b.erros : [];
  return list.map((e: any) => ({ code: e?.codigo ? String(e.codigo) : undefined, message: [e?.mensagem, e?.correcao].filter(Boolean).join(' — ') || 'Erro', field: e?.campo ?? undefined }));
}

/** 1 Simples, 2 Simples com excesso de sublimite, 3 regime normal, 4 MEI (empresas). */
const focusRegime = (r: ProviderContext['settings']['taxRegime']) => ({ simples: 1, simples_excess: 2, presumido: 3, real: 3, mei: 4 })[r];

/** Formas de pagamento da NFC-e/NF-e (tPag). */
const PAYMENT_CODE: Record<FiscalPaymentMethod, string> = { cash: '01', credit_card: '03', debit_card: '04', on_account: '05', pix: '17', other: '99' };

const round2 = (n: number) => Math.round(n * 100) / 100;
const date = (d: Date) => d.toISOString();

function recipientDocument(doc: ProviderDocument): { cpf?: string; cnpj?: string } {
  const d = doc.recipient?.document;
  if (!d) return {};
  return d.length === 11 ? { cpf: d } : { cnpj: d };
}

/** NFS-e Nacional (DPS). Uma nota = um serviço: a validação junta os itens de mesmo código. */
function nfsenPayload(ctx: ProviderContext, doc: ProviderDocument) {
  const s = ctx.settings;
  const item = doc.items[0]!;
  const r = recipientDocument(doc);
  const issRate = item.issRate ?? s.defaultIssRate;
  const withheld = doc.taxes.issWithheld;
  return {
    data_emissao: date(doc.issuedAt),
    data_competencia: doc.serviceDate,
    ...(doc.series ? { serie_dps: Number(doc.series) } : {}),
    ...(doc.number ? { numero_dps: doc.number } : {}),
    emitente_dps: 1,
    codigo_municipio_emissora: Number(s.municipalityCode),
    cnpj_prestador: onlyDigits(ctx.company.document ?? ''),
    // 1 não optante, 2 MEI, 3 ME/EPP do Simples (opSimpNac).
    codigo_opcao_simples_nacional: s.taxRegime === 'mei' ? '2' : isSimples(s.taxRegime) ? '3' : '1',
    ...(s.specialRegime ? { regime_especial_tributacao: s.specialRegime } : {}),
    ...(r.cnpj ? { cnpj_tomador: r.cnpj } : {}),
    ...(r.cpf ? { cpf_tomador: r.cpf } : {}),
    // a confirmar: nome, e-mail e IM do tomador/prestador na NFS-e Nacional.
    ...(doc.recipient ? { razao_social_tomador: doc.recipient.name, email_tomador: doc.recipient.email ?? undefined } : {}),
    ...(ctx.company.municipalRegistration ? { inscricao_municipal_prestador: onlyDigits(ctx.company.municipalRegistration) } : {}),
    codigo_municipio_prestacao: s.municipalityCode,
    codigo_tributacao_nacional_iss: item.nationalCode ?? s.defaultNationalCode,
    ...(item.nbs ? { codigo_nbs: item.nbs } : {}), // a confirmar
    descricao_servico: serviceDescription(doc),
    valor_servico: round2(doc.total),
    // 1 operação tributável (tribISSQN).
    tributacao_iss: 1,
    // a confirmar: alíquota e retenção (1 não retido, 2 retido pelo tomador).
    percentual_aliquota_iss: issRate,
    tipo_retencao_iss: withheld ? 2 : 1,
    ...reformTotals(ctx, doc), // a confirmar
  };
}

/** NFS-e no padrão do município (rota /v2/nfse). Campos conferidos na documentação. */
function nfsePayload(ctx: ProviderContext, doc: ProviderDocument) {
  const s = ctx.settings;
  const item = doc.items[0]!;
  const r = recipientDocument(doc);
  const rate = (item.issRate ?? s.defaultIssRate) / 100;
  const a = doc.recipient?.address;
  return {
    data_emissao: date(doc.issuedAt),
    natureza_operacao: '1',
    optante_simples_nacional: isSimples(s.taxRegime),
    ...(s.specialRegime ? { regime_especial_tributacao: s.specialRegime } : {}),
    incentivador_cultural: false,
    prestador: { cnpj: onlyDigits(ctx.company.document ?? ''), inscricao_municipal: onlyDigits(ctx.company.municipalRegistration ?? ''), codigo_municipio: s.municipalityCode },
    tomador: {
      ...r,
      razao_social: doc.recipient?.name ?? 'Consumidor',
      ...(doc.recipient?.email ? { email: doc.recipient.email } : {}),
      ...(doc.recipient?.phone ? { telefone: onlyDigits(doc.recipient.phone).replace(/^55/, '') } : {}),
      ...(a?.street
        ? { endereco: { logradouro: a.street, numero: a.number ?? 'S/N', complemento: a.complement, bairro: a.district, codigo_municipio: a.ibge, uf: a.state, cep: a.zip ? onlyDigits(a.zip) : undefined } }
        : {}),
    },
    servico: {
      aliquota: rate,
      discriminacao: serviceDescription(doc),
      iss_retido: doc.taxes.issWithheld,
      item_lista_servico: (item.lc116 ?? s.defaultLc116).replace('.', ''),
      ...(item.municipalCode ? { codigo_tributario_municipio: item.municipalCode } : {}),
      ...(s.cnae ? { codigo_cnae: s.cnae } : {}),
      valor_servicos: round2(doc.total),
      valor_iss: doc.taxes.iss,
      base_calculo: round2(doc.total),
      valor_deducoes: 0,
      codigo_municipio: s.municipalityCode,
      ...(item.nbs ? { codigo_nbs: item.nbs } : {}),
    },
  };
}

/** NFC-e e NF-e: mesmo leiaute de itens; a NF-e tem destinatário completo. */
function productPayload(ctx: ProviderContext, doc: ProviderDocument) {
  const s = ctx.settings;
  const isNfe = doc.type === 'nfe';
  const r = recipientDocument(doc);
  const a = doc.recipient?.address;
  const items = doc.items.map((item, i) => productItem(ctx, item, i));
  const payments = doc.payments.length ? doc.payments : [{ method: 'other' as const, amount: doc.total }];
  return {
    natureza_operacao: doc.nature,
    data_emissao: date(doc.issuedAt),
    ...(doc.series ? { serie: doc.series } : {}),
    ...(doc.number ? { numero: doc.number } : {}),
    cnpj_emitente: onlyDigits(ctx.company.document ?? ''),
    ...(isNfe
      ? {
          tipo_documento: 1,
          finalidade_emissao: 1,
          consumidor_final: doc.recipient?.ieIndicator === 1 ? 0 : 1,
          inscricao_estadual_emitente: ctx.company.stateRegistration ? onlyDigits(ctx.company.stateRegistration) : undefined,
          regime_tributario_emitente: s.taxRegime === 'simples_excess' ? 2 : isSimples(s.taxRegime) ? 1 : 3,
        }
      : {}),
    presenca_comprador: 1,
    modalidade_frete: 9,
    local_destino: a?.state && ctx.company.address?.state && a.state !== ctx.company.address.state ? 2 : 1,
    ...(doc.recipient
      ? {
          nome_destinatario: doc.recipient.name,
          ...(r.cpf ? { cpf_destinatario: r.cpf } : {}),
          ...(r.cnpj ? { cnpj_destinatario: r.cnpj } : {}),
          indicador_inscricao_estadual_destinatario: doc.recipient.ieIndicator,
          ...(doc.recipient.stateRegistration ? { inscricao_estadual_destinatario: onlyDigits(doc.recipient.stateRegistration) } : {}),
        }
      : {}),
    ...(isNfe && a
      ? {
          logradouro_destinatario: a.street,
          numero_destinatario: a.number ?? 'S/N',
          bairro_destinatario: a.district,
          municipio_destinatario: a.city,
          uf_destinatario: a.state,
          cep_destinatario: a.zip ? onlyDigits(a.zip) : undefined,
          pais_destinatario: 'Brasil',
          ...(doc.recipient?.phone ? { telefone_destinatario: onlyDigits(doc.recipient.phone).replace(/^55/, '') } : {}),
          ...(doc.recipient?.email ? { email_destinatario: doc.recipient.email } : {}), // a confirmar
        }
      : {}),
    ...(isNfe ? { valor_produtos: round2(doc.total + doc.discount), valor_desconto: round2(doc.discount), valor_total: round2(doc.total) } : {}),
    items,
    // Na NF-e o nome do grupo de pagamento está "a confirmar"; na NFC-e é obrigatório e conferido.
    formas_pagamento: payments.map((p) => ({ forma_pagamento: PAYMENT_CODE[p.method], valor_pagamento: round2(p.amount) })),
    ...(doc.additionalInfo ? { informacoes_adicionais_contribuinte: doc.additionalInfo } : {}),
  };
}

function productItem(ctx: ProviderContext, item: DocumentItem, i: number) {
  const gross = round2(item.quantity * item.unitPrice);
  const s = ctx.settings;
  return {
    numero_item: i + 1,
    codigo_produto: item.code || String(i + 1),
    descricao: item.description,
    codigo_ncm: item.ncm,
    cfop: item.cfop,
    unidade_comercial: item.unit,
    quantidade_comercial: item.quantity,
    valor_unitario_comercial: item.unitPrice,
    unidade_tributavel: item.taxUnit ?? item.unit,
    quantidade_tributavel: item.quantity,
    valor_unitario_tributavel: item.unitPrice,
    valor_bruto: gross,
    ...(item.discount ? { valor_desconto: round2(item.discount) } : {}),
    icms_origem: item.origin ?? 0,
    icms_situacao_tributaria: item.icmsSituation,
    ...(item.icmsRate ? { icms_aliquota: item.icmsRate, icms_base_calculo: round2(gross - item.discount) } : {}),
    // a confirmar: CEST e CST de PIS/COFINS por item.
    ...(item.cest ? { cest: item.cest } : {}),
    ...(item.pisCofinsCst ? { pis_situacao_tributaria: item.pisCofinsCst, cofins_situacao_tributaria: item.pisCofinsCst } : {}),
    // a confirmar: grupo IBS/CBS por item (Reforma Tributária, NT 2025.002).
    ...(s.reformEnabled
      ? {
          ibs_cbs_situacao_tributaria: item.ibsCbsCst ?? s.ibsCbsCst,
          ibs_cbs_classificacao_tributaria: item.classTrib ?? s.classTrib,
          ibs_cbs_base_calculo: round2(gross - item.discount),
          ibs_uf_aliquota: s.ibsRate,
          cbs_aliquota: s.cbsRate,
        }
      : {}),
    ...(s.approximateTaxPercent ? { valor_total_tributos: round2(((gross - item.discount) * s.approximateTaxPercent) / 100) } : {}),
  };
}

function reformTotals(ctx: ProviderContext, doc: ProviderDocument) {
  const s = ctx.settings;
  if (!s.reformEnabled) return {};
  const item = doc.items[0]!;
  return {
    ibs_cbs_situacao_tributaria: item.ibsCbsCst ?? s.ibsCbsCst,
    ibs_cbs_classificacao_tributaria: item.classTrib ?? s.classTrib,
    ibs_cbs_base_calculo: round2(doc.total),
    ibs_aliquota: s.ibsRate,
    cbs_aliquota: s.cbsRate,
  };
}

function serviceDescription(doc: ProviderDocument) {
  const lines = doc.items.map((i) => (i.quantity === 1 ? i.description : `${i.quantity} × ${i.description}`));
  return [lines.join('; '), doc.additionalInfo].filter(Boolean).join('\n').slice(0, 2000);
}
