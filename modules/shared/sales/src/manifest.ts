import { defineModule } from '@all/module-sdk';
import { salesSettings } from './contracts';

/** Produtos, estoque e frente de caixa (PDV). Usado pela padaria, pet shop e outras verticais com balcão. */
export const salesManifest = defineModule({
  key: 'shared.sales',
  name: 'Vendas e estoque',
  layer: 'shared',
  description: 'Caixa (PDV), vendas e controle de estoque.',
  icon: 'register',
  version: '1.0.0',
  dependsOn: ['core.customers', 'core.finance'],
  permissions: [
    { key: 'shared.sales.sell', label: 'Vender no caixa (PDV)' },
    { key: 'shared.sales.register', label: 'Abrir e fechar o caixa, sangria e suprimento' },
    { key: 'shared.sales.register.history', label: 'Ver o histórico de caixas e gerenciar os caixas' },
    { key: 'shared.sales.read', label: 'Ver vendas e relatórios' },
    { key: 'shared.sales.cancel', label: 'Cancelar vendas' },
    { key: 'shared.sales.products', label: 'Cadastrar produtos e preços' },
    { key: 'shared.sales.stock', label: 'Lançar entradas, perdas e inventário' },
  ],
  settings: salesSettings,
  defaultRoles: [
    { key: 'shared.sales.cashier', label: 'Caixa', permissions: ['shared.sales.sell', 'shared.sales.register', 'core.customers.read'] },
    { key: 'shared.sales.stockist', label: 'Estoquista', permissions: ['shared.sales.products', 'shared.sales.stock', 'shared.sales.read'] },
  ],
  menu: [
    { label: 'Caixa (PDV)', path: '/pdv', icon: 'register', permission: 'shared.sales.sell' },
    { label: 'Vendas', path: '/vendas', icon: 'chart', permission: 'shared.sales.read' },
    { label: 'Caixas', path: '/caixas', icon: 'banknote', permission: 'shared.sales.register.history' },
    { label: 'Produtos e estoque', path: '/produtos', icon: 'package', permission: 'shared.sales.products' },
  ],
});
