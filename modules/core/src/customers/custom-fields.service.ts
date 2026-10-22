import { requestContext } from '@all/module-sdk';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { TenantDb } from '../db/tenant-db';
import { customFieldDefinitions, customFieldTypes } from './schema';

export interface CustomFieldInput {
  label: string;
  type: (typeof customFieldTypes)[number];
  options?: string[];
  required?: boolean;
  position?: number;
}

/** Campos extras que o tenant define para o cadastro de clientes (sem alterar o schema). */
@Injectable()
export class CustomFieldsService {
  constructor(
    private readonly tdb: TenantDb,
    private readonly audit: AuditService,
  ) {}

  list(entity = 'customer') {
    return this.tdb.run((tx) =>
      tx
        .select()
        .from(customFieldDefinitions)
        .where(eq(customFieldDefinitions.entity, entity))
        .orderBy(asc(customFieldDefinitions.position), asc(customFieldDefinitions.label)),
    );
  }

  create(input: CustomFieldInput, entity = 'customer') {
    assertOptions(input);
    const { tenantId } = requestContext.require();
    return this.tdb.run(async (tx) => {
      const key = slugKey(input.label);
      const [exists] = await tx
        .select({ id: customFieldDefinitions.id })
        .from(customFieldDefinitions)
        .where(and(eq(customFieldDefinitions.entity, entity), eq(customFieldDefinitions.key, key)));
      if (exists) throw new ConflictException({ code: 'FIELD_EXISTS', message: 'Já existe um campo com este nome' });

      const [field] = await tx
        .insert(customFieldDefinitions)
        .values({ ...input, tenantId, entity, key, options: input.type === 'select' ? input.options : null })
        .returning();
      await this.audit.log(tx, { action: 'custom_field.created', entity: 'custom_field', entityId: field!.id, data: input });
      return field!;
    });
  }

  /** O tipo e a key não mudam: os valores já gravados continuam válidos. */
  update(id: string, input: Partial<Omit<CustomFieldInput, 'type'>>) {
    return this.tdb.run(async (tx) => {
      const [current] = await tx.select().from(customFieldDefinitions).where(eq(customFieldDefinitions.id, id));
      if (!current) throw new NotFoundException({ code: 'FIELD_NOT_FOUND', message: 'Campo não encontrado' });
      if (input.options) assertOptions({ type: current.type, options: input.options });
      const [field] = await tx.update(customFieldDefinitions).set(input).where(eq(customFieldDefinitions.id, id)).returning();
      await this.audit.log(tx, { action: 'custom_field.updated', entity: 'custom_field', entityId: id, data: input });
      return field!;
    });
  }

  /** Os valores antigos ficam no JSON do cliente, mas deixam de ser exibidos e validados. */
  remove(id: string) {
    return this.tdb.run(async (tx) => {
      const deleted = await tx.delete(customFieldDefinitions).where(eq(customFieldDefinitions.id, id)).returning();
      if (!deleted.length) throw new NotFoundException({ code: 'FIELD_NOT_FOUND', message: 'Campo não encontrado' });
      await this.audit.log(tx, { action: 'custom_field.deleted', entity: 'custom_field', entityId: id, data: { label: deleted[0]!.label } });
    });
  }
}

function assertOptions(input: Pick<CustomFieldInput, 'type' | 'options'>) {
  if (input.type === 'select' && !input.options?.filter((o) => o.trim()).length) {
    throw new BadRequestException({ code: 'VALIDATION', message: 'Campos de lista precisam de ao menos uma opção' });
  }
}

function slugKey(label: string) {
  return (
    label
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 40) || 'campo'
  );
}
