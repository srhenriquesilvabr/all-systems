import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testEnv } from './env';
import { createTestApp, ownerSession, uniqueEmail, type TestApp } from './helpers';

const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const SIGNATURE = `data:image/png;base64,${PNG_1PX.toString('base64')}`;
const at = (date: string, time: string) => new Date(`${date}T${time}:00-03:00`).toISOString();
const localToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const plusDays = (n: number) => {
  const d = new Date(`${localToday()}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

function nextWeekday(offset = 3): string {
  const d = new Date(Date.now() + offset * 86_400_000);
  for (;;) {
    const local = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d);
    const wd = new Date(`${local}T12:00:00Z`).getUTCDay();
    if (wd >= 1 && wd <= 5) return local;
    d.setTime(d.getTime() + 86_400_000);
  }
}

describe('estética: especialidades', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  async function clinic(specialties: string[] = []) {
    const s = await ownerSession(t, ['aesthetics']);
    const { body: customer } = await s.as('post', '/customers').send({ name: 'Paula Paciente', email: uniqueEmail('paciente'), phone: '(48) 99700-3344' }).expect(201);
    const pro = async (name: string) => (await s.as('post', '/scheduling/resources').send({ name }).expect(201)).body as { id: string; teamMemberId: string };
    const enable = async (list: string[]) => {
      const { body: current } = await s.as('get', '/modules/aesthetics/settings').expect(200);
      await s.as('put', '/modules/aesthetics/settings').send({ ...current, specialties: list }).expect(204);
    };
    if (specialties.length) await enable(specialties);
    const credential = (resourceId: string, body: Record<string, unknown>) => s.as('put', `/aesthetics/credentials/${resourceId}`).send(body).expect(204);
    const record = (body: Record<string, unknown>) => s.as('post', '/aesthetics/records').send({ customerId: customer.id, ...body });
    const services = async () => (await s.as('get', '/scheduling/services').expect(200)).body as { id: string; name: string; requiresRoom: boolean }[];
    return { ...s, customer, pro, enable, credential, record, services };
  }

  it('nenhuma especialidade ligada: tudo como antes; ligar cria serviços, termos e o equipamento sem duplicar', async () => {
    const s = await clinic();
    expect((await s.as('get', '/aesthetics/specialties').expect(200)).body.enabled).toEqual([]);
    const before = await s.services();
    expect(before.some((x) => x.name === 'Toxina botulínica')).toBe(false);
    expect((await s.record({ specialty: 'harmonization', formKey: 'aesthetics.harmonization', data: {} }).expect(400)).body.code).toBe('SPECIALTY_DISABLED');

    // As fichas das especialidades são geridas pela tela da estética: a rota genérica recusa.
    const { body: forms } = await s.as('get', '/medical-records/forms?subjectType=customer').expect(200);
    expect(forms.find((f: { key: string }) => f.key === 'aesthetics.harmonization')).toMatchObject({ managed: true });
    expect(forms.find((f: { key: string }) => f.key === 'aesthetics.anamnesis').managed).toBeUndefined();
    const generic = await s
      .as('post', '/medical-records')
      .send({ subjectType: 'customer', subjectId: s.customer.id, formKey: 'aesthetics.harmonization', data: { procedure: 'Toxina botulínica' } })
      .expect(400);
    expect(generic.body.code).toBe('FORM_MANAGED');

    await s.enable(['harmonization', 'laser']);
    const after = await s.services();
    expect(after.filter((x) => x.name === 'Toxina botulínica')).toHaveLength(1);
    expect(after.find((x) => x.name === 'Depilação a laser (área média)')).toMatchObject({ requiresRoom: true });
    // "Depilação a laser (área pequena)" já vinha com a estética: não duplica.
    expect(after.filter((x) => x.name === 'Depilação a laser (área pequena)')).toHaveLength(1);
    const { body: resources } = await s.as('get', '/scheduling/resources').expect(200);
    expect(resources.filter((r: { name: string; kind: string }) => r.kind === 'room' && r.name === 'Laser de diodo (equipamento)')).toHaveLength(1);
    const { body: templates } = await s.as('get', '/aesthetics/consent-templates').expect(200);
    expect(templates.map((x: { key: string }) => x.key).sort()).toEqual(['common.image-use', 'harmonization.biostimulator', 'harmonization.filler', 'harmonization.toxin', 'laser.default']);

    // Salvar de novo (ou religar) não duplica nada.
    await s.enable(['harmonization', 'laser']);
    expect((await s.services()).length).toBe(after.length);
    expect((await s.as('get', '/aesthetics/consent-templates').expect(200)).body).toHaveLength(templates.length);
    const { body: again } = await s.as('get', '/scheduling/resources').expect(200);
    expect(again.length).toBe(resources.length);

    // Desligar não apaga nada.
    await s.enable([]);
    expect((await s.as('get', '/aesthetics/specialties').expect(200)).body.enabled).toEqual([]);
    expect((await s.services()).length).toBe(after.length);
  });

  it('harmonização: registro no conselho, lote válido, mapa facial, rastreio do lote e baixa no estoque', async () => {
    const s = await clinic(['harmonization']);
    const helena = await s.pro('Dra. Helena Vasconcelos');

    const { body: vial } = await s.as('post', '/sales/products').send({ name: 'Toxina 100 U (frasco)', price: 1000, unit: 'un', trackStock: true }).expect(201);
    await s.as('post', '/sales/stock-moves').send({ productId: vial.id, kind: 'purchase', quantity: 3, unitCost: 800 }).expect(201);

    const { body: product } = await s
      .as('post', '/aesthetics/products')
      .send({ name: 'Toxina botulínica 100 U', brand: 'Botox', kind: 'toxin', unit: 'U', unitsPerPackage: 100, salesProductId: vial.id, anvisaRegistration: '1004300120024' })
      .expect(201);
    expect((await s.as('post', '/aesthetics/products').send({ name: 'TOXINA BOTULÍNICA 100 U', kind: 'toxin', unit: 'U' }).expect(409)).body.code).toBe('PRODUCT_EXISTS');

    const { body: withLot } = await s.as('post', '/aesthetics/lots').send({ productId: product.id, lot: 'c7845a2', expiresOn: plusDays(300), quantity: 300 }).expect(201);
    const lot = withLot.lots.find((l: { lot: string }) => l.lot === 'C7845A2');
    expect(lot).toMatchObject({ used: 0, expired: false, quantity: 300 });
    expect((await s.as('post', '/aesthetics/lots').send({ productId: product.id, lot: 'C7845A2', expiresOn: plusDays(300) }).expect(409)).body.code).toBe('LOT_EXISTS');
    const { body: withOld } = await s.as('post', '/aesthetics/lots').send({ productId: product.id, lot: 'OLD1', expiresOn: plusDays(-10) }).expect(201);
    const old = withOld.lots.find((l: { lot: string }) => l.lot === 'OLD1');
    expect(old.expired).toBe(true);

    const points = (lotId: string) => [
      { region: 'Glabela', x: 100, y: 80, lotId, amount: 20, unit: '' },
      { region: 'Frontal', x: 100, y: 46, lotId, amount: 10, unit: '' },
    ];
    const base = { specialty: 'harmonization', formKey: 'aesthetics.harmonization' };
    expect((await s.record({ ...base, data: { procedure: 'Toxina botulínica', points: points(lot.id) } }).expect(400)).body.code).toBe('PROFESSIONAL_REQUIRED');
    expect((await s.record({ ...base, professionalId: helena.id, data: { procedure: 'Toxina botulínica', points: points(lot.id) } }).expect(400)).body.code).toBe('CREDENTIAL_REQUIRED');
    await s.credential(helena.id, { council: 'CRM', number: '123456', uf: 'SP', specialty: 'Dermatologia' });
    expect((await s.record({ ...base, professionalId: helena.id, data: { procedure: 'Toxina botulínica', points: points(old.id) } }).expect(400)).body.code).toBe('LOT_EXPIRED');

    const { body: entry } = await s
      .record({ ...base, professionalId: helena.id, data: { procedure: 'Toxina botulínica', points: points(lot.id), returnOn: plusDays(15), product: 'adulterado' } })
      .expect(201);
    expect(entry.data.professional).toBe('Dra. Helena Vasconcelos — CRM-SP 123456');
    // Produto, lote e validade vêm do cadastro, não do que a tela mandou.
    expect(entry.data.points[0]).toMatchObject({ region: 'Glabela', product: 'Toxina botulínica 100 U (Botox)', lot: 'C7845A2', expiresOn: plusDays(300), amount: 20, unit: 'U' });
    expect(entry.data.product).toBeUndefined();

    const { body: trace } = await s.as('get', `/aesthetics/lots/${lot.id}/trace`).expect(200);
    expect(trace.usages.map((u: { amount: number; customer: { id: string } }) => [u.customer.id, u.amount]).sort()).toEqual([
      [s.customer.id, 10],
      [s.customer.id, 20],
    ]);
    const { body: products } = await s.as('get', '/aesthetics/products?specialty=harmonization').expect(200);
    expect(products[0].lots.find((l: { id: string }) => l.id === lot.id).used).toBe(30);
    // Lote usado: número e validade não mudam mais.
    expect((await s.as('patch', `/aesthetics/lots/${lot.id}`).send({ lot: 'OUTRO', expiresOn: plusDays(300) }).expect(400)).body.code).toBe('LOT_IN_USE');

    // 30 U de um frasco de 100 U = 0,3 frasco a menos no estoque.
    const { body: stock } = await s.as('get', '/sales/products?q=Toxina').expect(200);
    expect(stock[0].stock).toBeCloseTo(2.7, 3);
    const { body: moves } = await s.as('get', `/sales/products/${vial.id}/moves`).expect(200);
    expect(moves[0]).toMatchObject({ kind: 'consumption', quantity: -0.3 });
    expect(moves[0].reason).not.toContain('Paula');

    // Foto padronizada: entra no prontuário com a imagem e só sai pela rota dele.
    const q = new URLSearchParams({ customerId: s.customer.id, specialty: 'harmonization', region: 'Face inteira', angle: 'Frontal', phase: 'Antes' });
    const { body: photo } = await s.as('post', `/aesthetics/photos?${q}`).attach('file', PNG_1PX, { filename: 'antes.png', contentType: 'image/png' }).expect(201);
    expect(photo).toMatchObject({ formKey: 'aesthetics.photo', data: { region: 'Face inteira', angle: 'Frontal', phase: 'Antes', specialty: 'Harmonização facial' } });
    const fileId = photo.attachments[0].id;
    await s.as('get', `/files/${fileId}`).expect(404);
    await s.as('get', `/medical-records/attachments/${fileId}`).buffer(true).expect(200);
    await s.as('post', `/aesthetics/photos?${q}`).attach('file', Buffer.from('%PDF-1.4'), { filename: 'a.pdf', contentType: 'application/pdf' }).expect(400);

    const { body: patient } = await s.as('get', `/aesthetics/patients/${s.customer.id}`).expect(200);
    expect(patient.entries.map((e: { formKey: string }) => e.formKey).sort()).toEqual(['aesthetics.harmonization', 'aesthetics.photo']);
    const { body: log } = await s.as('get', `/medical-records/access-log?subjectType=customer&subjectId=${s.customer.id}`).expect(200);
    expect(new Set(log.map((l: { action: string }) => l.action))).toEqual(new Set(['create', 'view', 'attach', 'download']));

    // O rastreio de lote é só inclusão, garantido pelo banco.
    const app = new Client({ connectionString: testEnv.DATABASE_URL });
    await app.connect();
    try {
      await app.query('begin');
      await app.query(`select set_config('app.tenant_id', $1, true)`, [s.tenantId]);
      await expect(app.query(`update aes_lot_usages set amount = 0 where lot_id = $1`, [lot.id])).rejects.toThrow(/permission denied/);
      await app.query('rollback');
      await app.query('begin');
      await app.query(`select set_config('app.tenant_id', $1, true)`, [s.tenantId]);
      await expect(app.query(`delete from aes_lot_usages`)).rejects.toThrow(/permission denied/);
      await app.query('rollback');
    } finally {
      await app.end();
    }
  });

  it('importação de lote: produto pelo nome, criado com tipo e unidade', async () => {
    const s = await clinic(['harmonization']);
    const row = { lot: 'VB2201', expiresOn: plusDays(200), quantity: 10 };
    const missing = await s.as('post', '/aesthetics/lots').send({ ...row, product: { name: 'Juvéderm Volbella' } }).expect(400);
    expect(missing.body.code).toBe('PRODUCT_DETAILS_REQUIRED');
    const { body: created } = await s.as('post', '/aesthetics/lots').send({ ...row, product: { name: 'Juvéderm Volbella', brand: 'Allergan', kind: 'filler', unit: 'ml', unitsPerPackage: 1 } }).expect(201);
    expect(created).toMatchObject({ name: 'Juvéderm Volbella', kind: 'filler', unit: 'ml', lots: [expect.objectContaining({ lot: 'VB2201', quantity: 10 })] });
    // Segunda linha do mesmo produto (nome com outra caixa) entra no produto existente.
    const { body: same } = await s.as('post', '/aesthetics/lots').send({ ...row, lot: 'VB2202', product: { name: 'juvéderm volbella' } }).expect(201);
    expect(same.id).toBe(created.id);
    expect(same.lots).toHaveLength(2);
  });

  it('clareamento exige CRO e conta as sessões do tratamento', async () => {
    const s = await clinic(['whitening']);
    const dentist = await s.pro('Dr. Bruno Lima');
    await s.credential(dentist.id, { council: 'CRM', number: '99887', uf: 'SC' });
    const data = { type: 'Consultório', session: 1, shadeBefore: 'A3', shadeAfter: 'A1', sensitivity: 'Leve', barrier: true };
    expect((await s.record({ specialty: 'whitening', formKey: 'aesthetics.whitening', professionalId: dentist.id, data }).expect(400)).body.code).toBe('CREDENTIAL_REQUIRED');
    await s.credential(dentist.id, { council: 'CRO', number: '12345', uf: 'SC' });

    const { body: whiteningCase } = await s.as('post', '/aesthetics/cases').send({ customerId: s.customer.id, specialty: 'whitening', title: 'Clareamento combinado', plannedSessions: 3, professionalId: dentist.id }).expect(201);
    expect(whiteningCase).toMatchObject({ stage: null, doneSessions: 0, plannedSessions: 3 });
    const { body: entry } = await s.record({ specialty: 'whitening', formKey: 'aesthetics.whitening', professionalId: dentist.id, caseId: whiteningCase.id, data }).expect(201);
    expect(entry.data).toMatchObject({ shadeBefore: 'A3', shadeAfter: 'A1', professional: 'Dr. Bruno Lima — CRO-SC 12345', caseId: whiteningCase.id });
    const { body: cases } = await s.as('get', `/aesthetics/cases?customerId=${s.customer.id}`).expect(200);
    expect(cases[0]).toMatchObject({ id: whiteningCase.id, doneSessions: 1 });

    // Ficha de outra especialidade não entra por esta.
    expect((await s.record({ specialty: 'whitening', formKey: 'aesthetics.laser', data: {} }).expect(400)).body.code).toBe('FORM_NOT_AVAILABLE');
    // Valor fora da escala VITA é recusado pelo formulário.
    expect((await s.record({ specialty: 'whitening', formKey: 'aesthetics.whitening', professionalId: dentist.id, data: { ...data, shadeAfter: 'Z9' } }).expect(400)).body.code).toBe('INVALID_ENTRY');
  });

  it('cirurgia plástica: orçamento no financeiro, termo, pré-operatório, RQE e cirurgia na agenda', async () => {
    const s = await clinic(['plastic_surgery']);
    const surgeon = await s.pro('Dr. Rafael Moreira');
    await s.as('put', `/scheduling/resources/${surgeon.id}/hours`).send({ hours: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start: '07:00', end: '19:00' })) });
    await s.credential(surgeon.id, { council: 'CRM', number: '145678', uf: 'SP', specialty: 'Cirurgia plástica' });

    const { body: c } = await s.as('post', '/aesthetics/cases').send({ customerId: s.customer.id, specialty: 'plastic_surgery', title: 'Mamoplastia de aumento', professionalId: surgeon.id }).expect(201);
    expect(c).toMatchObject({ stage: 'evaluation', budget: null, surgery: null, consentAccepted: false });

    const service = (await s.services()).find((x) => x.name === 'Cirurgia plástica (centro cirúrgico)')!;
    const schedule = () =>
      s.as('post', `/aesthetics/cases/${c.id}/surgery`).send({
        resourceId: surgeon.id,
        serviceId: service.id,
        startsAt: at(nextWeekday(), '08:00'),
        location: 'Hospital Santa Catarina — centro cirúrgico 3',
        team: [{ role: 'Anestesista', name: 'Dr. Paulo Teixeira' }],
      });
    expect((await schedule().expect(400)).body.code).toBe('BUDGET_NOT_APPROVED');

    const items = [
      { kind: 'surgeon', description: 'Honorários do cirurgião', amount: 12000, billedBy: 'clinic' },
      { kind: 'anesthetist', description: 'Equipe de anestesia', amount: 2500, billedBy: 'third_party' },
      { kind: 'hospital', description: 'Hospital (diária e sala)', amount: 6000, billedBy: 'third_party' },
      { kind: 'implant', description: 'Próteses de silicone 300 ml', amount: 4000, billedBy: 'clinic' },
    ];
    const { body: draft } = await s.as('put', `/aesthetics/cases/${c.id}/budget`).send({ items }).expect(200);
    expect(draft.budget).toMatchObject({ status: 'draft', clinicTotal: 16000, thirdPartyTotal: 8500 });
    const { body: approved } = await s.as('post', `/aesthetics/cases/${c.id}/budget/approve`).send({ installments: 4 }).expect(201);
    expect(approved.budget).toMatchObject({ status: 'approved', installments: 4, approvedOn: localToday() });
    const { body: entries } = await s.as('get', `/finance/entries?limit=50&customerId=${s.customer.id}`).expect(200);
    const mine = entries.items.filter((e: { sourceId: string }) => e.sourceId === c.id);
    expect(mine).toHaveLength(4);
    expect(mine.reduce((sum: number, e: { amount: number }) => sum + e.amount, 0)).toBe(16000);
    expect((await s.as('put', `/aesthetics/cases/${c.id}/budget`).send({ items }).expect(400)).body.code).toBe('BUDGET_APPROVED');

    expect((await schedule().expect(400)).body.code).toBe('CONSENT_REQUIRED');
    const { body: templates } = await s.as('get', '/aesthetics/consent-templates?specialty=plastic_surgery').expect(200);
    const template = templates.find((x: { key: string }) => x.key === 'plastic_surgery.default');
    const { body: consent } = await s
      .as('post', '/aesthetics/consents')
      .send({ customerId: s.customer.id, templateId: template.id, procedure: 'Mamoplastia de aumento', professionalId: surgeon.id, caseId: c.id, signedBy: 'Paula Paciente', signature: SIGNATURE })
      .expect(201);
    expect(consent.data).toMatchObject({ term: template.title, version: 1, signature: true, caseId: c.id, specialty: 'Cirurgia plástica' });
    expect(consent.data.text).toContain('Paula Paciente');
    expect(consent.data.text).not.toContain('{{');
    expect(consent.attachments).toEqual([expect.objectContaining({ mime: 'image/png', filename: 'assinatura.png' })]);
    await s.as('post', '/aesthetics/consents').send({ customerId: s.customer.id, templateId: template.id, procedure: 'X', professionalId: surgeon.id, signedBy: 'Paula', signature: 'data:image/png;base64,AAAA' }).expect(400);

    expect((await schedule().expect(400)).body.code).toBe('PREOP_NOT_RELEASED');
    await s
      .record({
        specialty: 'plastic_surgery',
        formKey: 'aesthetics.surgery.preop',
        professionalId: surgeon.id,
        caseId: c.id,
        data: { exams: [{ exam: 'Hemograma', ok: true }, { exam: 'Coagulograma', ok: true }], asa: 'ASA I', anesthesiaClearance: true, released: true },
      })
      .expect(201);
    expect((await s.as('get', `/aesthetics/cases?customerId=${s.customer.id}`).expect(200)).body[0].stage).toBe('preop');

    expect((await schedule().expect(400)).body.code).toBe('RQE_REQUIRED');
    await s.credential(surgeon.id, { council: 'CRM', number: '145678', uf: 'SP', rqe: '7788', specialty: 'Cirurgia plástica' });
    const { body: scheduled } = await schedule().expect(201);
    expect(scheduled).toMatchObject({ stage: 'scheduled', consentAccepted: true, surgery: { status: 'scheduled', location: 'Hospital Santa Catarina — centro cirúrgico 3' } });
    expect((await schedule().expect(409)).body.code).toBe('SURGERY_SCHEDULED');

    // O cadastro da pessoa mostra o registro no conselho.
    const { body: person } = await s.as('get', `/team/${surgeon.teamMemberId}`).expect(200);
    expect(person.links.map((l: { label: string }) => l.label)).toContain('Registro CRM-SP 145678 · RQE 7788');

    // Editar o termo sobe a versão; o aceite guardado continua com o texto antigo.
    const { body: edited } = await s.as('patch', `/aesthetics/consent-templates/${template.id}`).send({ specialty: 'plastic_surgery', title: template.title, body: `${template.body}\n\nCláusula nova.`, active: true }).expect(200);
    expect(edited.version).toBe(2);

    // Cancelar o tratamento cancela as parcelas em aberto.
    await s.as('post', `/aesthetics/cases/${c.id}/close`).send({ status: 'cancelled' }).expect(400);
    await s.as('post', `/aesthetics/cases/${c.id}/close`).send({ status: 'cancelled', reason: 'Paciente desistiu' }).expect(201);
    const { body: after } = await s.as('get', `/finance/entries?limit=50&customerId=${s.customer.id}`).expect(200);
    expect(after.items.filter((e: { sourceId: string }) => e.sourceId === c.id).every((e: { status: string }) => e.status === 'cancelled')).toBe(true);
  });
});
