import type { Tx } from '@all/db';
import { Injectable } from '@nestjs/common';
import type { Payroll } from '../contracts';

/** Folha de uma empresa-cliente acabou de ser fechada (mensal ou 13º). */
export interface ClosedEmployerPayroll {
  payrollId: string;
  employerCustomerId: string;
  employerName: string;
  competence: string;
  type: 'monthly' | 'thirteenth_1' | 'thirteenth_2';
  totals: Payroll['totals'];
}

/** Rescisão confirmada de um colaborador de empresa-cliente. */
export interface ConfirmedEmployerTermination {
  terminationId: string;
  employerCustomerId: string;
  employerName: string;
  employeeName: string;
  terminationDate: string;
}

/** Folha de empresa-cliente sendo reaberta. */
export interface ReopenedEmployerPayroll {
  payrollId: string;
  employerCustomerId: string;
  competence: string;
  reason: string;
}

/** Rescisão de empresa-cliente sendo desfeita. */
export interface UndoneEmployerTermination {
  terminationId: string;
  employerCustomerId: string;
  employeeName: string;
  reason: string;
}

/**
 * Ramo que liga, no RH, os colaboradores de empresas-clientes (ex.: Consultoria de RH) e reage ao que
 * acontece com eles (ex.: lançar os honorários). Os ganchos rodam na mesma transação do fechamento.
 * O RH não conhece o ramo (ADR-018): só valem os registros de módulos ativos no tenant.
 * Nas reversões, o ramo pode recusar lançando uma exceção (ex.: honorário já recebido).
 */
export interface HrEmployerExtension {
  moduleKey: string;
  onPayrollClosed?(tx: Tx, payroll: ClosedEmployerPayroll): Promise<void>;
  onTerminationConfirmed?(tx: Tx, termination: ConfirmedEmployerTermination): Promise<void>;
  onPayrollReopened?(tx: Tx, payroll: ReopenedEmployerPayroll): Promise<void>;
  onTerminationUndone?(tx: Tx, termination: UndoneEmployerTermination): Promise<void>;
}

@Injectable()
export class HrEmployersRegistry {
  private readonly extensions: HrEmployerExtension[] = [];

  register(extension: HrEmployerExtension) {
    if (!this.extensions.some((e) => e.moduleKey === extension.moduleKey)) this.extensions.push(extension);
  }

  /** Extensões dos módulos ativos no tenant. */
  active(activeModules: ReadonlySet<string> | undefined): HrEmployerExtension[] {
    return this.extensions.filter((e) => activeModules?.has(e.moduleKey));
  }

  /** O tenant pode ter colaboradores (e folhas) de empresas-clientes. */
  enabled(activeModules: ReadonlySet<string> | undefined): boolean {
    return this.active(activeModules).length > 0;
  }
}
