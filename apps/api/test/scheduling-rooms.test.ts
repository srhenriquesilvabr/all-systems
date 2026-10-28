import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testEnv } from './env';
import { createTestApp, ownerSession, uniqueEmail, type TestApp } from './helpers';

const OFFSET = '-03:00';
const at = (date: string, time: string) => new Date(`${date}T${time}:00${OFFSET}`).toISOString();

/** Próximo dia útil a pelo menos 2 dias de hoje (no fuso de São Paulo). */
function nextWeekday(): string {
  const d = new Date(Date.now() + 2 * 86_400_000);
  for (;;) {
    const local = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d);
    const wd = new Date(`${local}T12:00:00Z`).getUTCDay();
    if (wd >= 1 && wd <= 5) return local;
    d.setTime(d.getTime() + 86_400_000);
  }
}

describe('agenda: sala de atendimentos já marcados', () => {
  let t: TestApp;
  const admin = new Client({ connectionString: testEnv.MIGRATION_DATABASE_URL });
  beforeAll(async () => {
    t = await createTestApp();
    await admin.connect();
  });
  afterAll(async () => {
    await admin.end();
    await t.close();
  });

  async function salon() {
    const s = await ownerSession(t, ['beauty']);
    const { body: customer } = await s.as('post', '/customers').send({ name: 'Bia Cliente', email: uniqueEmail('cliente'), phone: '(48) 99911-2233' }).expect(201);
    const { body: services } = await s.as('get', '/scheduling/services').expect(200);
    const { body: ana } = await s.as('post', '/scheduling/resources').send({ name: 'Ana' }).expect(201);
    const { body: bruno } = await s.as('post', '/scheduling/resources').send({ name: 'Bruno' }).expect(201);
    const service = (name: string) => services.find((x: { name: string }) => x.name === name);
    const room = async (name: string, extra: Record<string, unknown> = {}) => (await s.as('post', '/scheduling/resources').send({ name, kind: 'room', ...extra }).expect(201)).body as { id: string };
    const book = (body: Record<string, unknown>) =>
      s.as('post', '/scheduling/appointments').send({ customerId: customer.id, resourceId: ana.id, serviceIds: [service('Corte feminino').id], ...body });
    const setRoom = (id: string, roomId: string | null) => s.as('put', `/scheduling/appointments/${id}/room`).send({ roomId });
    const requireRoom = async (name: string) => {
      const svc = service(name);
      await s.as('patch', `/scheduling/services/${svc.id}`).send({ name: svc.name, durationMin: svc.durationMin, price: svc.price, requiresRoom: true }).expect(200);
    };
    const audit = async () => (await s.as('get', '/audit?limit=200').expect(200)).body as { action: string; entityId: string; data: Record<string, unknown> | null }[];
    return { ...s, customer, ana, bruno, service, room, book, setRoom, requireRoom, audit };
  }

  it('define, troca e remove a sala; recusa sala ocupada, inadequada, inativa ou que não é sala', async () => {
    const s = await salon();
    const day = nextWeekday();
    // Salas ligadas ao corte: a de manicure (ligada só à manicure) não serve para ele.
    const corte = [s.service('Corte feminino').id];
    const salaA = await s.room('Sala A', { serviceIds: corte });
    const salaB = await s.room('Sala B', { serviceIds: corte });
    const salaC = await s.room('Sala C', { serviceIds: corte });
    const { body: a } = await s.book({ startsAt: at(day, '09:00'), roomId: salaA.id }).expect(201);
    await s.book({ startsAt: at(day, '09:30'), resourceId: s.bruno.id, roomId: salaB.id }).expect(201);

    // Opções: as três servem; a B está ocupada nesse horário.
    const { body: options } = await s.as('get', `/scheduling/appointments/${a.id}/rooms`).expect(200);
    expect(options).toMatchObject({ requiresRoom: false, roomId: salaA.id });
    expect(Object.fromEntries(options.rooms.map((r: { name: string; free: boolean }) => [r.name, r.free]))).toEqual({ 'Sala A': true, 'Sala B': false, 'Sala C': true });

    const taken = await s.setRoom(a.id, salaB.id).expect(409);
    expect(taken.body.code).toBe('ROOM_TAKEN');
    expect(taken.body.message).toMatch(/Sala B já tem reserva/);

    const { body: moved } = await s.setRoom(a.id, salaC.id).expect(200);
    expect(moved).toMatchObject({ roomId: salaC.id, roomName: 'Sala C' });

    // Profissional não é sala; sala só de manicure não serve para corte; sala inativa não vale.
    expect((await s.setRoom(a.id, s.ana.id).expect(400)).body.code).toBe('ROOM_NOT_FOUND');
    const manicure = await s.room('Sala de manicure', { serviceIds: [s.service('Manicure').id] });
    expect((await s.setRoom(a.id, manicure.id).expect(400)).body.code).toBe('ROOM_NOT_ELIGIBLE');
    const inativa = await s.room('Sala desativada', { active: false, serviceIds: corte });
    expect((await s.setRoom(a.id, inativa.id).expect(400)).body.code).toBe('ROOM_NOT_FOUND');

    // Serviço que não exige sala pode ficar sem.
    const { body: none } = await s.setRoom(a.id, null).expect(200);
    expect(none).toMatchObject({ roomId: null, roomName: null });

    const log = (await s.audit()).filter((e) => e.action === 'appointment.room_changed' && e.entityId === a.id);
    expect(log.map((e) => e.data)).toEqual(
      expect.arrayContaining([
        { from: salaA.id, to: salaC.id },
        { from: salaC.id, to: null },
      ]),
    );

    // Cancelado não muda de sala.
    await s.as('post', `/scheduling/appointments/${a.id}/status`).send({ status: 'cancelled', reason: 'Cliente pediu' }).expect(200);
    expect((await s.setRoom(a.id, salaA.id).expect(400)).body.code).toBe('APPOINTMENT_CLOSED');
  });

  it('duas trocas simultâneas para a mesma sala: o banco recusa uma com 409 amigável', async () => {
    const s = await salon();
    const day = nextWeekday();
    const sala = await s.room('Sala disputada');
    const { body: a } = await s.book({ startsAt: at(day, '14:00') }).expect(201);
    const { body: b } = await s.book({ startsAt: at(day, '14:30'), resourceId: s.bruno.id }).expect(201);
    const results = await Promise.all([s.setRoom(a.id, sala.id), s.setRoom(b.id, sala.id)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const refused = results.find((r) => r.status === 409)!;
    expect(refused.body.code).toBe('ROOM_TAKEN');
    expect(refused.body.message).toMatch(/sala|reserva/i);
  });

  it('serviço que exige sala não fica sem sala', async () => {
    const s = await salon();
    const day = nextWeekday();
    const sala1 = await s.room('Sala 1');
    const sala2 = await s.room('Sala 2');
    await s.requireRoom('Corte feminino');
    const { body: a } = await s.book({ startsAt: at(day, '10:00') }).expect(201);
    expect(a.roomId).toBe(sala1.id);

    expect((await s.setRoom(a.id, null).expect(400)).body.code).toBe('ROOM_REQUIRED');
    expect((await s.as('get', `/scheduling/appointments/${a.id}/rooms`).expect(200)).body.requiresRoom).toBe(true);
    await s.setRoom(a.id, sala2.id).expect(200);
    expect((await s.as('post', `/scheduling/appointments/${a.id}/reschedule`).send({ startsAt: at(day, '15:00'), roomId: null }).expect(400)).body.code).toBe('ROOM_REQUIRED');
  });

  it('remarcar: mantém a sala se livre, escolhe outra livre se não, aceita outra sala ou nenhuma, e recusa sem sala livre', async () => {
    const s = await salon();
    const day = nextWeekday();
    const salaA = await s.room('Sala A');
    const salaB = await s.room('Sala B');
    const { body: a } = await s.book({ startsAt: at(day, '09:00'), roomId: salaA.id }).expect(201);
    // Bruno ocupa a sala A às 14h e as duas salas às 16h.
    await s.book({ startsAt: at(day, '14:00'), resourceId: s.bruno.id, roomId: salaA.id }).expect(201);

    // Horário livre na sala atual: continua nela.
    const { body: same } = await s.as('post', `/scheduling/appointments/${a.id}/reschedule`).send({ startsAt: at(day, '10:00') }).expect(200);
    expect(same.roomId).toBe(salaA.id);

    // Sala atual ocupada no novo horário: vai para outra livre que serve.
    const { body: other } = await s.as('post', `/scheduling/appointments/${a.id}/reschedule`).send({ startsAt: at(day, '14:00') }).expect(200);
    expect(other).toMatchObject({ roomId: salaB.id, roomName: 'Sala B' });
    const rescheduled = (await s.audit()).find((e) => e.action === 'appointment.rescheduled' && e.entityId === a.id && e.data?.roomTo);
    expect(rescheduled?.data).toMatchObject({ roomFrom: salaA.id, roomTo: salaB.id });

    // Escolha explícita: sala ocupada é recusada; livre é aceita; null tira a sala.
    expect((await s.as('post', `/scheduling/appointments/${a.id}/reschedule`).send({ startsAt: at(day, '14:00'), roomId: salaA.id }).expect(409)).body.code).toBe('ROOM_TAKEN');
    const { body: chosen } = await s.as('post', `/scheduling/appointments/${a.id}/reschedule`).send({ startsAt: at(day, '11:00'), roomId: salaA.id }).expect(200);
    expect(chosen.roomId).toBe(salaA.id);
    const { body: noRoom } = await s.as('post', `/scheduling/appointments/${a.id}/reschedule`).send({ startsAt: at(day, '09:00'), roomId: null }).expect(200);
    expect(noRoom.roomId).toBeNull();

    // Com sala de novo, para um horário em que nenhuma sala está livre: recusa com mensagem clara.
    await s.setRoom(a.id, salaA.id).expect(200);
    await s.book({ startsAt: at(day, '16:00'), resourceId: s.bruno.id, roomId: salaA.id }).expect(201);
    const { body: carla } = await s.as('post', '/scheduling/resources').send({ name: 'Carla' }).expect(201);
    await s.book({ startsAt: at(day, '16:00'), resourceId: carla.id, roomId: salaB.id }).expect(201);
    const refused = await s.as('post', `/scheduling/appointments/${a.id}/reschedule`).send({ startsAt: at(day, '16:00') }).expect(409);
    expect(refused.body.code).toBe('ROOM_TAKEN');
    expect(refused.body.message).toMatch(/Sala A já tem reserva no novo horário.*Escolha outro horário/);
    // A recusa não mexeu no atendimento.
    expect((await s.as('get', `/scheduling/appointments/${a.id}`).expect(200)).body).toMatchObject({ startsAt: at(day, '09:00'), roomId: salaA.id });
  });

  it('distribuir salas: atendimentos futuros que exigem sala e estão sem recebem a primeira livre', async () => {
    const s = await salon();
    const day = nextWeekday();
    const sala = await s.room('Sala única');
    // Marcados antes de o corte exigir sala.
    const { body: ana9 } = await s.book({ startsAt: at(day, '09:00') }).expect(201);
    const { body: bruno9 } = await s.book({ startsAt: at(day, '09:00'), resourceId: s.bruno.id }).expect(201);
    const { body: ana11 } = await s.book({ startsAt: at(day, '11:00') }).expect(201);
    const { body: cancelled } = await s.book({ startsAt: at(day, '13:00') }).expect(201);
    await s.as('post', `/scheduling/appointments/${cancelled.id}/status`).send({ status: 'cancelled', reason: 'Desistiu' }).expect(200);
    const { body: past } = await s.book({ startsAt: at(day, '15:00') }).expect(201);
    await admin.query(`update sch_appointments set starts_at = starts_at - interval '30 days', ends_at = ends_at - interval '30 days' where id = $1`, [past.id]);
    // Serviço sem exigência de sala não entra.
    const { body: manicure } = await s.book({ startsAt: at(day, '16:00'), serviceIds: [s.service('Manicure').id] }).expect(201);
    await s.requireRoom('Corte feminino');

    const { body: r } = await s.as('post', '/scheduling/rooms/distribute').expect(200);
    expect(r.assigned).toBe(2);
    expect(r.remaining).toBe(0);
    expect(r.unassigned).toEqual([expect.objectContaining({ id: bruno9.id, customerName: 'Bia Cliente', resourceName: 'Bruno', services: ['Corte feminino'] })]);

    const get = async (id: string) => (await s.as('get', `/scheduling/appointments/${id}`).expect(200)).body;
    expect((await get(ana9.id)).roomId).toBe(sala.id);
    expect((await get(ana11.id)).roomId).toBe(sala.id);
    for (const id of [bruno9.id, cancelled.id, past.id, manicure.id]) expect((await get(id)).roomId).toBeNull();

    const auto = (await s.audit()).filter((e) => e.action === 'appointment.room_changed' && e.data?.auto === true);
    expect(auto.map((e) => e.entityId).sort()).toEqual([ana9.id, ana11.id].sort());

    // Rodar de novo não muda nada (idempotente).
    const { body: again } = await s.as('post', '/scheduling/rooms/distribute').expect(200);
    expect(again).toMatchObject({ assigned: 0, remaining: 0 });
    expect(again.unassigned.map((u: { id: string }) => u.id)).toEqual([bruno9.id]);

    // Liberou outra sala: a próxima rodada atende o que faltou.
    const sala2 = await s.room('Sala nova');
    const { body: third } = await s.as('post', '/scheduling/rooms/distribute').expect(200);
    expect(third).toMatchObject({ assigned: 1, unassigned: [] });
    expect((await get(bruno9.id)).roomId).toBe(sala2.id);
  });
});
