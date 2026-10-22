import { Injectable } from '@nestjs/common';
import type { ServiceOrderWorkflow } from '../contracts';

/** Fluxo genérico, usado quando a vertical não registra um próprio. */
export const defaultWorkflow: ServiceOrderWorkflow = {
  key: 'default',
  label: 'Padrão',
  initial: 'open',
  statuses: [
    { key: 'open', label: 'Aberta', tone: 'brand' },
    { key: 'in_progress', label: 'Em andamento', tone: 'warning' },
    { key: 'ready', label: 'Pronta', tone: 'success' },
    { key: 'delivered', label: 'Entregue', tone: 'neutral', terminal: true },
    { key: 'cancelled', label: 'Cancelada', tone: 'danger', terminal: true, cancelled: true },
  ],
  transitions: {
    open: ['in_progress', 'cancelled'],
    in_progress: ['ready', 'cancelled'],
    ready: ['delivered', 'in_progress'],
    delivered: [],
    cancelled: [],
  },
  notify: {
    open: 'shared.service-orders.received',
    ready: 'shared.service-orders.ready',
    delivered: 'shared.service-orders.delivered',
  },
};

/** Registro de fluxos. As verticais registram o seu no onModuleInit. */
@Injectable()
export class ServiceOrderWorkflows {
  private readonly byKey = new Map<string, ServiceOrderWorkflow>([[defaultWorkflow.key, defaultWorkflow]]);

  register(workflow: ServiceOrderWorkflow) {
    const keys = new Set(workflow.statuses.map((s) => s.key));
    if (!keys.has(workflow.initial)) throw new Error(`Fluxo ${workflow.key}: status inicial inexistente`);
    for (const [from, targets] of Object.entries(workflow.transitions)) {
      for (const to of [from, ...targets]) {
        if (!keys.has(to)) throw new Error(`Fluxo ${workflow.key}: status inexistente "${to}"`);
      }
    }
    this.byKey.set(workflow.key, workflow);
  }

  get(key: string): ServiceOrderWorkflow | undefined {
    return this.byKey.get(key);
  }

  all(): ServiceOrderWorkflow[] {
    return [...this.byKey.values()];
  }
}
