import { companyLogoUrl, ModuleSettingsService, TenancyService, TenantDb } from '@all/core';
import type { Tx } from '@all/db';
import { requestContext } from '@all/module-sdk';
import { BadRequestException, HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { and, count, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import { estimateInstallment, LEAD_CONSENT_VERSION, leadConsentText, openLeadStatuses, UTM_KEYS, type PublicLeadInput, type PublicSimulator } from '../../contracts';
import { consLeadEvents, consLeads, consReferrers } from '../../db/schema';
import type { ConsortiumSettings } from '../../manifest';
import { brl, MODULE } from '../shared';
import { LeadsService } from './leads.service';
import { cleanUtm, ipHashOf, normalizePhone, planProfilesInTx } from './shared';

/** Limites do simulador público (por empresa). */
const MAX_PER_IP_HOUR = 10;
const MAX_PER_PHONE_DAY = 3;
/** Formulário enviado antes disto (desde que abriu) é de robô. */
const MIN_FILL_MS = 3000;

type Tenant = NonNullable<Awaited<ReturnType<TenancyService['tenantBySlug']>>>;

/**
 * Simulador público com a marca da empresa (/consorcio/<slug>): o visitante escolhe tipo, crédito
 * e prazo, vê a parcela estimada pelos planos cadastrados e deixa o contato com o aceite (LGPD).
 * Sem login: limite por IP e por telefone, campo-armadilha e tempo mínimo de preenchimento.
 */
@Injectable()
export class PublicSimulatorService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly tdb: TenantDb,
    private readonly settings: ModuleSettingsService,
    private readonly leads: LeadsService,
  ) {}

  info(slug: string, ref?: string): Promise<PublicSimulator> {
    return this.withTenant(slug, (tenant, settings) =>
      this.tdb.run(async (tx) => {
        const profiles = await planProfilesInTx(tx);
        const lines = [...new Set(profiles.map((p) => p.assetType))].map((assetType) => {
          const same = profiles.filter((p) => p.assetType === assetType);
          return {
            assetType,
            minCredit: Math.min(...same.map((p) => p.minCredit)),
            maxCredit: Math.max(...same.map((p) => p.maxCredit)),
            terms: [...new Set(same.map((p) => p.termMonths))].sort((a, b) => a - b),
          };
        });
        const referrer = ref ? await this.referrerInTx(tx, ref) : null;
        return {
          company: { name: tenant.name, logoUrl: companyLogoUrl(tenant), brandColor: tenant.brandColor },
          lines,
          profiles,
          consent: { version: LEAD_CONSENT_VERSION, text: this.consent(tenant, settings) },
          referrer: referrer ? { name: referrer.name.split(' ')[0] ?? referrer.name, reward: settings.referralReward || null } : null,
        };
      }),
    );
  }

  /** Simulação com contato: vira lead (ou atualiza o lead em aberto do mesmo telefone nas últimas 24 h). */
  submit(slug: string, input: PublicLeadInput, ip: string | undefined): Promise<{ ok: true; estimate?: { min: number; max: number } | null }> {
    // Robô (campo escondido preenchido ou envio instantâneo): responde como se tivesse dado certo.
    if (input.website || (input.startedAt && Date.now() - input.startedAt < MIN_FILL_MS)) return Promise.resolve({ ok: true });
    const phone = normalizePhone(input.phone);
    if (!phone) throw new BadRequestException({ code: 'INVALID_PHONE', message: 'Informe o celular com DDD' });

    return this.withTenant(slug, (tenant, settings) =>
      this.tdb.run(async (tx) => {
        const { tenantId } = requestContext.requireTenant();
        if (input.consentVersion !== LEAD_CONSENT_VERSION) {
          throw new BadRequestException({ code: 'CONSENT_OUTDATED', message: 'O texto de autorização mudou. Recarregue a página e confira antes de enviar.' });
        }
        const ipHash = ipHashOf(tenantId, ip);
        await this.checkLimits(tx, ipHash, phone);
        const estimate = estimateInstallment(await planProfilesInTx(tx), input.assetType, input.creditValue, input.termMonths);
        const consent = { version: LEAD_CONSENT_VERSION, text: this.consent(tenant, settings), acceptedAt: new Date().toISOString() };
        const utm = cleanUtm(input.utm, UTM_KEYS);

        // Mesma pessoa simulando de novo: atualiza o lead em aberto em vez de duplicar.
        const [open] = await tx
          .select()
          .from(consLeads)
          .where(and(eq(consLeads.phone, phone), inArray(consLeads.status, openLeadStatuses), gt(consLeads.createdAt, sql`now() - interval '1 day'`)))
          .orderBy(desc(consLeads.createdAt))
          .limit(1)
          .for('update');
        if (open) {
          await tx
            .update(consLeads)
            .set({
              assetType: input.assetType,
              creditValue: input.creditValue.toFixed(2),
              termMonths: input.termMonths,
              estimatedInstallment: estimate ? estimate.min.toFixed(2) : null,
              consent,
            })
            .where(eq(consLeads.id, open.id));
          await tx.insert(consLeadEvents).values({
            tenantId,
            leadId: open.id,
            kind: 'simulation',
            text: `Nova simulação no site: ${brl.format(input.creditValue)} em ${input.termMonths} meses`,
            data: { assetType: input.assetType, creditValue: input.creditValue, termMonths: input.termMonths, utm },
            userId: null,
          });
          return { ok: true as const, estimate: estimate ? { min: estimate.min, max: estimate.max } : null };
        }

        const referrer = input.ref ? await this.referrerInTx(tx, input.ref) : null;
        await this.leads.createInTx(tx, tenantId, {
          name: input.name,
          phone,
          email: input.email,
          city: input.city,
          state: input.state,
          assetType: input.assetType,
          creditValue: input.creditValue,
          termMonths: input.termMonths,
          source: referrer ? 'referral' : 'simulator',
          utm,
          referrerId: referrer?.id ?? null,
          contactBasis: 'form_consent',
          consent,
          ipHash,
          createdBy: null,
        });
        return { ok: true as const, estimate: estimate ? { min: estimate.min, max: estimate.max } : null };
      }),
    );
  }

  private consent(tenant: Tenant, settings: ConsortiumSettings) {
    return leadConsentText({ company: tenant.name, retentionMonths: settings.leadRetentionMonths, privacyEmail: settings.privacyEmail || null });
  }

  private async referrerInTx(tx: Tx, code: string) {
    const [r] = await tx
      .select()
      .from(consReferrers)
      .where(and(eq(consReferrers.code, code.trim().toLowerCase()), eq(consReferrers.active, true)));
    return r ?? null;
  }

  private async checkLimits(tx: Tx, ipHash: string | null, phone: string) {
    const hourAgo = new Date(Date.now() - 60 * 60_000);
    const dayAgo = new Date(Date.now() - 24 * 60 * 60_000);
    if (ipHash) {
      const [{ n }] = (await tx.select({ n: count() }).from(consLeads).where(and(eq(consLeads.ipHash, ipHash), gt(consLeads.createdAt, hourAgo)))) as [{ n: number }];
      if (n >= MAX_PER_IP_HOUR) throw tooMany();
    }
    const [{ n }] = (await tx
      .select({ n: count() })
      .from(consLeadEvents)
      .innerJoin(consLeads, eq(consLeads.id, consLeadEvents.leadId))
      .where(and(eq(consLeads.phone, phone), sql`${consLeadEvents.kind} in ('created', 'simulation')`, gt(consLeadEvents.createdAt, dayAgo)))) as [{ n: number }];
    if (n >= MAX_PER_PHONE_DAY) throw tooMany();
  }

  /** Resolve a empresa pelo slug e roda no escopo dela, sem usuário logado. */
  private async withTenant<T>(slug: string, fn: (tenant: Tenant, settings: ConsortiumSettings) => Promise<T>): Promise<T> {
    const ip = requestContext.get().ip;
    const tenant = await this.tenancy.tenantBySlug(slug);
    if (!tenant) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Empresa não encontrada' });
    return requestContext.run({ tenantId: tenant.id, modules: new Set([MODULE]), ip }, async () => {
      const settings = await this.tdb.run(async (tx) => {
        const res = await tx.execute<{ ok: boolean }>(sql`select exists (select 1 from tenant_modules where tenant_id = ${tenant.id} and module_key = ${MODULE} and status = 'active') as ok`);
        return res.rows[0]?.ok ? this.settings.getInTx<ConsortiumSettings>(tx, MODULE) : null;
      });
      if (!settings?.publicSimulator) throw new NotFoundException({ code: 'SIMULATOR_DISABLED', message: 'Esta empresa não está com o simulador público ativo' });
      return fn(tenant, settings);
    });
  }
}

const tooMany = () => new HttpException({ code: 'TOO_MANY_REQUESTS', message: 'Muitas simulações seguidas. Tente de novo mais tarde.' }, HttpStatus.TOO_MANY_REQUESTS);
