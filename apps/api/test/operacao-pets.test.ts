import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, ownerSession, uniqueEmail, type TestApp } from './helpers';

const at = (date: string, time: string) => new Date(`${date}T${time}:00-03:00`).toISOString();
const localToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const plusDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
function nextWeekday(offset = 2): string {
  const d = new Date(Date.now() + offset * 86_400_000);
  for (;;) {
    const local = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d);
    const wd = new Date(`${local}T12:00:00Z`).getUTCDay();
    if (wd >= 1 && wd <= 5) return local;
    d.setTime(d.getTime() + 86_400_000);
  }
}
const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

describe('pet shop e veterinária', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  async function shop(modules = ['petshop']) {
    const s = await ownerSession(t, modules);
    const { body: tutor } = await s.as('post', '/customers').send({ name: 'Carla', email: uniqueEmail('carla'), phone: '(48) 99800-1122' }).expect(201);
    const { body: services } = await s.as('get', '/scheduling/services').expect(200);
    const { body: professional } = await s.as('post', '/scheduling/resources').send({ name: 'Duda' }).expect(201);
    const { body: rex } = await s.as('post', '/pets').send({ customerId: tutor.id, name: 'Rex' }).expect(201);
    // O serviço mais curto: os horários do teste não se cruzam.
    const shortest = [...services].sort((a: { durationMin: number }, b: { durationMin: number }) => a.durationMin - b.durationMin)[0] as { id: string };
    return { ...s, tutor, services, shortest, professional, rex };
  }
  type S = Awaited<ReturnType<typeof shop>>;

  const book = async (s: S, time: string, subject?: unknown) =>
    (
      await s
        .as('post', '/scheduling/appointments')
        .send({ customerId: s.tutor.id, resourceId: s.professional.id, serviceIds: [s.shortest.id], startsAt: at(nextWeekday(), time), subject })
        .expect(201)
    ).body as { id: string; startsAt: string };
  const finish = (s: S, id: string) => s.as('post', `/scheduling/appointments/${id}/status`).send({ status: 'done' }).expect(200);
  const range = (a: { startsAt: string }) => `from=${encodeURIComponent(new Date(Date.parse(a.startsAt) - 3600_000).toISOString())}&to=${encodeURIComponent(new Date(Date.parse(a.startsAt) + 3600_000).toISOString())}`;

  describe('quadro do banho e tosa', () => {
    it('registra que o tutor buscou, uma vez, só depois de pronto, e dá para desfazer', async () => {
      const s = await shop();
      const a = await book(s, '09:00', { type: 'pet', id: s.rex.id, label: 'Rex' });

      const early = await s.as('post', `/petshop/appointments/${a.id}/pickup`).expect(400);
      expect(early.body.code).toBe('NOT_READY');
      await finish(s, a.id);

      const { body: pickup } = await s.as('post', `/petshop/appointments/${a.id}/pickup`).expect(201);
      expect(pickup.pickedUpAt).toEqual(expect.any(String));
      expect((await s.as('post', `/petshop/appointments/${a.id}/pickup`).expect(409)).body.code).toBe('ALREADY_PICKED_UP');

      const { body: list } = await s.as('get', `/petshop/pickups?${range(a)}`).expect(200);
      expect(list).toEqual([expect.objectContaining({ appointmentId: a.id, userName: 'Dono Teste' })]);

      await s.as('delete', `/petshop/appointments/${a.id}/pickup`).expect(204);
      expect((await s.as('get', `/petshop/pickups?${range(a)}`).expect(200)).body).toEqual([]);
      await s.as('delete', `/petshop/appointments/${a.id}/pickup`).expect(404);
    });

    it('sem pet, não avisa; escolhido o pet pelo quadro, o aviso sai ao concluir', async () => {
      const s = await shop();
      const without = await book(s, '10:00');
      await finish(s, without.id);
      await t.relay.drain();
      const silent = await s.as('get', `/notifications?relatedEntity=appointment&relatedId=${without.id}`).expect(200);
      expect(silent.body.filter((m: { templateKey: string }) => m.templateKey === 'petshop.ready')).toEqual([]);

      const later = await book(s, '11:00');
      await s.as('post', `/petshop/appointments/${later.id}/pet`).send({ petId: s.rex.id }).expect(200);
      await finish(s, later.id);
      await t.relay.drain();
      const told = await s.as('get', `/notifications?relatedEntity=appointment&relatedId=${later.id}`).expect(200);
      expect(told.body.filter((m: { templateKey: string }) => m.templateKey === 'petshop.ready').length).toBeGreaterThan(0);

      // Pet de outro tutor e horário já encerrado são recusados.
      const { body: other } = await s.as('post', '/customers').send({ name: 'Outra', email: uniqueEmail('outra') }).expect(201);
      const { body: mia } = await s.as('post', '/pets').send({ customerId: other.id, name: 'Mia' }).expect(201);
      const third = await book(s, '13:00');
      expect((await s.as('post', `/petshop/appointments/${third.id}/pet`).send({ petId: mia.id }).expect(400)).body.code).toBe('PET_NOT_FOUND');
      expect((await s.as('post', `/petshop/appointments/${without.id}/pet`).send({ petId: s.rex.id }).expect(400)).body.code).toBe('APPOINTMENT_CLOSED');
    });
  });

  it('a lista de pets pagina, com o total, e a busca respeita a paginação', async () => {
    const s = await shop();
    for (const name of ['Amora', 'Bidu', 'Cacau']) await s.as('post', '/pets').send({ customerId: s.tutor.id, name }).expect(201);
    const { body: first } = await s.as('get', '/pets/page?limit=2&offset=0').expect(200);
    expect(first).toMatchObject({ total: 4 });
    expect(first.items.map((p: { name: string }) => p.name)).toEqual(['Amora', 'Bidu']);
    const { body: second } = await s.as('get', '/pets/page?limit=2&offset=2').expect(200);
    expect(second.items.map((p: { name: string }) => p.name)).toEqual(['Cacau', 'Rex']);
    const { body: found } = await s.as('get', '/pets/page?q=cac').expect(200);
    expect(found).toMatchObject({ total: 1 });
  });

  describe('vacinas', () => {
    const vaccinate = (s: S, vaccine: string, appliedOn: string, extra: object = {}) => s.as('post', '/vet/vaccinations').send({ petId: s.rex.id, vaccine, appliedOn, ...extra });

    it('nomes diferentes da mesma vacina contam como uma só, sem perder o que foi digitado', async () => {
      const s = await shop(['vet']);
      const today = localToday();
      await vaccinate(s, 'V10', plusDays(today, -362), { nextDueOn: plusDays(today, 3) }).expect(201);
      const { body: renewed } = await vaccinate(s, 'V10 polivalente', plusDays(today, -2), { nextDueOn: plusDays(today, 360) }).expect(201);
      expect(renewed).toMatchObject({ vaccine: 'V10 polivalente', vaccineName: 'V10 (polivalente canina)' });

      // A dose antiga sai dos reforços e não gera lembrete.
      const { body: due } = await s.as('get', `/vet/vaccinations/due?until=${plusDays(today, 30)}`).expect(200);
      expect(due).toEqual([]);

      const { body: card } = await s.as('get', `/vet/pets/${s.rex.id}/vaccinations`).expect(200);
      expect(card.map((v: { vaccine: string }) => v.vaccine)).toEqual(['V10 polivalente', 'V10']);
      expect(new Set(card.map((v: { vaccineId: string }) => v.vaccineId)).size).toBe(1);
    });

    it('vacina fora do catálogo entra nele; juntar leva as aplicações e anula só a repetida', async () => {
      const s = await shop(['vet']);
      const today = localToday();
      const day = plusDays(today, -30);
      await vaccinate(s, 'Polivalente Importada', day, { notes: 'Trazida de fora' }).expect(201);
      await vaccinate(s, 'V8', day).expect(201);
      const { body: catalog } = await s.as('get', '/vet/vaccines').expect(200);
      const imported = catalog.find((v: { name: string }) => v.name === 'Polivalente Importada');
      const v8 = catalog.find((v: { name: string }) => v.name === 'V8 (polivalente canina)');
      expect(imported.uses).toBe(1);

      expect((await s.as('post', '/vet/vaccines').send({ name: 'V-8' }).expect(409)).body.code).toBe('VACCINE_EXISTS');
      await s.as('post', `/vet/vaccines/${imported.id}/merge`).send({ intoId: imported.id }).expect(409);

      await s.as('post', `/vet/vaccines/${imported.id}/merge`).send({ intoId: v8.id }).expect(200);
      const { body: card } = await s.as('get', `/vet/pets/${s.rex.id}/vaccinations`).expect(200);
      expect(card).toHaveLength(2);
      expect(card.every((v: { vaccineId: string }) => v.vaccineId === v8.id)).toBe(true);
      expect(card.filter((v: { voided: unknown }) => v.voided)).toHaveLength(1);
      expect(card.find((v: { vaccine: string }) => v.vaccine === 'Polivalente Importada').notes).toBe('Trazida de fora');

      // O nome antigo passou a ser apelido: registrar por ele conta como V8.
      const { body: byAlias } = await vaccinate(s, 'polivalente importada', today).expect(201);
      expect(byAlias.vaccineId).toBe(v8.id);
    });

    it('repetir a mesma vacina na mesma data é recusado; pela importação, é ignorado e não duplica', async () => {
      const s = await shop(['vet']);
      const day = plusDays(localToday(), -10);
      const { body: first } = await vaccinate(s, 'Antirrábica', day).expect(201);

      const again = await vaccinate(s, 'anti-rábica', day).expect(409);
      expect(again.body.code).toBe('DUPLICATE_VACCINATION');

      const { body: imported } = await vaccinate(s, 'Raiva', day, { skipDuplicate: true }).expect(201);
      expect(imported).toMatchObject({ id: first.id, duplicate: true });
      expect((await s.as('get', `/vet/pets/${s.rex.id}/vaccinations`).expect(200)).body).toHaveLength(1);

      // Anulada não conta: dá para registrar de novo com os dados certos.
      await s.as('post', `/vet/vaccinations/${first.id}/void`).send({ reason: 'Data errada' }).expect(201);
      await vaccinate(s, 'Antirrábica', day).expect(201);
    });

    it('a coluna Lembrete mostra o que aconteceu: sem contato, não diz que enviou', async () => {
      const s = await shop(['vet']);
      const today = localToday();
      const { body: noContact } = await s.as('post', '/customers').send({ name: 'Sem contato' }).expect(201);
      const { body: thor } = await s.as('post', '/pets').send({ customerId: noContact.id, name: 'Thor' }).expect(201);
      await s.as('post', '/vet/vaccinations').send({ petId: thor.id, vaccine: 'V10', appliedOn: plusDays(today, -360), nextDueOn: plusDays(today, 3) }).expect(201);
      await vaccinate(s, 'Giárdia', plusDays(today, -360), { nextDueOn: plusDays(today, 3) }).expect(201);

      await t.jobs.runOnce('vet.vaccine-reminders');
      await t.relay.drain();
      const { body: due } = await s.as('get', `/vet/vaccinations/due?until=${plusDays(today, 10)}`).expect(200);
      const of = (name: string) => due.find((d: { pet: { name: string } }) => d.pet.name === name).reminder;
      expect(of('Thor')).toEqual({ status: 'skipped', detail: expect.stringMatching(/sem e-mail/) });
      expect(of('Rex')).toMatchObject({ status: 'sent' });
    });

    it('a configuração de dias vale para o lembrete, e zero desliga', async () => {
      const s = await shop(['vet']);
      const today = localToday();
      await s.as('put', '/modules/vet/settings').send({ vaccineReminderDays: 0 }).expect(204);
      const { body: v } = await vaccinate(s, 'Giárdia', plusDays(today, -360), { nextDueOn: plusDays(today, 1) }).expect(201);
      await t.jobs.runOnce('vet.vaccine-reminders');
      await t.relay.drain();
      expect((await s.as('get', `/notifications?relatedEntity=vet_vaccination&relatedId=${v.id}`).expect(200)).body).toEqual([]);
      await s.as('put', '/modules/vet/settings').send({ vaccineReminderDays: 61 }).expect(400);
    });
  });

  describe('retorno e horário da agenda', () => {
    it('a consulta se liga ao horário do próprio pet; horário de outro pet é recusado', async () => {
      const s = await shop(['vet']);
      const a = await book(s, '09:00', { type: 'pet', id: s.rex.id, label: 'Rex' });
      const { body: mia } = await s.as('post', '/pets').send({ customerId: s.tutor.id, name: 'Mia' }).expect(201);
      const entry = (subjectId: string) => s.as('post', '/medical-records').send({ subjectType: 'pet', subjectId, formKey: 'vet.consultation', data: { complaint: 'Tosse' }, appointmentId: a.id });

      const refused = await entry(mia.id).expect(400);
      expect(refused.body.code).toBe('APPOINTMENT_MISMATCH');
      const { body: ok } = await entry(s.rex.id).expect(201);
      expect(ok.appointmentId).toBe(a.id);
    });

    it('marca o retorno com o pet, pela permissão do prontuário, e recusa horário ocupado', async () => {
      const s = await shop(['vet']);
      const day = nextWeekday(5);
      const body = { resourceId: s.professional.id, serviceIds: [s.shortest.id], startsAt: at(day, '10:00') };
      const { body: created } = await s.as('post', `/vet/pets/${s.rex.id}/return-appointment`).send(body).expect(201);
      expect(created.subject).toMatchObject({ type: 'pet', id: s.rex.id, label: 'Rex' });
      expect(created.customer.id).toBe(s.tutor.id);
      await s.as('post', `/vet/pets/${s.rex.id}/return-appointment`).send(body).expect(409);
    });
  });

  describe('retificação com anexos', () => {
    it('a nova versão mostra os anexos do original por referência, e nada é copiado', async () => {
      const s = await shop(['vet']);
      const { body: entry } = await s.as('post', '/medical-records').send({ subjectType: 'pet', subjectId: s.rex.id, formKey: 'note', notes: 'Original' }).expect(201);
      const { body: file } = await s.as('post', `/medical-records/${entry.id}/attachments`).attach('file', PNG_1PX, { filename: 'laudo.png', contentType: 'image/png' }).expect(201);

      const { body: fix } = await s.as('post', `/medical-records/${entry.id}/amend`).send({ notes: 'Corrigido', reason: 'Texto errado' }).expect(201);
      expect(fix.attachments).toEqual([expect.objectContaining({ id: file.id, filename: 'laudo.png', inheritedFrom: { entryId: entry.id, occurredOn: entry.occurredOn } })]);

      // Segunda retificação: continua levando, e um anexo novo fica na versão dele.
      const { body: second } = await s.as('post', `/medical-records/${fix.id}/amend`).send({ notes: 'Corrigido de novo', reason: 'Faltou' }).expect(201);
      const { body: own } = await s.as('post', `/medical-records/${second.id}/attachments`).attach('file', PNG_1PX, { filename: 'novo.png', contentType: 'image/png' }).expect(201);
      const { body: list } = await s.as('get', `/medical-records?subjectType=pet&subjectId=${s.rex.id}`).expect(200);
      const latest = list.find((e: { id: string }) => e.id === second.id);
      expect(latest.attachments.map((a: { id: string }) => a.id).sort()).toEqual([file.id, own.id].sort());
      expect(latest.attachments.find((a: { id: string }) => a.id === own.id).inheritedFrom).toBeUndefined();

      // O original continua igual, com o arquivo dele, que abre normalmente.
      const original = list.find((e: { id: string }) => e.id === entry.id);
      expect(original.attachments).toEqual([expect.objectContaining({ id: file.id })]);
      expect(original.attachments[0].inheritedFrom).toBeUndefined();
      await s.as('get', `/medical-records/attachments/${file.id}`).buffer(true).expect(200);
    });
  });
});
