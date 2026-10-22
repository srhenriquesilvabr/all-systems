import { RequirePermission } from '@all/module-sdk';
import { Body, Controller, Delete, Get, Header, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { ZodPipe } from '../common/zod.pipe';
import { CustomFieldsService } from './custom-fields.service';
import { CustomersService } from './customers.service';
import { consentPurposes, customFieldTypes } from './schema';

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => v || null);

const address = z
  .object({
    zip: z.string().trim().max(9).optional(),
    street: z.string().trim().max(200).optional(),
    number: z.string().trim().max(20).optional(),
    complement: z.string().trim().max(100).optional(),
    district: z.string().trim().max(100).optional(),
    city: z.string().trim().max(100).optional(),
    state: z.string().trim().max(2).optional(),
  })
  .nullish();

const customerBody = z.object({
  type: z.enum(['person', 'company']).default('person'),
  name: z.string().trim().min(2, 'Informe o nome').max(200),
  document: optionalText(18),
  email: z.string().trim().email('E-mail inválido').max(254).nullish().or(z.literal('')).transform((v) => v || null),
  phone: optionalText(20),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish().or(z.literal('')).transform((v) => v || null),
  address,
  notes: optionalText(2000),
  customFields: z.record(z.unknown()).optional(),
});

const listQuery = z.object({
  q: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
});
const duplicatesQuery = z.object({
  document: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  excludeId: z.string().uuid().optional(),
});
const forceQuery = z.object({ allowDuplicates: z.enum(['true', 'false']).optional() });
const consentBody = z.object({ purpose: z.enum(consentPurposes), granted: z.boolean(), source: z.string().trim().min(2).max(100) });

const fieldBody = z.object({
  label: z.string().trim().min(2).max(60),
  type: z.enum(customFieldTypes),
  options: z.array(z.string().trim().min(1).max(60)).max(50).optional(),
  required: z.boolean().default(false),
  position: z.number().int().min(0).default(0),
});
const fieldUpdate = fieldBody.omit({ type: true }).partial();

@Controller('customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  @RequirePermission('core.customers.read')
  list(@Query(new ZodPipe(listQuery)) query: z.infer<typeof listQuery>) {
    return this.customers.list(query);
  }

  @Get('duplicates')
  @RequirePermission('core.customers.read')
  duplicates(@Query(new ZodPipe(duplicatesQuery)) query: z.infer<typeof duplicatesQuery>) {
    return this.customers.findDuplicates(query);
  }

  @Get(':id')
  @RequirePermission('core.customers.read')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.customers.get(id);
  }

  @Post()
  @RequirePermission('core.customers.write')
  create(
    @Body(new ZodPipe(customerBody)) body: z.infer<typeof customerBody>,
    @Query(new ZodPipe(forceQuery)) query: z.infer<typeof forceQuery>,
  ) {
    return this.customers.create(body, { allowDuplicates: query.allowDuplicates === 'true' });
  }

  @Patch(':id')
  @RequirePermission('core.customers.write')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(customerBody.partial())) body: Partial<z.infer<typeof customerBody>>,
    @Query(new ZodPipe(forceQuery)) query: z.infer<typeof forceQuery>,
  ) {
    return this.customers.update(id, body, { allowDuplicates: query.allowDuplicates === 'true' });
  }

  @Get(':id/timeline')
  @RequirePermission('core.customers.read')
  timeline(@Param('id', ParseUUIDPipe) id: string) {
    return this.customers.timeline(id);
  }

  @Post(':id/consents')
  @RequirePermission('core.customers.write')
  consent(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(consentBody)) body: z.infer<typeof consentBody>) {
    return this.customers.setConsent(id, body.purpose, body.granted, body.source);
  }

  @Get(':id/export')
  @RequirePermission('core.customers.privacy')
  @Header('Content-Disposition', 'attachment; filename="dados-do-cliente.json"')
  export(@Param('id', ParseUUIDPipe) id: string) {
    return this.customers.exportData(id);
  }

  @Post(':id/anonymize')
  @HttpCode(204)
  @RequirePermission('core.customers.privacy')
  anonymize(@Param('id', ParseUUIDPipe) id: string) {
    return this.customers.anonymize(id);
  }
}

@Controller('custom-fields/customer')
export class CustomFieldsController {
  constructor(private readonly fields: CustomFieldsService) {}

  /** Leitura liberada para quem vê clientes: o formulário de cadastro precisa das definições. */
  @Get()
  @RequirePermission('core.customers.read')
  list() {
    return this.fields.list();
  }

  @Post()
  @RequirePermission('core.customers.fields')
  create(@Body(new ZodPipe(fieldBody)) body: z.infer<typeof fieldBody>) {
    return this.fields.create(body);
  }

  @Patch(':id')
  @RequirePermission('core.customers.fields')
  update(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(fieldUpdate)) body: z.infer<typeof fieldUpdate>) {
    return this.fields.update(id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('core.customers.fields')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.fields.remove(id);
  }
}
