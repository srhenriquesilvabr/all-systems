import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTenant, createTestApp, ownerSession, uniqueEmail, type TestApp } from './helpers';

const localToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

describe('crédito: integração bancária, veículos, imóveis e consórcio', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  const applicant = (income: number) => ({ name: 'Rafael Comprador', document: '12345678909', monthlyIncome: income, birthDate: '1990-05-10' });

  async function dealer() {
    const s = await ownerSession(t, ['vehicles']);
    const { body: customer } = await s.as('post', '/customers').send({ name: 'Rafael Comprador', email: uniqueEmail('comprador'), phone: '(48) 99300-4455' }).expect(201);
    const { body: car } = await s
      .as('post', '/vehicles/stock')
      .send({ brand: 'Volkswagen', model: 'Gol', version: '1.0 MPI', yearManufacture: 2020, yearModel: 2020, plate: 'abc-1d23', km: 42000, price: 52000, cost: 44000, fipeCode: '005340-6', fipePrice: 48500 })
      .expect(201);
    return { ...s, customer, car };
  }

  /** Convida alguém para a equipe da empresa e devolve o id de usuário (pelo /users/team). */
  async function teammate(s: Awaited<ReturnType<typeof ownerSession>>, name: string) {
    const { body: invited } = await s.as('post', '/users/invite').send({ email: uniqueEmail('vendedor'), name }).expect(201);
    const { body: team } = await s.as('get', '/users/team').expect(200);
    const user = team.find((u: { name: string }) => u.name === name) as { id: string; name: string };
    return { ...user, membershipId: invited.membershipId as string };
  }

  describe('integração bancária', () => {
    it('instituições simuladas vêm configuradas e a simulação ordena pela menor parcela', async () => {
      const s = await dealer();
      const { body: conns } = await s.as('get', '/banking/connections').expect(200);
      expect(conns.map((c: { name: string }) => c.name)).toEqual(['Banco Parceiro A (simulação)', 'Financeira Parceira B (simulação)', 'Banco Parceiro C (simulação)', 'Administradora de Consórcio D (simulação)']);
      const { body } = await s.as('post', '/banking/simulate').send({ product: 'vehicle_financing', amount: 40000, termMonths: 48 }).expect(200);
      expect(body.offers.map((o: { institution: string }) => o.institution)).toEqual(['Banco Parceiro A (simulação)', 'Financeira Parceira B (simulação)']);
      const [best] = body.offers;
      expect(best.monthlyRate).toBeCloseTo(0.0189, 6);
      expect(best.fees.tac).toBe(600);
      expect(best.cetYearly).toBeGreaterThan(best.yearlyRate);
      expect(body.offers[0].firstInstallment).toBeLessThan(body.offers[1].firstInstallment);
    });

    it('API REST da instituição: OAuth2, simulação, proposta e webhook assinado', async () => {
      const s = await dealer();
      const { body: conn } = await s
        .as('post', '/banking/connections')
        .send({ name: 'Banco Real API', mode: 'api', products: ['vehicle_financing'], baseUrl: 'https://api.banco.exemplo', clientId: 'cli', clientSecret: 'segredo', webhookSecret: 'whsec' })
        .expect(201);
      expect(conn).toMatchObject({ hasClientSecret: true, hasWebhookSecret: true });
      expect(JSON.stringify(conn)).not.toContain('segredo');

      t.bankApi.respond = (method, url, json) => {
        if (url.endsWith('/v1/simulations')) return { ok: true, status: 200, body: { monthlyRate: 0.0159, firstInstallment: json.amount / 30, totalPaid: json.amount * 1.6, cetYearly: 0.24, system: 'price' } };
        if (url.endsWith('/v1/proposals') && method === 'POST') return { ok: true, status: 201, body: { id: 'BR-777', status: 'recebida' } };
        return { ok: false, status: 404, body: {} };
      };
      // Só a instituição por API, para o teste ficar determinístico.
      for (const c of (await s.as('get', '/banking/connections').expect(200)).body.filter((x: { id: string }) => x.id !== conn.id)) {
        await s.as('patch', `/banking/connections/${c.id}`).send({ ...c, active: false }).expect(200);
      }
      const { body: sim } = await s.as('post', '/banking/simulate').send({ product: 'vehicle_financing', amount: 30000, termMonths: 36 }).expect(200);
      expect(sim.offers).toEqual([expect.objectContaining({ institution: 'Banco Real API', monthlyRate: 0.0159, firstInstallment: 1000 })]);
      expect(t.bankApi.calls.find((c) => c.url.endsWith('/oauth/token'))?.form).toEqual({ grant_type: 'client_credentials' });

      const { body: deal } = await s.as('post', '/vehicles/deals').send({ customerId: s.customer.id, vehicleId: s.car.id, price: 52000, paymentType: 'financing', downPayment: 22000 }).expect(201);
      const { body: proposal } = await s
        .as('post', '/banking/proposals')
        .send({ connectionId: conn.id, product: 'vehicle_financing', sourceType: 'vehicle_deal', sourceId: deal.id, customerId: s.customer.id, amount: 30000, termMonths: 36, applicant: applicant(9000) })
        .expect(201);
      expect(proposal).toMatchObject({ status: 'submitted', externalId: 'BR-777' });

      const payload = JSON.stringify({ proposalId: 'BR-777', status: 'aprovada', message: 'Crédito liberado', result: { approvedAmount: 30000 } });
      await t.http().post(`/api/public/banking/webhook/${conn.id}`).set('Content-Type', 'application/json').set('X-Signature', 'sha256=errado').send(payload).expect(401);
      const sig = `sha256=${createHmac('sha256', 'whsec').update(payload).digest('hex')}`;
      await t.http().post(`/api/public/banking/webhook/${conn.id}`).set('Content-Type', 'application/json').set('X-Signature', sig).send(payload).expect(200);
      await t.relay.drain();

      const { body: after } = await s.as('get', `/banking/proposals?sourceType=vehicle_deal&sourceId=${deal.id}`).expect(200);
      expect(after[0]).toMatchObject({ status: 'approved', statusMessage: 'Crédito liberado', result: { approvedAmount: 30000 } });
      expect(after[0].events.map((e: { source: string }) => e.source)).toEqual(['submit', 'webhook']);
      expect((await s.as('get', `/vehicles/deals/${deal.id}`).expect(200)).body.status).toBe('credit_approved');
    });
  });

  describe('revenda de veículos', () => {
    it('FIPE pela BrasilAPI e placa única', async () => {
      const s = await dealer();
      expect(s.car).toMatchObject({ plate: 'ABC1D23', cost: 44000 });
      const { body: fipe } = await s.as('get', '/vehicles/fipe/005340-6').expect(200);
      expect(fipe[0]).toMatchObject({ modelo: 'Gol 1.0', valor: 48500 });
      await s.as('get', '/vehicles/fipe/123').expect(400);
      const dup = await s.as('post', '/vehicles/stock').send({ brand: 'Fiat', model: 'Uno', yearManufacture: 2015, yearModel: 2015, plate: 'ABC1D23', price: 20000 }).expect(409);
      expect(dup.body.code).toBe('PLATE_TAKEN');
    });

    it('venda financiada: crédito aprovado avisa o cliente; fechar baixa estoque, recebe troca e lança entrada e repasse', async () => {
      const s = await ownerSession(t, ['vehicles', 'integration.whatsapp']);
      const { body: customer } = await s.as('post', '/customers').send({ name: 'Rafael Comprador', email: uniqueEmail('comprador'), phone: '(48) 99300-4455' }).expect(201);
      const { body: car } = await s.as('post', '/vehicles/stock').send({ brand: 'Toyota', model: 'Corolla', yearManufacture: 2022, yearModel: 2023, price: 120000 }).expect(201);
      const { body: deal } = await s
        .as('post', '/vehicles/deals')
        .send({ customerId: customer.id, vehicleId: car.id, price: 120000, discount: 2000, paymentType: 'financing', downPayment: 30000, tradeIn: { brand: 'Fiat', model: 'Argo', yearModel: 2019, value: 38000 } })
        .expect(201);
      expect(deal).toMatchObject({ financedAmount: 50000, status: 'negotiating' });
      expect((await s.as('get', `/vehicles/stock/${car.id}`).expect(200)).body.status).toBe('reserved');
      await s.as('post', '/vehicles/deals').send({ customerId: customer.id, vehicleId: car.id, price: 120000 }).expect(409);
      await s.as('post', `/vehicles/deals/${deal.id}/close`).expect(400); // sem crédito aprovado

      const { body: conns } = await s.as('get', '/banking/connections').expect(200);
      const bankA = conns.find((c: { name: string }) => c.name.startsWith('Banco Parceiro A'));
      // Renda baixa: recusado.
      const { body: p1 } = await s
        .as('post', '/banking/proposals')
        .send({ connectionId: bankA.id, product: 'vehicle_financing', sourceType: 'vehicle_deal', sourceId: deal.id, customerId: customer.id, amount: 50000, termMonths: 48, applicant: applicant(3000) })
        .expect(201);
      await s.as('post', `/banking/proposals/${p1.id}/refresh`).expect(200);
      await t.relay.drain();
      expect((await s.as('get', `/vehicles/deals/${deal.id}`).expect(200)).body.status).toBe('credit_rejected');

      const { body: p2 } = await s
        .as('post', '/banking/proposals')
        .send({ connectionId: bankA.id, product: 'vehicle_financing', sourceType: 'vehicle_deal', sourceId: deal.id, customerId: customer.id, amount: 50000, termMonths: 48, applicant: applicant(12000) })
        .expect(201);
      await t.jobs.runOnce('banking.poll');
      await t.relay.drain();
      const { body: approved } = await s.as('get', `/vehicles/deals/${deal.id}`).expect(200);
      expect(approved.status).toBe('credit_approved');
      const { body: msgs } = await s.as('get', `/notifications?relatedEntity=veh_deal&relatedId=${deal.id}`).expect(200);
      expect(msgs.map((m: { templateKey: string }) => m.templateKey)).toContain('vehicles.credit_approved');

      await s.as('post', `/banking/proposals/${p2.id}/status`).send({ status: 'contracted' }).expect(200);
      const { body: closed } = await s.as('post', `/vehicles/deals/${deal.id}/close`).expect(200);
      expect(closed.status).toBe('closed');
      expect((await s.as('get', `/vehicles/stock/${car.id}`).expect(200)).body.status).toBe('sold');
      const { body: stock } = await s.as('get', '/vehicles/stock?status=inactive').expect(200);
      expect(stock.map((v: { model: string; cost: number }) => [v.model, v.cost])).toEqual([['Argo', 38000]]);

      const { body: entries } = await s.as('get', `/finance/entries?limit=50&customerId=${customer.id}`).expect(200);
      const amounts = entries.items.filter((e: { sourceId: string }) => e.sourceId === deal.id).map((e: { amount: number }) => e.amount).sort((a: number, b: number) => a - b);
      expect(amounts).toEqual([30000, 50000]);
    });

    it('vendedor responsável, troca de vendedor, motivo de perda padronizado e resumo por vendedor', async () => {
      const s = await dealer();
      const bia = await teammate(s, 'Vendedora Bia');
      const outsider = await createTenant(t);
      const car = async () => (await s.as('post', '/vehicles/stock').send({ brand: 'Fiat', model: 'Mobi', yearManufacture: 2021, yearModel: 2021, price: 50000 }).expect(201)).body as { id: string };
      const open = (vehicleId: string, body: Record<string, unknown> = {}) => s.as('post', '/vehicles/deals').send({ customerId: s.customer.id, vehicleId, price: 52000, paymentType: 'cash', ...body });

      // Sem informar, o vendedor é quem abriu; outro da equipe pode ser escolhido; de fora, não.
      const { body: d1 } = await open(s.car.id, { discount: 2000 }).expect(201);
      expect(d1).toMatchObject({ sellerId: s.ownerUserId, sellerName: 'Dono Teste' });
      const car2 = await car();
      expect((await open(car2.id, { sellerId: outsider.ownerUserId }).expect(400)).body.code).toBe('SELLER_NOT_MEMBER');
      const { body: d2 } = await open(car2.id, { sellerId: bia.id }).expect(201);
      expect(d2).toMatchObject({ sellerId: bia.id, sellerName: 'Vendedora Bia' });

      // Troca do vendedor numa negociação aberta.
      expect((await s.as('patch', `/vehicles/deals/${d1.id}/seller`).send({ sellerId: outsider.ownerUserId }).expect(400)).body.code).toBe('SELLER_NOT_MEMBER');
      const { body: moved } = await s.as('patch', `/vehicles/deals/${d1.id}/seller`).send({ sellerId: bia.id }).expect(200);
      expect(moved).toMatchObject({ sellerId: bia.id, sellerName: 'Vendedora Bia' });

      // Perda: motivo da lista; "outro" exige detalhe; o texto livre sozinho não vale mais.
      await s.as('post', `/vehicles/deals/${d2.id}/lose`).send({ reason: 'Achou caro' }).expect(400);
      await s.as('post', `/vehicles/deals/${d2.id}/lose`).send({ reasonKey: 'other' }).expect(400);
      await s.as('post', `/vehicles/deals/${d2.id}/lose`).send({ reasonKey: 'documentation' }).expect(400); // motivo da imobiliária
      const { body: lost } = await s.as('post', `/vehicles/deals/${d2.id}/lose`).send({ reasonKey: 'price' }).expect(200);
      expect(lost).toMatchObject({ status: 'lost', lostReasonKey: 'price', lostReason: null, lostAt: expect.any(String) });
      const { body: d4 } = await open(car2.id).expect(201); // o veículo voltou ao estoque
      const { body: lost4 } = await s.as('post', `/vehicles/deals/${d4.id}/lose`).send({ reasonKey: 'other', reason: 'Mudou de cidade' }).expect(200);
      expect(lost4).toMatchObject({ lostReasonKey: 'other', lostReason: 'Mudou de cidade', sellerId: s.ownerUserId });

      await s.as('post', `/vehicles/deals/${d1.id}/close`).expect(200);
      expect((await s.as('patch', `/vehicles/deals/${d1.id}/seller`).send({ sellerId: s.ownerUserId }).expect(400)).body.code).toBe('DEAL_CLOSED');
      const { body: d3 } = await open((await car()).id).expect(201);

      // Resumo do mês: Bia vendeu o d1 (52.000 - 2.000) e perdeu o d2; o dono tem o d3 aberto e perdeu o d4.
      const { body: summary } = await s.as('get', '/vehicles/deals/summary').expect(200);
      expect(summary.from).toBe(`${localToday().slice(0, 7)}-01`);
      expect(summary.sellers).toEqual([
        { sellerId: bia.id, sellerName: 'Vendedora Bia', open: 0, won: 1, wonValue: 50000, lost: 1 },
        { sellerId: s.ownerUserId, sellerName: 'Dono Teste', open: 1, won: 0, wonValue: 0, lost: 1 },
      ]);
      expect(summary.lostByReason).toHaveLength(2);
      expect(summary.lostByReason).toEqual(expect.arrayContaining([{ reasonKey: 'price', count: 1 }, { reasonKey: 'other', count: 1 }]));
      // Em outro período só conta o que está em aberto agora.
      const { body: past } = await s.as('get', '/vehicles/deals/summary?from=2020-01-01&to=2020-01-31').expect(200);
      expect(past).toEqual({ from: '2020-01-01', to: '2020-01-31', sellers: [{ sellerId: s.ownerUserId, sellerName: 'Dono Teste', open: 1, won: 0, wonValue: 0, lost: 0 }], lostByReason: [] });
      await s.as('get', '/vehicles/deals/summary?from=2020-02-01&to=2020-01-01').expect(400);

      // Filtro por vendedor.
      const { body: biaDeals } = await s.as('get', `/vehicles/deals?sellerId=${bia.id}`).expect(200);
      expect(biaDeals.map((d: { id: string }) => d.id).sort()).toEqual([d1.id, d2.id].sort());

      // Quem saiu da equipe não recebe negociações.
      await s.as('patch', `/users/${bia.membershipId}`).send({ status: 'disabled' }).expect(204);
      expect((await s.as('patch', `/vehicles/deals/${d3.id}/seller`).send({ sellerId: bia.id }).expect(400)).body.code).toBe('SELLER_NOT_MEMBER');
    });
  });

  describe('imobiliária', () => {
    it('proposta com entrada e FGTS, limite de 80% financiado, aprovação e comissão', async () => {
      const s = await ownerSession(t, ['real_estate']);
      const { body: owner } = await s.as('post', '/customers').send({ name: 'Dona Proprietária' }).expect(201);
      const { body: buyer } = await s.as('post', '/customers').send({ name: 'Comprador Imóvel', email: uniqueEmail('imovel') }).expect(201);
      const { body: prop } = await s
        .as('post', '/real-estate/properties')
        .send({ type: 'apartment', title: 'Apto 3 quartos no Centro', ownerId: owner.id, street: 'Rua Felipe Schmidt', number: '100', district: 'Centro', city: 'Florianópolis', state: 'sc', areaM2: 90, bedrooms: 3, salePrice: 600000 })
        .expect(201);
      expect(prop).toMatchObject({ code: 1, state: 'SC', pricePerM2: 6666.67 });
      const deal = (body: Record<string, unknown>) => s.as('post', '/real-estate/deals').send({ customerId: buyer.id, propertyId: prop.id, price: 580000, ...body });
      expect((await deal({ downPayment: 50000 }).expect(400)).body.code).toBe('LTV_EXCEEDED');
      await deal({ customerId: owner.id, downPayment: 200000 }).expect(400);
      const { body: d } = await deal({ downPayment: 80000, fgtsAmount: 40000, commissionPercent: 5 }).expect(201);
      expect(d).toMatchObject({ financedAmount: 460000, commission: 29000, status: 'negotiating' });

      const { body: sim } = await s.as('post', '/banking/simulate').send({ product: 'real_estate_financing', amount: 460000, termMonths: 360 }).expect(200);
      expect(sim.offers.map((o: { system: string }) => o.system)).toEqual(['sac', 'sac']);
      expect(sim.offers[0].firstInstallment).toBeGreaterThan(sim.offers[0].lastInstallment);
      const bank = sim.offers[0];
      const { body: p } = await s
        .as('post', '/banking/proposals')
        .send({ connectionId: bank.connectionId, product: 'real_estate_financing', sourceType: 'real_estate_deal', sourceId: d.id, customerId: buyer.id, amount: 460000, termMonths: 360, system: 'sac', applicant: applicant(25000) })
        .expect(201);
      await s.as('post', `/banking/proposals/${p.id}/refresh`).expect(200);
      await t.relay.drain();
      await s.as('post', `/real-estate/deals/${d.id}/close`).expect(200);
      expect((await s.as('get', `/real-estate/properties/${prop.id}`).expect(200)).body.status).toBe('sold');
      const { body: entries } = await s.as('get', `/finance/entries?limit=50&customerId=${owner.id}`).expect(200);
      expect(entries.items.filter((e: { sourceId: string }) => e.sourceId === d.id)).toEqual([expect.objectContaining({ amount: 29000, status: 'pending' })]);
    });

    it('corretor responsável, troca de corretor, motivo de perda e resumo por corretor', async () => {
      const s = await ownerSession(t, ['real_estate']);
      const ana = await teammate(s, 'Corretora Ana');
      const outsider = await createTenant(t);
      const { body: owner } = await s.as('post', '/customers').send({ name: 'Dono do Imóvel' }).expect(201);
      const { body: buyer } = await s.as('post', '/customers').send({ name: 'Compradora', email: uniqueEmail('re') }).expect(201);
      const property = async (title: string) =>
        (
          await s
            .as('post', '/real-estate/properties')
            .send({ type: 'house', title, ownerId: owner.id, street: 'Rua das Flores', number: '10', district: 'Centro', city: 'Joinville', state: 'SC', salePrice: 500000 })
            .expect(201)
        ).body as { id: string };
      const open = (propertyId: string, body: Record<string, unknown> = {}) =>
        s.as('post', '/real-estate/deals').send({ customerId: buyer.id, propertyId, price: 500000, paymentType: 'cash', commissionPercent: 5, ...body });

      const p1 = await property('Casa 1');
      const { body: d1 } = await open(p1.id).expect(201);
      expect(d1).toMatchObject({ brokerId: s.ownerUserId, brokerName: 'Dono Teste' });
      const p2 = await property('Casa 2');
      expect((await open(p2.id, { brokerId: outsider.ownerUserId }).expect(400)).body.code).toBe('SELLER_NOT_MEMBER');
      const { body: d2 } = await open(p2.id, { brokerId: ana.id }).expect(201);
      expect(d2).toMatchObject({ brokerId: ana.id, brokerName: 'Corretora Ana' });
      await s.as('post', `/real-estate/deals/${d2.id}/close`).expect(200);

      expect((await s.as('patch', `/real-estate/deals/${d1.id}/broker`).send({ brokerId: outsider.ownerUserId }).expect(400)).body.code).toBe('SELLER_NOT_MEMBER');
      expect((await s.as('patch', `/real-estate/deals/${d1.id}/broker`).send({ brokerId: ana.id }).expect(200)).body).toMatchObject({ brokerId: ana.id });

      await s.as('post', `/real-estate/deals/${d1.id}/lose`).send({ reasonKey: 'other', reason: 'ab' }).expect(400);
      await s.as('post', `/real-estate/deals/${d1.id}/lose`).send({ reasonKey: 'trade_rejected' }).expect(400); // motivo da revenda de veículos
      const { body: lost } = await s.as('post', `/real-estate/deals/${d1.id}/lose`).send({ reasonKey: 'documentation', reason: 'Matrícula com pendência' }).expect(200);
      expect(lost).toMatchObject({ status: 'lost', lostReasonKey: 'documentation', lostReason: 'Matrícula com pendência' });
      expect((await s.as('patch', `/real-estate/deals/${d1.id}/broker`).send({ brokerId: s.ownerUserId }).expect(400)).body.code).toBe('DEAL_CLOSED');

      const { body: summary } = await s.as('get', '/real-estate/deals/summary').expect(200);
      expect(summary.brokers).toEqual([{ brokerId: ana.id, brokerName: 'Corretora Ana', open: 0, won: 1, wonValue: 500000, wonCommission: 25000, lost: 1 }]);
      expect(summary.lostByReason).toEqual([{ reasonKey: 'documentation', count: 1 }]);
      const { body: anaDeals } = await s.as('get', `/real-estate/deals?brokerId=${ana.id}`).expect(200);
      expect(anaDeals).toHaveLength(2);
      expect((await s.as('get', '/real-estate/deals?brokerId=none').expect(200)).body).toEqual([]);
    });
  });

  describe('consórcio', () => {
    it('sincroniza planos, envia adesão, ativa a cota com grupo e número, e a assembleia contempla', async () => {
      const s = await ownerSession(t, ['consortium', 'integration.whatsapp']);
      const { body: customer } = await s.as('post', '/customers').send({ name: 'Carla Consorciada', phone: '(48) 99111-2222', email: uniqueEmail('cons') }).expect(201);
      const { body: plans } = await s.as('post', '/consortium/plans/sync').expect(200);
      expect(plans.length).toBe(6);
      await s.as('post', '/consortium/plans/sync').expect(200); // de novo: atualiza sem duplicar
      const { body: autos } = await s.as('get', '/consortium/plans?assetType=vehicle&minCredit=90000').expect(200);
      expect(autos).toEqual([expect.objectContaining({ name: 'Auto 100 mil', installment: 1505, totalCost: 20400 })]);

      const { body: quota } = await s.as('post', '/consortium/quotas').send({ customerId: customer.id, planId: autos[0].id, applicant: applicant(8000) }).expect(201);
      expect(quota.status).toBe('proposal');
      const { body: props } = await s.as('get', `/banking/proposals?sourceType=consortium_quota&sourceId=${quota.id}`).expect(200);
      await s.as('post', `/banking/proposals/${props[0].id}/refresh`).expect(200);
      await t.relay.drain();
      const { body: active } = await s.as('get', `/consortium/quotas/${quota.id}`).expect(200);
      expect(active).toMatchObject({ status: 'active', commission: 2000 });
      expect(active.groupCode).toMatch(/^G\d{4}$/);

      const { body: entries } = await s.as('get', '/finance/entries?limit=50').expect(200);
      expect(entries.items.filter((e: { sourceId: string }) => e.sourceId === quota.id)).toEqual([expect.objectContaining({ amount: 2000 })]);

      const { body: assembly } = await s
        .as('post', '/consortium/assemblies')
        .send({ groupCode: active.groupCode, heldOn: localToday(), drawn: ['999'], bids: [{ quotaNumber: active.quotaNumber, percent: 35 }] })
        .expect(201);
      expect(assembly.ourWinners).toEqual([expect.objectContaining({ customer: 'Carla Consorciada', type: 'bid' })]);
      await s.as('post', '/consortium/assemblies').send({ groupCode: active.groupCode, heldOn: localToday() }).expect(400);
      expect((await s.as('get', `/consortium/quotas/${quota.id}`).expect(200)).body).toMatchObject({ status: 'contemplated', contemplationType: 'bid', bidPercent: 35 });
      await t.relay.drain();
      const { body: msgs } = await s.as('get', `/notifications?relatedEntity=cons_quota&relatedId=${quota.id}`).expect(200);
      expect(msgs.map((m: { templateKey: string }) => m.templateKey)).toEqual(expect.arrayContaining(['consortium.active', 'consortium.contemplated']));
    });

    it('vendedor da cota: padrão é quem vende, pode ser outro da equipe e entra no resumo', async () => {
      const s = await ownerSession(t, ['consortium']);
      const caio = await teammate(s, 'Vendedor Caio');
      const outsider = await createTenant(t);
      const { body: customer } = await s.as('post', '/customers').send({ name: 'Cliente Consórcio', email: uniqueEmail('cons') }).expect(201);
      await s.as('post', '/consortium/plans/sync').expect(200);
      const { body: autos } = await s.as('get', '/consortium/plans?assetType=vehicle&minCredit=90000').expect(200);
      const sell = (body: Record<string, unknown> = {}) => s.as('post', '/consortium/quotas').send({ customerId: customer.id, planId: autos[0].id, applicant: applicant(8000), ...body });

      const { body: mine } = await sell().expect(201);
      expect(mine).toMatchObject({ sellerId: s.ownerUserId, sellerName: 'Dono Teste' });
      expect((await sell({ sellerId: outsider.ownerUserId }).expect(400)).body.code).toBe('SELLER_NOT_MEMBER');
      const { body: his } = await sell({ sellerId: caio.id }).expect(201);
      expect(his).toMatchObject({ sellerId: caio.id, sellerName: 'Vendedor Caio' });

      // A adesão do Caio é aceita; a do dono segue em análise.
      const { body: props } = await s.as('get', `/banking/proposals?sourceType=consortium_quota&sourceId=${his.id}`).expect(200);
      await s.as('post', `/banking/proposals/${props[0].id}/refresh`).expect(200);
      await t.relay.drain();
      const { body: summary } = await s.as('get', '/consortium/quotas/summary').expect(200);
      expect(summary.sellers).toEqual([
        { sellerId: caio.id, sellerName: 'Vendedor Caio', open: 0, won: 1, wonValue: 100000, lost: 0 },
        { sellerId: s.ownerUserId, sellerName: 'Dono Teste', open: 1, won: 0, wonValue: 0, lost: 0 },
      ]);
      expect((await s.as('get', `/consortium/quotas?sellerId=${caio.id}`).expect(200)).body.map((q: { id: string }) => q.id)).toEqual([his.id]);

      // Troca de vendedor; cota cancelada não troca mais.
      expect((await s.as('patch', `/consortium/quotas/${mine.id}/seller`).send({ sellerId: outsider.ownerUserId }).expect(400)).body.code).toBe('SELLER_NOT_MEMBER');
      expect((await s.as('patch', `/consortium/quotas/${mine.id}/seller`).send({ sellerId: caio.id }).expect(200)).body).toMatchObject({ sellerId: caio.id });
      await s.as('post', `/consortium/quotas/${mine.id}/cancel`).send({ reason: 'Cliente desistiu' }).expect(200);
      expect((await s.as('patch', `/consortium/quotas/${mine.id}/seller`).send({ sellerId: s.ownerUserId }).expect(400)).body.code).toBe('QUOTA_CLOSED');
    });
  });
});
