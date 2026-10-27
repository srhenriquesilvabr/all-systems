import { AuditService, CustomerDataRegistry, CustomersService, TenantDb, ZodPipe } from '@all/core';
import { customers } from '@all/core/schema';
import type { Tx } from '@all/db';
import { ModuleRoute, RequirePermission, requestContext } from '@all/module-sdk';
import { SchedulingModule, SchedulingService } from '@all/scheduling';
import { BadRequestException, Body, Controller, Get, Injectable, Module, NotFoundException, OnModuleInit, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { and, asc, eq, ilike, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { petInput, species, speciesLabel, type Pet, type PetInput, type Species } from '../contracts';
import { pets } from '../db/schema';

type PetRow = typeof pets.$inferSelect;

/** Nome comparável: sem acento, sem diferença de maiúsculas e espaços extras. */
const sameName = (name: string) => name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

@Injectable()
export class PetsService implements OnModuleInit {
  constructor(
    private readonly tdb: TenantDb,
    private readonly customers: CustomersService,
    private readonly audit: AuditService,
    private readonly customerData: CustomerDataRegistry,
    private readonly scheduling: SchedulingService,
  ) {}

  onModuleInit() {
    this.customerData.register({
      moduleKey: 'shared.pets',
      export: async (tx, customerId) => (await tx.select().from(pets).where(eq(pets.customerId, customerId))).map((p) => ({ name: p.name, species: p.species, breed: p.breed, birthDate: p.birthDate })),
      anonymize: async (tx, customerId) => {
        await tx.update(pets).set({ notes: null, microchip: null }).where(eq(pets.customerId, customerId));
      },
    });
    // Agendamento online: com pets ativo, o cliente diz o nome e a espécie do pet; o horário fica para ele.
    this.scheduling.registerBookingSubject({
      moduleKey: 'shared.pets',
      label: 'Pet',
      fields: [
        { key: 'name', label: 'Nome do pet', required: true, maxLength: 60 },
        { key: 'species', label: 'Espécie', required: true, options: species.map((s) => ({ value: s, label: speciesLabel[s] })) },
      ],
      resolve: async (tx, { customerId, values }) => {
        const pet = await this.findOrCreateByNameInTx(tx, customerId, values.name!, values.species as Species);
        return { type: 'pet', id: pet.id, label: pet.name };
      },
    });
  }

  /** Pet do tutor com o mesmo nome (sem diferenciar acento/maiúscula) ou um novo, só com nome e espécie. */
  async findOrCreateByNameInTx(tx: Tx, customerId: string, name: string, kind: Species): Promise<{ id: string; name: string }> {
    const { tenantId } = requestContext.requireTenant();
    const mine = await tx.select({ id: pets.id, name: pets.name }).from(pets).where(and(eq(pets.customerId, customerId), isNull(pets.deceasedAt)));
    const found = mine.find((p) => sameName(p.name) === sameName(name));
    if (found) return found;
    const clean = name.replace(/\s+/g, ' ').trim();
    const [row] = await tx.insert(pets).values({ tenantId, customerId, name: clean, species: kind }).returning({ id: pets.id, name: pets.name });
    await this.customers.addTimeline(tx, {
      customerId,
      moduleKey: 'shared.pets',
      type: 'pet.created',
      title: `Pet cadastrado: ${clean} (${speciesLabel[kind]})`,
      entity: 'pet',
      entityId: row!.id,
    });
    await this.audit.log(tx, { action: 'pet.created', entity: 'pet', entityId: row!.id, data: { source: 'online_booking' } });
    return row!;
  }

  list(opts: { q?: string; customerId?: string; limit: number }) {
    return this.tdb.run(async (tx) => {
      const term = opts.q?.trim();
      const like = term ? `%${term.replace(/[%_\\]/g, (c) => `\\${c}`)}%` : undefined;
      const rows = await this.query(tx)
        .where(and(opts.customerId ? eq(pets.customerId, opts.customerId) : undefined, like ? or(ilike(pets.name, like), ilike(customers.name, like), ilike(pets.breed, like)) : undefined))
        .orderBy(asc(pets.name))
        .limit(opts.limit);
      return rows.map(toDto);
    });
  }

  get(id: string) {
    return this.tdb.run(async (tx) => toDto(await this.findOrFail(tx, id)));
  }

  /** Para outros módulos (ex.: vacinas): o pet com o tutor, na transação de quem chama. */
  async findInTx(tx: Tx, id: string): Promise<Pet | undefined> {
    const [row] = await this.query(tx).where(eq(pets.id, id));
    return row && toDto(row);
  }

  create(input: PetInput) {
    const { tenantId } = requestContext.require();
    return this.tdb.run(async (tx) => {
      const tutor = await this.customers.findInTx(tx, input.customerId);
      if (!tutor || tutor.anonymizedAt) throw new BadRequestException({ code: 'CUSTOMER_NOT_FOUND', message: 'Tutor não encontrado' });
      const [row] = await tx.insert(pets).values({ ...toRow(input), tenantId, customerId: input.customerId }).returning({ id: pets.id });
      await this.customers.addTimeline(tx, {
        customerId: input.customerId,
        moduleKey: 'shared.pets',
        type: 'pet.created',
        title: `Pet cadastrado: ${input.name} (${speciesLabel[input.species]})`,
        entity: 'pet',
        entityId: row!.id,
      });
      await this.audit.log(tx, { action: 'pet.created', entity: 'pet', entityId: row!.id });
      return toDto(await this.findOrFail(tx, row!.id));
    });
  }

  update(id: string, input: Partial<PetInput>) {
    return this.tdb.run(async (tx) => {
      const current = await this.findOrFail(tx, id);
      const { customerId: _ignored, ...rest } = input;
      await tx.update(pets).set(toRow({ ...fromRow(current.pet), ...rest })).where(eq(pets.id, id));
      await this.audit.log(tx, { action: 'pet.updated', entity: 'pet', entityId: id, data: { fields: Object.keys(input) } });
      return toDto(await this.findOrFail(tx, id));
    });
  }

  private query(tx: Tx) {
    return tx
      .select({ pet: pets, tutor: { id: customers.id, name: customers.name, phone: customers.phone } })
      .from(pets)
      .innerJoin(customers, eq(customers.id, pets.customerId))
      .$dynamic();
  }

  private async findOrFail(tx: Tx, id: string) {
    const [row] = await this.query(tx).where(eq(pets.id, id));
    if (!row) throw new NotFoundException({ code: 'PET_NOT_FOUND', message: 'Pet não encontrado' });
    return row;
  }
}

function toRow(input: Omit<PetInput, 'customerId'>) {
  return {
    name: input.name,
    species: input.species,
    breed: input.breed ?? null,
    sex: input.sex,
    birthDate: input.birthDate ?? null,
    weightKg: input.weightKg != null ? input.weightKg.toFixed(2) : null,
    coat: input.coat ?? null,
    size: input.size ?? null,
    neutered: input.neutered,
    microchip: input.microchip ?? null,
    notes: input.notes ?? null,
    deceasedAt: input.deceased ? sql`coalesce(${pets.deceasedAt}, now())` : null,
  };
}

function fromRow(p: PetRow): Omit<PetInput, 'customerId'> {
  return {
    name: p.name,
    species: p.species,
    breed: p.breed,
    sex: p.sex,
    birthDate: p.birthDate,
    weightKg: p.weightKg === null ? null : Number(p.weightKg),
    coat: p.coat,
    size: p.size,
    neutered: p.neutered,
    microchip: p.microchip,
    notes: p.notes,
    deceased: !!p.deceasedAt,
  };
}

function toDto(row: { pet: PetRow; tutor: { id: string; name: string; phone: string | null } }): Pet {
  return { id: row.pet.id, customerId: row.pet.customerId, ...fromRow(row.pet), tutor: row.tutor, createdAt: row.pet.createdAt.toISOString() };
}

const listQuery = z.object({
  q: z.string().max(100).optional(),
  customerId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

@Controller('pets')
@ModuleRoute('shared.pets')
export class PetsController {
  constructor(private readonly pets: PetsService) {}

  @Get()
  @RequirePermission('shared.pets.read')
  list(@Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>) {
    return this.pets.list(q);
  }

  @Get(':id')
  @RequirePermission('shared.pets.read')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.pets.get(id);
  }

  @Post()
  @RequirePermission('shared.pets.write')
  create(@Body(new ZodPipe(petInput)) body: PetInput) {
    return this.pets.create(body);
  }

  @Patch(':id')
  @RequirePermission('shared.pets.write')
  update(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(petInput.partial())) body: Partial<PetInput>) {
    return this.pets.update(id, body);
  }
}

@Module({ imports: [SchedulingModule], controllers: [PetsController], providers: [PetsService], exports: [PetsService] })
export class PetsModule {}
