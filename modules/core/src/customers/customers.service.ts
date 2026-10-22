import type { Tx } from '@all/db';
import { requestContext } from '@all/module-sdk';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, count, desc, eq, ilike, ne, or, sql, type SQL } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { TenantDb } from '../db/tenant-db';
import { isValidCnpj, isValidCpf, normalizePhone, onlyDigits } from './br';
import { CustomerDataRegistry } from './customer-data.registry';
import {
  customerConsents,
  customers,
  customerTimeline,
  customFieldDefinitions,
  type Address,
  type ConsentPurpose,
} from './schema';

export interface CustomerInput {
  type: 'person' | 'company';
  name: string;
  document?: string | null;
  email?: string | null;
  phone?: string | null;
  birthDate?: string | null;
  address?: Address | null;
  notes?: string | null;
  customFields?: Record<string, unknown>;
}

export interface TimelineEntry {
  customerId: string;
  moduleKey: string;
  type: string;
  title: string;
  entity?: string;
  entityId?: string;
}

type CustomerRow = typeof customers.$inferSelect;

@Injectable()
export class CustomersService {
  constructor(
    private readonly tdb: TenantDb,
    private readonly audit: AuditService,
    private readonly dataRegistry: CustomerDataRegistry,
  ) {}

  list(opts: { q?: string; limit: number; offset: number }) {
    return this.tdb.run(async (tx) => {
      const where = searchFilter(opts.q);
      const [items, totals] = await Promise.all([
        tx.select().from(customers).where(where).orderBy(asc(customers.name)).limit(opts.limit).offset(opts.offset),
        tx.select({ total: count() }).from(customers).where(where),
      ]);
      return { items, total: totals[0]?.total ?? 0 };
    });
  }

  get(id: string) {
    return this.tdb.run(async (tx) => {
      const customer = await this.findOrFail(tx, id);
      return { ...customer, consents: await this.currentConsents(tx, id) };
    });
  }

  /** Cadastros parecidos (mesmo documento, e-mail ou telefone) para avisar antes de criar um duplicado. */
  findDuplicates(input: { document?: string | null; email?: string | null; phone?: string | null; excludeId?: string }) {
    // Consulta enquanto o usuário digita: valores incompletos são ignorados, não geram erro.
    const lenient = {
      document: input.document ? onlyDigits(input.document) || null : null,
      email: input.email?.trim().toLowerCase() || null,
      phone: input.phone ? normalizePhone(input.phone) : null,
    };
    return this.tdb.run((tx) => this.duplicatesInTx(tx, lenient, input.excludeId));
  }

  async create(input: CustomerInput, opts: { allowDuplicates?: boolean } = {}) {
    const { tenantId } = requestContext.requireTenant();
    const data = normalize(input);

    return this.tdb.run(async (tx) => {
      data.customFields = await this.validateCustomFields(tx, input.customFields ?? {});
      await this.assertNoDuplicates(tx, data, undefined, opts.allowDuplicates);

      const [customer] = await tx.insert(customers).values({ ...data, tenantId }).returning();
      await this.addTimeline(tx, { customerId: customer!.id, moduleKey: 'core.customers', type: 'customer.created', title: 'Cadastro criado' });
      await this.audit.log(tx, { action: 'customer.created', entity: 'customer', entityId: customer!.id });
      return customer!;
    });
  }

  update(id: string, input: Partial<CustomerInput>, opts: { allowDuplicates?: boolean } = {}) {
    return this.tdb.run(async (tx) => {
      const current = await this.findOrFail(tx, id);
      if (current.anonymizedAt) throw new BadRequestException({ code: 'ANONYMIZED', message: 'Cadastro anonimizado não pode ser editado' });

      const { customFields, ...fields } = input;
      const data = normalize({
        type: current.type,
        document: current.document,
        email: current.email,
        phone: current.phone,
        ...fields,
      });
      const set = {
        ...data,
        customFields: await this.validateCustomFields(tx, customFields ?? current.customFields),
      };
      await this.assertNoDuplicates(tx, data, id, opts.allowDuplicates);

      const [customer] = await tx.update(customers).set(set).where(eq(customers.id, id)).returning();
      await this.audit.log(tx, { action: 'customer.updated', entity: 'customer', entityId: id, data: { fields: Object.keys(input) } });
      return customer!;
    });
  }

  setConsent(id: string, purpose: ConsentPurpose, granted: boolean, source: string) {
    const { tenantId, userId } = requestContext.requireTenant();
    return this.tdb.run(async (tx) => {
      await this.findOrFail(tx, id);
      await tx.insert(customerConsents).values({
        tenantId,
        customerId: id,
        purpose,
        granted,
        legalBasis: purpose === 'service_notifications' ? 'contract' : 'consent',
        source,
        userId,
      });
      await this.addTimeline(tx, {
        customerId: id,
        moduleKey: 'core.customers',
        type: 'consent.changed',
        title: `${granted ? 'Autorizou' : 'Revogou'}: ${consentLabels[purpose]}`,
      });
      return this.currentConsents(tx, id);
    });
  }

  /**
   * Avisos sobre o serviço contratado (OS pronta, pagamento…) usam a base legal "execução de
   * contrato" e valem até o cliente pedir para não receber; marketing exige autorização explícita.
   */
  async canContact(tx: Tx, customerId: string, purpose: ConsentPurpose): Promise<boolean> {
    const [last] = await tx
      .select({ granted: customerConsents.granted })
      .from(customerConsents)
      .where(and(eq(customerConsents.customerId, customerId), eq(customerConsents.purpose, purpose)))
      .orderBy(desc(customerConsents.createdAt))
      .limit(1);
    return last ? last.granted : purpose === 'service_notifications';
  }

  timeline(id: string, limit = 100) {
    return this.tdb.run((tx) =>
      tx
        .select()
        .from(customerTimeline)
        .where(eq(customerTimeline.customerId, id))
        .orderBy(desc(customerTimeline.createdAt))
        .limit(limit),
    );
  }

  /** Ponto de extensão: qualquer módulo registra eventos na linha do tempo do cliente. */
  async addTimeline(tx: Tx, entry: TimelineEntry) {
    const { tenantId, userId } = requestContext.requireTenant();
    await tx.insert(customerTimeline).values({ ...entry, tenantId, userId: userId ?? null });
  }

  /** Nome/contato para outros módulos (ex.: ordem de serviço, notificações). */
  async findInTx(tx: Tx, id: string): Promise<CustomerRow | undefined> {
    const [row] = await tx.select().from(customers).where(eq(customers.id, id));
    return row;
  }

  /** Direito de acesso (LGPD art. 18): tudo o que o tenant guarda sobre o cliente, de todos os módulos ativos. */
  exportData(id: string) {
    const ctx = requestContext.require();
    return this.tdb.run(async (tx) => {
      const customer = await this.findOrFail(tx, id);
      const consents = await tx.select().from(customerConsents).where(eq(customerConsents.customerId, id)).orderBy(customerConsents.createdAt);
      const timeline = await tx.select().from(customerTimeline).where(eq(customerTimeline.customerId, id)).orderBy(customerTimeline.createdAt);
      const modules: Record<string, unknown> = {};
      for (const provider of this.dataRegistry.for(ctx.modules ?? new Set())) {
        modules[provider.moduleKey] = await provider.export(tx, id);
      }
      await this.audit.log(tx, { action: 'customer.exported', entity: 'customer', entityId: id });
      return { exportedAt: new Date().toISOString(), customer, consents, timeline, modules };
    });
  }

  /** Direito de eliminação: apaga dados pessoais e mantém o registro (e os valores) para fins legais. */
  anonymize(id: string) {
    const ctx = requestContext.require();
    return this.tdb.run(async (tx) => {
      const customer = await this.findOrFail(tx, id);
      if (customer.anonymizedAt) return;
      await tx
        .update(customers)
        .set({
          name: 'Cliente anonimizado',
          document: null,
          email: null,
          phone: null,
          birthDate: null,
          address: null,
          notes: null,
          customFields: {},
          anonymizedAt: new Date(),
        })
        .where(eq(customers.id, id));
      for (const provider of this.dataRegistry.for(ctx.modules ?? new Set())) await provider.anonymize?.(tx, id);
      await this.addTimeline(tx, { customerId: id, moduleKey: 'core.customers', type: 'customer.anonymized', title: 'Dados pessoais anonimizados' });
      await this.audit.log(tx, { action: 'customer.anonymized', entity: 'customer', entityId: id });
    });
  }

  private async findOrFail(tx: Tx, id: string) {
    const row = await this.findInTx(tx, id);
    if (!row) throw new NotFoundException({ code: 'CUSTOMER_NOT_FOUND', message: 'Cliente não encontrado' });
    return row;
  }

  private async currentConsents(tx: Tx, customerId: string) {
    const rows = await tx
      .selectDistinctOn([customerConsents.purpose])
      .from(customerConsents)
      .where(eq(customerConsents.customerId, customerId))
      .orderBy(customerConsents.purpose, desc(customerConsents.createdAt));
    return Object.fromEntries(rows.map((r) => [r.purpose, { granted: r.granted, at: r.createdAt, source: r.source }]));
  }

  private async duplicatesInTx(tx: Tx, data: Pick<Partial<CustomerInput>, 'document' | 'email' | 'phone'>, excludeId?: string) {
    const conditions = [
      data.document ? eq(customers.document, data.document) : undefined,
      data.email ? eq(customers.email, data.email) : undefined,
      data.phone ? eq(customers.phone, data.phone) : undefined,
    ].filter((c): c is SQL => !!c);
    if (!conditions.length) return [];

    const rows = await tx
      .select({ id: customers.id, name: customers.name, document: customers.document, email: customers.email, phone: customers.phone })
      .from(customers)
      .where(and(or(...conditions), excludeId ? ne(customers.id, excludeId) : undefined))
      .limit(5);
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      matchedOn: [
        data.document && r.document === data.document && 'document',
        data.email && r.email === data.email && 'email',
        data.phone && r.phone === data.phone && 'phone',
      ].filter(Boolean) as string[],
    }));
  }

  private async assertNoDuplicates(tx: Tx, data: Partial<CustomerInput>, excludeId: string | undefined, allow?: boolean) {
    const duplicates = await this.duplicatesInTx(tx, data, excludeId);
    // Documento igual nunca: é a mesma pessoa/empresa. E-mail ou telefone igual pode ser legítimo (família, sócios).
    if (duplicates.some((d) => d.matchedOn.includes('document'))) {
      throw new ConflictException({ code: 'DUPLICATE_DOCUMENT', message: 'Já existe um cliente com este CPF/CNPJ', duplicates });
    }
    if (duplicates.length && !allow) {
      throw new ConflictException({ code: 'POSSIBLE_DUPLICATE', message: 'Há cadastros com o mesmo e-mail ou telefone', duplicates });
    }
  }

  private async validateCustomFields(tx: Tx, values: Record<string, unknown>) {
    const defs = await tx.select().from(customFieldDefinitions).where(eq(customFieldDefinitions.entity, 'customer'));
    const result: Record<string, unknown> = {};
    const errors: string[] = [];

    for (const def of defs) {
      const raw = values[def.key];
      const empty = raw === undefined || raw === null || raw === '';
      if (empty) {
        if (def.required) errors.push(`${def.label}: obrigatório`);
        continue;
      }
      switch (def.type) {
        case 'text':
          result[def.key] = String(raw).slice(0, 1000);
          break;
        case 'number':
          if (Number.isFinite(Number(raw))) result[def.key] = Number(raw);
          else errors.push(`${def.label}: deve ser um número`);
          break;
        case 'date':
          if (/^\d{4}-\d{2}-\d{2}$/.test(String(raw))) result[def.key] = String(raw);
          else errors.push(`${def.label}: data inválida`);
          break;
        case 'boolean':
          result[def.key] = raw === true || raw === 'true';
          break;
        case 'select':
          if (def.options?.includes(String(raw))) result[def.key] = String(raw);
          else errors.push(`${def.label}: opção inválida`);
          break;
      }
    }
    if (errors.length) throw new BadRequestException({ code: 'VALIDATION', message: errors });
    return result;
  }
}

export const consentLabels: Record<ConsentPurpose, string> = {
  service_notifications: 'avisos sobre os serviços contratados',
  marketing_email: 'ofertas por e-mail',
  marketing_whatsapp: 'ofertas por WhatsApp',
};

/** Normaliza documento, e-mail e telefone; recusa CPF/CNPJ ou telefone inválidos. */
function normalize<T extends Partial<CustomerInput>>(input: T): T {
  const errors: string[] = [];
  const document = input.document ? onlyDigits(input.document) : null;
  if (document && input.type === 'person' && !isValidCpf(document)) errors.push('document: CPF inválido');
  if (document && input.type === 'company' && !isValidCnpj(document)) errors.push('document: CNPJ inválido');
  const phone = input.phone ? normalizePhone(input.phone) : null;
  if (input.phone && !phone) errors.push('phone: telefone inválido (use DDD + número)');
  if (errors.length) throw new BadRequestException({ code: 'VALIDATION', message: errors });

  return { ...input, document, phone, email: input.email ? input.email.trim().toLowerCase() : null };
}

function searchFilter(q?: string): SQL | undefined {
  const term = q?.trim();
  if (!term) return undefined;
  const like = `%${term.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  const digits = onlyDigits(term);
  return or(
    ilike(customers.name, like),
    ilike(customers.email, like),
    digits.length >= 3 ? sql`${customers.document} like ${`%${digits}%`}` : undefined,
    digits.length >= 3 ? sql`${customers.phone} like ${`%${digits}%`}` : undefined,
  );
}
