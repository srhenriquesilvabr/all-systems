import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, createTestApp, login, ownerSession, PASSWORD, tokenFromMail, uniqueEmail, type TestApp } from './helpers';
import { testEnv } from './env';

// Lojinha (módulo store): anúncios com fotos e promoção, vitrine pública, pedido pela vitrine
// (WhatsApp / pagar na entrega), proteção contra abuso, fluxo do pedido com reserva de estoque,
// conclusão em venda do PDV, cancelamento, avisos ao cliente, planilha e permissões.

/** Bytes que passam pela checagem de imagem (assinatura PNG). */
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
const localToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

describe('lojinha (store)', () => {
  let t: TestApp;
  const db = new Client({ connectionString: testEnv.MIGRATION_DATABASE_URL });
  beforeAll(async () => {
    t = await createTestApp();
    await db.connect();
  });
  afterAll(async () => {
    await db.end();
    await t.close();
  });

  /** Empresa com a loja, um WhatsApp nos dados da empresa e produtos próprios no PDV. */
  async function store(modules = ['store']) {
    const s = await ownerSession(t, modules);
    const slug = (await db.query(`select slug from tenants where id = $1`, [s.tenantId])).rows[0].slug as string;
    await s.as('patch', '/company').send({ phone: '(11) 98888-7777' }).expect(200);
    const product = async (body: Record<string, unknown>, stock?: number) => {
      const { body: p } = await s.as('post', '/sales/products').send({ unit: 'un', trackStock: true, ...body }).expect(201);
      if (stock) await s.as('post', '/sales/stock-moves').send({ productId: p.id, kind: 'purchase', quantity: stock }).expect(201);
      return p as { id: string; name: string };
    };
    const cake = await product({ name: 'Bolo de cenoura', category: 'Bolos', price: 40, barcode: '7891000000017' }, 5);
    const bread = await product({ name: 'Pão de mel', category: 'Doces', price: 8, trackStock: false });
    const hidden = await product({ name: 'Torta salgada', category: 'Salgados', price: 30 }, 3);
    const settings = {
      open: true,
      welcome: 'Doces feitos todos os dias.',
      pickup: { enabled: true, address: 'Rua das Flores, 10', hours: 'Seg. a sáb., 8h às 18h' },
      delivery: { enabled: true, feeMode: 'district', districts: [{ name: 'Centro', fee: 7 }, { name: 'Jardim América', fee: 12 }], minOrder: 30, eta: 'Até 60 minutos' },
      paymentModes: ['whatsapp', 'on_delivery', 'online'],
      exchangePolicy: 'Trocas em até 7 dias.',
    };
    await s.as('put', '/store/settings').send(settings).expect(200);
    await s.as('put', `/store/listings/${cake.id}`).send({ visible: true, title: 'Bolo de cenoura com chocolate', description: 'Inteiro, 20 fatias.', featured: true, promoPrice: 35 }).expect(200);
    await s.as('put', `/store/listings/${bread.id}`).send({ visible: true, category: 'Mimos' }).expect(200);
    await s.as('put', `/store/listings/${hidden.id}`).send({ visible: false }).expect(200);
    const pub = () => t.http().get(`/api/public/store/${slug}`);
    const order = (body: Record<string, unknown>) =>
      t
        .http()
        .post(`/api/public/store/${slug}/orders`)
        .send({
          name: 'Maria Cliente',
          phone: '(11) 97777-1234',
          email: 'maria.loja@teste.com',
          fulfillment: 'pickup',
          items: [{ productId: cake.id, quantity: 1 }],
          paymentMode: 'whatsapp',
          consent: true,
          consentVersion: '2026-10-28',
          startedAt: Date.now() - 20_000,
          ...body,
        });
    return { ...s, slug, cake, bread, hidden, pub, order };
  }
  type Store = Awaited<ReturnType<typeof store>>;

  const availableOf = async (s: Store, productId: string) => (await s.as('get', '/store/products').expect(200)).body.find((p: { productId: string }) => p.productId === productId);

  it('anúncios e vitrine pública: promoção, destaque, fotos e só o que está publicado', async () => {
    const s = await store();
    const { body: photo } = await s.as('post', `/store/listings/${s.cake.id}/photos`).attach('photo', PNG, { filename: 'bolo.png', contentType: 'image/png' }).expect(200);
    expect(photo.listing.photos).toHaveLength(1);
    // Tipo conferido pelos bytes, não pelo nome.
    expect((await s.as('post', `/store/listings/${s.cake.id}/photos`).attach('photo', Buffer.from('<html>oi</html>'), { filename: 'x.png', contentType: 'image/png' }).expect(400)).body.code).toBe('INVALID_FILE_TYPE');
    // Promoção maior que o preço é recusada.
    expect((await s.as('put', `/store/listings/${s.bread.id}`).send({ visible: true, promoPrice: 9 }).expect(400)).body.code).toBe('INVALID_PROMO');

    const { body } = await s.pub().expect(200);
    expect(body).toMatchObject({ open: true, welcome: 'Doces feitos todos os dias.', paymentModes: ['whatsapp', 'on_delivery'] }); // online: sem provedor
    expect(body.products.map((p: { title: string }) => p.title)).toEqual(['Bolo de cenoura com chocolate', 'Pão de mel']);
    expect(body.products[0]).toMatchObject({ price: 40, finalPrice: 35, featured: true, soldOut: false, maxQuantity: 5, category: 'Bolos' });
    expect(body.products[1]).toMatchObject({ category: 'Mimos', maxQuantity: null });
    expect(body.categories).toEqual(['Bolos', 'Mimos']);
    expect(body.consent.text).toContain('autoriza');

    const img = await t.http().get(body.products[0].photos[0]).expect(200);
    expect(img.headers['content-type']).toBe('image/png');
    expect(img.headers['cache-control']).toContain('immutable');
    expect(img.headers['x-content-type-options']).toBe('nosniff');
    // Foto de anúncio não publicado não sai pela rota pública.
    const { body: hiddenPhoto } = await s.as('post', `/store/listings/${s.hidden.id}/photos`).attach('photo', PNG, { filename: 't.png', contentType: 'image/png' }).expect(200);
    await t.http().get(`/api/public/store/${s.slug}/photos/${hiddenPhoto.listing.photos[0].fileId}`).expect(404);

    // Promoção vencida volta ao preço cheio.
    await s.as('put', `/store/listings/${s.cake.id}`).send({ visible: true, promoPrice: 35, promoUntil: '2020-01-01' }).expect(200);
    expect((await s.pub().expect(200)).body.products[0]).toMatchObject({ finalPrice: 40, promoUntil: null });

    // Sem estoque: "esgotado" ou fora da vitrine, conforme a configuração.
    await s.as('post', '/sales/stock-moves').send({ productId: s.cake.id, kind: 'count', quantity: 0 }).expect(201);
    expect((await s.pub().expect(200)).body.products[0]).toMatchObject({ soldOut: true, maxQuantity: 0 });
    const { body: current } = await s.as('get', '/store/settings').expect(200);
    await s.as('put', '/store/settings').send({ ...current, outOfStock: 'hide' }).expect(200);
    expect((await s.pub().expect(200)).body.products.map((p: { id: string }) => p.id)).toEqual([s.bread.id]);

    // Empresa sem o módulo: a loja não existe.
    const other = await ownerSession(t, ['laundry']);
    const otherSlug = (await db.query(`select slug from tenants where id = $1`, [other.tenantId])).rows[0].slug;
    expect((await t.http().get(`/api/public/store/${otherSlug}`).expect(404)).body.code).toBe('STORE_NOT_FOUND');
    await other.as('get', '/store/status').expect(403);
  });

  it('pedido pela vitrine: WhatsApp com o resumo, entrega por bairro, mínimo e travas contra abuso', async () => {
    const s = await store();

    const { body: placed } = await s.order({ items: [{ productId: s.cake.id, quantity: 2 }, { productId: s.bread.id, quantity: 3 }] }).expect(201);
    expect(placed.order).toMatchObject({ number: 1, total: 94, paymentMode: 'whatsapp' }); // 2 × 35 + 3 × 8
    expect(placed.next.kind).toBe('whatsapp');
    expect(placed.next.url).toMatch(/^https:\/\/wa\.me\/5511988887777\?text=/);
    const text = decodeURIComponent(placed.next.url.split('text=')[1]);
    expect(text).toContain('pedido nº 1');
    expect(text).toContain('Bolo de cenoura com chocolate');
    expect(text).toContain('Vou retirar no local');

    // Entrega: bairro da lista (sem acento/maiúscula também vale), taxa somada; fora da lista, recusa.
    const { body: delivered } = await s
      .order({ fulfillment: 'delivery', paymentMode: 'on_delivery', address: { zip: '01001-000', street: 'Rua A', number: '5', district: 'jardim america', city: 'São Paulo', state: 'SP' } })
      .expect(201);
    expect(delivered).toMatchObject({ order: { number: 2, total: 47 }, next: { kind: 'done' } });
    expect((await s.order({ fulfillment: 'delivery', address: { street: 'Rua B', number: '1', district: 'Bairro Longe', city: 'São Paulo' } }).expect(400)).body.code).toBe('DISTRICT_NOT_SERVED');
    expect((await s.order({ fulfillment: 'delivery', items: [{ productId: s.bread.id, quantity: 1 }], address: { street: 'Rua B', number: '1', district: 'Centro', city: 'São Paulo' } }).expect(400)).body.code).toBe('MIN_ORDER');
    expect((await s.order({ fulfillment: 'delivery' }).expect(400)).body.code).toBe('VALIDATION'); // sem endereço

    // Regras da vitrine: consentimento, produto não publicado, estoque, modo desligado e loja pausada.
    await s.order({ consent: false }).expect(400);
    expect((await s.order({ consentVersion: 'antiga' }).expect(400)).body.code).toBe('CONSENT_OUTDATED');
    expect((await s.order({ items: [{ productId: s.hidden.id, quantity: 1 }] }).expect(400)).body.code).toBe('PRODUCT_UNAVAILABLE');
    expect((await s.order({ items: [{ productId: s.cake.id, quantity: 6 }] }).expect(409)).body.code).toBe('OUT_OF_STOCK');
    expect((await s.order({ items: [{ productId: s.cake.id, quantity: 1.5 }] }).expect(400)).body.code).toBe('INVALID_QUANTITY');
    expect((await s.order({ paymentMode: 'online' }).expect(400)).body.code).toBe('PAYMENT_MODE_UNAVAILABLE');

    // Robô (campo escondido ou envio instantâneo): "ok" sem gravar nada.
    expect((await s.order({ website: 'http://spam' }).expect(201)).body).toEqual({ ok: true });
    expect((await s.order({ startedAt: Date.now() }).expect(201)).body).toEqual({ ok: true });

    const { body: settings } = await s.as('get', '/store/settings').expect(200);
    await s.as('put', '/store/settings').send({ ...settings, open: false }).expect(200);
    expect((await s.order({}).expect(409)).body.code).toBe('STORE_CLOSED');
    expect((await s.pub().expect(200)).body.open).toBe(false);
    await s.as('put', '/store/settings').send({ ...settings, open: true }).expect(200);

    // Limite por celular (10 por dia na empresa).
    for (let i = 0; i < 8; i++) await s.order({ items: [{ productId: s.bread.id, quantity: 1 }] }).expect(201);
    expect((await s.order({ items: [{ productId: s.bread.id, quantity: 1 }] }).expect(429)).body.code).toBe('TOO_MANY_ORDERS');

    const { body: orders } = await s.as('get', '/store/orders?status=new').expect(200);
    expect(orders).toHaveLength(10);
    expect(orders.map((o: { number: number }) => o.number)).toEqual([10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
    expect((await s.as('get', '/store/orders?q=2').expect(200)).body.map((o: { number: number }) => o.number)).toEqual([2]);
  });

  it('fluxo: confirmar reserva o estoque e liga o cliente; concluir vira venda com o preço do pedido; cancelar libera', async () => {
    const s = await store();
    // Cliente já cadastrado com o mesmo celular: o pedido é ligado a ele.
    const { body: existing } = await s.as('post', '/customers').send({ name: 'Maria Cliente', phone: '11977771234' }).expect(201);

    const { body: placed } = await s
      .order({ fulfillment: 'delivery', paymentMode: 'on_delivery', items: [{ productId: s.cake.id, quantity: 2 }], address: { street: 'Rua A', number: '5', district: 'Centro', city: 'São Paulo' } })
      .expect(201);
    const id = placed.order.id as string;
    const { body: fresh } = await s.as('get', `/store/orders/${id}`).expect(200);
    expect(fresh).toMatchObject({ status: 'new', customer: null, subtotal: 70, deliveryFee: 7, total: 77, next: ['confirmed', 'preparing', 'dispatched'] });
    expect(fresh.consent).toMatchObject({ version: '2026-10-28' });
    expect((await availableOf(s, s.cake.id)).available).toBe(5);

    // "Pronto para retirada" não existe em pedido de entrega.
    expect((await s.as('post', `/store/orders/${id}/status`).send({ status: 'ready' }).expect(400)).body.code).toBe('INVALID_STATUS');

    const { body: confirmed } = await s.as('post', `/store/orders/${id}/status`).send({ status: 'confirmed' }).expect(200);
    expect(confirmed).toMatchObject({ status: 'confirmed', customer: { id: existing.id }, warnings: [] });
    expect(await availableOf(s, s.cake.id)).toMatchObject({ stock: 5, reserved: 2, available: 3 });
    expect((await s.pub().expect(200)).body.products[0].maxQuantity).toBe(3);
    // A vitrine não deixa pedir o que está reservado.
    expect((await s.order({ items: [{ productId: s.cake.id, quantity: 4 }] }).expect(409)).body.code).toBe('OUT_OF_STOCK');

    await s.as('post', `/store/orders/${id}/status`).send({ status: 'preparing' }).expect(200);
    await s.as('post', `/store/orders/${id}/status`).send({ status: 'dispatched' }).expect(200);
    expect((await s.as('post', `/store/orders/${id}/status`).send({ status: 'confirmed' }).expect(400)).body.code).toBe('INVALID_STATUS'); // não volta

    // Sem promoção agora: a venda usa o preço do pedido (35), não o do cadastro.
    await s.as('put', `/store/listings/${s.cake.id}`).send({ visible: true, promoPrice: null }).expect(200);
    const { body: done } = await s.as('post', `/store/orders/${id}/complete`).send({ paymentMethod: 'pix' }).expect(200);
    expect(done).toMatchObject({ status: 'completed', paymentStatus: 'paid', paymentMethod: 'pix', saleNumber: 1 });
    const { body: sale } = await s.as('get', `/sales/${done.saleId}`).expect(200);
    expect(sale).toMatchObject({ total: 70, customer: { id: existing.id }, payments: [{ method: 'pix', amount: 70 }], items: [expect.objectContaining({ quantity: 2, unitPrice: 35, total: 70 })] });
    expect(sale.notes).toContain('Pedido nº 1');
    expect(await availableOf(s, s.cake.id)).toMatchObject({ stock: 3, reserved: 0, available: 3 });

    // Financeiro: a venda (origem sale) e a taxa de entrega (origem store_order), ambas pagas.
    const { body: entries } = await s.as('get', '/finance/entries?limit=50').expect(200);
    expect(entries.items.filter((e: { sourceId: string }) => e.sourceId === sale.id)).toEqual([expect.objectContaining({ status: 'paid', amount: 70 })]);
    expect(entries.items.filter((e: { sourceId: string }) => e.sourceId === id)).toEqual([expect.objectContaining({ status: 'paid', amount: 7, customerId: existing.id })]);

    // Concluído não cancela pela loja (cancela-se a venda).
    expect((await s.as('post', `/store/orders/${id}/cancel`).send({ reason: 'Desistiu' }).expect(400)).body.code).toBe('ORDER_COMPLETED');

    // Cancelar um confirmado devolve a reserva; o cliente novo é criado pelo celular.
    const { body: other } = await s.order({ phone: '(21) 96666-5555', name: 'Joana Nova', email: 'joana.loja@teste.com', items: [{ productId: s.cake.id, quantity: 3 }] }).expect(201);
    const { body: c2 } = await s.as('post', `/store/orders/${other.order.id}/status`).send({ status: 'confirmed' }).expect(200);
    expect(c2.customer.name).toBe('Joana Nova');
    expect((await availableOf(s, s.cake.id)).available).toBe(0);
    expect((await s.as('post', `/store/orders/${other.order.id}/cancel`).send({ reason: 'x' }).expect(400)).body.code).toBe('VALIDATION');
    const { body: cancelled } = await s.as('post', `/store/orders/${other.order.id}/cancel`).send({ reason: 'Cliente desistiu' }).expect(200);
    expect(cancelled).toMatchObject({ status: 'cancelled', cancelReason: 'Cliente desistiu' });
    expect((await availableOf(s, s.cake.id)).available).toBe(3);
    await s.as('post', `/store/orders/${other.order.id}/status`).send({ status: 'preparing' }).expect(400);

    const audit = await db.query(`select action from audit_logs where tenant_id = $1 and entity = 'store_order' order by created_at`, [s.tenantId]);
    expect(audit.rows.map((r) => r.action)).toEqual(expect.arrayContaining(['store.order.placed', 'store.order.status_changed', 'store.order.completed', 'store.order.cancelled']));
    const history = (await s.as('get', `/store/orders/${id}`).expect(200)).body.events.map((e: { status: string }) => e.status);
    expect(history).toEqual(['new', 'confirmed', 'preparing', 'dispatched', 'completed']);
  });

  it('confirmar sem estoque: avisa, ou recusa quando o PDV bloqueia venda sem estoque; fiado exige cliente', async () => {
    const s = await store();
    const a = (await s.order({ items: [{ productId: s.cake.id, quantity: 4 }] }).expect(201)).body.order.id;
    const b = (await s.order({ phone: '11955554444', email: null, items: [{ productId: s.cake.id, quantity: 3 }] }).expect(201)).body.order.id;
    await s.as('post', `/store/orders/${a}/status`).send({ status: 'confirmed' }).expect(200);
    const { body: warned } = await s.as('post', `/store/orders/${b}/status`).send({ status: 'confirmed' }).expect(200);
    expect(warned.warnings[0]).toContain('Estoque insuficiente');
    expect((await availableOf(s, s.cake.id)).available).toBe(-2);

    const c = (await s.order({ phone: '11944443333', items: [{ productId: s.bread.id, quantity: 1 }, { productId: s.cake.id, quantity: 1 }] })).body.order;
    expect(c).toBeUndefined(); // a vitrine já não aceita: sem estoque disponível
    await s.as('put', '/modules/shared.sales/settings').send({ blockNegativeStock: true }).expect(204);
    const { body: admin } = await s.as('post', '/store/orders').send({ name: 'Balcão', phone: '11933332222', fulfillment: 'pickup', paymentMode: 'on_delivery', items: [{ productId: s.cake.id, quantity: 1 }] }).expect(201);
    expect(admin).toMatchObject({ source: 'admin', status: 'new', number: 3 });
    expect((await s.as('post', `/store/orders/${admin.id}/status`).send({ status: 'confirmed' }).expect(409)).body.code).toBe('OUT_OF_STOCK');

    // Concluir com venda fiado precisa de cliente; o pedido do balcão liga/cria pelo celular.
    const pdm = (await s.as('post', '/store/orders').send({ name: 'Seu Zé', phone: '11922221111', fulfillment: 'pickup', paymentMode: 'on_delivery', items: [{ productId: s.bread.id, quantity: 2 }] }).expect(201)).body;
    const { body: fiado } = await s.as('post', `/store/orders/${pdm.id}/complete`).send({ paymentMethod: 'on_account' }).expect(200);
    expect(fiado).toMatchObject({ status: 'completed', paymentStatus: 'pending', customer: { name: 'Seu Zé' } });
  });

  it('avisa o cliente pelas notificações quando o módulo está ativo (e não trava sem ele)', async () => {
    const s = await store(['store', 'shared.notifications']);
    const id = (await s.order({ items: [{ productId: s.bread.id, quantity: 2 }] }).expect(201)).body.order.id;
    await s.as('post', `/store/orders/${id}/status`).send({ status: 'confirmed' }).expect(200);
    await s.as('post', `/store/orders/${id}/status`).send({ status: 'ready' }).expect(200);
    await s.as('post', `/store/orders/${id}/complete`).send({ paymentMethod: 'cash' }).expect(200);
    const sent = await db.query(`select template_key, channel, subject from notifications where related_id = $1 order by created_at`, [id]);
    expect(sent.rows.map((r) => r.template_key)).toEqual(['store.order.confirmed', 'store.order.ready', 'store.order.completed']);
    expect(sent.rows[0]).toMatchObject({ channel: 'email', subject: 'Pedido nº 1 confirmado' });
    await t.relay.drain();
    expect(t.mails.some((m) => m.to === 'maria.loja@teste.com' && m.subject === 'Pedido nº 1 confirmado')).toBe(true);

    // Sem o módulo de notificações, o fluxo segue e nada é enfileirado.
    const plain = await store();
    const other = (await plain.order({ items: [{ productId: plain.bread.id, quantity: 1 }] }).expect(201)).body.order.id;
    await plain.as('post', `/store/orders/${other}/status`).send({ status: 'confirmed' }).expect(200);
    expect((await db.query(`select count(*)::int as n from notifications where related_id = $1`, [other])).rows[0].n).toBe(0);
  });

  it('planilha de anúncios, banner, CEP público e permissões dos papéis', async () => {
    const s = await store();
    const { body: byBarcode } = await s.as('post', '/store/listings/import').send({ product: '7891000000017', visible: true, description: 'Da planilha', promoPrice: 30, promoUntil: localToday() }).expect(200);
    expect(byBarcode.listing).toMatchObject({ description: 'Da planilha', promoPrice: 30, promoUntil: localToday() });
    const { body: byName } = await s.as('post', '/store/listings/import').send({ product: 'torta SALGADA', visible: true }).expect(200);
    expect(byName).toMatchObject({ productId: s.hidden.id, listing: { visible: true } });
    expect((await s.as('post', '/store/listings/import').send({ product: 'Não existe' }).expect(400)).body.code).toBe('PRODUCT_NOT_FOUND');

    await s.as('post', '/store/banner').attach('banner', PNG, { filename: 'b.png', contentType: 'image/png' }).expect(200);
    const { body: status } = await s.as('get', '/store/status').expect(200);
    expect(status).toMatchObject({ open: true, paymentModes: ['whatsapp', 'on_delivery'], onlinePaymentAvailable: false, notifications: false });
    expect(status.publicUrl).toContain(`/loja/${s.slug}`);
    const { body: pub } = await s.pub().expect(200);
    expect(pub.bannerUrl).toBe(`/api/public/store/${s.slug}/banner?v=${status.bannerFileId}`);
    await t.http().get(pub.bannerUrl).expect(200);

    const cep = await t.http().get(`/api/public/store/${s.slug}/cep/01001000`).expect(200);
    expect(cep.body).toMatchObject({ street: 'Praça da Sé', district: 'Sé', city: 'São Paulo', state: 'SP' });
    expect((await t.http().get(`/api/public/store/${s.slug}/cep/99999999`).expect(404)).body.code).toBe('CEP_NOT_FOUND');

    // Atendente: vê e anda com os pedidos, não cancela nem mexe em anúncios/configurações.
    const roles = await s.as('get', '/access/roles').expect(200);
    const role = roles.body.find((r: { key: string }) => r.key === 'store.attendant');
    const email = uniqueEmail('atendente');
    await s.as('post', '/users/invite').send({ email, name: 'Atendente', roleIds: [role.id] }).expect(201);
    const token = tokenFromMail(t.mails.findLast((m) => m.to === email));
    await t.http().post('/api/auth/set-password').send({ token, password: PASSWORD, name: 'Atendente' }).expect(204);
    const session = await login(t, email);
    const as = (method: 'get' | 'post' | 'put', path: string) => t.http()[method](`/api${path}`).set(auth(session.token));
    const id = (await s.order({}).expect(201)).body.order.id;
    await as('get', '/store/orders').expect(200);
    await as('post', `/store/orders/${id}/status`).send({ status: 'confirmed' }).expect(200);
    await as('post', `/store/orders/${id}/cancel`).send({ reason: 'Teste de permissão' }).expect(403);
    await as('put', `/store/listings/${s.bread.id}`).send({ visible: false }).expect(403);
    await as('get', '/store/settings').expect(403);
    await as('get', '/store/products').expect(200); // para lançar pedido
  });
});
