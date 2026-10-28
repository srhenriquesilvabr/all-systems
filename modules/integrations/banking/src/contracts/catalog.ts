import type { CreditProduct } from './index';

/**
 * Catálogo de administradoras de consórcio (e bancos que também financiam) que as corretoras
 * costumam representar. É material de REFERÊNCIA para a tela de conexões: linhas de produto mais
 * comuns, o canal de integração que se costuma encontrar e o que é preciso para ligar. Nada aqui foi
 * confirmado com as administradoras: oferta, canal e exigências mudam e dependem do contrato de cada
 * corretora. Por isso toda entrada sai com `confirmed: false` e a tela mostra o aviso.
 */

export const administratorKinds = ['bank', 'independent', 'automaker', 'cooperative'] as const;
export type AdministratorKind = (typeof administratorKinds)[number];
export const administratorKindLabel: Record<AdministratorKind, string> = {
  bank: 'Banco',
  independent: 'Administradora independente',
  automaker: 'Montadora',
  cooperative: 'Cooperativa de crédito',
};

/** Linhas de consórcio (mesmos tipos de bem dos planos do vertical). */
export const consortiumLines = ['real_estate', 'vehicle', 'heavy', 'services'] as const;
export type ConsortiumLine = (typeof consortiumLines)[number];
export const consortiumLineLabel: Record<ConsortiumLine, string> = { real_estate: 'Imóvel', vehicle: 'Auto/moto', heavy: 'Pesados', services: 'Serviços' };

/**
 * Canal de integração:
 * - partner_api: API de parceiro, liberada só com contrato (documentação não pública);
 * - broker_portal: portal do corretor/representante, sem API — o modo `manual` atende;
 * - file: arquivo ou planilha de retorno (vendas, contemplações, comissões) enviado pela administradora.
 */
export const integrationChannels = ['partner_api', 'broker_portal', 'file'] as const;
export type IntegrationChannel = (typeof integrationChannels)[number];
export const integrationChannelLabel: Record<IntegrationChannel, string> = {
  partner_api: 'API de parceiro (sob contrato)',
  broker_portal: 'Portal do corretor (sem API)',
  file: 'Arquivo/planilha de retorno',
};

export interface CatalogAdministrator {
  key: string;
  name: string;
  kind: AdministratorKind;
  /** Linhas de consórcio mais comuns (referência; a oferta atual vem dos planos). */
  lines: ConsortiumLine[];
  /** Produtos da integração bancária que fazem sentido para esta instituição. */
  creditProducts: CreditProduct[];
  /** Canais que se costuma encontrar, do mais para o menos provável. */
  channels: IntegrationChannel[];
  /** O que é preciso para ligar (contrato, credenciamento, credenciais). */
  requirements: string[];
  /** Observações para a equipe. */
  notes?: string;
  /** false = informação de referência, a confirmar com a administradora. */
  confirmed: boolean;
}

const BANK_REQUIREMENTS = [
  'Contrato de parceria com a administradora de consórcio do banco (ou de correspondente, se também for vender financiamento)',
  'Credenciamento da corretora (CNPJ) e cadastro/certificação dos vendedores exigidos pelo banco — a confirmar',
  'Credenciais de acesso por empresa: usuário do portal ou client ID/secret da API de parceiro, se houver',
  'Tabela de comissão, regras de estorno e calendário de assembleias dos grupos',
];
const INDEPENDENT_REQUIREMENTS = [
  'Contrato de representação comercial com a administradora',
  'Cadastro da corretora (CNPJ) e dos vendedores no portal do parceiro',
  'Credenciais do portal ou da API de parceiro (se a administradora oferecer) e o layout dos arquivos de retorno',
  'Tabela de comissão, regras de estorno e calendário de assembleias dos grupos',
];
const COOPERATIVE_REQUIREMENTS = [
  'Parceria com a cooperativa (em geral a venda é feita pelas agências e pelos associados) — a confirmar',
  'Cadastro da corretora e dos vendedores, se a cooperativa trabalhar com parceiros externos',
  'Credenciais e arquivos de retorno combinados no contrato',
];
const AUTOMAKER_REQUIREMENTS = [
  'Credenciamento junto à administradora da montadora (em geral pela rede de concessionárias) — a confirmar',
  'Cadastro da corretora/concessionária e dos vendedores',
  'Credenciais do portal e regras de comissão',
];

const bank = (key: string, name: string, lines: ConsortiumLine[], notes?: string): CatalogAdministrator => ({
  key,
  name,
  kind: 'bank',
  lines,
  creditProducts: ['consortium', 'vehicle_financing', 'real_estate_financing'],
  channels: ['broker_portal', 'partner_api', 'file'],
  requirements: BANK_REQUIREMENTS,
  notes,
  confirmed: false,
});
const independent = (key: string, name: string, lines: ConsortiumLine[], notes?: string): CatalogAdministrator => ({
  key,
  name,
  kind: 'independent',
  lines,
  creditProducts: ['consortium'],
  channels: ['broker_portal', 'file', 'partner_api'],
  requirements: INDEPENDENT_REQUIREMENTS,
  notes,
  confirmed: false,
});

/** Lista inicial; a ordem é a da tela (bancos, independentes, cooperativas, montadoras). */
export const administratorCatalog: CatalogAdministrator[] = [
  bank('itau', 'Itaú Consórcio', ['real_estate', 'vehicle', 'heavy']),
  bank('bradesco', 'Bradesco Consórcios', ['real_estate', 'vehicle', 'heavy', 'services']),
  bank('caixa', 'Caixa Consórcio', ['real_estate', 'vehicle', 'services']),
  bank('santander', 'Santander Consórcio', ['real_estate', 'vehicle']),
  bank('bb', 'BB Consórcios (Banco do Brasil)', ['real_estate', 'vehicle', 'heavy', 'services']),
  independent('embracon', 'Embracon', ['real_estate', 'vehicle', 'services']),
  independent('porto', 'Porto Consórcio', ['real_estate', 'vehicle', 'heavy']),
  independent('rodobens', 'Rodobens Consórcio', ['real_estate', 'vehicle', 'heavy']),
  independent('ademicon', 'Ademicon', ['real_estate', 'vehicle', 'heavy', 'services']),
  independent('canopus', 'Canopus Consórcios', ['real_estate', 'vehicle']),
  independent('mapfre', 'Mapfre Consórcios', ['real_estate', 'vehicle']),
  independent('magalu', 'Consórcio Magalu', ['real_estate', 'vehicle', 'services']),
  independent('servopa', 'Servopa Consórcios', ['real_estate', 'vehicle']),
  independent('hs', 'HS Consórcios', ['real_estate', 'vehicle', 'heavy']),
  {
    key: 'sicoob',
    name: 'Sicoob Consórcios',
    kind: 'cooperative',
    lines: ['real_estate', 'vehicle', 'services'],
    creditProducts: ['consortium'],
    channels: ['broker_portal', 'file'],
    requirements: COOPERATIVE_REQUIREMENTS,
    confirmed: false,
  },
  {
    key: 'sicredi',
    name: 'Sicredi Consórcios',
    kind: 'cooperative',
    lines: ['real_estate', 'vehicle', 'services'],
    creditProducts: ['consortium'],
    channels: ['broker_portal', 'file'],
    requirements: COOPERATIVE_REQUIREMENTS,
    confirmed: false,
  },
  {
    key: 'honda',
    name: 'Consórcio Nacional Honda',
    kind: 'automaker',
    lines: ['vehicle'],
    creditProducts: ['consortium'],
    channels: ['broker_portal'],
    requirements: AUTOMAKER_REQUIREMENTS,
    confirmed: false,
  },
  {
    key: 'volkswagen',
    name: 'Consórcio Nacional Volkswagen',
    kind: 'automaker',
    lines: ['vehicle', 'heavy'],
    creditProducts: ['consortium'],
    channels: ['broker_portal'],
    requirements: AUTOMAKER_REQUIREMENTS,
    confirmed: false,
  },
];

export const catalogByKey = (key: string | null | undefined) => (key ? administratorCatalog.find((a) => a.key === key) : undefined);

/** O que o modo `manual` faz, para a tela. */
export const MANUAL_MODE_TEXT =
  'Sem API: a proposta fica registrada aqui, a equipe envia pelo portal da administradora e registra a resposta (aprovação, grupo e cota, recusa). O acompanhamento (parcelas, assembleias, lances, comissão) segue igual.';
