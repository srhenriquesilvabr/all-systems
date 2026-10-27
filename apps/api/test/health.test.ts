import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testEnv } from './env';
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

describe('saúde: prontuário, veterinária, estética e ortodontia', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  async function clinic(modules: string[]) {
    const s = await ownerSession(t, modules);
    const { body: customer } = await s.as('post', '/customers').send({ name: 'Paula Paciente', email: uniqueEmail('paciente'), phone: '(48) 99700-3344' }).expect(201);
    const { body: services } = await s.as('get', '/scheduling/services').expect(200);
    const { body: pro } = await s.as('post', '/scheduling/resources').send({ name: 'Dra. Helena' }).expect(201);
    const service = (name: string) => services.find((x: { name: string }) => x.name === name);
    const book = (body: Record<string, unknown>) => s.as('post', '/scheduling/appointments').send({ customerId: customer.id, resourceId: pro.id, ...body });
    const setStatus = (id: string, status: string, reason?: string) => s.as('post', `/scheduling/appointments/${id}/status`).send({ status, reason }).expect(200);
    return { ...s, customer, pro, service, book, setStatus };
  }

  describe('prontuário', () => {
    it('só inclusão: retificação aponta para o original, que continua lá', async () => {
      const s = await clinic(['vet']);
      const { body: rex } = await s.as('post', '/pets').send({ customerId: s.customer.id, name: 'Rex' }).expect(201);
      const subject = `subjectType=pet&subjectId=${rex.id}`;

      const { body: forms } = await s.as('get', '/medical-records/forms?subjectType=pet').expect(200);
      expect(forms.map((f: { key: string }) => f.key)).toEqual(['note', 'vet.consultation', 'vet.exam', 'vet.procedure']);

      const missing = await s.as('post', '/medical-records').send({ subjectType: 'pet', subjectId: rex.id, formKey: 'vet.consultation', data: { weight: '12,5' } }).expect(400);
      expect(missing.body.message).toMatch(/Queixa principal/);
      const { body: entry } = await s
        .as('post', '/medical-records')
        .send({ subjectType: 'pet', subjectId: rex.id, formKey: 'vet.consultation', data: { complaint: 'Vômito há 2 dias', weight: '12,5', invented: 'x' } })
        .expect(201);
      expect(entry.data).toEqual({ complaint: 'Vômito há 2 dias', weight: 12.5 });
      expect(entry.author.name).toBeTruthy();

      await s.as('post', `/medical-records/${entry.id}/amend`).send({ data: { complaint: 'Vômito há 3 dias' } }).expect(400); // sem motivo
      const { body: fix } = await s
        .as('post', `/medical-records/${entry.id}/amend`)
        .send({ data: { complaint: 'Vômito há 3 dias', weight: 12.5 }, reason: 'Tutor corrigiu a data' })
        .expect(201);
      expect(fix).toMatchObject({ amendsId: entry.id, amendReason: 'Tutor corrigiu a data' });
      const again = await s.as('post', `/medical-records/${entry.id}/amend`).send({ data: { complaint: 'x' }, reason: 'de novo' }).expect(409);
      expect(again.body.code).toBe('ALREADY_AMENDED');

      const { body: list } = await s.as('get', `/medical-records?${subject}`).expect(200);
      expect(list.map((e: { id: string }) => e.id)).toEqual([fix.id, entry.id]);
      expect(list[1]).toMatchObject({ amendedById: fix.id, data: { complaint: 'Vômito há 2 dias' } });
    });

    it('atendimento com data passada entra na linha do tempo pela data do atendimento', async () => {
      const s = await clinic(['vet']);
      const { body: rex } = await s.as('post', '/pets').send({ customerId: s.customer.id, name: 'Rex' }).expect(201);
      const today = localToday();
      const note = (notes: string, occurredOn?: string) => s.as('post', '/medical-records').send({ subjectType: 'pet', subjectId: rex.id, formKey: 'note', notes, occurredOn });

      const { body: recent } = await note('Consulta de hoje').expect(201);
      expect(recent.occurredOn).toBe(today);
      // Histórico trazido de outro sistema, lançado depois.
      const { body: old } = await note('Consulta de março', plusDays(today, -200)).expect(201);
      const { body: middle } = await note('Retorno', plusDays(today, -30)).expect(201);
      expect(old.occurredOn).toBe(plusDays(today, -200));
      expect(new Date(old.createdAt).getTime()).toBeGreaterThanOrEqual(new Date(recent.createdAt).getTime());

      const future = await note('Amanhã', plusDays(today, 1)).expect(400);
      expect(String(future.body.message)).toMatch(/não pode ser no futuro/);
      await note('Data torta', '31/12/2024').expect(400);

      // Retificação fica na data do original, a menos que corrija a data.
      const { body: fix } = await s.as('post', `/medical-records/${middle.id}/amend`).send({ notes: 'Retorno (sem febre)', reason: 'Faltou a observação' }).expect(201);
      expect(fix.occurredOn).toBe(middle.occurredOn);
      const { body: moved } = await s
        .as('post', `/medical-records/${old.id}/amend`)
        .send({ notes: 'Consulta de março', reason: 'Data errada', occurredOn: plusDays(today, -199) })
        .expect(201);
      expect(moved.occurredOn).toBe(plusDays(today, -199));

      const { body: list } = await s.as('get', `/medical-records?subjectType=pet&subjectId=${rex.id}`).expect(200);
      expect(list.map((e: { id: string }) => e.id)).toEqual([recent.id, fix.id, middle.id, moved.id, old.id]);
    });

    it('o banco recusa alterar ou apagar registros, mesmo vindo da aplicação', async () => {
      const s = await clinic(['vet']);
      const { body: rex } = await s.as('post', '/pets').send({ customerId: s.customer.id, name: 'Rex' }).expect(201);
      const { body: entry } = await s.as('post', '/medical-records').send({ subjectType: 'pet', subjectId: rex.id, formKey: 'note', notes: 'Primeira consulta' }).expect(201);

      const app = new Client({ connectionString: testEnv.DATABASE_URL });
      await app.connect();
      try {
        await app.query('begin');
        await app.query(`select set_config('app.tenant_id', $1, true)`, [s.tenantId]);
        await expect(app.query(`update mr_entries set notes = 'adulterado' where id = $1`, [entry.id])).rejects.toThrow(/permission denied/);
        await app.query('rollback');
        await app.query('begin');
        await app.query(`select set_config('app.tenant_id', $1, true)`, [s.tenantId]);
        await expect(app.query(`delete from mr_access_log`)).rejects.toThrow(/permission denied/);
        await app.query('rollback');
      } finally {
        await app.end();
      }
    });

    it('anexo só sai pelo prontuário, com registro de quem abriu', async () => {
      const s = await clinic(['aesthetics']);
      const { body: entry } = await s
        .as('post', '/medical-records')
        .send({ subjectType: 'customer', subjectId: s.customer.id, formKey: 'aesthetics.anamnesis', data: { complaint: 'Manchas', pregnant: false, phototype: 'III' } })
        .expect(201);
      const pdf = Buffer.from('%PDF-1.4\n%fake\n');
      const { body: file } = await s.as('post', `/medical-records/${entry.id}/attachments`).attach('file', pdf, { filename: 'termo.pdf', contentType: 'application/pdf' }).expect(201);
      await s.as('post', `/medical-records/${entry.id}/attachments`).attach('file', Buffer.from('x'), { filename: 'a.txt', contentType: 'text/plain' }).expect(400);

      await s.as('get', `/files/${file.id}`).expect(404); // download genérico não serve anexo de prontuário
      const download = await s.as('get', `/medical-records/attachments/${file.id}`).buffer(true).expect(200);
      expect(download.headers['content-type']).toBe('application/pdf');
      expect(download.headers['cache-control']).toBe('private, no-store');

      await s.as('get', `/medical-records?subjectType=customer&subjectId=${s.customer.id}`).expect(200);
      const { body: log } = await s.as('get', `/medical-records/access-log?subjectType=customer&subjectId=${s.customer.id}`).expect(200);
      expect(log.map((l: { action: string }) => l.action)).toEqual(['view', 'download', 'attach', 'create']);
    });

    it('outra empresa não vê nem escreve no prontuário', async () => {
      const a = await clinic(['aesthetics']);
      const b = await clinic(['aesthetics']);
      await a.as('post', '/medical-records').send({ subjectType: 'customer', subjectId: a.customer.id, formKey: 'note', notes: 'Sigiloso' }).expect(201);
      await b.as('get', `/medical-records?subjectType=customer&subjectId=${a.customer.id}`).expect(404);
      await b.as('post', '/medical-records').send({ subjectType: 'customer', subjectId: a.customer.id, formKey: 'note', notes: 'x' }).expect(404);
      // Formulário de outra vertical não está disponível.
      await b.as('post', '/medical-records').send({ subjectType: 'customer', subjectId: b.customer.id, formKey: 'ortho.anamnesis', data: { complaint: 'x' } }).expect(400);
    });
  });

  describe('veterinária', () => {
    it('vacina com reforço próximo gera um lembrete só, e só da dose mais recente', async () => {
      const s = await clinic(['vet']);
      const { body: rex } = await s.as('post', '/pets').send({ customerId: s.customer.id, name: 'Rex' }).expect(201);
      const today = localToday();
      const vaccinate = (vaccine: string, appliedOn: string, nextDueOn: string) =>
        s.as('post', '/vet/vaccinations').send({ petId: rex.id, vaccine, appliedOn, nextDueOn }).expect(201);
      const { body: v10 } = await vaccinate('V10', plusDays(today, -362), plusDays(today, 3));
      // Antirrábica antiga já foi reaplicada: a antiga não deve gerar lembrete.
      await vaccinate('Antirrábica', plusDays(today, -700), plusDays(today, 2));
      await vaccinate('Antirrábica', plusDays(today, -5), plusDays(today, 360));
      await s.as('post', '/vet/vaccinations').send({ petId: rex.id, vaccine: 'Giárdia', appliedOn: today, nextDueOn: plusDays(today, -1) }).expect(400);
      const future = await s.as('post', '/vet/vaccinations').send({ petId: rex.id, vaccine: 'Giárdia', appliedOn: plusDays(today, 1) }).expect(400);
      expect(String(future.body.message)).toMatch(/não pode ser no futuro/);

      await t.jobs.runOnce('vet.vaccine-reminders');
      await t.jobs.runOnce('vet.vaccine-reminders');
      await t.relay.drain();
      const { body: msgs } = await s.as('get', `/notifications?relatedEntity=vet_vaccination&relatedId=${v10.id}`).expect(200);
      expect(msgs).toHaveLength(1);
      expect(msgs[0]).toMatchObject({ templateKey: 'vet.vaccine_due', status: 'sent' });
      expect(t.mails.at(-1)!.subject).toBe(`Vacina de Rex: reforço em ${plusDays(today, 3).split('-').reverse().join('/')}`);

      const { body: due } = await s.as('get', `/vet/vaccinations/due?until=${plusDays(today, 30)}`).expect(200);
      expect(due.map((d: { vaccine: string }) => d.vaccine)).toEqual(['V10']);

      const { body: voided } = await s.as('post', `/vet/vaccinations/${v10.id}/void`).send({ reason: 'Lançada no pet errado' }).expect(201);
      expect(voided.voided.reason).toBe('Lançada no pet errado');
      expect((await s.as('get', `/vet/vaccinations/due?until=${plusDays(today, 30)}`).expect(200)).body).toEqual([]);
    });
  });

  describe('estética', () => {
    it('pacote: parcelas no financeiro, sessão marcada sai a R$ 0 e é consumida ao concluir', async () => {
      const s = await clinic(['aesthetics']);
      const drainage = s.service('Drenagem linfática');
      const firstDueOn = localToday();
      const { body: pkg } = await s
        .as('post', '/aesthetics/packages')
        .send({ customerId: s.customer.id, serviceId: drainage.id, totalSessions: 2, price: '250.01', installments: 3, firstDueOn })
        .expect(201);
      expect(pkg).toMatchObject({ totalSessions: 2, usedSessions: 0, status: 'active' });

      const { body: entries } = await s.as('get', `/finance/entries?limit=100&customerId=${s.customer.id}`).expect(200);
      const parcels = entries.items.filter((e: { sourceId: string }) => e.sourceId === pkg.id).sort((x: { dueDate: string }, y: { dueDate: string }) => x.dueDate.localeCompare(y.dueDate));
      expect(parcels.map((e: { amount: number }) => e.amount)).toEqual([83.35, 83.33, 83.33]);

      const day = nextWeekday();
      const { body: a1 } = await s.book({ serviceIds: [drainage.id], startsAt: at(day, '09:00') }).expect(201);
      expect(a1.total).toBe(0);
      expect(a1.services[0].name).toBe('Drenagem linfática (pacote 1/2)');
      const { body: a2 } = await s.book({ serviceIds: [drainage.id], startsAt: at(day, '11:00') }).expect(201);
      expect(a2.services[0].name).toBe('Drenagem linfática (pacote 2/2)');
      // Sem saldo: a terceira sai pelo preço normal.
      const { body: a3 } = await s.book({ serviceIds: [drainage.id], startsAt: at(day, '14:00') }).expect(201);
      expect(a3.total).toBe(140);

      // Cancelar libera a sessão; concluir consome.
      await s.setStatus(a2.id, 'cancelled', 'Cliente remarcou');
      await s.setStatus(a1.id, 'done');
      await t.relay.drain();
      let [current] = (await s.as('get', `/aesthetics/packages?customerId=${s.customer.id}`).expect(200)).body;
      expect(current).toMatchObject({ usedSessions: 1, reservedSessions: 0, status: 'active' });

      const { body: a4 } = await s.book({ serviceIds: [drainage.id], startsAt: at(day, '16:00') }).expect(201);
      expect(a4.total).toBe(0);
      await s.as('post', `/aesthetics/packages/${pkg.id}/cancel`).send({ reason: 'Desistiu' }).expect(400); // tem horário marcado
      await s.setStatus(a4.id, 'done');
      await t.relay.drain();
      [current] = (await s.as('get', `/aesthetics/packages?customerId=${s.customer.id}`).expect(200)).body;
      expect(current).toMatchObject({ usedSessions: 2, status: 'finished' });

      // Atendimentos de pacote não geram "a receber" (o pacote já gerou).
      const after = (await s.as('get', `/finance/entries?limit=100&customerId=${s.customer.id}`).expect(200)).body.items;
      expect(after.filter((e: { sourceId: string }) => [a1.id, a4.id].includes(e.sourceId))).toEqual([]);
    });

    it('pacote vendido em data passada: parcelas a partir da venda; venda no futuro é recusada', async () => {
      const s = await clinic(['aesthetics']);
      const drainage = s.service('Drenagem linfática');
      const soldOn = plusDays(localToday(), -40);
      const sell = (body: Record<string, unknown>) => s.as('post', '/aesthetics/packages').send({ customerId: s.customer.id, serviceId: drainage.id, totalSessions: 4, price: 400, installments: 2, ...body });
      const future = await sell({ soldOn: plusDays(localToday(), 1) }).expect(400);
      expect(String(future.body.message)).toMatch(/não pode ser no futuro/);

      const { body: pkg } = await sell({ soldOn }).expect(201);
      expect(pkg.soldOn).toBe(soldOn);
      const { body: entries } = await s.as('get', `/finance/entries?limit=100&customerId=${s.customer.id}`).expect(200);
      const due = entries.items
        .filter((e: { sourceId: string }) => e.sourceId === pkg.id)
        .map((e: { dueDate: string; competenceDate: string }) => [e.dueDate, e.competenceDate])
        .sort();
      const second = new Date(`${soldOn}T12:00:00Z`);
      second.setUTCMonth(second.getUTCMonth() + 1);
      expect(due[0]).toEqual([soldOn, soldOn]);
      expect(due[1]![0].slice(0, 7)).toBe(second.toISOString().slice(0, 7));

      const { body: cancelled } = await s.as('post', `/aesthetics/packages/${pkg.id}/cancel`).send({ reason: 'Desistiu', cancelledOn: plusDays(localToday(), -10) }).expect(201);
      expect(cancelled).toMatchObject({ status: 'cancelled', cancelledOn: plusDays(localToday(), -10) });
    });
  });

  describe('ortodontia', () => {
    it('tratamento lança mensalidades, cobre a manutenção na agenda e cancela o que está em aberto', async () => {
      const s = await clinic(['orthodontics']);
      const { body: tr } = await s
        .as('post', '/orthodontics/treatments')
        .send({ customerId: s.customer.id, appliance: 'fixed_metal', startedOn: '2026-01-31', expectedMonths: 12, entryFee: 500, monthlyFee: 199.9, dueDay: 10 })
        .expect(201);
      expect(tr.installments).toHaveLength(13);
      expect(tr.installments[0]).toMatchObject({ dueDate: '2026-01-31', amount: 500 });
      expect(tr.installments[1]).toMatchObject({ dueDate: '2026-02-10', amount: 199.9, description: 'Ortodontia: mensalidade 1/12' });
      expect(tr.installments.at(-1).dueDate).toBe('2027-01-10');
      await s.as('post', '/orthodontics/treatments').send({ customerId: s.customer.id, appliance: 'aligners', startedOn: '2026-02-01', expectedMonths: 6, monthlyFee: 100, dueDay: 5 }).expect(400);

      const { body: maintenance } = await s.book({ serviceIds: [s.service('Manutenção mensal').id], startsAt: at(nextWeekday(), '10:00') }).expect(201);
      expect(maintenance.total).toBe(0);
      const { body: bracket } = await s.book({ serviceIds: [s.service('Colagem de bráquete').id], startsAt: at(nextWeekday(), '15:00') }).expect(201);
      expect(bracket.total).toBe(60);

      const { body: extended } = await s.as('post', `/orthodontics/treatments/${tr.id}/extend`).send({ months: 6 }).expect(201);
      expect(extended).toMatchObject({ expectedMonths: 18, totalInstallments: 18 });
      expect(extended.installments.at(-1)).toMatchObject({ dueDate: '2027-07-10', description: 'Ortodontia: mensalidade 18/18' });

      const { body: cancelled } = await s.as('post', `/orthodontics/treatments/${tr.id}/cancel`).send({ reason: 'Mudou de cidade' }).expect(201);
      expect(cancelled.status).toBe('cancelled');
      expect(cancelled.installments.every((i: { status: string }) => i.status === 'cancelled')).toBe(true);

      // Sem tratamento ativo, a manutenção volta a ser cobrada.
      const { body: later } = await s.book({ serviceIds: [s.service('Manutenção mensal').id], startsAt: at(nextWeekday(), '16:00') }).expect(201);
      expect(later.total).toBe(180);
    });

    it('tratamento concluído em data passada cancela só as mensalidades que vencem depois dela', async () => {
      const s = await clinic(['orthodontics']);
      const { body: tr } = await s
        .as('post', '/orthodontics/treatments')
        .send({ customerId: s.customer.id, appliance: 'aligners', startedOn: plusDays(localToday(), -150), expectedMonths: 12, monthlyFee: 150, dueDay: 10 })
        .expect(201);
      const finishedOn = plusDays(localToday(), -30);
      await s.as('post', `/orthodontics/treatments/${tr.id}/finish`).send({ finishedOn: plusDays(localToday(), 1) }).expect(400);
      await s.as('post', `/orthodontics/treatments/${tr.id}/finish`).send({ finishedOn: plusDays(localToday(), -200) }).expect(400); // antes do início

      const { body: done } = await s.as('post', `/orthodontics/treatments/${tr.id}/finish`).send({ finishedOn }).expect(201);
      expect(done).toMatchObject({ status: 'finished', finishedOn });
      for (const i of done.installments as { dueDate: string; status: string }[]) {
        expect(i.status).toBe(i.dueDate > finishedOn ? 'cancelled' : 'pending');
      }
      expect(done.installments.some((i: { status: string }) => i.status === 'pending')).toBe(true);
    });
  });
});
