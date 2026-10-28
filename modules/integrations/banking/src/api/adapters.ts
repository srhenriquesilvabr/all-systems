import { Injectable } from '@nestjs/common';
import { catalogByKey, type ConsortiumPlanOffer, type Offer, type SimulationInput } from '../contracts';
import { BankApiError, type BankProvider, type ResolvedConnection, type StatusResult, type SubmitPayload } from './providers';

/**
 * Adaptadores próprios das administradoras (modo `api` com adaptador `vendor`).
 *
 * Nenhuma administradora publica a API de parceiro: a documentação, os endpoints, o formato dos
 * campos e a autenticação só chegam com o contrato. Até lá cada adaptador é um ESQUELETO que
 * responde "adaptador pendente" com a lista do que falta confirmar — nada é inventado. Quando a
 * documentação chegar, a implementação entra aqui (uma classe por administradora, com a interface
 * `BankProvider`), e o resto do sistema (propostas, eventos, consórcio) não muda.
 *
 * Se a administradora aceitar o contrato REST genérico (docs/arquitetura/10), não precisa de
 * adaptador: use o adaptador `generic_rest`.
 */

/** O que precisa ser confirmado com qualquer administradora antes de escrever o adaptador. */
export const VENDOR_PENDING_ITEMS = [
  'Ambiente de homologação e de produção (URLs) e se há API de parceiro ou só portal/arquivo',
  'Autenticação (OAuth2, certificado mTLS, usuário/senha, IP de origem liberado)',
  'Listagem de planos/grupos: endpoint e campos (crédito, prazo, taxa de administração, fundo de reserva, seguro)',
  'Envio da adesão/proposta: campos obrigatórios do proponente e do plano, documentos anexos e assinatura',
  'Retorno: consulta de status e/ou webhook (assinatura), com grupo e cota na aprovação',
  'Assembleias, contemplações, lances e parcelas: se vêm por API, por arquivo ou só pelo portal',
  'Comissão e estorno: relatório/arquivo e periodicidade',
];

/** Notas por administradora (o que já se sabe e o que perguntar). Tudo "a confirmar com a administradora". */
export const VENDOR_NOTES: Record<string, string[]> = {
  itau: ['A confirmar com o Itaú: existência de API de parceiro para consórcio ou só portal de parceiros.'],
  bradesco: ['A confirmar com a Bradesco Consórcios: canal para corretoras parceiras (portal/API) e layout de retorno.'],
  caixa: ['A confirmar com a Caixa Consórcio: canal para parceiros externos e credenciamento exigido.'],
  santander: ['A confirmar com o Santander: canal de parceiros para consórcio.'],
  bb: ['A confirmar com a BB Consórcios: canal de parceiros e certificações exigidas dos vendedores.'],
  embracon: ['A confirmar com a Embracon: API de parceiro ou portal do representante, e arquivos de retorno.'],
  porto: ['A confirmar com a Porto: canal do corretor para consórcio (portal/API) e retorno de status.'],
  rodobens: ['A confirmar com a Rodobens: portal do representante e arquivos de retorno.'],
  ademicon: ['A confirmar com a Ademicon: canal para representantes (portal/API).'],
};

/**
 * Esqueleto do adaptador de uma administradora do catálogo. Todas as operações falham com uma
 * mensagem legível ("a confirmar com a administradora"), que a tela mostra no lugar da oferta.
 */
export class PendingVendorAdapter implements BankProvider {
  constructor(readonly catalogKey: string) {}

  private pending(c: ResolvedConnection, operation: string): never {
    const name = catalogByKey(this.catalogKey)?.name ?? c.name;
    throw new BankApiError(c, operation, 501, `adaptador da ${name} ainda não implementado (a confirmar com a administradora: documentação e credenciais do contrato). Use o modo manual enquanto isso`);
  }

  simulate(c: ResolvedConnection, _input: SimulationInput): Promise<Offer> {
    return Promise.resolve().then(() => this.pending(c, 'simulação'));
  }

  submit(c: ResolvedConnection, _p: SubmitPayload): Promise<{ externalId: string } & StatusResult> {
    return Promise.resolve().then(() => this.pending(c, 'envio da proposta'));
  }

  status(c: ResolvedConnection, _externalId: string, _p: SubmitPayload): Promise<StatusResult> {
    return Promise.resolve().then(() => this.pending(c, 'consulta de status'));
  }

  consortiumPlans(c: ResolvedConnection): Promise<ConsortiumPlanOffer[]> {
    return Promise.resolve().then(() => this.pending(c, 'listagem de planos'));
  }
}

/**
 * Registro dos adaptadores por administradora. Hoje todos são esqueletos; um adaptador real entra
 * aqui (ex.: `implemented.set('embracon', new EmbraconAdapter(http))`) sem mudar o serviço.
 */
@Injectable()
export class VendorAdapters {
  private readonly implemented = new Map<string, BankProvider>();

  for(catalogKey: string | null): BankProvider {
    return (catalogKey && this.implemented.get(catalogKey)) || new PendingVendorAdapter(catalogKey ?? '');
  }

  /** Para a tela: o adaptador desta administradora já está implementado? */
  isImplemented(catalogKey: string | null) {
    return !!catalogKey && this.implemented.has(catalogKey);
  }
}
