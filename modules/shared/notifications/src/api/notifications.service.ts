import { AuditService, CustomerDataRegistry, CustomersService, MessageChannels, OutboxHandlers, OutboxService, TenantDb, coreSchema } from '@all/core';
import type { Tx } from '@all/db';
import { ModuleRegistry, requestContext, type NotificationChannel, type NotificationTemplateDef } from '@all/module-sdk';
import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { notifications, notificationTemplates, type NotificationMeta } from '../db/schema';

const DELIVER = 'shared.notifications.deliver';
const WHATSAPP_MODULE = 'integration.whatsapp';

export interface EnqueueInput {
  templateKey: string;
  customerId: string;
  /** Valores das variáveis do template, ex.: { os: { numero: 12 } }. `cliente` e `empresa` são preenchidos aqui. */
  data: Record<string, unknown>;
  related?: { entity: string; id: string };
  /** Restringe os canais (ex.: só WhatsApp num lembrete). Sem isso, todos os disponíveis. */
  channels?: NotificationChannel[];
}

@Injectable()
export class NotificationsService implements OnModuleInit {
  constructor(
    private readonly tdb: TenantDb,
    private readonly registry: ModuleRegistry,
    private readonly customers: CustomersService,
    private readonly outbox: OutboxService,
    private readonly handlers: OutboxHandlers,
    private readonly channels: MessageChannels,
    private readonly audit: AuditService,
    private readonly customerData: CustomerDataRegistry,
  ) {}

  onModuleInit() {
    this.handlers.on<{ notificationId: string }>(DELIVER, 'notifications.send', (e) => this.deliver(e.payload.notificationId));
    this.customerData.register({
      moduleKey: 'shared.notifications',
      export: (tx, customerId) =>
        tx
          .select({ at: notifications.createdAt, channel: notifications.channel, subject: notifications.subject, status: notifications.status, recipient: notifications.recipient })
          .from(notifications)
          .where(eq(notifications.customerId, customerId)),
      anonymize: async (tx, customerId) => {
        await tx
          .update(notifications)
          .set({ recipient: null, body: '[removido a pedido do titular]', actionUrl: null })
          .where(eq(notifications.customerId, customerId));
      },
    });
  }

  /** Templates dos módulos ativos, por canal, já com a personalização do tenant aplicada. */
  templates() {
    const ctx = requestContext.require();
    return this.tdb.run(async (tx) => {
      const overrides = await tx.select().from(notificationTemplates);
      const custom = (key: string, channel: NotificationChannel) => overrides.find((o) => o.key === key && o.channel === channel);
      return this.registry.notificationTemplatesOf(ctx.modules ?? []).map((t) => ({
        key: t.key,
        module: t.module,
        label: t.label,
        variables: [...t.variables, 'cliente.nome', 'empresa.nome'],
        email: t.email && {
          subject: custom(t.key, 'email')?.subject ?? t.email.subject,
          body: custom(t.key, 'email')?.body ?? t.email.body,
          customized: !!custom(t.key, 'email'),
          defaults: t.email,
        },
        whatsapp: t.whatsapp && {
          body: custom(t.key, 'whatsapp')?.body ?? t.whatsapp.body,
          customized: !!custom(t.key, 'whatsapp'),
          defaults: { body: t.whatsapp.body },
          metaTemplate: t.whatsapp.meta?.name ?? null,
          buttons: t.whatsapp.buttons?.map((b) => b.label) ?? [],
        },
      }));
    });
  }

  saveTemplate(key: string, channel: NotificationChannel, input: { subject?: string; body: string }) {
    const ctx = requestContext.require();
    const def = this.registry.notificationTemplatesOf(ctx.modules ?? []).find((t) => t.key === key);
    if (!def?.[channel]) {
      throw new BadRequestException({ code: 'TEMPLATE_NOT_FOUND', message: 'Mensagem inexistente, de módulo não contratado ou sem este canal' });
    }
    if (channel === 'email' && !input.subject) throw new BadRequestException({ code: 'VALIDATION', message: 'Informe o assunto do e-mail' });
    const values = { subject: channel === 'email' ? input.subject! : null, body: input.body, updatedBy: ctx.userId };
    return this.tdb.run(async (tx) => {
      await tx
        .insert(notificationTemplates)
        .values({ tenantId: ctx.tenantId, key, channel, ...values })
        .onConflictDoUpdate({ target: [notificationTemplates.tenantId, notificationTemplates.key, notificationTemplates.channel], set: values });
      await this.audit.log(tx, { action: 'notification.template.updated', entity: 'notification_template', entityId: `${key}:${channel}` });
    });
  }

  resetTemplate(key: string, channel: NotificationChannel) {
    return this.tdb.run(async (tx) => {
      await tx.delete(notificationTemplates).where(and(eq(notificationTemplates.key, key), eq(notificationTemplates.channel, channel)));
      await this.audit.log(tx, { action: 'notification.template.reset', entity: 'notification_template', entityId: `${key}:${channel}` });
    });
  }

  log(opts: { limit: number; customerId?: string; status?: 'manual' | 'queued' | 'sent' | 'failed' | 'skipped'; related?: { entity: string; id: string } }) {
    return this.tdb.run((tx) =>
      tx
        .select()
        .from(notifications)
        .where(
          and(
            opts.customerId ? eq(notifications.customerId, opts.customerId) : undefined,
            opts.status ? eq(notifications.status, opts.status) : undefined,
            opts.related ? and(eq(notifications.relatedEntity, opts.related.entity), eq(notifications.relatedId, opts.related.id)) : undefined,
          ),
        )
        .orderBy(desc(notifications.createdAt))
        .limit(opts.limit),
    );
  }

  /** Mensagem manual (WhatsApp sem API) enviada por alguém da equipe pelo link. */
  markSent(id: string) {
    return this.tdb.run(async (tx) => {
      const [row] = await tx
        .update(notifications)
        .set({ status: 'sent', sentAt: new Date(), detail: null })
        .where(and(eq(notifications.id, id), eq(notifications.status, 'manual')))
        .returning({ id: notifications.id });
      if (!row) throw new NotFoundException({ code: 'NOT_PENDING', message: 'Mensagem não encontrada ou já enviada' });
      await this.audit.log(tx, { action: 'notification.sent_manually', entity: 'notification', entityId: id });
    });
  }

  /**
   * Prepara as mensagens (uma por canal) na transação de quem chama; o envio acontece depois,
   * pelo worker. Se a transação for desfeita, nada sai.
   */
  async enqueueInTx(tx: Tx, input: EnqueueInput): Promise<void> {
    const { tenantId } = requestContext.requireTenant();
    const def = this.registry.notificationTemplate(input.templateKey);
    if (!def) throw new Error(`Template de notificação inexistente: ${input.templateKey}`);

    const customer = await this.customers.findInTx(tx, input.customerId);
    const [tenant] = await tx.select({ name: coreSchema.tenants.name }).from(coreSchema.tenants).where(eq(coreSchema.tenants.id, tenantId));
    const data = { ...input.data, cliente: { nome: customer?.name ?? '' }, empresa: { nome: tenant?.name ?? '' } };
    const optedOut = customer ? !(await this.customers.canContact(tx, customer.id, 'service_notifications')) : false;

    for (const channel of await this.channelsFor(tx, def, input.channels)) {
      const custom = await this.customText(tx, input.templateKey, channel);
      const recipient = channel === 'email' ? customer?.email : customer?.phone;
      const skipReason = !recipient
        ? channel === 'email'
          ? 'Cliente sem e-mail cadastrado'
          : 'Cliente sem telefone cadastrado'
        : optedOut
          ? 'Cliente pediu para não receber avisos'
          : undefined;

      const subject = channel === 'email' ? render(custom?.subject ?? def.email!.subject, data) : def.label;
      const body = render(custom?.body ?? (channel === 'email' ? def.email!.body : def.whatsapp!.body), data);
      const meta: NotificationMeta | null =
        channel === 'whatsapp'
          ? {
              template: def.whatsapp!.meta && { name: def.whatsapp!.meta.name, params: def.whatsapp!.meta.params.map((p) => render(`{{${p}}}`, data)) },
              buttons: def.whatsapp!.buttons?.map((b) => ({ label: b.label, payload: render(b.payload, data) })),
            }
          : null;

      const [row] = await tx
        .insert(notifications)
        .values({
          tenantId,
          customerId: input.customerId,
          channel,
          templateKey: input.templateKey,
          recipient: recipient ?? null,
          subject,
          body,
          meta,
          status: skipReason ? 'skipped' : 'queued',
          detail: skipReason,
          relatedEntity: input.related?.entity,
          relatedId: input.related?.id,
        })
        .returning({ id: notifications.id });
      if (!skipReason) await this.outbox.publish(tx, DELIVER, { notificationId: row!.id });
    }
  }

  private async deliver(notificationId: string) {
    const [row] = await this.tdb.run((tx) => tx.select().from(notifications).where(eq(notifications.id, notificationId)));
    if (!row || row.status !== 'queued' || !row.recipient) return;

    // Se o envio falhar, o erro sobe e o outbox tenta de novo com espera crescente.
    const result = await this.channels.get(row.channel).send({
      tenantId: row.tenantId,
      to: row.recipient,
      subject: row.subject,
      body: row.body,
      template: row.meta?.template && { ...row.meta.template, buttons: row.meta.buttons?.map((b) => ({ payload: b.payload })) },
      reference: row.id,
    });
    await this.tdb.run((tx) =>
      tx
        .update(notifications)
        .set({
          status: result.status,
          externalId: result.externalId ?? null,
          actionUrl: result.actionUrl ?? null,
          sentAt: result.status === 'sent' ? new Date() : null,
          detail: result.status === 'manual' ? 'Aguardando envio pelo WhatsApp da empresa' : null,
        })
        .where(and(eq(notifications.id, notificationId), eq(notifications.status, 'queued'))),
    );
  }

  /** Canais do template que o tenant pode usar agora. */
  private async channelsFor(tx: Tx, def: NotificationTemplateDef, only?: NotificationChannel[]): Promise<NotificationChannel[]> {
    const out: NotificationChannel[] = [];
    if (def.email) out.push('email');
    if (def.whatsapp && this.channels.has('whatsapp')) {
      const [active] = await tx
        .select({ status: coreSchema.tenantModules.status })
        .from(coreSchema.tenantModules)
        .where(and(eq(coreSchema.tenantModules.moduleKey, WHATSAPP_MODULE), eq(coreSchema.tenantModules.status, 'active')));
      if (active) out.push('whatsapp');
    }
    return only ? out.filter((c) => only.includes(c)) : out;
  }

  private async customText(tx: Tx, key: string, channel: NotificationChannel) {
    const [row] = await tx
      .select()
      .from(notificationTemplates)
      .where(and(eq(notificationTemplates.key, key), eq(notificationTemplates.channel, channel)));
    return row;
  }
}

/** Substitui {{a.b}} pelos valores de `data`. Variável desconhecida vira texto vazio. */
export function render(template: string, data: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, path: string) => {
    const value = path.split('.').reduce<unknown>((acc, part) => (acc as Record<string, unknown> | undefined)?.[part], data);
    return value === undefined || value === null ? '' : String(value);
  });
}
