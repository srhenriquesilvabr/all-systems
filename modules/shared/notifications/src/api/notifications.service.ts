import { AuditService, CustomerDataRegistry, CustomersService, MailService, OutboxHandlers, OutboxService, TenantDb, coreSchema } from '@all/core';
import type { Tx } from '@all/db';
import { ModuleRegistry, requestContext } from '@all/module-sdk';
import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { notifications, notificationTemplates } from '../db/schema';

const DELIVER = 'shared.notifications.deliver';

export interface EnqueueInput {
  templateKey: string;
  customerId: string;
  /** Valores das variáveis do template, ex.: { os: { numero: 12 } }. `cliente` e `empresa` são preenchidos aqui. */
  data: Record<string, unknown>;
  related?: { entity: string; id: string };
}

@Injectable()
export class NotificationsService implements OnModuleInit {
  constructor(
    private readonly tdb: TenantDb,
    private readonly registry: ModuleRegistry,
    private readonly customers: CustomersService,
    private readonly outbox: OutboxService,
    private readonly handlers: OutboxHandlers,
    private readonly mail: MailService,
    private readonly audit: AuditService,
    private readonly customerData: CustomerDataRegistry,
  ) {}

  onModuleInit() {
    this.handlers.on<{ notificationId: string }>(DELIVER, 'notifications.send-email', (e) => this.deliver(e.payload.notificationId));
    this.customerData.register({
      moduleKey: 'shared.notifications',
      export: (tx, customerId) =>
        tx
          .select({ at: notifications.createdAt, subject: notifications.subject, status: notifications.status, recipient: notifications.recipient })
          .from(notifications)
          .where(eq(notifications.customerId, customerId)),
      anonymize: async (tx, customerId) => {
        await tx
          .update(notifications)
          .set({ recipient: null, body: '[removido a pedido do titular]' })
          .where(eq(notifications.customerId, customerId));
      },
    });
  }

  /** Templates dos módulos ativos, já com a personalização do tenant aplicada. */
  templates() {
    const ctx = requestContext.require();
    return this.tdb.run(async (tx) => {
      const overrides = await tx.select().from(notificationTemplates);
      return this.registry.notificationTemplatesOf(ctx.modules ?? []).map((t) => {
        const custom = overrides.find((o) => o.key === t.key);
        return {
          key: t.key,
          module: t.module,
          label: t.label,
          channel: t.channel,
          variables: [...t.variables, 'cliente.nome', 'empresa.nome'],
          subject: custom?.subject ?? t.subject,
          body: custom?.body ?? t.body,
          customized: !!custom,
          defaults: { subject: t.subject, body: t.body },
        };
      });
    });
  }

  saveTemplate(key: string, input: { subject: string; body: string }) {
    const ctx = requestContext.require();
    if (!this.registry.notificationTemplatesOf(ctx.modules ?? []).some((t) => t.key === key)) {
      throw new BadRequestException({ code: 'TEMPLATE_NOT_FOUND', message: 'Mensagem inexistente ou de módulo não contratado' });
    }
    return this.tdb.run(async (tx) => {
      await tx
        .insert(notificationTemplates)
        .values({ tenantId: ctx.tenantId, key, ...input, updatedBy: ctx.userId })
        .onConflictDoUpdate({ target: [notificationTemplates.tenantId, notificationTemplates.key], set: { ...input, updatedBy: ctx.userId } });
      await this.audit.log(tx, { action: 'notification.template.updated', entity: 'notification_template', entityId: key });
    });
  }

  resetTemplate(key: string) {
    return this.tdb.run(async (tx) => {
      await tx.delete(notificationTemplates).where(eq(notificationTemplates.key, key));
      await this.audit.log(tx, { action: 'notification.template.reset', entity: 'notification_template', entityId: key });
    });
  }

  log(opts: { limit: number; customerId?: string }) {
    return this.tdb.run((tx) =>
      tx
        .select()
        .from(notifications)
        .where(opts.customerId ? eq(notifications.customerId, opts.customerId) : undefined)
        .orderBy(desc(notifications.createdAt))
        .limit(opts.limit),
    );
  }

  /**
   * Prepara a mensagem na transação de quem chama; o envio acontece depois, pelo worker.
   * Se a transação for desfeita, a mensagem não sai.
   */
  async enqueueInTx(tx: Tx, input: EnqueueInput): Promise<void> {
    const { tenantId } = requestContext.requireTenant();
    const template = await this.resolveTemplate(tx, input.templateKey);
    const customer = await this.customers.findInTx(tx, input.customerId);
    const [tenant] = await tx.select({ name: coreSchema.tenants.name }).from(coreSchema.tenants).where(eq(coreSchema.tenants.id, tenantId));

    const data = { ...input.data, cliente: { nome: customer?.name ?? '' }, empresa: { nome: tenant?.name ?? '' } };
    const subject = render(template.subject, data);
    const body = render(template.body, data);

    let skipReason: string | undefined;
    if (!customer?.email) skipReason = 'Cliente sem e-mail cadastrado';
    else if (!(await this.customers.canContact(tx, customer.id, 'service_notifications'))) skipReason = 'Cliente pediu para não receber avisos';

    const [notification] = await tx
      .insert(notifications)
      .values({
        tenantId,
        customerId: input.customerId,
        channel: 'email',
        templateKey: input.templateKey,
        recipient: customer?.email ?? null,
        subject,
        body,
        status: skipReason ? 'skipped' : 'queued',
        detail: skipReason,
        relatedEntity: input.related?.entity,
        relatedId: input.related?.id,
      })
      .returning({ id: notifications.id });
    if (!skipReason) await this.outbox.publish(tx, DELIVER, { notificationId: notification!.id });
  }

  private async deliver(notificationId: string) {
    const [notification] = await this.tdb.run((tx) => tx.select().from(notifications).where(eq(notifications.id, notificationId)));
    if (!notification || notification.status !== 'queued' || !notification.recipient) return;

    // Se o envio falhar, o erro sobe e o outbox tenta de novo com espera crescente.
    await this.mail.send({ to: notification.recipient, subject: notification.subject, text: notification.body });
    await this.tdb.run((tx) =>
      tx
        .update(notifications)
        .set({ status: 'sent', sentAt: new Date(), detail: null })
        .where(and(eq(notifications.id, notificationId), eq(notifications.status, 'queued'))),
    );
  }

  private async resolveTemplate(tx: Tx, key: string) {
    const [custom] = await tx.select().from(notificationTemplates).where(eq(notificationTemplates.key, key));
    if (custom) return custom;
    const fallback = this.registry.notificationTemplate(key);
    if (!fallback) throw new Error(`Template de notificação inexistente: ${key}`);
    return fallback;
  }
}

/** Substitui {{a.b}} pelos valores de `data`. Variável desconhecida vira texto vazio. */
export function render(template: string, data: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, path: string) => {
    const value = path.split('.').reduce<unknown>((acc, part) => (acc as Record<string, unknown> | undefined)?.[part], data);
    return value === undefined || value === null ? '' : String(value);
  });
}
