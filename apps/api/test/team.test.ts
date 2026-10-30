import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testEnv } from './env';
import { auth, cpf, createTestApp, login, ownerSession, PASSWORD, tokenFromMail, uniqueEmail, type TestApp } from './helpers';

const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

const localToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const plusDays = (date: string, n: number) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + n)).toISOString().slice(0, 10);
};
const yesterday = () => plusDays(localToday(), -1);
const tomorrow = () => plusDays(localToday(), 1);

type Session = Awaited<ReturnType<typeof ownerSession>>;

describe('pessoas da equipe', () => {
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

  /** Convida um usuário com os papéis indicados (pelas keys) e devolve o token dele. */
  async function inviteAndLogin(ownerToken: string, roleKeys: string[]) {
    const roles = await t.http().get('/api/access/roles').set(auth(ownerToken)).expect(200);
    const roleIds = roleKeys.map((k) => roles.body.find((r: { key: string }) => r.key === k).id);
    const email = uniqueEmail('func');
    await t.http().post('/api/users/invite').set(auth(ownerToken)).send({ email, name: 'Funcionário', roleIds }).expect(201);
    const token = tokenFromMail(t.mails.findLast((m) => m.to === email));
    await t.http().post('/api/auth/set-password').send({ token, password: PASSWORD, name: 'Funcionário Novo' }).expect(204);
    return login(t, email);
  }

  const resources = async (s: Session) => (await s.as('get', '/scheduling/resources').expect(200)).body as { id: string; name: string; active: boolean; teamMemberId: string | null }[];
  const person = async (s: Session, id: string) => (await s.as('get', `/team/${id}`).expect(200)).body;

  describe('cadastro (core)', () => {
    it('valida CPF (dígitos e único na empresa), normaliza contato e registra o acesso na auditoria', async () => {
      const s = await ownerSession(t, []);
      const doc = cpf();
      const { body: marina } = await s
        .as('post', '/team')
        .send({
          firstName: ' Marina ',
          lastName: 'Souza  Lima',
          cpf: doc.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4'),
          rg: '12.345.678-9',
          birthDate: '1990-04-15',
          email: 'MARINA@Exemplo.com',
          phone: '(11) 98765-4321',
          address: { zip: '01001-000', street: 'Praça da Sé', number: '10', district: 'Sé', city: 'São Paulo', state: 'SP' },
          linkedinUrl: 'linkedin.com/in/marina',
          startedOn: '2024-02-01',
        })
        .expect(201);
      expect(marina).toMatchObject({
        firstName: 'Marina',
        lastName: 'Souza Lima',
        name: 'Marina Souza Lima',
        cpf: doc,
        email: 'marina@exemplo.com',
        phone: '+5511987654321',
        linkedinUrl: 'https://linkedin.com/in/marina',
        startedOn: '2024-02-01',
        endedOn: null,
        active: true,
        links: [],
        photo: null,
        resume: null,
      });

      expect((await s.as('post', '/team').send({ firstName: 'Teste', cpf: '123.456.789-00' }).expect(400)).body.code).toBe('VALIDATION');
      const dup = await s.as('post', '/team').send({ firstName: 'Outra', cpf: doc }).expect(409);
      expect(dup.body).toMatchObject({ code: 'DUPLICATE_CPF', existing: { id: marina.id, name: 'Marina Souza Lima' } });
      expect((await s.as('post', '/team').send({ firstName: 'Datas', startedOn: '2025-01-10', endedOn: '2025-01-01' }).expect(400)).body.code).toBe('END_BEFORE_START');
      await s.as('post', '/team').send({ firstName: 'Link', linkedinUrl: 'não é endereço' }).expect(400);
      await s.as('post', '/team').send({ firstName: 'Login', userId: '00000000-0000-7000-8000-000000000000' }).expect(400);

      // PATCH parcial: só o que veio muda.
      const { body: patched } = await s.as('patch', `/team/${marina.id}`).send({ phone: null, notes: 'Prefere contato por e-mail' }).expect(200);
      expect(patched).toMatchObject({ phone: null, cpf: doc, notes: 'Prefere contato por e-mail', address: expect.objectContaining({ city: 'São Paulo' }) });

      const byName = (await s.as('get', '/team?q=souza').expect(200)).body;
      expect(byName.items.map((m: { id: string }) => m.id)).toEqual([marina.id]);
      const byCpf = (await s.as('get', `/team?q=${doc.slice(0, 6)}`).expect(200)).body;
      expect(byCpf.items.map((m: { id: string }) => m.id)).toContain(marina.id);

      await s.as('get', `/team/${marina.id}`).expect(200);
      const { body: audit } = await s.as('get', '/audit?limit=50').expect(200);
      const actions = audit.filter((a: { entityId: string }) => a.entityId === marina.id).map((a: { action: string }) => a.action);
      expect(actions).toEqual(expect.arrayContaining(['team_member.created', 'team_member.updated', 'team_member.viewed']));
    });

    it('foto pelo download comum; currículo (PDF/Word) só pela rota da equipe, com registro', async () => {
      const s = await ownerSession(t, []);
      const { body: m } = await s.as('post', '/team').send({ firstName: 'Rafa' }).expect(201);

      const { body: photo } = await s.as('post', `/team/${m.id}/photo`).attach('photo', PNG_1PX, { filename: 'rafa.png', contentType: 'image/png' }).expect(201);
      await s.as('get', `/files/${photo.id}`).expect(200);
      expect((await person(s, m.id)).photoFileId).toBe(photo.id);

      await s.as('post', `/team/${m.id}/resume`).attach('file', Buffer.from('oi'), { filename: 'cv.txt', contentType: 'text/plain' }).expect(400);
      const { body: resume } = await s.as('post', `/team/${m.id}/resume`).attach('file', PDF, { filename: 'curriculo.pdf', contentType: 'application/pdf' }).expect(201);
      await s.as('get', `/files/${resume.id}`).expect(404);
      const download = await s.as('get', `/team/${m.id}/resume`).expect(200);
      expect(download.headers['content-type']).toContain('application/pdf');
      expect(download.headers['content-disposition']).toContain('attachment');
      // Word enviado como "octet-stream" vale pela extensão e substitui o anterior.
      await s.as('post', `/team/${m.id}/resume`).attach('file', Buffer.from('doc'), { filename: 'cv.docx', contentType: 'application/octet-stream' }).expect(201);
      expect((await person(s, m.id)).resume).toMatchObject({ filename: 'cv.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });

      const { body: audit } = await s.as('get', '/audit?limit=50').expect(200);
      expect(audit.map((a: { action: string }) => a.action)).toContain('team_member.resume_downloaded');

      await s.as('delete', `/team/${m.id}/resume`).expect(204);
      await s.as('delete', `/team/${m.id}/photo`).expect(204);
      expect(await person(s, m.id)).toMatchObject({ photo: null, resume: null, photoFileId: null });
    });

    it('dados pessoais só com core.team.*: o analista de DP vê a equipe mas não edita', async () => {
      const s = await ownerSession(t, ['hr']);
      const { body: m } = await s.as('post', '/team').send({ firstName: 'Paula' }).expect(201);
      const analyst = await inviteAndLogin(s.token, ['hr.analyst']);
      await t.http().get('/api/team').set(auth(analyst.token)).expect(200);
      await t.http().get(`/api/team/${m.id}`).set(auth(analyst.token)).expect(200);
      const denied = await t.http().patch(`/api/team/${m.id}`).set(auth(analyst.token)).send({ firstName: 'Outra' }).expect(403);
      expect(denied.body.code).toBe('MISSING_PERMISSION');
    });
  });

  describe('busca de CEP', () => {
    it('preenche o endereço pelo servidor; 404 quando não existe', async () => {
      const s = await ownerSession(t, []);
      const { body } = await s.as('get', '/cep/01001-000').expect(200);
      expect(body).toEqual({ zip: '01001-000', street: 'Praça da Sé', district: 'Sé', city: 'São Paulo', state: 'SP', complement: 'lado ímpar' });
      expect((await s.as('get', '/cep/99999999').expect(404)).body.code).toBe('CEP_NOT_FOUND');
      expect((await s.as('get', '/cep/123').expect(400)).body.code).toBe('INVALID_CEP');
      expect((await s.as('get', '/cep/12345678').expect(503)).body.code).toBe('CEP_UNAVAILABLE');
      await t.http().get('/api/cep/01001000').expect(401);
    });
  });

  describe('profissional da agenda = pessoa da equipe', () => {
    it('profissional novo ganha uma pessoa; o formulário grava os dados dela; uma pessoa, um profissional', async () => {
      const s = await ownerSession(t, ['beauty']);
      const { body: ana } = await s.as('post', '/scheduling/resources').send({ name: 'Ana Maria Lima' }).expect(201);
      expect(ana.teamMemberId).toEqual(expect.any(String));
      expect(await person(s, ana.teamMemberId)).toMatchObject({
        firstName: 'Ana',
        lastName: 'Maria Lima',
        links: [expect.objectContaining({ moduleKey: 'shared.scheduling', label: 'Profissional da agenda', active: true })],
      });

      const doc = cpf();
      await s
        .as('patch', `/scheduling/resources/${ana.id}`)
        .send({ name: 'Ana', person: { cpf: doc, rg: '1234567', address: { zip: '01001-000', street: 'Praça da Sé', number: '1', city: 'São Paulo', state: 'SP' } } })
        .expect(200);
      expect(await person(s, ana.teamMemberId)).toMatchObject({ firstName: 'Ana', lastName: 'Maria Lima', cpf: doc, rg: '1234567', address: expect.objectContaining({ number: '1' }) });
      expect((await resources(s)).find((r) => r.id === ana.id)).toMatchObject({ name: 'Ana', teamMemberId: ana.teamMemberId });

      await s.as('patch', `/scheduling/resources/${ana.id}`).send({ name: 'Ana', person: { cpf: '111.111.111-11' } }).expect(400);
      expect((await s.as('post', '/scheduling/resources').send({ name: 'Outra', teamMemberId: ana.teamMemberId }).expect(409)).body.code).toBe('TEAM_MEMBER_TAKEN');

      // Pessoa já cadastrada na equipe vira profissional.
      const { body: bia } = await s.as('post', '/team').send({ firstName: 'Bia', lastName: 'Rocha' }).expect(201);
      const { body: biaResource } = await s.as('post', '/scheduling/resources').send({ name: 'Bia', teamMemberId: bia.id }).expect(201);
      expect(biaResource.teamMemberId).toBe(bia.id);

      // Sala não é pessoa.
      const { body: room } = await s.as('post', '/scheduling/resources').send({ name: 'Sala 1', kind: 'room' }).expect(201);
      expect(room.teamMemberId).toBeNull();
    });

    it('encerramento passado tira o profissional da agenda (evento do core), também ao salvar e pelo job diário', async () => {
      const s = await ownerSession(t, ['beauty']);
      const { body: bruno } = await s.as('post', '/scheduling/resources').send({ name: 'Bruno' }).expect(201);
      await s.as('patch', `/team/${bruno.teamMemberId}`).send({ endedOn: yesterday() }).expect(200);
      await t.relay.drain();
      expect((await resources(s)).find((r) => r.id === bruno.id)?.active).toBe(false);
      const { body: audit } = await s.as('get', '/audit?limit=50').expect(200);
      expect(audit.find((a: { action: string; entityId: string }) => a.action === 'scheduling.resource.deactivated' && a.entityId === bruno.id)).toBeTruthy();
      expect(await person(s, bruno.teamMemberId)).toMatchObject({ active: false, links: [expect.objectContaining({ active: false })] });

      // Pelo formulário do profissional: inativo na hora.
      const { body: carla } = await s.as('post', '/scheduling/resources').send({ name: 'Carla', active: true, person: { firstName: 'Carla', endedOn: yesterday() } }).expect(201);
      expect((await resources(s)).find((r) => r.id === carla.id)?.active).toBe(false);

      // Encerramento futuro: continua ativo até a data passar (job core.team.endings).
      const { body: davi } = await s.as('post', '/scheduling/resources').send({ name: 'Davi' }).expect(201);
      await s.as('patch', `/team/${davi.teamMemberId}`).send({ endedOn: tomorrow() }).expect(200);
      await t.relay.drain();
      expect((await resources(s)).find((r) => r.id === davi.id)?.active).toBe(true);
      await admin.query(`update team_members set ended_on = $2 where id = $1`, [davi.teamMemberId, yesterday()]);
      await t.jobs.runOnce('core.team.endings');
      await t.relay.drain();
      expect((await resources(s)).find((r) => r.id === davi.id)?.active).toBe(false);
    });
  });

  describe('RH com a mesma pessoa', () => {
    const job = { position: 'Cabeleireira', admissionDate: '2024-03-01', salary: 3000 };

    it('colaborador escolhe o profissional da agenda; a rescisão encerra a pessoa e desativa na agenda', async () => {
      const s = await ownerSession(t, ['beauty', 'hr']);
      const { body: diana } = await s.as('post', '/scheduling/resources').send({ name: 'Diana Prado' }).expect(201);
      const doc = cpf();
      const { body: emp } = await s
        .as('post', '/hr/employees')
        .send({ ...job, teamMemberId: diana.teamMemberId, name: 'Diana Prado Costa', cpf: doc, phone: '(11) 98765-0000', email: 'diana@exemplo.com' })
        .expect(201);
      expect(emp).toEqual({ id: expect.any(String), teamMemberId: diana.teamMemberId });

      const p = await person(s, diana.teamMemberId);
      expect(p).toMatchObject({ firstName: 'Diana', lastName: 'Prado Costa', cpf: doc, phone: '+5511987650000', startedOn: '2024-03-01' });
      expect(p.links.map((l: { label: string }) => l.label).sort()).toEqual(['Colaborador (RH)', 'Profissional da agenda']);
      expect((await s.as('get', `/hr/employees/${emp.id}`).expect(200)).body).toMatchObject({ name: 'Diana Prado Costa', cpf: doc, teamMemberId: diana.teamMemberId, phone: '+5511987650000' });
      expect((await s.as('post', '/hr/employees').send({ ...job, teamMemberId: diana.teamMemberId, name: 'Diana', cpf: doc }).expect(409)).body.code).toBe('TEAM_MEMBER_TAKEN');

      // O PATCH do RH continua aceitando os dados pessoais (e grava na pessoa).
      await s.as('patch', `/hr/employees/${emp.id}`).send({ ...job, name: 'Diana Prado Costa', cpf: doc, email: 'diana.costa@exemplo.com' }).expect(200);
      expect((await person(s, diana.teamMemberId)).email).toBe('diana.costa@exemplo.com');

      await s.as('post', `/hr/employees/${emp.id}/termination`).send({ type: 'without_cause', terminationDate: '2025-06-15', notice: 'indemnified', fgtsBalance: 0 }).expect(201);
      expect(await person(s, diana.teamMemberId)).toMatchObject({ endedOn: '2025-06-15', active: false });
      await t.relay.drain();
      expect((await resources(s)).find((r) => r.id === diana.id)?.active).toBe(false);
    });

    it('admissão sem escolher: vincula a quem já tem o CPF; senão cria a pessoa (planilha e seed)', async () => {
      const s = await ownerSession(t, ['hr']);
      const doc = cpf();
      const { body: m } = await s.as('post', '/team').send({ firstName: 'Elisa', cpf: doc, startedOn: '2023-01-10' }).expect(201);
      const { body: elisa } = await s.as('post', '/hr/employees').send({ ...job, name: 'Elisa Martins', cpf: doc }).expect(201);
      expect(elisa.teamMemberId).toBe(m.id);
      // Já estava na empresa antes da admissão: o início continua o mais antigo.
      expect(await person(s, m.id)).toMatchObject({ name: 'Elisa Martins', startedOn: '2023-01-10' });
      expect((await s.as('post', '/hr/employees').send({ ...job, name: 'Outra Elisa', cpf: doc }).expect(409)).body.code).toBe('CPF_TAKEN');

      // Como o seed: colaborador já desligado vem com a data; a pessoa é criada com nome/sobrenome.
      const { body: fabio } = await s
        .as('post', '/hr/employees')
        .send({ ...job, name: 'Fábio de Souza', cpf: cpf(), status: 'terminated', terminationDate: '2025-02-18', birthDate: '1985-07-02', phone: '11987654000' })
        .expect(201);
      expect(await person(s, fabio.teamMemberId)).toMatchObject({ firstName: 'Fábio', lastName: 'de Souza', birthDate: '1985-07-02', startedOn: '2024-03-01', endedOn: '2025-02-18', active: false });
      const { body: list } = await s.as('get', '/hr/employees').expect(200);
      expect(list.map((e: { name: string }) => e.name)).toEqual(['Elisa Martins', 'Fábio de Souza']);

      // CPF inválido é recusado (validado na pessoa).
      await s.as('post', '/hr/employees').send({ ...job, name: 'Gabi', cpf: '12345678900' }).expect(400);
    });
  });

  describe('Consultoria de RH', () => {
    it('é um ramo (vertical) que traz o RH, que é módulo contratável por qualquer ramo', async () => {
      const s = await ownerSession(t, ['hr_consulting']);
      const { body: me } = await s.as('get', '/me').expect(200);
      expect(me.modules).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ key: 'hr_consulting', layer: 'vertical', name: 'Consultoria de RH' }),
          expect.objectContaining({ key: 'hr', layer: 'shared' }),
          expect.objectContaining({ key: 'core.team', layer: 'core' }),
        ]),
      );
      await s.as('get', '/hr/employees').expect(200);

      const { body: catalog } = await s.as('get', '/modules/catalog').expect(200);
      const keys = catalog.map((m: { key: string }) => m.key);
      expect(keys).toContain('hr');
      expect(keys).toContain('hr_consulting');
      expect(keys).not.toContain('core.team');
    });
  });
});
