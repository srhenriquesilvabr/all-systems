import { AuditService, CoreConfig, OutboxHandlers, OutboxService, SecretBox, TenantDb } from '@all/core';
import type { Tx } from '@all/db';
import { requestContext } from '@all/module-sdk';
import { ConflictException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import type { ChannelInput, LeadChannel } from '../../contracts';
import { consLeadChannels, consLeadRoutes, consLeads } from '../../db/schema';
import { badRequest } from '../shared';
import { assetFromAnswers, fromGoogleLead, metaLeadsConfig, MetaLeadsAdapter, metaNotices, sameKey, simulatedLead, validMetaSignature, type AdLead, type MetaLeadNotice } from './ads';
import { LeadsService } from './leads.service';
import { META_LEAD_RECEIVED, normalizePhone } from './shared';

type ChannelRow = typeof consLeadChannels.$inferSelect;
type MetaLeadEvent = MetaLeadNotice & { channelId: string };

/**
 * Canais de anúncio (Meta Lead Ads e formulário de lead do Google Ads): cadastro com segredos
 * cifrados, webhooks e a criação do lead no funil. O sistema só recebe quem preencheu o formulário
 * do anúncio; públicos e segmentação são configurados nas próprias plataformas.
 */
@Injectable()
export class LeadChannelsService implements OnModuleInit {
  private readonly logger = new Logger('ConsortiumLeadChannels');

  constructor(
    private readonly tdb: TenantDb,
    private readonly secrets: SecretBox,
    private readonly outbox: OutboxService,
    private readonly handlers: OutboxHandlers,
    private readonly audit: AuditService,
    private readonly config: CoreConfig,
    private readonly leads: LeadsService,
    private readonly meta: MetaLeadsAdapter,
  ) {}

  onModuleInit() {
    // A leitura do lead na Graph API roda no worker: o webhook responde rápido e a Meta não reenvia.
    this.handlers.on<MetaLeadEvent>(META_LEAD_RECEIVED, 'consortium.lead.meta', (e) => this.tdb.run((tx) => this.receiveMetaInTx(tx, e.payload)).then(() => undefined));
  }

  list(): Promise<LeadChannel[]> {
    return this.tdb.run(async (tx) => {
      const rows = await tx
        .select({ c: consLeadChannels, leads: sql<number>`(select count(*) from cons_leads l where l.channel_id = "cons_lead_channels"."id")`.mapWith(Number) })
        .from(consLeadChannels)
        .orderBy(asc(consLeadChannels.createdAt));
      return rows.map(({ c, leads }) => this.toChannel(c, leads));
    });
  }

  save(id: string | null, input: ChannelInput): Promise<LeadChannel> {
    const { tenantId } = requestContext.require();
    return this.tdb.run(async (tx) => {
      const current = id ? await this.channelOrFail(tx, id) : null;
      if (current && current.kind !== input.kind) throw badRequest('CHANNEL_KIND', 'Não é possível trocar o tipo do canal');
      if (input.kind === 'google' && !input.webhookKey && !current?.webhookKeyEnc) throw badRequest('KEY_REQUIRED', 'Informe a chave do webhook (a mesma do formulário no Google Ads)');
      if (input.kind === 'meta' && input.mode === 'api' && !input.accessToken && !current?.accessTokenEnc) throw badRequest('TOKEN_REQUIRED', 'Informe o token de acesso da página');
      const values = {
        kind: input.kind,
        name: input.name,
        mode: input.mode,
        pageId: input.kind === 'meta' ? input.pageId : null,
        formIds: input.kind === 'meta' ? input.formIds : [],
        assetType: input.assetType ?? null,
        active: input.active,
        // Segredo em branco = mantém o que já estava.
        ...(input.accessToken ? { accessTokenEnc: this.secrets.encrypt(input.accessToken) } : {}),
        ...(input.webhookKey ? { webhookKeyEnc: this.secrets.encrypt(input.webhookKey) } : {}),
      };
      const row = current
        ? (await tx.update(consLeadChannels).set(values).where(eq(consLeadChannels.id, current.id)).returning())[0]!
        : (await tx.insert(consLeadChannels).values({ ...values, tenantId }).returning())[0]!;
      // Rota do webhook (sem RLS): a mesma página do Facebook não pode estar em duas empresas.
      const pageId = row.kind === 'meta' && row.active ? row.pageId : null;
      if (pageId) {
        const [taken] = await this.tdb.db.select({ channelId: consLeadRoutes.channelId }).from(consLeadRoutes).where(eq(consLeadRoutes.pageId, pageId));
        if (taken && taken.channelId !== row.id) throw new ConflictException({ code: 'PAGE_IN_USE', message: 'Esta página do Facebook já está ligada a outro canal' });
      }
      await tx
        .insert(consLeadRoutes)
        .values({ channelId: row.id, tenantId, pageId })
        .onConflictDoUpdate({ target: consLeadRoutes.channelId, set: { pageId } });
      await this.audit.log(tx, { action: current ? 'consortium.lead_channel.updated' : 'consortium.lead_channel.created', entity: 'cons_lead_channel', entityId: row.id, data: { kind: row.kind, mode: row.mode } });
      return this.toChannel(row, 0);
    });
  }

  /** Lead de teste pelo mesmo caminho do webhook (dados fictícios). Meta só no modo simulado. */
  test(id: string): Promise<{ leadId: string | null }> {
    return this.tdb.run(async (tx) => {
      const c = await this.channelOrFail(tx, id);
      if (!c.active) throw badRequest('CHANNEL_INACTIVE', 'Canal inativo');
      const testId = `TESTE-${randomBytes(6).toString('hex')}`;
      if (c.kind === 'meta') {
        if (c.mode !== 'simulated') throw badRequest('TEST_SIMULATED_ONLY', 'No modo API, use a ferramenta de teste de leads da Meta para enviar um lead de verdade');
        const leadId = await this.receiveMetaInTx(tx, { channelId: c.id, pageId: c.pageId ?? '', leadgenId: testId, formId: c.formIds[0] ?? null, adId: null, createdTime: null });
        return { leadId };
      }
      const lead = simulatedLead(testId);
      const leadId = await this.createFromAdInTx(tx, c, { ...lead, campaign: 'Teste do formulário (Google Ads)' }, 'google');
      return { leadId };
    });
  }

  // ---- Webhooks ------------------------------------------------------------------------------

  /** Verificação do webhook pela Meta (hub.challenge). */
  verifyMeta(mode: string | undefined, token: string | undefined, challenge: string | undefined) {
    const { verifyToken } = metaLeadsConfig();
    if (mode !== 'subscribe' || !verifyToken || !token || !sameKey(token, verifyToken)) return null;
    return challenge ?? '';
  }

  /**
   * Webhook da Meta (um para o app inteiro): valida a assinatura, descobre a empresa pela página e
   * publica um evento por lead; a leitura dos dados (Graph API) acontece no worker.
   */
  async receiveMetaWebhook(raw: Buffer, signature: string | undefined, body: unknown): Promise<{ ok: boolean; reason?: 'config' | 'signature'; queued: number }> {
    const { appSecret } = metaLeadsConfig();
    if (!appSecret) return { ok: false, reason: 'config', queued: 0 };
    if (!validMetaSignature(raw, signature, appSecret)) return { ok: false, reason: 'signature', queued: 0 };
    let queued = 0;
    for (const notice of metaNotices(body)) {
      const [route] = await this.tdb.db.select().from(consLeadRoutes).where(eq(consLeadRoutes.pageId, notice.pageId));
      if (!route) {
        this.logger.warn(`Lead do Meta para página não ligada: ${notice.pageId}`);
        continue;
      }
      const published = await requestContext.run({ tenantId: route.tenantId }, () =>
        this.tdb.run(async (tx) => {
          const [c] = await tx.select().from(consLeadChannels).where(eq(consLeadChannels.id, route.channelId));
          if (!c || !c.active || (c.formIds.length && notice.formId && !c.formIds.includes(notice.formId))) return false;
          // A Meta reenvia notificações: lead já recebido não é publicado de novo.
          if (await this.alreadyReceived(tx, 'meta', notice.leadgenId)) return false;
          await this.outbox.publish(tx, META_LEAD_RECEIVED, { ...notice, channelId: c.id });
          return true;
        }),
      );
      if (published) queued++;
    }
    return { ok: true, queued };
  }

  /** Webhook do formulário de lead do Google Ads: canal no endereço, chave (`google_key`) no corpo. */
  async receiveGoogleWebhook(channelId: string, body: Record<string, unknown>): Promise<{ ok: boolean; reason?: 'unknown' | 'key' | 'invalid'; created?: boolean }> {
    const [route] = await this.tdb.db.select().from(consLeadRoutes).where(eq(consLeadRoutes.channelId, channelId));
    if (!route) return { ok: false, reason: 'unknown' };
    return requestContext.run({ tenantId: route.tenantId }, () =>
      this.tdb.run(async (tx) => {
        const [c] = await tx.select().from(consLeadChannels).where(eq(consLeadChannels.id, channelId));
        if (!c || c.kind !== 'google' || !c.active) return { ok: false as const, reason: 'unknown' as const };
        const key = c.webhookKeyEnc ? this.secrets.decrypt(c.webhookKeyEnc) : '';
        if (!key || typeof body.google_key !== 'string' || !sameKey(body.google_key, key)) return { ok: false as const, reason: 'key' as const };
        const lead = fromGoogleLead(body);
        if (!lead) return { ok: false as const, reason: 'invalid' as const };
        if (await this.alreadyReceived(tx, 'google', lead.externalId)) return { ok: true as const, created: false };
        await this.createFromAdInTx(tx, c, lead, 'google');
        return { ok: true as const, created: true };
      }),
    );
  }

  // ---- internos ------------------------------------------------------------------------------

  /** Evento do worker (ou teste simulado): lê o lead na Meta e cria no funil. */
  private async receiveMetaInTx(tx: Tx, e: MetaLeadEvent): Promise<string | null> {
    const [c] = await tx.select().from(consLeadChannels).where(eq(consLeadChannels.id, e.channelId));
    if (!c || !c.active) return null;
    if (await this.alreadyReceived(tx, 'meta', e.leadgenId)) return null;
    const token = c.accessTokenEnc ? this.secrets.decrypt(c.accessTokenEnc) : null;
    const lead = await this.meta.fetch(c.mode, e, token);
    return this.createFromAdInTx(tx, c, lead, 'meta');
  }

  private async createFromAdInTx(tx: Tx, c: ChannelRow, ad: AdLead, source: 'meta' | 'google'): Promise<string> {
    const extra = Object.entries(ad.extra).map(([k, v]) => `${k}: ${v}`);
    const lead = await this.leads.createInTx(tx, c.tenantId, {
      name: ad.name.slice(0, 120),
      phone: normalizePhone(ad.phone),
      email: ad.email && /^[^\s@]+@[^\s@]+$/.test(ad.email) ? ad.email.slice(0, 254) : null,
      city: ad.city?.slice(0, 80) ?? null,
      state: ad.state && /^[A-Za-z]{2}$/.test(ad.state) ? ad.state.toUpperCase() : null,
      assetType: c.assetType ?? assetFromAnswers(ad.extra),
      source,
      campaign: ad.campaign ?? c.name,
      formId: ad.formId,
      adId: ad.adId,
      externalId: ad.externalId,
      channelId: c.id,
      // Quem preenche o formulário do anúncio aceita os termos da plataforma e pede o contato.
      contactBasis: 'form_consent',
      notes: [ad.test ? 'Lead de teste' : null, extra.length ? `Respostas do formulário — ${extra.join('; ')}` : null].filter(Boolean).join('\n') || null,
      createdBy: null,
    });
    await tx.update(consLeadChannels).set({ lastLeadAt: new Date() }).where(eq(consLeadChannels.id, c.id));
    return lead.id;
  }

  private async alreadyReceived(tx: Tx, source: 'meta' | 'google', externalId: string) {
    const [l] = await tx.select({ id: consLeads.id }).from(consLeads).where(and(eq(consLeads.source, source), eq(consLeads.externalId, externalId)));
    return !!l;
  }

  private async channelOrFail(tx: Tx, id: string) {
    const [c] = await tx.select().from(consLeadChannels).where(eq(consLeadChannels.id, id)).for('update');
    if (!c) throw new NotFoundException({ code: 'CHANNEL_NOT_FOUND', message: 'Canal não encontrado' });
    return c;
  }

  private toChannel(c: ChannelRow, leads: number): LeadChannel {
    const api = process.env.PUBLIC_API_URL ?? this.config.adminUrl.replace(/:5173$/, ':3000');
    return {
      id: c.id,
      kind: c.kind,
      name: c.name,
      mode: c.mode,
      pageId: c.pageId,
      formIds: c.formIds,
      hasAccessToken: !!c.accessTokenEnc,
      hasWebhookKey: !!c.webhookKeyEnc,
      assetType: c.assetType,
      active: c.active,
      lastLeadAt: c.lastLeadAt?.toISOString() ?? null,
      webhookUrl: c.kind === 'google' ? `${api}/api/public/consortium-leads/google/${c.id}` : `${api}/api/public/consortium-leads/meta`,
      leads,
    };
  }
}
