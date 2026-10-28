import {
  accessKeyCheckDigit,
  crc32,
  createSelfSignedPfx,
  FiscalHttp,
  focusStatus,
  isValidAccessKey,
  normalizeCfop,
  normalizeLc116,
  normalizeNbs,
  normalizeNcm,
  parsePfx,
  scale,
  spread,
  zip,
} from '@all/fiscal';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { cpf, createTestApp, ownerSession, uniqueEmail, type TestApp } from './helpers';

const OFFSET = '-03:00';
const at = (date: string, time: string) => new Date(`${date}T${time}:00${OFFSET}`).toISOString();
function nextWeekday(): string {
  const d = new Date(Date.now() + 2 * 86_400_000);
  for (;;) {
    const local = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d);
    const wd = new Date(`${local}T12:00:00Z`).getUTCDay();
    if (wd >= 1 && wd <= 5) return local;
    d.setTime(d.getTime() + 86_400_000);
  }
}
const localToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const CNPJ = '11222333000181';

/** Corpo binário (XML, PDF, ZIP) como Buffer. */
const binary = (res: any, cb: (err: Error | null, body: any) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

describe('nota fiscal (integration.fiscal)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  /** Empresa com o módulo fiscal, CNPJ, endereço e inscrições (o modo simulado não pede token nem certificado). */
  async function company(modules: string[], settings: Record<string, unknown> = {}) {
    const s = await ownerSession(t, [...modules, 'integration.fiscal']);
    await s
      .as('patch', '/company')
      .send({
        legalName: 'Empresa de Teste Ltda',
        document: CNPJ,
        stateRegistration: '110.042.490.114',
        municipalRegistration: '1234567',
        email: uniqueEmail('empresa'),
        address: { zip: '01001-000', street: 'Praça da Sé', number: '100', district: 'Sé', city: 'São Paulo', state: 'SP' },
      })
      .expect(200);
    const { body: current } = await s.as('get', '/modules/integration.fiscal/settings').expect(200);
    await s.as('put', '/fiscal/settings').send({ ...current, municipalityCode: '3550308', cnae: '9602501', ...settings }).expect(200);
    return s;
  }

  type Session = Awaited<ReturnType<typeof company>>;
  const docsOf = async (s: Session, query = '') => (await s.as('get', `/fiscal/documents${query}`).expect(200)).body as { id: string; status: string; number: number | null; type: string; statusMessage: string | null }[];

  async function bakery(settings: Record<string, unknown> = {}) {
    const s = await company(['bakery'], settings);
    const { body: products } = await s.as('get', '/sales/products').expect(200);
    const product = (name: string) => products.find((p: { name: string }) => p.name === name) as { id: string; name: string };
    const classify = (p: { id: string; name: string }, extra: Record<string, unknown> = {}) =>
      s.as('put', '/fiscal/codes/products').send({ productId: p.id, productName: p.name, ncm: '1905.90.90', cfop: '5102', icmsSituation: '102', taxUnit: 'KG', origin: 0, ...extra });
    return { ...s, product, classify };
  }

  async function salon(settings: Record<string, unknown> = {}) {
    const s = await company(['beauty'], settings);
    const { body: customer } = await s.as('post', '/customers').send({ name: 'Bia Cliente', email: uniqueEmail('cliente'), phone: '(48) 99911-2233' }).expect(201);
    const { body: services } = await s.as('get', '/scheduling/services').expect(200);
    const { body: ana } = await s.as('post', '/scheduling/resources').send({ name: 'Ana' }).expect(201);
    const { body: accounts } = await s.as('get', '/scheduling/payment-accounts').expect(200);
    const service = (name: string) => services.find((x: { name: string }) => x.name === name) as { id: string; name: string; price: number };
    const paidAppointment = async (serviceName = 'Corte feminino') => {
      const day = nextWeekday();
      const { body: a } = await s.as('post', '/scheduling/appointments').send({ customerId: customer.id, resourceId: ana.id, serviceIds: [service(serviceName).id], startsAt: at(day, '10:00') }).expect(201);
      await s.as('post', `/scheduling/appointments/${a.id}/payments`).send({ amount: a.total, method: 'pix', accountId: accounts[0].id, paidAt: localToday() }).expect(201);
      return a as { id: string; total: number };
    };
    return { ...s, customer, service, paidAppointment };
  }

  describe('regras puras', () => {
    it('formatos de códigos fiscais', () => {
      expect(normalizeNcm('1905.90.90')).toBe('19059090');
      expect(normalizeNcm('1905909')).toBeNull();
      expect(normalizeCfop('5102')).toBe('5102');
      expect(normalizeCfop('1102')).toBeNull();
      expect(normalizeLc116('0601')).toBe('06.01');
      expect(normalizeLc116('6.01')).toBe('06.01');
      expect(normalizeLc116('41.01')).toBeNull();
      expect(normalizeNbs('1.2601.10.00')).toBe('126011000');
    });

    it('chave de acesso com dígito verificador módulo 11', () => {
      const first43 = '3526101122233300018165001000000001100000001';
      const key = `${first43}${accessKeyCheckDigit(first43)}`;
      expect(isValidAccessKey(key)).toBe(true);
      expect(isValidAccessKey(`${first43}${(accessKeyCheckDigit(first43) + 1) % 10}`)).toBe(false);
    });

    it('rateio de desconto e ajuste de preço fecham no centavo', () => {
      expect(spread(1, [10, 10, 10])).toEqual([0.33, 0.33, 0.34]);
      expect(scale([90, 60], 120)).toEqual([72, 48]);
      expect(spread(0, [5, 5])).toEqual([0, 0]);
    });

    it('ZIP sem compressão e CRC32', () => {
      expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926);
      const z = zip([{ name: 'a.xml', content: Buffer.from('<a/>') }]);
      expect(z.subarray(0, 4).toString('latin1')).toBe('PK\x03\x04');
      expect(z.readUInt32LE(z.length - 22)).toBe(0x06054b50);
    });

    it('status da Focus → vocabulário do sistema', () => {
      expect(focusStatus('autorizado')).toBe('authorized');
      expect(focusStatus('erro_autorizacao')).toBe('rejected');
      expect(focusStatus('cancelado')).toBe('cancelled');
      expect(focusStatus('denegado')).toBe('denied');
      expect(focusStatus('processando_autorizacao')).toBe('processing');
    });

    it('lê o certificado A1 (.pfx) e recusa senha errada', () => {
      const pfx = createSelfSignedPfx({ name: 'EMPRESA DE TESTE LTDA', cnpj: CNPJ, password: 'senha123' });
      const parsed = parsePfx(pfx, 'senha123');
      expect(parsed).toMatchObject({ subjectName: `EMPRESA DE TESTE LTDA:${CNPJ}`, document: CNPJ });
      expect(parsed.validTo.getTime()).toBeGreaterThan(Date.now());
      expect(() => parsePfx(pfx, 'errada')).toThrow(/Senha do certificado incorreta/);
    });
  });

  describe('configuração e cadastro fiscal', () => {
    it('séries criadas na ativação, papéis padrão e prontidão', async () => {
      const s = await company(['bakery']);
      const { body } = await s.as('get', '/fiscal/overview').expect(200);
      expect(body.series).toHaveLength(6);
      expect(body.series.every((x: { series: string; nextNumber: number }) => x.series === '1' && x.nextNumber === 1)).toBe(true);
      expect(body.readiness.find((r: { key: string }) => r.key === 'cnpj')).toMatchObject({ ok: true });
      expect(body.webhookUrl).toMatch(/\/api\/public\/fiscal\/webhook\/[0-9a-f-]{36}$/);
      const { body: roles } = await s.as('get', '/access/roles').expect(200);
      expect(roles.map((r: { key: string }) => r.key)).toEqual(expect.arrayContaining(['integration.fiscal.biller', 'integration.fiscal.accountant']));
    });

    it('certificado: guarda cifrado, mostra validade e recusa CNPJ de outra empresa', async () => {
      const s = await company(['bakery']);
      const good = createSelfSignedPfx({ name: 'EMPRESA DE TESTE LTDA', cnpj: CNPJ, password: 'abc12345' });
      await s.as('post', '/fiscal/certificate').field('password', 'outra').attach('certificate', good, 'cert.pfx').expect(400);
      const { body: cert } = await s.as('post', '/fiscal/certificate').field('password', 'abc12345').attach('certificate', good, 'cert.pfx').expect(200);
      expect(cert).toMatchObject({ document: CNPJ, active: true, documentMismatch: false });
      expect(cert.daysLeft).toBeGreaterThan(300);
      const other = createSelfSignedPfx({ name: 'OUTRA', cnpj: '45723174000110', password: 'x1234567' });
      const res = await s.as('post', '/fiscal/certificate').field('password', 'x1234567').attach('certificate', other, 'outra.pfx').expect(400);
      expect(res.body.code).toBe('CERTIFICATE_MISMATCH');
      const { body: overview } = await s.as('get', '/fiscal/overview').expect(200);
      expect(overview.certificate.id).toBe(cert.id);
      expect(JSON.stringify(overview)).not.toContain('abc12345');
    });

    it('valida formatos e o CST/CSOSN conforme o regime', async () => {
      const s = await bakery();
      const bread = s.product('Pão francês');
      expect((await s.classify(bread, { ncm: '1905909' }).expect(400)).body.message.join(' ')).toMatch(/NCM/);
      expect((await s.classify(bread, { cfop: '1102' }).expect(400)).body.message.join(' ')).toMatch(/CFOP/);
      expect((await s.classify(bread, { icmsSituation: '00' }).expect(400)).body.message.join(' ')).toMatch(/CSOSN/);
      const { body } = await s.classify(bread).expect(200);
      expect(body).toMatchObject({ ncm: '19059090', cfop: '5102', icmsSituation: '102' });
      await s.as('put', '/fiscal/codes/services').send({ refId: 'x', serviceName: 'Corte', lc116: '06.01', issRate: 7 }).expect(400);
    });
  });

  describe('NFC-e da venda (simulado)', () => {
    it('emissão automática ao concluir a venda: autorizada, XML/PDF guardados e nota enviada ao cliente', async () => {
      const s = await bakery({ autoSale: 'nfce' });
      const bread = s.product('Pão francês');
      const milk = s.product('Leite integral 1 L');
      await s.classify(bread).expect(200);
      await s.classify(milk, { ncm: '0401.10.10', taxUnit: 'UN' }).expect(200);
      const email = uniqueEmail('consumidor');
      const { body: customer } = await s.as('post', '/customers').send({ name: 'Carla Consumidora', email, document: cpf() }).expect(201);
      const { body: sale } = await s
        .as('post', '/sales')
        .send({ customerId: customer.id, items: [{ productId: bread.id, quantity: 0.5 }, { productId: milk.id, quantity: 2 }], discount: 0.43, payments: [{ method: 'pix', amount: 19 }] })
        .expect(201);
      await t.relay.drain();

      const [doc] = await docsOf(s, `?sourceType=sale&sourceId=${sale.id}`);
      expect(doc).toMatchObject({ type: 'nfce', status: 'authorized', number: 1 });
      const { body: detail } = await s.as('get', `/fiscal/documents/${doc!.id}`).expect(200);
      expect(detail.total).toBe(19);
      expect(detail.discount).toBe(0.43);
      expect(detail.items.map((i: { ncm: string }) => i.ncm)).toEqual(['19059090', '04011010']);
      expect(isValidAccessKey(detail.accessKey)).toBe(true);
      expect(detail.files).toMatchObject({ xml: true, pdf: true });
      expect(detail.cancelUntil).toBeTruthy();

      const xml = await s.as('get', `/fiscal/documents/${doc!.id}/files/xml`).buffer(true).parse(binary).expect(200);
      expect((xml.body as Buffer).toString('utf8')).toContain('SEM VALOR FISCAL');
      const pdf = await s.as('get', `/fiscal/documents/${doc!.id}/files/pdf`).buffer(true).parse(binary).expect(200);
      expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');

      // E-mail ao cliente com o link público (sem login) da nota.
      const mail = t.mails.findLast((m) => m.to === email);
      expect(mail?.subject).toMatch(/NFC-e nº 1/);
      const link = mail!.text.match(/https?:\/\/\S+\/api(\/public\/fiscal\/\S+\/pdf\?t=\S+)/)?.[1];
      expect(link).toBeTruthy();
      await t.http().get(`/api${link}`).buffer(true).parse(binary).expect(200);
      await t.http().get(`/api${link!.replace(/t=.*/, 't=errado')}`).expect(404);

      // Download fica na auditoria.
      const { body: audit } = await s.as('get', '/audit?limit=50').expect(200);
      expect(audit.map((a: { action: string }) => a.action)).toEqual(expect.arrayContaining(['fiscal.document.issued', 'fiscal.document.authorized', 'fiscal.document.downloaded']));
    });

    it('produto sem cadastro fiscal: a automática não sai e a origem mostra o motivo; manual depois de cadastrar', async () => {
      const s = await bakery({ autoSale: 'nfce' });
      const bread = s.product('Pão francês');
      await s.as('post', '/sales').send({ items: [{ productId: bread.id, quantity: 1 }], payments: [{ method: 'cash', amount: 16.9 }] }).expect(201);
      await t.relay.drain();
      expect(await docsOf(s)).toEqual([]);
      const { body: sources } = await s.as('get', '/fiscal/sources').expect(200);
      expect(sources[0].autoError).toMatch(/NCM/);
      const { body: pending } = await s.as('get', '/fiscal/codes/pending').expect(200);
      expect(pending.products.map((p: { name: string }) => p.name)).toEqual(['Pão francês']);

      await s.classify(bread).expect(200);
      const { body: draft } = await s.as('post', `/fiscal/sources/${sources[0].id}/document`).send({ type: 'nfce' }).expect(201);
      expect(draft).toMatchObject({ status: 'draft', issues: [] });
      await s.as('post', `/fiscal/sources/${sources[0].id}/document`).send({ type: 'nfce' }).expect(409);
      await s.as('post', `/fiscal/documents/${draft.id}/issue`).expect(200);
      await t.relay.drain();
      expect((await s.as('get', `/fiscal/documents/${draft.id}`).expect(200)).body.status).toBe('authorized');
    });

    it('cancelamento com justificativa e XML do cancelamento; carta de correção só na NF-e', async () => {
      const s = await bakery({ autoSale: 'nfce' });
      const bread = s.product('Pão francês');
      await s.classify(bread).expect(200);
      await s.as('post', '/sales').send({ items: [{ productId: bread.id, quantity: 1 }], payments: [{ method: 'cash', amount: 16.9 }] }).expect(201);
      await t.relay.drain();
      const [doc] = await docsOf(s);
      await s.as('post', `/fiscal/documents/${doc!.id}/correction`).send({ text: 'Correção do endereço do destinatário' }).expect(400);
      await s.as('post', `/fiscal/documents/${doc!.id}/cancel`).send({ reason: 'curto' }).expect(400);
      const { body } = await s.as('post', `/fiscal/documents/${doc!.id}/cancel`).send({ reason: 'Venda registrada em duplicidade no caixa' }).expect(200);
      expect(body).toMatchObject({ status: 'cancelled', cancelReason: 'Venda registrada em duplicidade no caixa', files: { cancelXml: true } });
      await s.as('post', `/fiscal/documents/${doc!.id}/cancel`).send({ reason: 'Venda registrada em duplicidade no caixa' }).expect(400);
    });
  });

  describe('NFS-e do atendimento (simulado)', () => {
    it('rejeitada pelo ISS, corrigida e reenviada com o mesmo número; autoriza na consulta', async () => {
      const s = await salon({ autoAppointment: true });
      const cut = s.service('Corte feminino');
      await s.as('put', '/fiscal/codes/services').send({ refId: cut.id, serviceName: cut.name, lc116: '06.01', nationalCode: '060101', nbs: '1.2601.10.00', issRate: 1.5 }).expect(200);
      const a = await s.paidAppointment();
      await t.relay.drain();

      const [doc] = await docsOf(s, `?sourceType=appointment&sourceId=${a.id}`);
      expect(doc).toMatchObject({ type: 'nfse', status: 'rejected', number: 1 });
      expect(doc!.statusMessage).toMatch(/Alíquota do ISS/);

      const { body: rejected } = await s.as('get', `/fiscal/documents/${doc!.id}`).expect(200);
      const items = rejected.items.map((i: Record<string, unknown>) => ({ ...i, issRate: 2 }));
      await s.as('patch', `/fiscal/documents/${doc!.id}`).send({ items }).expect(200);
      await s.as('post', `/fiscal/documents/${doc!.id}/issue`).expect(200);
      await t.relay.drain();
      // NFS-e é assíncrona: fica "enviada" até a consulta (job, webhook ou "Atualizar").
      expect((await s.as('get', `/fiscal/documents/${doc!.id}`).expect(200)).body.status).toBe('sending');
      await t.jobs.runOnce('fiscal.poll');
      const { body: authorized } = await s.as('get', `/fiscal/documents/${doc!.id}`).expect(200);
      expect(authorized).toMatchObject({ status: 'authorized', number: 1, taxes: { iss: 1.8 } });
      expect(authorized.verificationCode).toMatch(/^[0-9A-F]{8}$/);
      expect(authorized.events.map((e: { kind: string }) => e.kind)).toEqual(expect.arrayContaining(['created', 'sent', 'rejected', 'edited', 'resent', 'authorized']));
    });

    it('uma NFS-e tem um código de serviço só: itens com códigos diferentes não emitem', async () => {
      const s = await salon();
      const { body: draft } = await s
        .as('post', '/fiscal/documents')
        .send({
          type: 'nfse',
          customerId: s.customer.id,
          items: [
            { kind: 'service', description: 'Corte', quantity: 1, unitPrice: 90, lc116: '06.01', nationalCode: '060101', issRate: 2 },
            { kind: 'service', description: 'Curso', quantity: 1, unitPrice: 200, lc116: '08.02', nationalCode: '080201', issRate: 3 },
          ],
        })
        .expect(201);
      expect(draft.issues.map((i: { message: string }) => i.message).join(' ')).toMatch(/um só código de serviço/);
      const res = await s.as('post', `/fiscal/documents/${draft.id}/issue`).expect(400);
      expect(res.body.code).toBe('FISCAL_VALIDATION');
    });
  });

  describe('NF-e, numeração e relatórios', () => {
    it('carta de correção, descarte com lacuna, inutilização e relatório do contador', async () => {
      const s = await bakery();
      const bread = s.product('Pão francês');
      await s.classify(bread).expect(200);
      const { body: buyer } = await s
        .as('post', '/customers')
        .send({ name: 'Mercado Comprador', document: cpf(), email: uniqueEmail('mercado'), address: { zip: '01001-000', street: 'Rua A', number: '10', district: 'Centro', city: 'São Paulo', state: 'SP' } })
        .expect(201);
      const create = (extra: Record<string, unknown> = {}) =>
        s
          .as('post', '/fiscal/documents')
          .send({ type: 'nfe', customerId: buyer.id, items: [{ kind: 'product', refType: 'sales_product', refId: bread.id, description: 'Pão francês', quantity: 10, unit: 'kg', unitPrice: 16.9 }], payments: [{ method: 'pix', amount: 169 }], ...extra })
          .expect(201);

      const { body: nfe } = await create();
      await s.as('post', `/fiscal/documents/${nfe.id}/issue`).expect(200);
      await t.relay.drain();
      const { body: ok } = await s.as('post', `/fiscal/documents/${nfe.id}/refresh`).expect(200);
      expect(ok).toMatchObject({ status: 'authorized', number: 1 });
      const { body: corrected } = await s.as('post', `/fiscal/documents/${nfe.id}/correction`).send({ text: 'Onde se lê Rua A, leia-se Rua A, fundos' }).expect(200);
      expect(corrected.corrections).toEqual([expect.objectContaining({ sequence: 1, hasXml: true, hasPdf: true })]);

      // Rejeitada de propósito (REJEITAR), descartada: o nº 2 vira lacuna até ser inutilizado.
      const { body: bad } = await create({ additionalInfo: 'REJEITAR' });
      await s.as('post', `/fiscal/documents/${bad.id}/issue`).expect(200);
      await t.relay.drain();
      expect((await s.as('get', `/fiscal/documents/${bad.id}`).expect(200)).body).toMatchObject({ status: 'rejected', number: 2, statusCode: 'SIM-999' });
      await s.as('post', `/fiscal/documents/${bad.id}/discard`).send({}).expect(200);
      const { body: third } = await create();
      await s.as('post', `/fiscal/documents/${third.id}/issue`).expect(200);
      await t.relay.drain();
      await s.as('post', `/fiscal/documents/${third.id}/refresh`).expect(200);

      expect((await s.as('get', '/fiscal/gaps').expect(200)).body).toEqual([{ type: 'nfe', series: '1', numbers: [2] }]);
      await s.as('post', '/fiscal/voids').send({ type: 'nfe', series: '1', from: 1, to: 1, reason: 'Teste de inutilização indevida' }).expect(400);
      await s.as('post', '/fiscal/voids').send({ type: 'nfe', series: '1', from: 2, to: 2, reason: 'Nota rejeitada e não reenviada' }).expect(201);
      expect((await s.as('get', '/fiscal/gaps').expect(200)).body).toEqual([]);

      const today = localToday();
      const { body: report } = await s.as('get', `/fiscal/reports/summary?from=${today}&to=${today}`).expect(200);
      expect(report.totals).toMatchObject({ count: 2, total: 338 });
      const sheet = await s.as('get', `/fiscal/reports/spreadsheet?from=${today}&to=${today}`).expect(200);
      expect(sheet.text).toContain('Chave de acesso');
      expect(sheet.text.split('\r\n').filter(Boolean)).toHaveLength(3);
      const zipped = await s.as('get', `/fiscal/reports/xml-zip?from=${today}&to=${today}`).buffer(true).parse(binary).expect(200);
      expect((zipped.body as Buffer).subarray(0, 2).toString()).toBe('PK');
    });

    it('produção não aceita o modo simulado', async () => {
      const s = await bakery({ environment: 'production' });
      const bread = s.product('Pão francês');
      await s.classify(bread).expect(200);
      const { body: draft } = await s.as('post', '/fiscal/documents').send({ type: 'nfce', items: [{ kind: 'product', refType: 'sales_product', refId: bread.id, description: 'Pão', quantity: 1, unitPrice: 10 }] }).expect(201);
      expect(draft.issues.map((i: { message: string }) => i.message).join(' ')).toMatch(/simulado não emite em produção/);
    });
  });

  describe('Focus NFe (HTTP simulado)', () => {
    it('envia a DPS da NFS-e Nacional com o token, consulta pelo webhook e guarda os arquivos', async () => {
      const s = await salon({ provider: 'focus', tokenHomologation: 'token-homolog' });
      const http = t.app.get(FiscalHttp);
      const calls: { method: string; url: string; headers?: Record<string, string>; json?: any }[] = [];
      let authorized = false;
      const request = vi.spyOn(http, 'request').mockImplementation(async (method, url, opts = {}) => {
        calls.push({ method, url, headers: opts.headers, json: opts.json });
        if (method === 'POST' && url.includes('/v2/nfsen?ref=')) return { ok: true, status: 202, body: { status: 'processando_autorizacao', ref: 'x' } };
        if (method === 'GET' && url.includes('/v2/nfsen/'))
          return authorized
            ? { ok: true, status: 200, body: { status: 'autorizado', numero: '74798', codigo_verificacao: 'ABC123', caminho_xml_nota_fiscal: '/arquivos/nfse.xml', url_danfse: 'https://homologacao.focusnfe.com.br/danfse.pdf' } }
            : { ok: true, status: 200, body: { status: 'processando_autorizacao' } };
        return { ok: false, status: 404, body: {} };
      });
      const bytes = vi.spyOn(http, 'bytes').mockImplementation(async (url) => ({ ok: true, status: 200, content: Buffer.from(url.endsWith('.xml') ? '<nfse/>' : '%PDF-1.4'), mime: 'application/octet-stream' }));
      try {
        const cut = s.service('Corte feminino');
        const { body: draft } = await s
          .as('post', '/fiscal/documents')
          .send({ type: 'nfse', customerId: s.customer.id, items: [{ kind: 'service', refType: 'sch_service', refId: cut.id, description: 'Corte feminino', quantity: 1, unitPrice: 90, lc116: '06.01', nationalCode: '060101', issRate: 2 }] })
          .expect(201);
        await s.as('post', `/fiscal/documents/${draft.id}/issue`).expect(200);
        await t.relay.drain();

        const post = calls.find((c) => c.method === 'POST')!;
        expect(post.url).toBe(`https://homologacao.focusnfe.com.br/v2/nfsen?ref=${draft.reference}`);
        expect(post.headers?.Authorization).toBe(`Basic ${Buffer.from('token-homolog:').toString('base64')}`);
        expect(post.json).toMatchObject({ cnpj_prestador: CNPJ, codigo_municipio_emissora: 3550308, codigo_tributacao_nacional_iss: '060101', valor_servico: 90, serie_dps: 1, numero_dps: 1, emitente_dps: 1 });
        expect((await s.as('get', `/fiscal/documents/${draft.id}`).expect(200)).body.status).toBe('sending');

        const { body: hook } = await s.as('post', '/fiscal/webhook-secret').expect(200);
        const tenantId = hook.url.split('/').pop();
        await t.http().post(`/api/public/fiscal/webhook/${tenantId}`).set('X-Fiscal-Token', 'errado').send({ ref: draft.reference }).expect(401);
        authorized = true;
        const res = await t.http().post(`/api/public/fiscal/webhook/${tenantId}`).set('X-Fiscal-Token', hook.secret).send({ ref: draft.reference, status: 'autorizado' }).expect(200);
        expect(res.body).toEqual({ applied: true });
        const { body: done } = await s.as('get', `/fiscal/documents/${draft.id}`).expect(200);
        expect(done).toMatchObject({ status: 'authorized', number: 1, verificationCode: 'ABC123', files: { xml: true, pdf: true } });
        expect(bytes).toHaveBeenCalledWith('https://homologacao.focusnfe.com.br/arquivos/nfse.xml', expect.anything());
      } finally {
        request.mockRestore();
        bytes.mockRestore();
      }
    });

    it('falha de comunicação mantém "enviada" e tenta de novo; token errado devolve para correção', async () => {
      const s = await salon({ provider: 'focus', tokenHomologation: 'tok' });
      const http = t.app.get(FiscalHttp);
      let mode: 'down' | 'denied' = 'down';
      const request = vi.spyOn(http, 'request').mockImplementation(async () => (mode === 'down' ? { ok: false, status: 503, body: { mensagem: 'indisponível' } } : { ok: false, status: 401, body: {} }));
      try {
        const { body: draft } = await s
          .as('post', '/fiscal/documents')
          .send({ type: 'nfse', customerId: s.customer.id, items: [{ kind: 'service', description: 'Corte', quantity: 1, unitPrice: 90, lc116: '06.01', nationalCode: '060101', issRate: 2 }] })
          .expect(201);
        await s.as('post', `/fiscal/documents/${draft.id}/issue`).expect(200);
        await t.relay.drain();
        const { body: waiting } = await s.as('get', `/fiscal/documents/${draft.id}`).expect(200);
        expect(waiting.status).toBe('sending');
        expect(waiting.statusMessage).toMatch(/Falha de comunicação/);
        mode = 'denied';
        await t.jobs.runOnce('fiscal.poll');
        const { body: back } = await s.as('get', `/fiscal/documents/${draft.id}`).expect(200);
        expect(back).toMatchObject({ status: 'rejected', statusCode: 'CONFIG' });
      } finally {
        request.mockRestore();
      }
    });
  });

  it('o contador (papel padrão) vê e exporta, mas não emite', async () => {
    const s = await company(['bakery']);
    const { body: roles } = await s.as('get', '/access/roles').expect(200);
    const role = roles.find((r: { key: string }) => r.key === 'integration.fiscal.accountant');
    expect(role).toBeTruthy();
    const perms: string[] = role.permissions;
    expect(perms).toEqual(expect.arrayContaining(['integration.fiscal.read', 'integration.fiscal.export']));
    expect(perms).not.toContain('integration.fiscal.issue');
  });
});
