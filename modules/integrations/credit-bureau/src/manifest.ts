import { defineModule } from '@all/module-sdk';
import { z } from 'zod';
import { bureauProviders, CREDIT_BUREAU } from './contracts';

export const creditBureauSettings = z.object({
  /**
   * simulated: resultado de demonstração, sem consultar ninguém (treinamento e testes).
   * serasa_experian / boa_vista / quod: adaptador do birô, com o contrato e as credenciais da empresa.
   */
  provider: z.enum(bureauProviders).default('simulated'),
  /** Endereço da API do birô (informado no contrato). */
  baseUrl: z.string().trim().url('URL inválida').max(300).or(z.literal('')).default(''),
  /** Usuário/client ID e senha/segredo do contrato; o segredo fica cifrado. O formato exato é a confirmar com cada birô. */
  clientId: z.string().trim().max(200).default(''),
  clientSecret: z.string().trim().max(1000).default(''),
  /** Custo de cada consulta (R$), para o histórico e o resumo do mês. */
  costPerQueryPf: z.coerce.number().min(0).max(1000).default(0),
  costPerQueryPj: z.coerce.number().min(0).max(1000).default(0),
  /** Teto de consultas por mês (0 = sem limite): evita surpresa na fatura do birô. */
  monthlyLimit: z.coerce.number().int().min(0).max(100_000).default(0),
  /** Score mínimo sugerido (0 a 1000). Só orienta: quem decide seguir ou reprovar é uma pessoa. */
  suggestedMinScore: z.coerce.number().int().min(0).max(1000).default(500),
});
export type CreditBureauSettings = z.infer<typeof creditBureauSettings>;

/**
 * Consulta de CPF/CNPJ em birô de crédito (Serasa Experian, Boa Vista/Equifax, Quod) com o
 * consentimento do cliente registrado (finalidade, data, forma e quem consultou), custo por
 * consulta, histórico e auditoria. Contratável; o modo simulado serve para demonstração.
 */
export const creditBureauManifest = defineModule({
  key: CREDIT_BUREAU,
  name: 'Consulta de crédito (birôs)',
  layer: 'integration',
  description: 'Score e resumo de pendências de CPF/CNPJ com autorização do cliente, para decidir a venda.',
  icon: 'user-search',
  version: '1.0.0',
  dependsOn: ['core.customers'],
  permissions: [
    { key: 'integration.credit_bureau.query', label: 'Consultar CPF/CNPJ em birô de crédito (com autorização do cliente) e decidir seguir ou reprovar' },
    { key: 'integration.credit_bureau.read', label: 'Ver o histórico de consultas de crédito' },
  ],
  defaultRoles: [
    {
      key: 'integration.credit_bureau.analyst',
      label: 'Analista de crédito',
      permissions: ['integration.credit_bureau.query', 'integration.credit_bureau.read', 'core.customers.read'],
    },
  ],
  menu: [
    { label: 'Consultas de crédito', path: '/credito/consultas', icon: 'user-search', permission: 'integration.credit_bureau.read' },
    { label: 'Consulta de crédito', path: '/configuracoes/consulta-de-credito', icon: 'user-search', permission: 'core.access.settings', group: 'Configurações' },
  ],
  settings: creditBureauSettings,
  secretSettings: ['clientSecret'],
});
