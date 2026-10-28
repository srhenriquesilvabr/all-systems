import { AuditService, CustomersService, FinanceService, TenantDb, addMonths, centsToNumber, splitCents, toCents, type UploadedFile } from '@all/core';
import { customers } from '@all/core/schema';
import type { Tx } from '@all/db';
import { MedicalRecordsService, type MedicalEntry, type MedicalForm } from '@all/medical-records';
import { requestContext } from '@all/module-sdk';
import { SalesService } from '@all/sales';
import { SchedulingService, schedulingSchema } from '@all/scheduling';
import { ConflictException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { and, desc, eq, inArray, type SQL } from 'drizzle-orm';
import {
  fillConsent,
  localToday,
  sessionForms,
  specialtyForms,
  specialtyLabel,
  specialtyOfForm,
  specialtyRequirement,
  surgeryStageLabel,
  type AesCase,
  type BudgetApproveInput,
  type BudgetInput,
  type CaseInput,
  type CaseUpdateInput,
  type ConsentAcceptInput,
  type PatientSpecialtyData,
  type PhotoMeta,
  type SpecialtyKey,
  type SpecialtyRecordInput,
  type SurgeryScheduleInput,
  type SurgeryStage,
} from '../contracts';
import { aesCases, aesLotUsages } from '../db/schema';
import { MODULE, SpecialtySetupService, badRequest } from './setup.service';

const { schAppointments, schResources } = schedulingSchema;
/** Origem dos lançamentos do orçamento aprovado no financeiro. */
const SOURCE = 'aes_case';
const brDate = (iso: string) => iso.split('-').reverse().join('/');
const allForms: MedicalForm[] = Object.values(specialtyForms).flat();
const formByKey = new Map(allForms.map((f) => [f.key, f]));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type CaseRow = typeof aesCases.$inferSelect;
type EntryRow = Awaited<ReturnType<MedicalRecordsService['entriesByFormInTx']>>[number];

/** Registros vigentes: sem os que já foram retificados (a retificação vale no lugar deles). */
function current(rows: EntryRow[]): EntryRow[] {
  const amended = new Set(rows.map((r) => r.amendsId).filter(Boolean));
  return rows.filter((r) => !amended.has(r.id));
}

/**
 * Parte clínica das especialidades. Toda ficha vai para o prontuário (só inclusão, com log de
 * acesso) pelo MedicalRecordsService, na mesma transação do uso dos lotes e da baixa no estoque.
 */
@Injectable()
export class SpecialtyClinicalService implements OnModuleInit {
  constructor(
    private readonly tdb: TenantDb,
    private readonly setup: SpecialtySetupService,
    private readonly records: MedicalRecordsService,
    private readonly customers: CustomersService,
    private readonly finance: FinanceService,
    private readonly sales: SalesService,
    private readonly scheduling: SchedulingService,
    private readonly audit: AuditService,
  ) {}

  onModuleInit() {
    for (const form of allForms) this.records.registerForm(form);
  }

  /** Fichas das especialidades e casos do paciente. Abrir conta como acesso ao prontuário. */
  patient(customerId: string): Promise<PatientSpecialtyData> {
    return this.tdb.run(async (tx) => {
      const entries = await this.records.listInTx(tx, 'customer', customerId, { formKeys: allForms.map((f) => f.key) });
      const cases = await this.caseDtos(tx, await tx.select().from(aesCases).where(eq(aesCases.customerId, customerId)).orderBy(desc(aesCases.startedOn), desc(aesCases.createdAt)));
      return { entries, cases };
    });
  }

  // ---- Fichas ---------------------------------------------------------------------------------

  record(input: SpecialtyRecordInput): Promise<MedicalEntry> {
    return this.tdb.run(async (tx) => {
      await this.setup.assertEnabledInTx(tx, input.specialty);
      const group = specialtyOfForm(input.formKey);
      if (!group || (group !== 'common' && group !== input.specialty)) throw badRequest('FORM_NOT_AVAILABLE', 'Ficha não pertence a esta especialidade');
      const form = formByKey.get(input.formKey)!;
      if (input.formKey === 'aesthetics.consent' || input.formKey === 'aesthetics.photo') throw badRequest('FORM_NOT_AVAILABLE', 'Termos e fotos têm tela própria');
      const occurredOn = input.occurredOn ?? localToday();
      const data: Record<string, unknown> = { ...input.data };

      // Quem fez: nome e registro no conselho vão para a ficha (o cadastro pode mudar depois).
      const requirement = group === 'common' ? undefined : specialtyRequirement[input.specialty];
      if (requirement && !input.professionalId) throw badRequest('PROFESSIONAL_REQUIRED', `${requirement.message}: escolha o profissional`);
      if (input.professionalId) {
        const pro = await this.setup.professionalInTx(tx, input.professionalId);
        if (requirement) checkCredential(pro, requirement, requirement.rqeForms?.includes(input.formKey) ?? false);
        data.professional = pro.label;
        data.professionalId = pro.resource.id;
      }
      if (group === 'common') data.specialty = specialtyLabel[input.specialty];

      const caseRow = input.caseId ? await this.caseForRecord(tx, input.caseId, input.customerId, group === 'common' ? null : input.specialty) : null;
      if (caseRow) data.caseId = caseRow.id;

      const { data: filled, usages } = await this.applyLots(tx, form, data, occurredOn);
      const entry = await this.records.createInTx(tx, {
        subjectType: 'customer',
        subjectId: input.customerId,
        formKey: form.key,
        data: filled,
        notes: input.notes ?? null,
        appointmentId: input.appointmentId ?? null,
        occurredOn,
      });
      await this.registerUsages(tx, entry, input.specialty, form, usages);
      if (caseRow) await this.advanceSurgery(tx, caseRow, form.key);
      return entry;
    });
  }

  /**
   * Produto, lote e validade saem do cadastro (não do que a tela mandou) e cada item com `lotId`
   * vira um uso do lote. Lote vencido no dia do atendimento é recusado.
   */
  private async applyLots(tx: Tx, form: MedicalForm, data: Record<string, unknown>, usedOn: string) {
    const usages: { lot: { id: string; lot: string }; product: { id: string; name: string; unit: string; salesProductId: string | null; unitsPerPackage: string | null }; amount: number }[] = [];
    const fill = async (obj: Record<string, unknown>) => {
      const lotId = typeof obj.lotId === 'string' ? obj.lotId : '';
      if (!lotId) return obj;
      if (!UUID.test(lotId)) throw badRequest('LOT_NOT_FOUND', 'Lote não encontrado');
      const { lot, product } = await this.setup.lotForUseInTx(tx, lotId, usedOn);
      const amount = Number(String(obj.amount ?? '').replace(',', '.'));
      usages.push({ lot, product, amount: Number.isFinite(amount) && amount > 0 ? amount : 0 });
      return { ...obj, product: product.brand ? `${product.name} (${product.brand})` : product.name, lot: lot.lot, expiresOn: lot.expiresOn, ...(obj.unit === undefined ? {} : { unit: obj.unit || product.unit }) };
    };
    let out = await fill(data);
    for (const f of form.fields.filter((f) => f.type === 'list')) {
      const rows = out[f.key];
      if (!Array.isArray(rows)) continue;
      const filled: unknown[] = [];
      for (const row of rows) filled.push(row && typeof row === 'object' ? await fill(row as Record<string, unknown>) : row);
      out = { ...out, [f.key]: filled };
    }
    return { data: out, usages };
  }

  /** Rastreio por lote (só inclusão) e baixa no estoque de vendas, se o produto estiver ligado a um. */
  private async registerUsages(tx: Tx, entry: MedicalEntry, specialty: SpecialtyKey, form: MedicalForm, usages: Awaited<ReturnType<SpecialtyClinicalService['applyLots']>>['usages']) {
    if (!usages.length) return;
    const { tenantId } = requestContext.requireTenant();
    await tx.insert(aesLotUsages).values(
      usages.map((u) => ({
        tenantId,
        lotId: u.lot.id,
        productId: u.product.id,
        customerId: entry.subjectId,
        entryId: entry.id,
        specialty,
        amount: String(u.amount),
        unit: u.product.unit,
        usedOn: entry.occurredOn,
      })),
    );
    const byProduct = new Map<string, { product: (typeof usages)[number]['product']; amount: number }>();
    for (const u of usages) {
      const acc = byProduct.get(u.product.id) ?? { product: u.product, amount: 0 };
      acc.amount += u.amount;
      byProduct.set(u.product.id, acc);
    }
    const occurredAt = entry.occurredOn === localToday() ? new Date() : new Date(`${entry.occurredOn}T12:00:00-03:00`);
    for (const { product, amount } of byProduct.values()) {
      if (!product.salesProductId || amount <= 0) continue;
      const packages = amount / (product.unitsPerPackage ? Number(product.unitsPerPackage) : 1);
      // Sem nome do paciente: o histórico do estoque é visto por quem não tem acesso ao prontuário.
      await this.sales.consumeInTx(tx, product.salesProductId, packages, { reason: `${form.label}: ${product.name}`, occurredAt });
    }
  }

  // ---- Fotos padronizadas --------------------------------------------------------------------

  /** Foto clínica: registro no prontuário com a imagem anexada, na mesma transação. */
  photo(meta: PhotoMeta, file: UploadedFile): Promise<MedicalEntry> {
    return this.tdb.run(async (tx) => {
      await this.setup.assertEnabledInTx(tx, meta.specialty);
      const caseRow = meta.caseId ? await this.caseForRecord(tx, meta.caseId, meta.customerId, null) : null;
      const entry = await this.records.createInTx(tx, {
        subjectType: 'customer',
        subjectId: meta.customerId,
        formKey: 'aesthetics.photo',
        data: { specialty: specialtyLabel[meta.specialty], region: meta.region, angle: meta.angle, phase: meta.phase, ...(caseRow ? { caseId: caseRow.id } : {}) },
        notes: null,
        occurredOn: meta.occurredOn ?? localToday(),
      });
      const attachment = await this.records.attachInTx(tx, entry.id, file, { image: true });
      return { ...entry, attachments: [attachment] };
    });
  }

  // ---- Termo de consentimento ----------------------------------------------------------------

  /** Aceite: o texto da versão atual do modelo, preenchido, vai para o prontuário com a assinatura. */
  consent(input: ConsentAcceptInput): Promise<MedicalEntry> {
    return this.tdb.run(async (tx) => {
      const template = await this.setup.templateInTx(tx, input.templateId);
      if (!template.active) throw badRequest('TEMPLATE_INACTIVE', 'Este modelo de termo está desativado');
      const enabled = await this.setup.enabledInTx(tx);
      const caseRow = input.caseId ? await this.caseForRecord(tx, input.caseId, input.customerId, (template.specialty as SpecialtyKey | null) ?? input.specialty ?? null) : null;
      // Modelo geral (ex.: uso de imagem): vale a especialidade de onde o termo foi aceito.
      const specialty = ((template.specialty as SpecialtyKey | null) ?? input.specialty ?? (caseRow?.specialty as SpecialtyKey | undefined) ?? null) as SpecialtyKey | null;
      if (specialty ? !enabled.includes(specialty) : !enabled.length) {
        throw badRequest('SPECIALTY_DISABLED', specialty ? `${specialtyLabel[specialty]} não está ligada nas configurações da clínica` : 'Nenhuma especialidade ligada');
      }
      const customer = await this.customers.findInTx(tx, input.customerId);
      if (!customer || customer.anonymizedAt) throw new NotFoundException({ code: 'CUSTOMER_NOT_FOUND', message: 'Paciente não encontrado' });
      const pro = await this.setup.professionalInTx(tx, input.professionalId);
      const occurredOn = input.occurredOn ?? localToday();
      const signature = input.signature ? pngFromDataUrl(input.signature) : null;

      const entry = await this.records.createInTx(tx, {
        subjectType: 'customer',
        subjectId: customer.id,
        formKey: 'aesthetics.consent',
        data: {
          term: template.title,
          version: template.version,
          specialty: specialty ? specialtyLabel[specialty] : null,
          procedure: input.procedure,
          text: fillConsent(template.body, { paciente: customer.name, procedimento: input.procedure, profissional: pro.label, data: brDate(occurredOn) }),
          signedBy: input.signedBy,
          signature: !!signature,
          templateId: template.id,
          professional: pro.label,
          professionalId: pro.resource.id,
          ...(caseRow ? { caseId: caseRow.id } : {}),
        },
        occurredOn,
      });
      if (!signature) return entry;
      const attachment = await this.records.attachInTx(tx, entry.id, { buffer: signature, originalname: 'assinatura.png', mimetype: 'image/png', size: signature.length }, { image: true });
      return { ...entry, attachments: [attachment] };
    });
  }

  // ---- Casos -----------------------------------------------------------------------------------

  listCases(opts: { customerId?: string; specialty?: SpecialtyKey; status?: AesCase['status'] }): Promise<AesCase[]> {
    return this.tdb.run(async (tx) => {
      const where: (SQL | undefined)[] = [
        opts.customerId ? eq(aesCases.customerId, opts.customerId) : undefined,
        opts.specialty ? eq(aesCases.specialty, opts.specialty) : undefined,
        opts.status ? eq(aesCases.status, opts.status) : undefined,
      ];
      const rows = await tx
        .select()
        .from(aesCases)
        .where(and(...where))
        .orderBy(desc(aesCases.startedOn), desc(aesCases.createdAt))
        .limit(300);
      return this.caseDtos(tx, rows);
    });
  }

  createCase(input: CaseInput): Promise<AesCase> {
    const { tenantId } = requestContext.requireTenant();
    return this.tdb.run(async (tx) => {
      await this.setup.assertEnabledInTx(tx, input.specialty);
      const customer = await this.customers.findInTx(tx, input.customerId);
      if (!customer || customer.anonymizedAt) throw new NotFoundException({ code: 'CUSTOMER_NOT_FOUND', message: 'Paciente não encontrado' });
      if (input.professionalId) await this.setup.professionalInTx(tx, input.professionalId);
      const [row] = await tx
        .insert(aesCases)
        .values({
          tenantId,
          customerId: customer.id,
          specialty: input.specialty,
          title: input.title,
          stage: input.specialty === 'plastic_surgery' ? 'evaluation' : null,
          professionalId: input.professionalId ?? null,
          plannedSessions: input.plannedSessions ?? null,
          startedOn: input.startedOn ?? localToday(),
          notes: input.notes ?? null,
        })
        .returning();
      await this.audit.log(tx, { action: 'aesthetics.case.created', entity: 'aes_case', entityId: row!.id, data: { specialty: input.specialty } });
      return (await this.caseDtos(tx, [row!]))[0]!;
    });
  }

  updateCase(id: string, input: CaseUpdateInput): Promise<AesCase> {
    return this.tdb.run(async (tx) => {
      const row = await this.caseOrFail(tx, id, true);
      if (row.status !== 'active') throw badRequest('CASE_CLOSED', 'Este tratamento já foi encerrado');
      if (input.professionalId) await this.setup.professionalInTx(tx, input.professionalId);
      const [updated] = await tx
        .update(aesCases)
        .set({
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.professionalId !== undefined ? { professionalId: input.professionalId ?? null } : {}),
          ...(input.plannedSessions !== undefined ? { plannedSessions: input.plannedSessions ?? null } : {}),
          ...(input.startedOn !== undefined ? { startedOn: input.startedOn } : {}),
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
        })
        .where(eq(aesCases.id, id))
        .returning();
      return (await this.caseDtos(tx, [updated!]))[0]!;
    });
  }

  /** Conclui ou cancela. Cancelar cancela as parcelas do orçamento ainda em aberto. */
  closeCase(id: string, status: 'finished' | 'cancelled', reason: string | null): Promise<AesCase> {
    return this.tdb.run(async (tx) => {
      const row = await this.caseOrFail(tx, id, true);
      if (row.status !== 'active') throw badRequest('CASE_CLOSED', 'Este tratamento já foi encerrado');
      if (status === 'cancelled' && (!reason || reason.length < 3)) throw badRequest('REASON_REQUIRED', 'Explique o motivo do cancelamento');
      const [updated] = await tx
        .update(aesCases)
        .set({ status, finishedOn: localToday(), closeReason: reason, ...(status === 'finished' && row.stage ? { stage: 'discharged' as const } : {}) })
        .where(eq(aesCases.id, id))
        .returning();
      const cancelled = status === 'cancelled' ? await this.finance.cancelPendingBySourceInTx(tx, SOURCE, id) : 0;
      await this.audit.log(tx, { action: `aesthetics.case.${status}`, entity: 'aes_case', entityId: id, data: { reason, cancelledInstallments: cancelled } });
      return (await this.caseDtos(tx, [updated!]))[0]!;
    });
  }

  /**
   * Etapa da cirurgia, à mão. "Cirurgia marcada" só pela marcação (que confere pré-operatório,
   * termo e orçamento); daí em diante, só com a cirurgia na agenda. Alta conclui o caso.
   */
  setStage(id: string, stage: SurgeryStage): Promise<AesCase> {
    return this.tdb.run(async (tx) => {
      const row = await this.caseOrFail(tx, id, true);
      if (row.specialty !== 'plastic_surgery') throw badRequest('NOT_SURGERY', 'Etapas são só da cirurgia plástica');
      if (row.status !== 'active') throw badRequest('CASE_CLOSED', 'Este tratamento já foi encerrado');
      if (stage === 'scheduled') throw badRequest('USE_SCHEDULE', 'Marque a cirurgia pela agenda do caso');
      const after = ['operated', 'postop', 'discharged'].includes(stage);
      if (after && !(await this.activeSurgery(tx, row))) throw badRequest('SURGERY_NOT_SCHEDULED', `"${surgeryStageLabel[stage]}" só depois de marcar a cirurgia`);
      const [updated] = await tx
        .update(aesCases)
        .set({ stage, ...(stage === 'discharged' ? { status: 'finished' as const, finishedOn: localToday() } : {}) })
        .where(eq(aesCases.id, id))
        .returning();
      await this.audit.log(tx, { action: 'aesthetics.case.stage', entity: 'aes_case', entityId: id, data: { from: row.stage, to: stage } });
      return (await this.caseDtos(tx, [updated!]))[0]!;
    });
  }

  // ---- Orçamento da cirurgia -------------------------------------------------------------------

  saveBudget(id: string, input: BudgetInput): Promise<AesCase> {
    return this.tdb.run(async (tx) => {
      const row = await this.surgeryCaseOrFail(tx, id);
      if (row.budget?.status === 'approved') throw badRequest('BUDGET_APPROVED', 'O orçamento já foi aprovado e lançado no financeiro');
      const items = input.items.map((i) => ({ ...i, amount: centsToNumber(toCents(i.amount)) }));
      const [updated] = await tx
        .update(aesCases)
        .set({ budget: { items, status: 'draft', validUntil: input.validUntil ?? null, approvedOn: null, installments: null } })
        .where(eq(aesCases.id, id))
        .returning();
      await this.audit.log(tx, { action: 'aesthetics.budget.saved', entity: 'aes_case', entityId: id, data: { total: items.reduce((s, i) => s + i.amount, 0) } });
      return (await this.caseDtos(tx, [updated!]))[0]!;
    });
  }

  /** Aprovado: a parte cobrada pela clínica vira "a receber" (parcelas); a de terceiros é só informativa. */
  approveBudget(id: string, input: BudgetApproveInput): Promise<AesCase> {
    return this.tdb.run(async (tx) => {
      const row = await this.surgeryCaseOrFail(tx, id);
      const budget = row.budget;
      if (!budget?.items.length) throw badRequest('BUDGET_EMPTY', 'Monte o orçamento antes de aprovar');
      if (budget.status === 'approved') throw badRequest('BUDGET_APPROVED', 'O orçamento já foi aprovado');
      const approvedOn = input.approvedOn ?? localToday();
      const firstDueOn = input.firstDueOn ?? approvedOn;
      if (firstDueOn < approvedOn) throw badRequest('INVALID_DUE_DATE', 'O primeiro vencimento não pode ser antes da aprovação');
      const clinicCents = budget.items.filter((i) => i.billedBy === 'clinic').reduce((s, i) => s + toCents(i.amount), 0);
      if (clinicCents <= 0) throw badRequest('BUDGET_NOTHING_TO_BILL', 'Nenhum item é cobrado pela clínica');
      const parts = splitCents(clinicCents, input.installments);
      for (const [i, cents] of parts.entries()) {
        if (cents <= 0) continue;
        await this.finance.recordInTx(tx, {
          kind: 'income',
          status: 'pending',
          description: `Cirurgia: ${row.title}${parts.length > 1 ? ` — parcela ${i + 1}/${parts.length}` : ''}`,
          amount: cents / 100,
          dueDate: addMonths(firstDueOn, i),
          customerId: row.customerId,
          sourceType: SOURCE,
          sourceId: row.id,
          settleInFinance: true,
          categoryKey: 'services',
        });
      }
      const [updated] = await tx
        .update(aesCases)
        .set({ budget: { ...budget, status: 'approved', approvedOn, installments: input.installments } })
        .where(eq(aesCases.id, id))
        .returning();
      await this.customers.addTimeline(tx, {
        customerId: row.customerId,
        moduleKey: MODULE,
        type: 'surgery.budget_approved',
        title: `Orçamento de cirurgia aprovado: ${(clinicCents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} em ${input.installments}x`,
        entity: 'aes_case',
        entityId: row.id,
      });
      await this.audit.log(tx, { action: 'aesthetics.budget.approved', entity: 'aes_case', entityId: id, data: { clinicTotal: clinicCents / 100, installments: input.installments, approvedOn } });
      return (await this.caseDtos(tx, [updated!]))[0]!;
    });
  }

  // ---- Cirurgia na agenda ----------------------------------------------------------------------

  /**
   * Marca a cirurgia na agenda (cirurgião, sala/centro cirúrgico se houver) com local e equipe.
   * Exige: orçamento aprovado, termo aceito no caso, pré-operatório liberado (inclusive pela
   * anestesia) e cirurgião com CRM e RQE.
   */
  scheduleSurgery(id: string, input: SurgeryScheduleInput): Promise<AesCase> {
    return this.tdb.run(async (tx) => {
      const row = await this.surgeryCaseOrFail(tx, id);
      if (await this.activeSurgery(tx, row)) throw new ConflictException({ code: 'SURGERY_SCHEDULED', message: 'A cirurgia já está marcada: para mudar o horário, remarque pela agenda' });
      if (row.budget?.status !== 'approved') throw badRequest('BUDGET_NOT_APPROVED', 'Aprove o orçamento antes de marcar a cirurgia');
      const entries = current(await this.records.entriesByFormInTx(tx, [row.customerId], ['aesthetics.consent', 'aesthetics.surgery.preop'])).filter((e) => e.data.caseId === row.id);
      if (!entries.some((e) => e.formKey === 'aesthetics.consent')) throw badRequest('CONSENT_REQUIRED', 'Registre o termo de consentimento da cirurgia antes de marcar');
      const preop = entries.filter((e) => e.formKey === 'aesthetics.surgery.preop').at(-1);
      if (!preop || preop.data.released !== true || preop.data.anesthesiaClearance !== true) {
        throw badRequest('PREOP_NOT_RELEASED', 'O pré-operatório mais recente precisa estar liberado, inclusive pela avaliação anestésica');
      }
      const surgeon = await this.setup.professionalInTx(tx, input.resourceId);
      checkCredential(surgeon, specialtyRequirement.plastic_surgery!, true);
      const appointment = await this.scheduling.createInTx(tx, {
        customerId: row.customerId,
        resourceId: input.resourceId,
        serviceIds: [input.serviceId],
        startsAt: input.startsAt,
        roomId: input.roomId ?? null,
        notes: `Cirurgia: ${row.title}. Local: ${input.location}`.slice(0, 1000),
      });
      const team = input.team.map((m) => ({ role: m.role, name: m.name, teamMemberId: m.teamMemberId ?? null }));
      const [updated] = await tx
        .update(aesCases)
        .set({ stage: 'scheduled', professionalId: input.resourceId, surgery: { appointmentId: appointment.id, startsAt: appointment.startsAt, location: input.location, team } })
        .where(eq(aesCases.id, id))
        .returning();
      await this.audit.log(tx, { action: 'aesthetics.surgery.scheduled', entity: 'aes_case', entityId: id, data: { appointmentId: appointment.id, location: input.location } });
      return (await this.caseDtos(tx, [updated!]))[0]!;
    });
  }

  // ---- internos ------------------------------------------------------------------------------

  /** Ficha da cirurgia move a etapa para a frente (nunca para trás). */
  private async advanceSurgery(tx: Tx, row: CaseRow, formKey: string) {
    if (row.specialty !== 'plastic_surgery' || row.status !== 'active' || !row.stage) return;
    const order = ['evaluation', 'preop', 'scheduled', 'operated', 'postop', 'discharged'];
    const target = ({ 'aesthetics.surgery.preop': 'preop', 'aesthetics.surgery.report': 'operated', 'aesthetics.surgery.postop': 'postop' } as Record<string, SurgeryStage>)[formKey];
    if (!target || order.indexOf(target) <= order.indexOf(row.stage)) return;
    if (target !== 'preop' && !(await this.activeSurgery(tx, row))) return;
    await tx.update(aesCases).set({ stage: target }).where(eq(aesCases.id, row.id));
  }

  /** Horário da cirurgia ainda valendo (não cancelado nem falta). */
  private async activeSurgery(tx: Tx, row: CaseRow) {
    if (!row.surgery) return false;
    const [a] = await tx.select({ status: schAppointments.status }).from(schAppointments).where(eq(schAppointments.id, row.surgery.appointmentId));
    return !!a && a.status !== 'cancelled' && a.status !== 'no_show';
  }

  private async caseForRecord(tx: Tx, id: string, customerId: string, specialty: SpecialtyKey | null) {
    const row = await this.caseOrFail(tx, id);
    if (row.customerId !== customerId) throw badRequest('CASE_MISMATCH', 'Este tratamento é de outro paciente');
    if (specialty && row.specialty !== specialty) throw badRequest('CASE_MISMATCH', 'Este tratamento é de outra especialidade');
    if (row.status === 'cancelled') throw badRequest('CASE_CLOSED', 'Este tratamento foi cancelado');
    return row;
  }

  private async caseOrFail(tx: Tx, id: string, lock = false) {
    const q = tx.select().from(aesCases).where(eq(aesCases.id, id));
    const [row] = lock ? await q.for('update') : await q;
    if (!row) throw new NotFoundException({ code: 'CASE_NOT_FOUND', message: 'Tratamento não encontrado' });
    return row;
  }

  private async surgeryCaseOrFail(tx: Tx, id: string) {
    const row = await this.caseOrFail(tx, id, true);
    if (row.specialty !== 'plastic_surgery') throw badRequest('NOT_SURGERY', 'Orçamento e marcação são da cirurgia plástica');
    if (row.status !== 'active') throw badRequest('CASE_CLOSED', 'Este tratamento já foi encerrado');
    return row;
  }

  private async caseDtos(tx: Tx, rows: CaseRow[]): Promise<AesCase[]> {
    if (!rows.length) return [];
    const customerIds = [...new Set(rows.map((r) => r.customerId))];
    const proIds = [...new Set(rows.map((r) => r.professionalId).filter((v): v is string => !!v))];
    const apptIds = rows.map((r) => r.surgery?.appointmentId).filter((v): v is string => !!v);
    const [names, pros, appts, entries] = await Promise.all([
      tx.select({ id: customers.id, name: customers.name }).from(customers).where(inArray(customers.id, customerIds)),
      proIds.length ? tx.select({ id: schResources.id, name: schResources.name }).from(schResources).where(inArray(schResources.id, proIds)) : Promise.resolve([]),
      apptIds.length ? tx.select({ id: schAppointments.id, startsAt: schAppointments.startsAt, status: schAppointments.status }).from(schAppointments).where(inArray(schAppointments.id, apptIds)) : Promise.resolve([]),
      this.records.entriesByFormInTx(tx, customerIds, [...sessionForms, 'aesthetics.consent']),
    ]);
    const live = current(entries);
    return rows.map((r) => {
      const mine = live.filter((e) => e.data.caseId === r.id);
      const appt = r.surgery ? appts.find((a) => a.id === r.surgery!.appointmentId) : undefined;
      const items = r.budget?.items ?? [];
      const sum = (who: string) => centsToNumber(items.filter((i) => i.billedBy === who).reduce((s, i) => s + toCents(i.amount), 0));
      return {
        id: r.id,
        customer: names.find((c) => c.id === r.customerId) ?? { id: r.customerId, name: 'Paciente' },
        specialty: r.specialty as SpecialtyKey,
        title: r.title,
        status: r.status,
        stage: r.stage,
        professional: pros.find((p) => p.id === r.professionalId) ?? null,
        plannedSessions: r.plannedSessions,
        doneSessions: mine.filter((e) => sessionForms.includes(e.formKey)).length,
        startedOn: r.startedOn,
        finishedOn: r.finishedOn,
        closeReason: r.closeReason,
        notes: r.notes,
        budget: r.budget ? { ...r.budget, clinicTotal: sum('clinic'), thirdPartyTotal: sum('third_party') } : null,
        surgery: r.surgery
          ? { appointmentId: r.surgery.appointmentId, startsAt: appt?.startsAt.toISOString() ?? r.surgery.startsAt, status: appt?.status ?? 'cancelled', location: r.surgery.location, team: r.surgery.team }
          : null,
        consentAccepted: mine.some((e) => e.formKey === 'aesthetics.consent'),
        createdAt: r.createdAt.toISOString(),
      };
    });
  }
}

/** Confere o registro no conselho exigido pela especialidade (e o RQE, quando pedido). */
function checkCredential(
  pro: { resource: { name: string }; credential?: { council: string; rqe: string | null } },
  requirement: { councils: string[]; message: string },
  needsRqe: boolean,
) {
  const c = pro.credential;
  if (!c || !requirement.councils.includes(c.council)) {
    throw badRequest('CREDENTIAL_REQUIRED', `${requirement.message}. Cadastre o registro de ${pro.resource.name} em Configurações › Especialidades da clínica`);
  }
  if (needsRqe && !c.rqe) throw badRequest('RQE_REQUIRED', `${pro.resource.name} precisa ter o RQE (especialista) cadastrado`);
}

/** Assinatura da tela: confere que é mesmo um PNG antes de guardar. */
function pngFromDataUrl(dataUrl: string): Buffer {
  const buf = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
  const magic = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (buf.length < 64 || magic.some((b, i) => buf[i] !== b)) throw badRequest('INVALID_SIGNATURE', 'Assinatura inválida: assine de novo');
  return buf;
}
