import { companyLogoUrl, CustomersService, ModuleSettingsService, TenancyService, TenantDb } from '@all/core';
import { requestContext } from '@all/module-sdk';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { SchedulingSettings } from '../contracts';
import { schResources, schServiceResources, schServices } from '../db/schema';
import { SchedulingService, type BookingSubjectProvider } from './scheduling.service';
import { addMinutes, utcToLocal } from './time';

const MODULE = 'shared.scheduling';

/**
 * Agendamento online, sem login: o cliente escolhe serviço, profissional e horário pelo
 * endereço público da empresa (/agendar/<slug>). Só funciona se a empresa ativar.
 */
@Injectable()
export class BookingService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly tdb: TenantDb,
    private readonly scheduling: SchedulingService,
    private readonly customers: CustomersService,
    private readonly settings: ModuleSettingsService,
  ) {}

  info(slug: string) {
    return this.withTenant(slug, async (tenant, settings, subject) =>
      this.tdb.run(async (tx) => {
        const [services, resources, links] = await Promise.all([
          tx
            .select({ id: schServices.id, name: schServices.name, category: schServices.category, durationMin: schServices.durationMin, price: schServices.price, description: schServices.description })
            .from(schServices)
            .where(and(eq(schServices.active, true), eq(schServices.online, true)))
            .orderBy(asc(schServices.category), asc(schServices.name)),
          tx
            .select({ id: schResources.id, name: schResources.name, color: schResources.color })
            .from(schResources)
            .where(and(eq(schResources.active, true), eq(schResources.kind, 'professional')))
            .orderBy(asc(schResources.name)),
          // Só vínculos com profissionais (sala ligada ao serviço não diz quem atende).
          tx
            .select({ serviceId: schServiceResources.serviceId, resourceId: schServiceResources.resourceId })
            .from(schServiceResources)
            .innerJoin(schResources, eq(schResources.id, schServiceResources.resourceId))
            .where(eq(schResources.kind, 'professional')),
        ]);
        return {
          // Marca da empresa (Dados da empresa): a página aplica a cor e mostra o logo.
          company: { name: tenant.name, logoUrl: companyLogoUrl(tenant), brandColor: tenant.brandColor },
          maxDays: settings.onlineMaxDays,
          services: services.map((s) => ({ ...s, price: Number(s.price) })),
          professionals: resources.map((r) => ({
            ...r,
            // Serviços que este profissional faz (serviço sem vínculo = todos fazem).
            serviceIds: services.filter((s) => !links.some((l) => l.serviceId === s.id) || links.some((l) => l.serviceId === s.id && l.resourceId === r.id)).map((s) => s.id),
          })),
          // Campos extras de "para quem é" (ex.: o pet), quando o módulo dono está ativo.
          subject: subject && { label: subject.label, fields: subject.fields },
        };
      }),
    );
  }

  availability(slug: string, q: { date: string; serviceIds: string[]; resourceId?: string }) {
    return this.withTenant(slug, async (_tenant, settings) => {
      const today = utcToLocal(new Date()).date;
      const last = utcToLocal(addMinutes(new Date(), settings.onlineMaxDays * 24 * 60)).date;
      if (q.date < today || q.date > last) return [];
      return this.scheduling.availability({ ...q, online: true });
    });
  }

  book(
    slug: string,
    input: {
      name: string;
      phone: string;
      email?: string | null;
      resourceId: string;
      startsAt: Date;
      serviceIds: string[];
      notes?: string | null;
      subjectFields?: Record<string, string> | null;
    },
  ) {
    return this.withTenant(slug, async (_tenant, _settings, subject) => {
      const values = subject ? subjectValues(subject, input.subjectFields ?? {}) : null;
      // O horário escolhido precisa estar livre de verdade (a lista na tela pode estar desatualizada).
      const local = utcToLocal(input.startsAt);
      const [free] = await this.scheduling.availability({ date: local.date, serviceIds: input.serviceIds, resourceId: input.resourceId, online: true });
      if (!free?.slots.includes(local.time)) {
        throw new BadRequestException({ code: 'SLOT_UNAVAILABLE', message: 'Este horário acabou de ser ocupado. Escolha outro.' });
      }

      const customerId = await this.findOrCreateCustomer(input);
      const appointment = await this.tdb.run(async (tx) => {
        // Ex.: acha o pet do cliente pelo nome ou cadastra; se a marcação falhar, nada fica.
        const resolved = subject && values ? await subject.resolve(tx, { customerId, values }) : null;
        return this.scheduling.createInTx(
          tx,
          { customerId, resourceId: input.resourceId, startsAt: input.startsAt, serviceIds: input.serviceIds, notes: input.notes ?? null, subject: resolved },
          { source: 'online', online: true },
        );
      });
      return {
        id: appointment.id,
        startsAt: appointment.startsAt,
        professional: appointment.resourceName,
        services: appointment.services.map((s) => s.name),
        subject: appointment.subject?.label ?? null,
        total: appointment.total,
      };
    });
  }

  /** Reaproveita o cadastro pelo celular; sem cadastro, cria um com nome, celular e e-mail. */
  private async findOrCreateCustomer(input: { name: string; phone: string; email?: string | null }) {
    const duplicates = await this.customers.findDuplicates({ phone: input.phone });
    const byPhone = duplicates.find((d) => d.matchedOn.includes('phone'));
    if (byPhone) return byPhone.id;
    try {
      const created = await this.customers.create({ type: 'person', name: input.name, phone: input.phone, email: input.email || null }, { allowDuplicates: true });
      return created.id;
    } catch (err) {
      if ((err as { response?: { code?: string } }).response?.code === 'VALIDATION') {
        throw new BadRequestException({ code: 'VALIDATION', message: 'Confira o celular (com DDD) e o e-mail' });
      }
      throw err;
    }
  }

  /** Resolve a empresa pelo slug e roda no escopo dela, sem usuário logado. */
  private async withTenant<T>(
    slug: string,
    fn: (
      tenant: { id: string; name: string; slug: string | null; logoFileId: string | null; brandColor: string | null },
      settings: SchedulingSettings,
      subject: BookingSubjectProvider | null,
    ) => Promise<T>,
  ): Promise<T> {
    const tenant = await this.tenancy.tenantBySlug(slug);
    if (!tenant) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Empresa não encontrada' });
    return requestContext.run({ tenantId: tenant.id, modules: new Set([MODULE]) }, async () => {
      const { settings, active } = await this.tdb.run(async (tx) => {
        const rows = await tx.execute<{ key: string }>(sql`select module_key as key from tenant_modules where tenant_id = ${tenant.id} and status = 'active'`).then((r) => r.rows);
        const active = new Set(rows.map((r) => r.key));
        return { active, settings: active.has(MODULE) ? await this.settings.getInTx<SchedulingSettings>(tx, MODULE) : null };
      });
      if (!settings?.onlineBooking) throw new NotFoundException({ code: 'BOOKING_DISABLED', message: 'Esta empresa não está recebendo agendamentos online' });
      return fn(tenant, settings, this.scheduling.bookingSubjectFor(active));
    });
  }
}

/** Confere os campos extras pedidos pela página (obrigatórios, opções válidas, tamanho). */
function subjectValues(subject: BookingSubjectProvider, raw: Record<string, string>) {
  const values: Record<string, string> = {};
  for (const f of subject.fields) {
    const v = (raw[f.key] ?? '').trim();
    if (f.required && !v) throw new BadRequestException({ code: 'VALIDATION', message: `Informe: ${f.label}` });
    if (v && f.options && !f.options.some((o) => o.value === v)) throw new BadRequestException({ code: 'VALIDATION', message: `Escolha uma opção válida em: ${f.label}` });
    if (v && f.maxLength && v.length > f.maxLength) throw new BadRequestException({ code: 'VALIDATION', message: `${f.label}: no máximo ${f.maxLength} caracteres` });
    values[f.key] = v;
  }
  return values;
}
