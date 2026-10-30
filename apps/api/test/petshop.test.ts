import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, ownerSession, uniqueEmail, type TestApp } from './helpers';

const at = (date: string, time: string) => new Date(`${date}T${time}:00-03:00`).toISOString();

function nextWeekday(): string {
  const d = new Date(Date.now() + 2 * 86_400_000);
  for (;;) {
    const local = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d);
    const wd = new Date(`${local}T12:00:00Z`).getUTCDay();
    if (wd >= 1 && wd <= 5) return local;
    d.setTime(d.getTime() + 86_400_000);
  }
}

describe('pets e pet shop', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  async function shop(modules = ['petshop']) {
    const s = await ownerSession(t, modules);
    const { body: tutor } = await s.as('post', '/customers').send({ name: 'Carla Tutora', email: uniqueEmail('tutora'), phone: '(48) 99800-1122' }).expect(201);
    const { body: services } = await s.as('get', '/scheduling/services').expect(200);
    const { body: groomer } = await s.as('post', '/scheduling/resources').send({ name: 'Duda' }).expect(201);
    const service = (name: string) => services.find((x: { name: string }) => x.name === name);
    return { ...s, tutor, groomer, service };
  }

  it('o pet shop ativa os pets e já vem com a tabela de banho e tosa', async () => {
    const s = await shop();
    const { body: me } = await s.as('get', '/me').expect(200);
    expect(me.modules.map((m: { key: string }) => m.key)).toEqual(expect.arrayContaining(['shared.pets', 'shared.scheduling', 'petshop']));
    expect(s.service('Banho e tosa — porte médio')).toMatchObject({ durationMin: 120, price: 100 });
  });

  it('cadastra pets do tutor, busca por nome e raça e valida os campos', async () => {
    const s = await shop();
    const { body: rex } = await s
      .as('post', '/pets')
      .send({ customerId: s.tutor.id, name: 'Rex', species: 'dog', breed: 'Golden', birthDate: '2022-03-10', weightKg: '31.5', size: 'large' })
      .expect(201);
    expect(rex).toMatchObject({ name: 'Rex', weightKg: 31.5, size: 'large', tutor: { id: s.tutor.id, name: 'Carla Tutora' }, deceased: false });
    await s.as('post', '/pets').send({ customerId: s.tutor.id, name: 'Mia', species: 'cat' }).expect(201);
    await s.as('post', '/pets').send({ customerId: s.tutor.id, name: '' }).expect(400);

    const byTutor = await s.as('get', `/pets?customerId=${s.tutor.id}`).expect(200);
    expect(byTutor.body.map((p: { name: string }) => p.name)).toEqual(['Mia', 'Rex']);
    const byBreed = await s.as('get', '/pets?q=gold').expect(200);
    expect(byBreed.body.map((p: { name: string }) => p.name)).toEqual(['Rex']);

    const { body: updated } = await s.as('patch', `/pets/${rex.id}`).send({ weightKg: 32, neutered: true }).expect(200);
    expect(updated).toMatchObject({ weightKg: 32, neutered: true, breed: 'Golden' });

    const { body: timeline } = await s.as('get', `/customers/${s.tutor.id}/timeline`).expect(200);
    expect(timeline.map((e: { title: string }) => e.title)).toContain('Pet cadastrado: Rex (Cachorro)');
  });

  it('pets de outra empresa não aparecem nem podem ser lidos', async () => {
    const a = await shop();
    const b = await shop();
    const { body: rex } = await a.as('post', '/pets').send({ customerId: a.tutor.id, name: 'Rex' }).expect(201);
    await b.as('get', `/pets/${rex.id}`).expect(404);
    expect((await b.as('get', '/pets').expect(200)).body).toEqual([]);
    // Nem cadastrar pet para o tutor da outra empresa.
    await b.as('post', '/pets').send({ customerId: a.tutor.id, name: 'Intruso' }).expect(400);
  });

  it('banho concluído avisa o tutor que o pet está pronto (WhatsApp e e-mail)', async () => {
    const s = await shop(['petshop', 'integration.whatsapp']);
    const { body: rex } = await s.as('post', '/pets').send({ customerId: s.tutor.id, name: 'Rex' }).expect(201);
    const { body: a } = await s
      .as('post', '/scheduling/appointments')
      .send({
        customerId: s.tutor.id,
        resourceId: s.groomer.id,
        serviceIds: [s.service('Banho — porte grande').id],
        startsAt: at(nextWeekday(), '10:00'),
        subject: { type: 'pet', id: rex.id, label: 'Rex' },
      })
      .expect(201);
    for (const status of ['arrived', 'in_service', 'done']) await s.as('post', `/scheduling/appointments/${a.id}/status`).send({ status }).expect(200);
    await t.relay.drain();

    const { body: msgs } = await s.as('get', `/notifications?relatedEntity=appointment&relatedId=${a.id}`).expect(200);
    const ready = msgs.filter((m: { templateKey: string }) => m.templateKey === 'petshop.ready');
    expect(ready.map((m: { channel: string }) => m.channel).sort()).toEqual(['email', 'whatsapp']);
    const wa = ready.find((m: { channel: string }) => m.channel === 'whatsapp');
    expect(decodeURIComponent(wa.actionUrl)).toContain('Rex já está pronto(a) (Banho — porte grande)');
  });

  it('sem pet no horário, ou com o aviso desligado, não manda "pet pronto"', async () => {
    const s = await shop();
    await s.as('put', '/modules/petshop/settings').send({ notifyReady: false }).expect(204);
    const { body: rex } = await s.as('post', '/pets').send({ customerId: s.tutor.id, name: 'Rex' }).expect(201);
    const book = (time: string, subject?: unknown) =>
      s
        .as('post', '/scheduling/appointments')
        .send({ customerId: s.tutor.id, resourceId: s.groomer.id, serviceIds: [s.service('Corte de unhas').id], startsAt: at(nextWeekday(), time), subject })
        .expect(201);
    const { body: a } = await book('09:00', { type: 'pet', id: rex.id, label: 'Rex' });
    await s.as('post', `/scheduling/appointments/${a.id}/status`).send({ status: 'done' }).expect(200);
    await t.relay.drain();
    const { body: msgs } = await s.as('get', `/notifications?relatedEntity=appointment&relatedId=${a.id}`).expect(200);
    expect(msgs.filter((m: { templateKey: string }) => m.templateKey === 'petshop.ready')).toEqual([]);
  });

  it('agendamento online pede o pet: cadastra na primeira vez e reaproveita pelo nome depois', async () => {
    const s = await shop();
    const { body: me } = await s.as('get', '/me').expect(200);
    const pub = `/api/public/booking/${me.tenant.slug}`;
    await s.as('put', '/modules/shared.scheduling/settings').send({ onlineBooking: true, onlineMinNoticeHours: 0 }).expect(204);
    await s.as('put', '/scheduling/services/online').send({ serviceIds: [s.service('Banho — porte pequeno').id] }).expect(204);

    const { body: info } = await t.http().get(pub).expect(200);
    expect(info.subject.label).toBe('Pet');
    expect(info.subject.fields.map((f: { key: string }) => f.key)).toEqual(['name', 'species']);
    expect(info.subject.fields[1].options).toEqual(expect.arrayContaining([{ value: 'dog', label: 'Cachorro' }, { value: 'cat', label: 'Gato' }]));

    const day = nextWeekday();
    const serviceId = s.service('Banho — porte pequeno').id;
    const book = (time: string, subjectFields?: Record<string, string>) =>
      t.http().post(pub).send({ name: 'Tutor Online', phone: '48 98765-4321', resourceId: s.groomer.id, serviceIds: [serviceId], startsAt: at(day, time), subjectFields });

    // Sem o nome do pet não marca (e não cria cliente nem pet).
    expect((await book('09:00', { species: 'dog' }).expect(400)).body.code).toBe('VALIDATION');
    expect((await book('09:00', { name: 'Thor', species: 'dinossauro' }).expect(400)).body.code).toBe('VALIDATION');

    const first = await book('09:00', { name: 'Thor', species: 'dog' }).expect(201);
    expect(first.body.subject).toBe('Thor');
    // Mesmo pet, escrito diferente (maiúsculas, acento, espaços): não duplica.
    const second = await book('11:00', { name: '  THÓR ', species: 'dog' }).expect(201);
    expect(second.body.subject).toBe('Thor');

    const { body: customers } = await s.as('get', `/customers?q=${encodeURIComponent('Tutor Online')}`).expect(200);
    const customerId = customers.items[0].id;
    const { body: petsOfTutor } = await s.as('get', `/pets?customerId=${customerId}`).expect(200);
    expect(petsOfTutor).toEqual([expect.objectContaining({ name: 'Thor', species: 'dog' })]);

    const { body: list } = await s.as('get', `/scheduling/appointments?customerId=${customerId}`).expect(200);
    expect(list.map((a: { subject: unknown }) => a.subject)).toEqual([
      { type: 'pet', id: petsOfTutor[0].id, label: 'Thor' },
      { type: 'pet', id: petsOfTutor[0].id, label: 'Thor' },
    ]);
  });

  it('o salão não ativa o módulo de pets', async () => {
    const s = await ownerSession(t, ['beauty']);
    const { body: me } = await s.as('get', '/me').expect(200);
    expect(me.modules.map((m: { key: string }) => m.key)).not.toContain('shared.pets');
  });
});
