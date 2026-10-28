import { AuditService, centsToDecimal, FinanceService, ModuleSettingsService, TeamService, TenantDb, toCents } from '@all/core';
import type { Tx } from '@all/db';
import { requestContext } from '@all/module-sdk';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { computeTermination, round2, terminationTypeLabel, type Payslip, type TaxTables, type TerminationDetail, type TerminationInput, type TerminationStatement } from '../contracts';
import { hrEmployees, hrLeaves, hrPayrollItems, hrPayrolls, hrTerminations, hrVacations } from '../db/schema';
import type { HrSettings } from '../manifest';
import { HrEmployersRegistry } from './employers';
import { addCompetence, badRequest, closedItem, employeeOrFail, fgtsEstimate, findPayroll, MODULE, nextMonth, pgCode, TERMINATION_SOURCE, variableAverage, type EmployeeRow } from './shared';

/**
 * Rescisão: prévia (sem gravar) e confirmação. Ao confirmar, o termo entra na folha de
 * rescisões da competência da saída, o colaborador fica desligado e o financeiro recebe:
 * líquido ao colaborador e guia do FGTS rescisório + multa (até 10 dias da saída, art. 477 §6º)
 * e INSS + IRRF retidos (dia 20 do mês seguinte). Tudo com baixa no financeiro.
 * Colaborador de empresa-cliente (consultoria de RH): o termo entra na folha de rescisões daquela
 * empresa, nada vai para o financeiro (quem paga é a empresa-cliente) e o ramo é avisado (honorário
 * por rescisão, se houver). A pessoa da equipe não ganha data de encerramento.
 */
@Injectable()
export class TerminationService {
  constructor(
    private readonly tdb: TenantDb,
    private readonly settings: ModuleSettingsService,
    private readonly finance: FinanceService,
    private readonly audit: AuditService,
    private readonly team: TeamService,
    private readonly employers: HrEmployersRegistry,
  ) {}

  preview(employeeId: string, input: TerminationInput): Promise<TerminationDetail> {
    return this.tdb.run(async (tx) => (await this.build(tx, employeeId, input)).detail);
  }

  get(employeeId: string): Promise<TerminationDetail> {
    return this.tdb.run(async (tx) => {
      const emp = await employeeOrFail(tx, employeeId);
      const [row] = await tx.select().from(hrTerminations).where(eq(hrTerminations.employeeId, employeeId));
      if (!row) throw new NotFoundException({ code: 'TERMINATION_NOT_FOUND', message: 'Colaborador sem rescisão registrada' });
      const stored = row.result as TerminationStatement & { cancelledVacations?: TerminationDetail['cancelledVacations'] };
      return { ...stored, id: row.id, employee: employeeInfo(emp), cancelledVacations: stored.cancelledVacations ?? [], notes: row.notes, createdAt: row.createdAt.toISOString() };
    });
  }

  confirm(employeeId: string, input: TerminationInput): Promise<TerminationDetail> {
    const { tenantId, userId, modules } = requestContext.requireTenant();
    return this.tdb.run(async (tx) => {
      const { emp, detail, tables } = await this.build(tx, employeeId, input);
      const s = detail;
      const competence = input.terminationDate.slice(0, 7);

      // Folha de rescisões da competência: criada já "fechada" (cada termo é lançado ao confirmar).
      // (sem erro se outra rescisão do mês criar a folha ao mesmo tempo: ON CONFLICT DO NOTHING).
      const employerId = emp.employerCustomerId;
      await tx
        .insert(hrPayrolls)
        .values({ tenantId, competence, type: 'termination', employerCustomerId: employerId, status: 'closed', closedAt: new Date(), closedById: userId ?? null, tables })
        .onConflictDoNothing();
      const payroll = await findPayroll(tx, competence, 'termination', employerId);

      let terminationId: string;
      try {
        const [row] = await tx
          .insert(hrTerminations)
          .values({
            tenantId,
            employeeId,
            payrollId: payroll!.id,
            type: input.type,
            notice: s.notice,
            terminationDate: input.terminationDate,
            projectedEnd: s.projectedEnd,
            input,
            result: { ...stripDetail(s), cancelledVacations: s.cancelledVacations },
            notes: input.notes ?? null,
            createdById: userId ?? null,
          })
          .returning({ id: hrTerminations.id });
        terminationId = row!.id;
      } catch (err) {
        if (pgCode(err) === '23505') throw new ConflictException({ code: 'ALREADY_TERMINATED', message: 'Este colaborador já tem rescisão registrada' });
        throw err;
      }

      // Resumo na folha de rescisões (totais do mês para INSS/IRRF/FGTS).
      const saldo = s.lines.find((l) => l.code === '50')?.amount ?? 0;
      const summary: Payslip = {
        baseSalary: saldo,
        overtime: 0,
        gross: s.earnings,
        inss: round2(s.taxes.inssSalary + s.taxes.inssThirteenth),
        irrf: round2(s.taxes.irrfSalary + s.taxes.irrfThirteenth),
        irrfBase: s.bases.irrfSalary,
        irrfReduction: 0,
        otherDeductions: round2(s.deductions - s.taxes.inssSalary - s.taxes.inssThirteenth - s.taxes.irrfSalary - s.taxes.irrfThirteenth),
        net: s.net,
        fgts: s.fgts.total,
        earnings: s.earnings,
        fgtsRate: s.fgts.rate,
        avos: s.thirteenthAvos,
      };
      await tx.insert(hrPayrollItems).values({
        tenantId,
        payrollId: payroll!.id,
        employeeId,
        salary: centsToDecimal(toCents(s.salary)),
        dependents: emp.dependents,
        daysWorked: s.salaryDays,
        otherEarnings: centsToDecimal(toCents(input.otherEarnings)),
        otherDeductions: centsToDecimal(toCents(input.otherDeductions)),
        variableAverage: centsToDecimal(toCents(s.variableAverage)),
        avos: s.thirteenthAvos,
        result: summary,
        notes: terminationTypeLabel[input.type],
      });

      // Férias marcadas para depois da saída: canceladas (os dias voltam como férias indenizadas).
      for (const v of s.cancelledVacations) {
        await tx.update(hrVacations).set({ status: 'cancelled' }).where(eq(hrVacations.id, v.id));
        await this.finance.cancelPendingBySourceInTx(tx, 'hr_vacation', v.id);
      }

      // Sai das folhas ainda abertas a partir do mês da saída (o termo já paga saldo e 13º).
      const year = input.terminationDate.slice(0, 4);
      const drafts = (await tx.select().from(hrPayrolls).where(eq(hrPayrolls.status, 'draft'))).filter((p) =>
        p.type === 'monthly' ? p.competence >= competence : p.type !== 'termination' && p.competence.slice(0, 4) >= year,
      );
      if (drafts.length)
        await tx.delete(hrPayrollItems).where(
          and(
            eq(hrPayrollItems.employeeId, employeeId),
            inArray(
              hrPayrollItems.payrollId,
              drafts.map((p) => p.id),
            ),
          ),
        );

      await tx.update(hrEmployees).set({ status: 'terminated', terminationDate: input.terminationDate }).where(eq(hrEmployees.id, employeeId));
      const name = emp.name;
      const audit = {
        action: 'hr.employee.terminated',
        entity: 'hr_employee',
        entityId: employeeId,
        data: { terminationId, type: input.type, terminationDate: input.terminationDate, net: s.net, fgts: s.fgts.total, employerCustomerId: employerId },
      };
      if (employerId) {
        await this.audit.log(tx, audit);
        for (const ext of this.employers.active(modules)) {
          await ext.onTerminationConfirmed?.(tx, { terminationId, employerCustomerId: employerId, employerName: emp.employerName ?? '', employeeName: name, terminationDate: input.terminationDate });
        }
        return { ...detail, id: terminationId, notes: input.notes ?? null, createdAt: new Date().toISOString() };
      }
      // A pessoa da equipe ganha a data de encerramento; passada a data, o core avisa a agenda
      // (core.team.member_ended) e o profissional dela fica inativo.
      await this.team.saveInTx(tx, emp.teamMemberId, { endedOn: input.terminationDate });

      const entries = [
        { description: `Rescisão de ${name} — líquido do termo`, amount: s.net, dueDate: s.payBy, categoryKey: 'payroll' },
        {
          description: `FGTS rescisório${s.fgts.fine > 0 ? ` + multa de ${Math.round(s.fgts.fineRate * 100)}%` : ''} — ${name} (guia FGTS Digital)`,
          amount: s.fgts.total,
          dueDate: s.payBy,
          categoryKey: 'payroll',
        },
        {
          description: `INSS e IRRF da rescisão de ${name} (DCTFWeb)`,
          amount: round2(s.taxes.inssSalary + s.taxes.inssThirteenth + s.taxes.irrfSalary + s.taxes.irrfThirteenth),
          dueDate: nextMonth(competence, 20),
          categoryKey: 'taxes',
        },
      ];
      for (const e of entries) {
        if (e.amount <= 0) continue;
        await this.finance.recordInTx(tx, { kind: 'expense', status: 'pending', ...e, sourceType: TERMINATION_SOURCE, sourceId: terminationId, settleInFinance: true });
      }
      await this.audit.log(tx, audit);
      return { ...detail, id: terminationId, notes: input.notes ?? null, createdAt: new Date().toISOString() };
    });
  }

  /** Junta o que está registrado (férias, afastamentos, folhas pagas) e calcula o termo. */
  private async build(tx: Tx, employeeId: string, input: TerminationInput): Promise<{ emp: EmployeeRow; detail: TerminationDetail; tables: TaxTables }> {
    const emp = await employeeOrFail(tx, employeeId);
    const [existing] = await tx.select({ id: hrTerminations.id }).from(hrTerminations).where(eq(hrTerminations.employeeId, employeeId));
    if (existing) throw new ConflictException({ code: 'ALREADY_TERMINATED', message: 'Este colaborador já tem rescisão registrada' });
    if (input.terminationDate < emp.admissionDate) throw badRequest('TERMINATION_BEFORE_ADMISSION', 'A saída é antes da admissão');
    const { tables } = await this.settings.getInTx<HrSettings>(tx, MODULE);

    const vacations = await tx.select().from(hrVacations).where(and(eq(hrVacations.employeeId, employeeId), eq(hrVacations.status, 'scheduled')));
    const future = vacations.filter((v) => v.startOn > input.terminationDate);
    const kept = vacations.filter((v) => v.startOn <= input.terminationDate);
    const leaves = await tx.select().from(hrLeaves).where(eq(hrLeaves.employeeId, employeeId));
    const year = input.terminationDate.slice(0, 4);
    const competence = input.terminationDate.slice(0, 7);
    const advance = (await closedItem(tx, employeeId, `${year}-11`, 'thirteenth_1'))?.gross ?? 0;
    const thirteenthPaid = !!(await closedItem(tx, employeeId, `${year}-12`, 'thirteenth_2'));
    const salaryAlreadyPaid = !!(await closedItem(tx, employeeId, competence, 'monthly'));
    // Médias: folhas mensais fechadas dos 12 meses antes da saída.
    const average = input.variableAverage ?? (await variableAverage(tx, employeeId, addCompetence(competence, -12), addCompetence(competence, -1)));
    const fgtsBalance = input.fgtsBalance ?? (await fgtsEstimate(tx, employeeId));

    const statement = computeTermination(
      {
        type: input.type,
        notice: input.notice,
        admissionDate: emp.admissionDate,
        terminationDate: input.terminationDate,
        salary: input.salary ?? Number(emp.salary),
        variableAverage: average,
        dependents: emp.dependents,
        apprentice: emp.category === 'apprentice',
        experienceEnd: emp.experienceEnd,
        vacationsUsed: kept.map((v) => ({ periodStart: v.periodStart, days: v.days + v.soldDays })),
        leaves,
        thirteenthAdvance: advance,
        thirteenthPaid,
        salaryAlreadyPaid,
        fgtsBalance,
        fgtsBalanceSource: input.fgtsBalance === undefined ? 'estimated' : 'informed',
        otherEarnings: input.otherEarnings,
        otherDeductions: input.otherDeductions,
      },
      tables,
    );
    if (future.length) statement.warnings.push(`${future.length} férias marcadas depois da saída serão canceladas; os dias entram como férias indenizadas. Se já foram pagas, desconte no termo.`);
    if (emp.category === 'apprentice') statement.warnings.push('Aprendiz: confira as hipóteses de extinção antecipada do art. 433 da CLT (o cálculo segue as regras gerais).');
    return {
      emp,
      tables,
      detail: {
        ...statement,
        id: null,
        employee: employeeInfo(emp),
        cancelledVacations: future.map((v) => ({ id: v.id, startOn: v.startOn, days: v.days })),
        notes: input.notes ?? null,
        createdAt: null,
      },
    };
  }
}

const employeeInfo = (e: EmployeeRow): TerminationDetail['employee'] => ({
  id: e.id,
  name: e.name,
  cpf: e.cpf ?? '',
  position: e.position,
  category: e.category,
  pixKey: e.pixKey,
  employer: e.employerCustomerId ? { id: e.employerCustomerId, name: e.employerName ?? '', document: e.employerDocument } : null,
});

function stripDetail(d: TerminationDetail): TerminationStatement {
  const { id: _id, employee: _e, cancelledVacations: _c, notes: _n, createdAt: _at, ...statement } = d;
  return statement;
}
