import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testEnv } from './env';
import { auth, createTestApp, login, ownerSession, PASSWORD, tokenFromMail, uniqueEmail, type TestApp } from './helpers';

const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const SVG_OK = `<?xml version="1.0" encoding="UTF-8"?>
<!-- Gerado pelo editor -->
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 10 10">
  <defs><linearGradient id="g"><stop offset="0" stop-color="#0f766e"/></linearGradient></defs>
  <style>.a { fill: url(#g); }</style>
  <title>Logo</title>
  <rect class="a" width="10" height="10" rx="2"/>
  <use xlink:href="#g"/>
  <text x="1" y="8" style="font-family: sans-serif">Oi &amp; tchau</text>
</svg>`;
/** SVGs que podem executar algo ou buscar recurso de fora: todos recusados. */
const SVG_BAD = {
  script: '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
  onload: '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><rect width="1" height="1"/></svg>',
  maiusculo: '<svg xmlns="http://www.w3.org/2000/svg"><rect OnClick="alert(1)" width="1" height="1"/></svg>',
  link: '<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)"><rect width="1" height="1"/></a></svg>',
  useExterno: '<svg xmlns="http://www.w3.org/2000/svg"><use href="https://mal.example/x.svg#a"/></svg>',
  foreign: '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div xmlns="http://www.w3.org/1999/xhtml">x</div></foreignObject></svg>',
  animacao: '<svg xmlns="http://www.w3.org/2000/svg"><set attributeName="href" to="javascript:alert(1)"/></svg>',
  entidade: '<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x "y">]><svg xmlns="http://www.w3.org/2000/svg">&x;</svg>',
  cssExterno: '<svg xmlns="http://www.w3.org/2000/svg"><style>@import url(https://mal.example/a.css);</style></svg>',
  urlCodificada: '<svg xmlns="http://www.w3.org/2000/svg"><rect style="fill: u&#114;l(https://mal.example/a)" width="1" height="1"/></svg>',
  imagemSvg: '<svg xmlns="http://www.w3.org/2000/svg"><image href="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="/></svg>',
  semFechar: '<svg xmlns="http://www.w3.org/2000/svg"><g>',
  doisSvgs: '<svg xmlns="http://www.w3.org/2000/svg"></svg><svg></svg>',
  // u\72l( é url( em CSS.
  escapeCss: String.raw`<svg xmlns="http://www.w3.org/2000/svg"><style>a{fill:u\72l(https://mal.example/a)}</style></svg>`,
  menorQueEmAtributo: '<svg xmlns="http://www.w3.org/2000/svg"><rect id="<script>" width="1" height="1"/></svg>',
};

const company = {
  name: 'Lavanderia Bolha',
  legalName: 'Bolha Serviços de Lavanderia Ltda',
  document: '11.222.333/0001-81',
  stateRegistration: 'ISENTO',
  municipalRegistration: '123456',
  email: 'Contato@Bolha.com.br',
  phone: '(48) 99911-2233',
  website: 'bolha.com.br',
  instagram: 'https://www.instagram.com/lavanderia.bolha/',
  address: { zip: '88010000', street: 'Rua Felipe Schmidt', number: '100', district: 'Centro', city: 'Florianópolis', state: 'sc' },
};

describe('dados da empresa, logo e cor do painel', () => {
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

  const slugOf = async (tenantId: string) => (await admin.query(`select slug from tenants where id = $1`, [tenantId])).rows[0].slug as string;

  it('o dono edita os dados, que voltam normalizados e ficam na auditoria', async () => {
    const s = await ownerSession(t);
    const me = await s.as('get', '/me').expect(200);
    expect(me.body.tenant).toMatchObject({ brandColor: null, logoUrl: null });
    expect(me.body.permissions).toContain('core.company.manage');
    expect(me.body.menu.map((m: { path: string }) => m.path)).toContain('/configuracoes/empresa');

    const { body } = await s.as('patch', '/company').send(company).expect(200);
    expect(body).toMatchObject({
      name: 'Lavanderia Bolha',
      document: '11222333000181',
      email: 'contato@bolha.com.br',
      phone: '+5548999112233',
      website: 'https://bolha.com.br',
      instagram: 'lavanderia.bolha',
      stateRegistration: 'ISENTO',
      address: { zip: '88010-000', state: 'SC', city: 'Florianópolis' },
      brandColor: null,
      logoUrl: null,
    });
    expect((await s.as('get', '/company').expect(200)).body).toEqual(body);
    // O nome fantasia é o nome da empresa na sessão.
    expect((await s.as('get', '/me').expect(200)).body.tenant.name).toBe('Lavanderia Bolha');

    const log = await s.as('get', '/audit').expect(200);
    const entry = log.body.find((e: { action: string }) => e.action === 'company.updated');
    expect(entry.data.changed).toEqual(expect.arrayContaining(['name', 'document', 'phone', 'address']));
  });

  it('PATCH só altera o que foi enviado; nulo apaga', async () => {
    const s = await ownerSession(t);
    await s.as('patch', '/company').send(company).expect(200);
    const { body } = await s.as('patch', '/company').send({ instagram: null, phone: '(48) 3222-1111' }).expect(200);
    expect(body).toMatchObject({ name: 'Lavanderia Bolha', document: '11222333000181', instagram: null, phone: '+554832221111' });
  });

  it('confere CPF e CNPJ pelos dígitos, inclusive o CNPJ alfanumérico', async () => {
    const s = await ownerSession(t);
    const bad = await s.as('patch', '/company').send({ document: '11.222.333/0001-80' }).expect(400);
    expect(bad.body.message.join()).toMatch(/CNPJ inválido/);
    expect((await s.as('patch', '/company').send({ document: '123.456.789-00' }).expect(400)).body.message.join()).toMatch(/CPF inválido/);
    expect((await s.as('patch', '/company').send({ document: '1234' }).expect(400)).body.message.join()).toMatch(/CPF \(11 dígitos\) ou CNPJ/);

    expect((await s.as('patch', '/company').send({ document: '529.982.247-25' }).expect(200)).body.document).toBe('52998224725');
    // Exemplo oficial da Receita para o CNPJ com letras.
    expect((await s.as('patch', '/company').send({ document: '12.abc.345/01de-35' }).expect(200)).body.document).toBe('12ABC34501DE35');
    await s.as('patch', '/company').send({ document: '12.ABC.345/01DE-36' }).expect(400);
  });

  it('recusa site, Instagram, telefone e e-mail inválidos', async () => {
    const s = await ownerSession(t);
    const res = await s.as('patch', '/company').send({ website: 'javascript:alert(1)', instagram: 'nome com espaço', phone: '123' }).expect(400);
    const message = res.body.message.join();
    for (const field of ['website', 'instagram', 'phone']) expect(message).toContain(`${field}:`);
    await s.as('patch', '/company').send({ email: 'não é e-mail' }).expect(400);
    await s.as('patch', '/company').send({ name: 'X' }).expect(400);
  });

  it('cor do painel: aceita cor com contraste, recusa cor clara demais e volta ao padrão com null', async () => {
    const s = await ownerSession(t);
    const light = await s.as('patch', '/company').send({ brandColor: '#FFD60A' }).expect(400);
    expect(light.body.message.join()).toMatch(/clara demais/);
    await s.as('patch', '/company').send({ brandColor: 'teal' }).expect(400);

    expect((await s.as('patch', '/company').send({ brandColor: '#0F766E' }).expect(200)).body.brandColor).toBe('#0f766e');
    expect((await s.as('get', '/me').expect(200)).body.tenant.brandColor).toBe('#0f766e');
    await s.as('patch', '/company').send({ brandColor: null }).expect(200);
    expect((await s.as('get', '/me').expect(200)).body.tenant.brandColor).toBeNull();

    const log = await s.as('get', '/audit').expect(200);
    const changes = log.body.filter((e: { action: string; data: { brandColor?: unknown } }) => e.action === 'company.updated' && e.data.brandColor);
    expect(changes.map((e: { data: { brandColor: unknown } }) => e.data.brandColor)).toEqual(
      expect.arrayContaining([{ from: null, to: '#0f766e' }, { from: '#0f766e', to: null }]),
    );
  });

  it('logo: envia, serve pela rota pública com cache, troca e remove', async () => {
    const s = await ownerSession(t);
    const slug = await slugOf(s.tenantId);
    await t.http().get(`/api/public/company/${slug}/logo`).expect(404);

    const up = await s.as('post', '/company/logo').attach('logo', PNG_1PX, { filename: 'logo.png', contentType: 'image/png' }).expect(200);
    expect(up.body.logoUrl).toMatch(new RegExp(`^/api/public/company/${slug}/logo\\?v=[0-9a-f-]{36}$`));
    expect((await s.as('get', '/me').expect(200)).body.tenant.logoUrl).toBe(up.body.logoUrl);
    const fileId = up.body.logoUrl.split('v=')[1];

    // Sem login. Com a versão atual, cache longo; sem versão, curto.
    const versioned = await t.http().get(up.body.logoUrl).expect(200);
    expect(versioned.headers['content-type']).toBe('image/png');
    expect(versioned.headers['cache-control']).toContain('immutable');
    expect(versioned.headers['etag']).toBe(`"${fileId}"`);
    expect(Buffer.compare(versioned.body, PNG_1PX)).toBe(0);
    const plain = await t.http().get(`/api/public/company/${slug}/logo`).expect(200);
    expect(plain.headers['cache-control']).toMatch(/max-age=300/);
    await t.http().get(`/api/public/company/${slug}/logo`).set('If-None-Match', `"${fileId}"`).expect(304);

    // O arquivo do logo não sai pelo download genérico.
    await s.as('get', `/files/${fileId}`).expect(404);

    // Trocar apaga o anterior.
    const second = await s.as('post', '/company/logo').attach('logo', Buffer.from(SVG_OK), { filename: 'logo.svg', contentType: 'image/svg+xml' }).expect(200);
    expect(second.body.logoUrl).not.toBe(up.body.logoUrl);
    const { rows } = await admin.query(`select id, mime from files where tenant_id = $1 and owner_entity = 'company_logo'`, [s.tenantId]);
    expect(rows).toEqual([{ id: second.body.logoUrl.split('v=')[1], mime: 'image/svg+xml' }]);

    const svg = await t.http().get(second.body.logoUrl).buffer(true).parse((res, cb) => {
      let data = '';
      res.on('data', (c: Buffer) => (data += c.toString()));
      res.on('end', () => cb(null, data));
    }).expect(200);
    expect(svg.headers['content-type']).toBe('image/svg+xml');
    expect(svg.headers['content-security-policy']).toMatch(/sandbox/);
    expect(svg.headers['content-security-policy']).toMatch(/default-src 'none'/);
    // Comentários e declaração XML saem; o desenho fica.
    expect(svg.body).not.toContain('Gerado pelo editor');
    expect(svg.body).toContain('<rect class="a"');

    await s.as('delete', '/company/logo').expect(204);
    await t.http().get(`/api/public/company/${slug}/logo`).expect(404);
    expect((await s.as('get', '/company').expect(200)).body.logoUrl).toBeNull();
    expect((await admin.query(`select count(*)::int as n from files where tenant_id = $1 and owner_entity = 'company_logo'`, [s.tenantId])).rows[0].n).toBe(0);

    const actions = (await s.as('get', '/audit').expect(200)).body.map((e: { action: string }) => e.action);
    expect(actions).toEqual(expect.arrayContaining(['company.logo_updated', 'company.logo_removed']));
  });

  it('logo: confere o tipo pelos bytes e o tamanho', async () => {
    const s = await ownerSession(t);
    const text = await s.as('post', '/company/logo').attach('logo', Buffer.from('oi'), { filename: 'a.txt', contentType: 'text/plain' }).expect(400);
    expect(text.body.code).toBe('INVALID_FILE_TYPE');
    // Declarado como PNG, mas não é.
    await s.as('post', '/company/logo').attach('logo', Buffer.from('<html><script>alert(1)</script></html>'), { filename: 'a.png', contentType: 'image/png' }).expect(400);
    const big = Buffer.concat([PNG_1PX, Buffer.alloc(1024 * 1024)]);
    await s.as('post', '/company/logo').attach('logo', big, { filename: 'grande.png', contentType: 'image/png' }).expect((res) => {
      expect([400, 413]).toContain(res.status);
    });
    await s.as('post', '/company/logo').expect(400);
  });

  it('logo SVG: recusa o que pode executar ou carregar algo de fora', async () => {
    const s = await ownerSession(t);
    for (const [name, svg] of Object.entries(SVG_BAD)) {
      const res = await s.as('post', '/company/logo').attach('logo', Buffer.from(svg), { filename: `${name}.svg`, contentType: 'image/svg+xml' });
      expect(res.status, name).toBe(400);
      expect(['UNSAFE_SVG', 'INVALID_FILE_TYPE'], name).toContain(res.body.code);
    }
    expect((await s.as('get', '/company').expect(200)).body.logoUrl).toBeNull();
  });

  it('quem não tem a permissão não vê nem altera os dados da empresa', async () => {
    const s = await ownerSession(t);
    const email = uniqueEmail('func');
    await s.as('post', '/users/invite').send({ email, name: 'Funcionário', roleIds: [] }).expect(201);
    const token = tokenFromMail(t.mails.findLast((m) => m.to === email));
    await t.http().post('/api/auth/set-password').send({ token, password: PASSWORD, name: 'Funcionário' }).expect(204);
    const employee = await login(t, email);

    await t.http().get('/api/company').set(auth(employee.token)).expect(403);
    await t.http().patch('/api/company').set(auth(employee.token)).send({ brandColor: '#0f766e' }).expect(403);
    await t.http().post('/api/company/logo').set(auth(employee.token)).attach('logo', PNG_1PX, { filename: 'l.png', contentType: 'image/png' }).expect(403);
    await t.http().delete('/api/company/logo').set(auth(employee.token)).expect(403);
    // Mas a sessão traz a marca para todos, e o menu não mostra a tela.
    await s.as('patch', '/company').send({ brandColor: '#0f766e' }).expect(200);
    const me = await t.http().get('/api/me').set(auth(employee.token)).expect(200);
    expect(me.body.tenant.brandColor).toBe('#0f766e');
    expect(me.body.menu.map((m: { path: string }) => m.path)).not.toContain('/configuracoes/empresa');
  });

  it('uma empresa não mexe na outra', async () => {
    const a = await ownerSession(t);
    const b = await ownerSession(t);
    await a.as('patch', '/company').send({ name: 'Empresa A Renomeada', brandColor: '#7c3aed' }).expect(200);
    await a.as('post', '/company/logo').attach('logo', PNG_1PX, { filename: 'a.png', contentType: 'image/png' }).expect(200);
    const other = await b.as('get', '/company').expect(200);
    expect(other.body).toMatchObject({ brandColor: null, logoUrl: null });
    expect(other.body.name).not.toBe('Empresa A Renomeada');
    await t.http().get(`/api/public/company/${await slugOf(b.tenantId)}/logo`).expect(404);
  });

  it('a página pública de agendamento traz o logo e a cor', async () => {
    const s = await ownerSession(t, ['beauty']);
    await s.as('put', '/modules/shared.scheduling/settings').send({ onlineBooking: true }).expect(204);
    await s.as('patch', '/company').send({ brandColor: '#be123c' }).expect(200);
    const up = await s.as('post', '/company/logo').attach('logo', PNG_1PX, { filename: 'l.png', contentType: 'image/png' }).expect(200);

    const info = await t.http().get(`/api/public/booking/${await slugOf(s.tenantId)}`).expect(200);
    expect(info.body.company).toMatchObject({ brandColor: '#be123c', logoUrl: up.body.logoUrl });
  });

  it('empresas antigas ganham o módulo na reconciliação, e o dono já tem a permissão', async () => {
    const s = await ownerSession(t);
    await admin.query(`delete from tenant_modules where tenant_id = $1 and module_key = 'core.company'`, [s.tenantId]);
    await s.as('get', '/company').expect(403);
    await t.tenancy.reconcileTenants();
    await s.as('get', '/company').expect(200);
  });
});
