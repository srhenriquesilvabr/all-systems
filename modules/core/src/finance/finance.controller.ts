import { RequirePermission } from '@all/module-sdk';
import { Body, Controller, Get, Header, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { ZodPipe } from '../common/zod.pipe';
import { FinanceService } from './finance.service';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida');
const amount = z.coerce.number().positive('O valor precisa ser maior que zero').max(100_000_000).multipleOf(0.01);

const entryBody = z
  .object({
    kind: z.enum(['income', 'expense']),
    description: z.string().trim().min(2).max(200),
    amount,
    status: z.enum(['pending', 'paid']),
    dueDate: isoDate,
    competenceDate: isoDate.optional(),
    paidAt: isoDate.nullish(),
    accountId: z.string().uuid().nullish(),
    categoryId: z.string().uuid().nullish(),
    customerId: z.string().uuid().nullish(),
    paymentMethod: z.string().max(30).nullish(),
    notes: z.string().trim().max(2000).nullish(),
  })
  .refine((e) => e.status !== 'paid' || (e.paidAt && e.accountId), {
    message: 'Informe a data de pagamento e a conta',
    path: ['paidAt'],
  });

const entryUpdate = z.object({
  description: z.string().trim().min(2).max(200).optional(),
  amount: amount.optional(),
  dueDate: isoDate.optional(),
  competenceDate: isoDate.optional(),
  accountId: z.string().uuid().nullish(),
  categoryId: z.string().uuid().nullish(),
  customerId: z.string().uuid().nullish(),
  notes: z.string().trim().max(2000).nullish(),
});

const payBody = z.object({ paidAt: isoDate, accountId: z.string().uuid(), paymentMethod: z.string().max(30).nullish() });

const reason = z.string().trim().min(3, 'Informe o motivo').max(500);
const reverseBody = z.object({ reason });
const cancelBody = z.object({ reason: reason.nullish() }).optional();
const initialBalanceBody = z.object({ initialBalance: z.coerce.number().min(-100_000_000).max(100_000_000).multipleOf(0.01), reason });

const filters = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  dateField: z.enum(['due', 'paid', 'competence']).default('due'),
  status: z.enum(['pending', 'paid', 'cancelled', 'overdue']).optional(),
  kind: z.enum(['income', 'expense']).optional(),
  accountId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(),
  customerId: z.string().uuid().optional(),
  q: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const summaryQuery = z.object({ from: isoDate, to: isoDate }).refine((q) => q.from <= q.to, 'Período inválido');

const accountBody = z.object({
  name: z.string().trim().min(2).max(60),
  type: z.enum(['cash', 'bank', 'gateway']),
  initialBalance: z.coerce.number().min(-100_000_000).max(100_000_000).default(0),
});
const accountUpdate = z.object({ name: z.string().trim().min(2).max(60).optional(), active: z.boolean().optional() });
const categoryBody = z.object({ name: z.string().trim().min(2).max(60), kind: z.enum(['income', 'expense']) });
const categoryUpdate = accountUpdate;

@Controller('finance')
export class FinanceController {
  constructor(private readonly finance: FinanceService) {}

  @Get('summary')
  @RequirePermission('core.finance.read')
  summary(@Query(new ZodPipe(summaryQuery)) q: z.infer<typeof summaryQuery>) {
    return this.finance.summary(q.from, q.to);
  }

  @Get('entries')
  @RequirePermission('core.finance.read')
  entries(@Query(new ZodPipe(filters)) q: z.infer<typeof filters>) {
    return this.finance.listEntries(q);
  }

  @Get('entries.csv')
  @RequirePermission('core.finance.read')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="lancamentos.csv"')
  csv(@Query(new ZodPipe(filters)) q: z.infer<typeof filters>) {
    return this.finance.exportCsv(q);
  }

  @Post('entries')
  @RequirePermission('core.finance.write')
  create(@Body(new ZodPipe(entryBody)) body: z.infer<typeof entryBody>) {
    return this.finance.createEntry(body);
  }

  @Patch('entries/:id')
  @RequirePermission('core.finance.write')
  update(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(entryUpdate)) body: z.infer<typeof entryUpdate>) {
    return this.finance.updateEntry(id, body);
  }

  @Post('entries/:id/pay')
  @RequirePermission('core.finance.write')
  pay(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(payBody)) body: z.infer<typeof payBody>) {
    return this.finance.pay(id, body);
  }

  /** Estorno da baixa: volta para em aberto, com motivo na auditoria. */
  @Post('entries/:id/reverse')
  @HttpCode(200)
  @RequirePermission('core.finance.write')
  reverse(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(reverseBody)) body: z.infer<typeof reverseBody>) {
    return this.finance.reversePayment(id, body);
  }

  @Post('entries/:id/cancel')
  @HttpCode(204)
  @RequirePermission('core.finance.write')
  cancel(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(cancelBody)) body: z.infer<typeof cancelBody>) {
    return this.finance.cancel(id, body ?? {});
  }

  @Get('entries/:id/history')
  @RequirePermission('core.finance.read')
  entryHistory(@Param('id', ParseUUIDPipe) id: string) {
    return this.finance.entryHistory(id);
  }

  /** Contas e categorias são lidas por quem lança; só quem administra cria/edita. */
  @Get('accounts')
  @RequirePermission('core.finance.read')
  accounts() {
    return this.finance.listAccounts();
  }

  @Post('accounts')
  @RequirePermission('core.finance.manage')
  createAccount(@Body(new ZodPipe(accountBody)) body: z.infer<typeof accountBody>) {
    return this.finance.createAccount(body);
  }

  @Patch('accounts/:id')
  @RequirePermission('core.finance.manage')
  updateAccount(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(accountUpdate)) body: z.infer<typeof accountUpdate>) {
    return this.finance.updateAccount(id, body);
  }

  @Post('accounts/:id/initial-balance')
  @HttpCode(200)
  @RequirePermission('core.finance.manage')
  correctInitialBalance(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(initialBalanceBody)) body: z.infer<typeof initialBalanceBody>) {
    return this.finance.correctInitialBalance(id, body);
  }

  @Get('accounts/:id/history')
  @RequirePermission('core.finance.manage')
  accountHistory(@Param('id', ParseUUIDPipe) id: string) {
    return this.finance.accountHistory(id);
  }

  @Get('categories')
  @RequirePermission('core.finance.read')
  categories() {
    return this.finance.listCategories();
  }

  @Post('categories')
  @RequirePermission('core.finance.manage')
  createCategory(@Body(new ZodPipe(categoryBody)) body: z.infer<typeof categoryBody>) {
    return this.finance.createCategory(body);
  }

  @Patch('categories/:id')
  @RequirePermission('core.finance.manage')
  updateCategory(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(categoryUpdate)) body: z.infer<typeof categoryUpdate>) {
    return this.finance.updateCategory(id, body);
  }
}
