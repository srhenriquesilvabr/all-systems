import type { CompanyFiscal, DocType, DocumentItem, DocumentPayment, FiscalEnvironment, FiscalSettings, ProviderKey, Recipient, Taxes } from '../../contracts';

/** Tudo que o provedor precisa saber da empresa e da configuração, já decifrado. */
export interface ProviderContext {
  environment: FiscalEnvironment;
  settings: FiscalSettings;
  /** Token da API do provedor no ambiente atual (vazio no simulado). */
  token: string;
  company: CompanyFiscal & { stateRegistration: string | null; municipalRegistration: string | null };
  /** Certificado A1, quando o provedor recebe pela API (cadastro da empresa no provedor). */
  certificate?: { pfx: Buffer; password: string } | null;
}

/** A nota no formato neutro, do jeito que cada adaptador traduz para a sua API. */
export interface ProviderDocument {
  type: DocType;
  reference: string;
  series: string | null;
  number: number | null;
  issuedAt: Date;
  serviceDate: string;
  nature: string;
  recipient: Recipient | null;
  items: DocumentItem[];
  payments: DocumentPayment[];
  total: number;
  discount: number;
  taxes: Taxes;
  additionalInfo: string | null;
}

/** Arquivo devolvido pelo provedor: conteúdo direto ou endereço para baixar. */
export type ProviderFile = { content: Buffer; mime: string } | { url: string; mime: string };

export type ProviderStatus = 'processing' | 'authorized' | 'rejected' | 'denied' | 'cancelled';

export interface ProviderResult {
  status: ProviderStatus;
  number?: number | null;
  series?: string | null;
  accessKey?: string | null;
  verificationCode?: string | null;
  protocol?: string | null;
  code?: string | null;
  message?: string | null;
  errors?: { code?: string; message: string; field?: string }[];
  /** Emitida em contingência (ex.: NFC-e offline). */
  contingency?: boolean;
  xml?: ProviderFile | null;
  pdf?: ProviderFile | null;
  cancelXml?: ProviderFile | null;
  consultUrl?: string | null;
  qrCodeUrl?: string | null;
  /** Resposta crua, guardada no histórico. */
  raw?: unknown;
}

export interface CancelResult {
  ok: boolean;
  message?: string | null;
  code?: string | null;
  protocol?: string | null;
  cancelXml?: ProviderFile | null;
  raw?: unknown;
}

export interface CorrectionResult {
  ok: boolean;
  sequence?: number;
  message?: string | null;
  protocol?: string | null;
  xml?: ProviderFile | null;
  pdf?: ProviderFile | null;
  raw?: unknown;
}

export interface VoidResult {
  ok: boolean;
  message?: string | null;
  protocol?: string | null;
  xml?: ProviderFile | null;
  raw?: unknown;
}

/**
 * Provedor de emissão. Cada um traduz a nota neutra para a sua API. Erros de comunicação
 * (rede, 5xx, autenticação) saem como `FiscalProviderError`; recusa da nota (rejeição) é resultado.
 */
export interface FiscalProvider {
  readonly key: ProviderKey;
  /** Envia a nota. Pode voltar já autorizada (síncrono) ou "processing" (consultar depois). */
  emit(ctx: ProviderContext, doc: ProviderDocument): Promise<ProviderResult>;
  /** Situação atual da nota no provedor (pela referência). */
  status(ctx: ProviderContext, doc: Pick<ProviderDocument, 'type' | 'reference'> & Partial<ProviderDocument>): Promise<ProviderResult>;
  cancel(ctx: ProviderContext, doc: Pick<ProviderDocument, 'type' | 'reference'>, reason: string): Promise<CancelResult>;
  /** Carta de correção (só NF-e). */
  correct(ctx: ProviderContext, doc: Pick<ProviderDocument, 'type' | 'reference'>, text: string): Promise<CorrectionResult>;
  /** Inutilização de faixa de numeração (NFC-e/NF-e). */
  voidRange(ctx: ProviderContext, input: { type: 'nfce' | 'nfe'; series: string; from: number; to: number; reason: string }): Promise<VoidResult>;
  /** Baixa um arquivo pelo endereço devolvido (XML, DANFE). */
  download(ctx: ProviderContext, url: string): Promise<Buffer>;
  /** Cadastra/atualiza a empresa (certificado, CSC, séries) no provedor, quando a API permite. */
  syncCompany?(ctx: ProviderContext): Promise<{ message: string }>;
  /** Registra no provedor o webhook que avisa mudanças de status. */
  registerWebhook?(ctx: ProviderContext, url: string, secret: string): Promise<{ message: string }>;
}

export class FiscalProviderError extends Error {
  constructor(
    readonly provider: string,
    readonly operation: string,
    readonly httpStatus: number | null,
    detail?: string,
  ) {
    super(`${provider}: falha em ${operation}${httpStatus ? ` (HTTP ${httpStatus})` : ''}${detail ? `: ${detail}` : ''}`);
  }
}

/** O provedor ainda não tem adaptador completo. */
export class ProviderNotReadyError extends FiscalProviderError {
  constructor(provider: string, operation: string) {
    super(provider, operation, null, 'adaptador ainda não implementado — use o modo simulado ou a Focus NFe');
  }
}
