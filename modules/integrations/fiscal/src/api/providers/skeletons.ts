import { Injectable } from '@nestjs/common';
import { FiscalHttp } from './http';
import { ProviderNotReadyError, type CancelResult, type CorrectionResult, type FiscalProvider, type ProviderResult, type VoidResult } from './types';

/**
 * PlugNotas (TecnoSpeed) — esqueleto. Para implementar, preencher os métodos abaixo com o mapeamento
 * do leiaute deles (o restante do módulo não muda). Tudo aqui está "a confirmar" na documentação
 * oficial (docs.plugnotas.com.br) e com o comercial da TecnoSpeed:
 *
 * - Base: https://api.plugnotas.com.br (produção) e https://api.sandbox.plugnotas.com.br (sandbox).
 * - Autenticação: cabeçalho `x-api-key` com a chave da conta (software house), não por empresa.
 * - Empresa e certificado: `POST /certificado` (multipart: arquivo .pfx + senha) devolve o id do
 *   certificado; `POST /empresa` (CNPJ, IE/IM, regime, endereço, id do certificado, configurações de
 *   NFS-e/NFC-e/NF-e, CSC). Guardar o id em `providerCompanyId` não é necessário: a empresa é o CNPJ.
 * - NFS-e: `POST /nfse` (lista de notas; resposta com `documents[].id` e `protocol`), consulta
 *   `GET /nfse/{id}`, arquivos `GET /nfse/pdf/{id}` e `GET /nfse/xml/{id}`, cancelamento
 *   `POST /nfse/cancelar/{id}`. Assíncrono: webhook configurado no cadastro da empresa.
 * - NFC-e/NF-e: `POST /nfce` e `POST /nfe` (idem), consulta `GET /{nfce|nfe}/{id}/resumo`, arquivos
 *   `/{id}/xml` e `/{id}/pdf`, cancelamento `POST /{nfce|nfe}/{id}/cancelamento`, carta de correção
 *   `POST /nfe/{id}/cce`, inutilização `POST /{nfce|nfe}/inutilizacao`.
 * - Referência: o PlugNotas devolve um id próprio; a nossa referência vai em `idIntegracao`, que serve
 *   para consultar sem ter o id (`GET /nfse/consultar/{idIntegracao}/{cnpj}`).
 */
@Injectable()
export class PlugNotasProvider implements FiscalProvider {
  readonly key = 'plugnotas' as const;

  constructor(readonly http: FiscalHttp) {}

  async emit(): Promise<ProviderResult> {
    throw new ProviderNotReadyError('PlugNotas', 'emissão');
  }
  async status(): Promise<ProviderResult> {
    throw new ProviderNotReadyError('PlugNotas', 'consulta');
  }
  async cancel(): Promise<CancelResult> {
    throw new ProviderNotReadyError('PlugNotas', 'cancelamento');
  }
  async correct(): Promise<CorrectionResult> {
    throw new ProviderNotReadyError('PlugNotas', 'carta de correção');
  }
  async voidRange(): Promise<VoidResult> {
    throw new ProviderNotReadyError('PlugNotas', 'inutilização');
  }
  async download(): Promise<Buffer> {
    throw new ProviderNotReadyError('PlugNotas', 'download');
  }
}

/**
 * NFE.io — esqueleto. Tudo "a confirmar" na documentação oficial (nfe.io/docs):
 *
 * - NFS-e: base https://api.nfe.io/v1, cabeçalho `Authorization: <chave da API>`; empresa cadastrada
 *   na NFE.io (o id dela vai em `providerCompanyId`), certificado enviado em
 *   `POST /v1/companies/{company_id}/certificate` (multipart). Emissão
 *   `POST /v1/companies/{company_id}/serviceinvoices` (assíncrona, devolve o id), consulta
 *   `GET .../serviceinvoices/{id}`, cancelamento `DELETE .../serviceinvoices/{id}`, arquivos
 *   `GET .../serviceinvoices/{id}/pdf` e `/xml`. A nossa referência vai em `externalId`.
 * - NF-e/NFC-e: API de produto (https://api.nfse.io/v2/companies/{company_id}/productinvoices e
 *   `/consumerinvoices`), com carta de correção e inutilização próprias.
 * - Webhooks: cadastrados na conta (`/v1/hooks`), assinados com HMAC (cabeçalho a confirmar).
 * - Ambiente de testes: a NFE.io usa a mesma base com empresa em modo "Development" (a confirmar).
 */
@Injectable()
export class NfeIoProvider implements FiscalProvider {
  readonly key = 'nfeio' as const;

  constructor(readonly http: FiscalHttp) {}

  async emit(): Promise<ProviderResult> {
    throw new ProviderNotReadyError('NFE.io', 'emissão');
  }
  async status(): Promise<ProviderResult> {
    throw new ProviderNotReadyError('NFE.io', 'consulta');
  }
  async cancel(): Promise<CancelResult> {
    throw new ProviderNotReadyError('NFE.io', 'cancelamento');
  }
  async correct(): Promise<CorrectionResult> {
    throw new ProviderNotReadyError('NFE.io', 'carta de correção');
  }
  async voidRange(): Promise<VoidResult> {
    throw new ProviderNotReadyError('NFE.io', 'inutilização');
  }
  async download(): Promise<Buffer> {
    throw new ProviderNotReadyError('NFE.io', 'download');
  }
}
