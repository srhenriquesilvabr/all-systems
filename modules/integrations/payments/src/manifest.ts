import { defineModule } from '@all/module-sdk';
import { z } from 'zod';
import { isValidPixKey } from './pix';

export const paymentsSettings = z.object({
  pixKey: z
    .string()
    .trim()
    .default('')
    .refine((k) => k === '' || isValidPixKey(k), 'Chave Pix inválida (CPF/CNPJ só números, telefone como +5511…, e-mail ou chave aleatória)'),
  merchantName: z.string().trim().max(25, 'Até 25 caracteres').default(''),
  merchantCity: z.string().trim().max(15, 'Até 15 caracteres').default(''),
});
export type PaymentsSettings = z.infer<typeof paymentsSettings>;

export const paymentsManifest = defineModule({
  key: 'integration.payments',
  name: 'Pix',
  layer: 'integration',
  version: '1.0.0',
  settings: paymentsSettings,
  menu: [{ label: 'Pix', path: '/configuracoes/pix', icon: 'qr', permission: 'core.access.settings', group: 'Configurações' }],
});
