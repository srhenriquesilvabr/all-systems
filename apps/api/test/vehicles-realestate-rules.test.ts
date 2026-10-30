import { administratorCatalog, catalogByKey } from '@all/banking';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, createTestApp, login, ownerSession, PASSWORD, tokenFromMail, uniqueEmail, type TestApp } from './helpers';

const localToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

interface Entry {
  id: string;
  kind: 'income' | 'expense';
  status: 'pending' | 'paid' | 'cancelled';
  amount: number;
  dueDate: string;
  sourceType: string;
  sourceId: string;
  settleInFinance: boolean;
}

describe('veículos, imóveis e bancos: regras da negociação e da locação', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  const applicant = { name: 'Rafael Comprador', document: '12345678909', monthlyIncome: 50000, birthDate: '1990-05-10' };

  /** Convida alguém com um papel próprio e devolve as chamadas dessa pessoa. */
  async function memberWith(s: Awaited<ReturnType<typeof ownerSession>>, permissions: string[]) {
    const { body: role } = await s.as('post', '/access/roles').send({ label: `Papel ${Math.random().toString(36).slice(2, 8)}`, permissions }).expect(201);
    const email = uniqueEmail('func');
    await s.as('post', '/users/invite').send({ email, name: 'Funcionário', roleIds: [role.id] }).expect(201);
    const token = tokenFromMail(t.mails.findLast((m) => m.to === email));
    await t.http().post('/api/auth/set-password').send({ token, password: PASSWORD, name: 'Funcionário' }).expect(204);
    const session = await login(t, email);
    return { as: (method: 'get' | 'post' | 'patch', path: string) => t.http()[method](`/api${path}`).set(auth(session.token)) };
  }

  async function dealer() {
    const s = await ownerSession(t, ['vehicles']);
    const { body: customer } = await s.as('post', '/customers').send({ name: 'Rafael Comprador', email: uniqueEmail('comprador'), phone: '(48) 99300-4455' }).expect(201);
    const carBody = { brand: 'Volkswagen', model: 'Gol', yearManufacture: 2020, yearModel: 2020, price: 52000, cost: 44000 };
    const { body: car } = await s.as('post', '/vehicles/stock').send(carBody).expect(201);
    const entriesOf = async (sourceId: string) => ((await s.as('get', '/finance/entries?limit=200').expect(200)).body.items as Entry[]).filter((e) => e.sourceId === sourceId);
    const open = (body: Record<string, unknown> = {}) => s.as('post', '/vehicles/deals').send({ customerId: customer.id, vehicleId: car.id, price: 52000, paymentType: 'cash', ...body });
    return { ...s, customer, car, carBody, entriesOf, open };
  }

  describe('veículos', () => {
    it('quem edita sem ver o custo não apaga o valor gravado; quem vê pode limpar', async () => {
      const s = await dealer();
      const member = await memberWith(s, ['vehicles.stock.read', 'vehicles.stock.write']);
      const { body: seen } = await member.as('get', `/vehicles/stock/${s.car.id}`).expect(200);
      expect(seen.cost).toBeNull();

      // A tela não manda custo (ou manda vazio): nos dois casos o valor fica.
      await member.as('patch', `/vehicles/stock/${s.car.id}`).send({ ...s.carBody, cost: undefined, price: 53000 }).expect(200);
      expect((await s.as('get', `/vehicles/stock/${s.car.id}`).expect(200)).body).toMatchObject({ cost: 44000, price: 53000 });
      await member.as('patch', `/vehicles/stock/${s.car.id}`).send({ ...s.carBody, cost: null }).expect(200);
      expect((await s.as('get', `/vehicles/stock/${s.car.id}`).expect(200)).body.cost).toBe(44000);
      // Nem troca o valor por um chute.
      await member.as('patch', `/vehicles/stock/${s.car.id}`).send({ ...s.carBody, cost: 1 }).expect(200);
      expect((await s.as('get', `/vehicles/stock/${s.car.id}`).expect(200)).body.cost).toBe(44000);

      await s.as('patch', `/vehicles/stock/${s.car.id}`).send({ ...s.carBody, cost: null }).expect(200);
      expect((await s.as('get', `/vehicles/stock/${s.car.id}`).expect(200)).body.cost).toBeNull();
    });

    it('a situação é controlada pela negociação, com mensagem do caminho certo', async () => {
      const s = await dealer();
      const edit = (status: string) => s.as('patch', `/vehicles/stock/${s.car.id}`).send({ ...s.carBody, status });

      // Marcar à mão: recusado no cadastro e na edição, e nada entra no financeiro.
      expect((await s.as('post', '/vehicles/stock').send({ ...s.carBody, status: 'sold' }).expect(400)).body.code).toBe('VEHICLE_STATUS_CONTROLLED');
      const sold = await edit('sold').expect(400);
      expect(sold.body.code).toBe('VEHICLE_STATUS_CONTROLLED');
      expect(sold.body.message).toContain('Fechar venda');
      expect((await edit('reserved').expect(400)).body.code).toBe('VEHICLE_STATUS_CONTROLLED');
      expect((await s.as('get', `/vehicles/stock/${s.car.id}`).expect(200)).body.status).toBe('available');

      // Disponível ↔ Fora de venda é livre.
      await edit('inactive').expect(200);
      await edit('available').expect(200);

      // Com negociação aberta, tirar de Reservado é recusado e não dá para abrir outra.
      const { body: deal } = await s.open().expect(201);
      for (const status of ['available', 'inactive']) expect((await edit(status).expect(400)).body.code).toBe('VEHICLE_RESERVED');
      await s.open().expect(409);
      // Editar outros dados mantendo a situação continua valendo.
      await edit('reserved').expect(200);

      // Fechada: vendido não volta.
      await s.as('post', `/vehicles/deals/${deal.id}/close`).expect(200);
      expect((await edit('available').expect(400)).body.code).toBe('VEHICLE_SOLD');
      await edit('sold').expect(200);
    });

    it('placa da troca já no estoque: recusa com mensagem clara e o fechamento não deixa nada pela metade', async () => {
      const s = await dealer();
      const trade = { brand: 'Fiat', model: 'Argo', yearModel: 2019, plate: 'XYZ1A23', value: 20000 };
      // Formato inválido e placa já ocupada são recusados ao salvar.
      await s.open({ tradeIn: { ...trade, plate: 'XX' } }).expect(400);
      const { body: other } = await s.as('post', '/vehicles/stock').send({ ...s.carBody, model: 'Polo', plate: 'ABC1D23' }).expect(201);
      expect((await s.open({ tradeIn: { ...trade, plate: 'ABC-1D23' } }).expect(409)).body.code).toBe('TRADE_PLATE_TAKEN');

      // A placa fica ocupada depois de a negociação abrir.
      const { body: deal } = await s.open({ tradeIn: trade }).expect(201);
      await s.as('post', '/vehicles/stock').send({ ...s.carBody, model: 'Up', plate: 'XYZ1A23' }).expect(201);
      const refused = await s.as('post', `/vehicles/deals/${deal.id}/close`).expect(409);
      expect(refused.body.code).toBe('TRADE_PLATE_TAKEN');
      expect(refused.body.message).toContain('XYZ1A23');

      // Nada pela metade: negociação aberta, veículo reservado, nenhum lançamento, troca fora do estoque.
      expect((await s.as('get', `/vehicles/deals/${deal.id}`).expect(200)).body.status).toBe('negotiating');
      expect((await s.as('get', `/vehicles/stock/${s.car.id}`).expect(200)).body.status).toBe('reserved');
      expect(await s.entriesOf(deal.id)).toEqual([]);
      expect((await s.as('get', '/vehicles/stock?q=Argo').expect(200)).body).toEqual([]);

      // Corrige a placa e fecha, com um lançamento só.
      expect((await s.as('patch', `/vehicles/deals/${deal.id}/trade-plate`).send({ plate: other.plate }).expect(409)).body.code).toBe('TRADE_PLATE_TAKEN');
      await s.as('patch', `/vehicles/deals/${deal.id}/trade-plate`).send({ plate: 'NEW-1234' }).expect(200);
      await s.as('post', `/vehicles/deals/${deal.id}/close`).expect(200);
      expect((await s.entriesOf(deal.id)).map((e) => e.amount)).toEqual([32000]);
      expect((await s.as('get', '/vehicles/stock?q=Argo').expect(200)).body).toEqual([expect.objectContaining({ plate: 'NEW1234', status: 'inactive' })]);
    });

    it('proposta contratada bloqueia a perda até o distrato, que exige motivo e devolve a negociação', async () => {
      const s = await dealer();
      const { body: deal } = await s.open({ paymentType: 'financing', downPayment: 12000 }).expect(201);
      const { body: conns } = await s.as('get', '/banking/connections').expect(200);
      const bank = conns.find((c: { name: string }) => c.name.startsWith('Banco Parceiro A'));
      const { body: p } = await s
        .as('post', '/banking/proposals')
        .send({ connectionId: bank.id, product: 'vehicle_financing', sourceType: 'vehicle_deal', sourceId: deal.id, customerId: s.customer.id, amount: 40000, termMonths: 48, applicant })
        .expect(201);
      await s.as('post', `/banking/proposals/${p.id}/refresh`).expect(200);
      await s.as('post', `/banking/proposals/${p.id}/status`).send({ status: 'contracted' }).expect(200);
      await t.relay.drain();
      expect((await s.as('get', `/vehicles/deals/${deal.id}`).expect(200)).body.status).toBe('credit_approved');

      const refused = await s.as('post', `/vehicles/deals/${deal.id}/lose`).send({ reasonKey: 'gave_up' }).expect(400);
      expect(refused.body.code).toBe('PROPOSAL_CONTRACTED');
      expect((await s.as('get', `/vehicles/stock/${s.car.id}`).expect(200)).body.status).toBe('reserved');

      // Distrato: motivo obrigatório e com rastro.
      expect((await s.as('post', `/banking/proposals/${p.id}/status`).send({ status: 'cancelled' }).expect(400)).body.code).toBe('REASON_REQUIRED');
      const { body: cancelled } = await s.as('post', `/banking/proposals/${p.id}/status`).send({ status: 'cancelled', message: 'Distrato combinado com o banco' }).expect(200);
      expect(cancelled.status).toBe('cancelled');
      expect(cancelled.events.at(-1)).toMatchObject({ status: 'cancelled', message: 'Distrato combinado com o banco', source: 'manual' });
      await t.relay.drain();
      expect((await s.as('get', `/vehicles/deals/${deal.id}`).expect(200)).body.status).toBe('negotiating');
      await s.as('post', `/vehicles/deals/${deal.id}/lose`).send({ reasonKey: 'gave_up' }).expect(200);
      expect((await s.as('get', `/vehicles/stock/${s.car.id}`).expect(200)).body.status).toBe('available');
    });
  });

  describe('bancos', () => {
    it('o catálogo traz os produtos certos de cada instituição', () => {
      expect(catalogByKey('itau')!.creditProducts).toEqual(['consortium', 'vehicle_financing', 'real_estate_financing']);
      expect(catalogByKey('embracon')!.creditProducts).toEqual(['consortium']);
      expect(administratorCatalog.every((a) => a.creditProducts.includes('consortium'))).toBe(true);
    });

    it('adesão de consórcio contratada não é cancelada pela integração: é pela cota', async () => {
      const s = await ownerSession(t, ['consortium']);
      await s.as('post', '/consortium/plans/sync').expect(200);
      const { body: customer } = await s.as('post', '/customers').send({ name: 'Carla', email: uniqueEmail('carla') }).expect(201);
      const { body: [plan] } = await s.as('get', '/consortium/plans').expect(200);
      const { body: quota } = await s.as('post', '/consortium/quotas').send({ customerId: customer.id, planId: plan.id, applicant }).expect(201);
      const { body: [p] } = await s.as('get', `/banking/proposals?sourceType=consortium_quota&sourceId=${quota.id}`).expect(200);
      await s.as('post', `/banking/proposals/${p.id}/refresh`).expect(200);
      await s.as('post', `/banking/proposals/${p.id}/status`).send({ status: 'contracted' }).expect(200);
      await s.as('post', `/banking/proposals/${p.id}/status`).send({ status: 'cancelled', message: 'Distrato' }).expect(400);
    });
  });

  async function realty() {
    const s = await ownerSession(t, ['real_estate']);
    const { body: owner } = await s.as('post', '/customers').send({ name: 'Proprietária' }).expect(201);
    const { body: buyer } = await s.as('post', '/customers').send({ name: 'Comprador', email: uniqueEmail('comp'), phone: '(48) 99123-4567' }).expect(201);
    const propertyBody = { purpose: 'both', type: 'apartment', title: 'Apto', ownerId: owner.id, street: 'Rua A', number: '10', complement: 'Apto 801', zip: '88015-200', district: 'Centro', city: 'Florianópolis', state: 'SC', salePrice: 500000, rentPrice: 2500, condoFee: 400 };
    const { body: prop } = await s.as('post', '/real-estate/properties').send(propertyBody).expect(201);
    const openDeal = (body: Record<string, unknown> = {}) => s.as('post', '/real-estate/deals').send({ customerId: buyer.id, propertyId: prop.id, price: 500000, paymentType: 'cash', commissionPercent: 5, ...body });
    const lease = (body: Record<string, unknown> = {}) => s.as('post', '/real-estate/leases').send({ propertyId: prop.id, renterId: buyer.id, startDate: localToday(), termMonths: 30, rent: 2500, dueDay: 10, adminFeePercent: 10, condoFee: 400, ...body });
    const entries = async (sourceType: string) => ((await s.as('get', '/finance/entries?limit=200').expect(200)).body.items as Entry[]).filter((e) => e.sourceType === sourceType);
    const { body: accounts } = await s.as('get', '/finance/accounts').expect(200);
    const cashId = accounts.find((a: { name: string }) => a.name === 'Caixa').id as string;
    const pay = (entryId: string) => s.as('post', `/finance/entries/${entryId}/pay`).send({ paidAt: localToday(), accountId: cashId });
    return { ...s, owner, buyer, prop, propertyBody, openDeal, lease, entries, cashId, pay };
  }

  describe('imobiliária', () => {
    it('CEP e complemento ficam no imóvel', async () => {
      const s = await realty();
      expect(s.prop).toMatchObject({ zip: '88015-200', complement: 'Apto 801' });
    });

    it('a situação do imóvel é controlada pela proposta e pelo contrato', async () => {
      const s = await realty();
      const edit = (status: string) => s.as('patch', `/real-estate/properties/${s.prop.id}`).send({ ...s.propertyBody, status });
      expect((await s.as('post', '/real-estate/properties').send({ ...s.propertyBody, status: 'rented' }).expect(400)).body.code).toBe('PROPERTY_STATUS_CONTROLLED');
      for (const status of ['sold', 'reserved', 'rented']) expect((await edit(status).expect(400)).body.code).toBe('PROPERTY_STATUS_CONTROLLED');
      await edit('inactive').expect(200);
      await edit('available').expect(200);

      const { body: deal } = await s.openDeal().expect(201);
      expect((await edit('available').expect(400)).body.code).toBe('PROPERTY_RESERVED');
      await s.openDeal().expect(409);
      await s.lease().expect(409);
      await edit('reserved').expect(200);
      await s.as('post', `/real-estate/deals/${deal.id}/lose`).send({ reasonKey: 'gave_up' }).expect(200);

      const { body: l } = await s.lease().expect(201);
      expect((await edit('available').expect(400)).body.code).toBe('PROPERTY_RENTED');
      await edit('rented').expect(200);
      await s.as('post', `/real-estate/leases/${l.id}/terminate`).send({ date: localToday(), reason: 'Acordo entre as partes' }).expect(200);

      const { body: sale } = await s.openDeal().expect(201);
      await s.as('post', `/real-estate/deals/${sale.id}/close`).expect(200);
      expect((await edit('available').expect(400)).body.code).toBe('PROPERTY_SOLD');
    });

    it('proposta em aberto pode ser editada, com as mesmas regras de valor; encerrada ou com crédito em andamento, não', async () => {
      const s = await realty();
      const { body: deal } = await s.openDeal({ paymentType: 'financing', downPayment: 100000, commissionPercent: 6 }).expect(201);
      const patch = (body: Record<string, unknown>) => s.as('patch', `/real-estate/deals/${deal.id}`).send({ price: 500000, paymentType: 'financing', downPayment: 100000, fgtsAmount: 0, commissionPercent: 6, ...body });

      expect((await patch({ downPayment: 1000 }).expect(400)).body.code).toBe('LTV_EXCEEDED');
      expect((await patch({ paymentType: 'cash', fgtsAmount: 10 }).expect(400)).body.code).toBe('FGTS_NEEDS_FINANCING');
      const { body: edited } = await patch({ price: 480000, downPayment: 120000, commissionPercent: 5, notes: 'Contraproposta aceita' }).expect(200);
      expect(edited).toMatchObject({ price: 480000, downPayment: 120000, financedAmount: 360000, commissionPercent: 5, commission: 24000, notes: 'Contraproposta aceita', status: 'negotiating' });

      // Com crédito em análise, os valores estão com o banco.
      const { body: conns } = await s.as('get', '/banking/connections').expect(200);
      const bank = conns.find((c: { name: string }) => c.name.startsWith('Banco Parceiro A'));
      const { body: p } = await s
        .as('post', '/banking/proposals')
        .send({ connectionId: bank.id, product: 'real_estate_financing', sourceType: 'real_estate_deal', sourceId: deal.id, customerId: s.buyer.id, amount: 360000, termMonths: 360, applicant })
        .expect(201);
      await t.relay.drain();
      expect((await patch({ price: 470000 }).expect(400)).body.code).toBe('DEAL_LOCKED');

      // Contratada bloqueia a perda até o distrato; só então volta a poder editar.
      await s.as('post', `/banking/proposals/${p.id}/refresh`).expect(200);
      await s.as('post', `/banking/proposals/${p.id}/status`).send({ status: 'contracted' }).expect(200);
      await t.relay.drain();
      expect((await s.as('post', `/real-estate/deals/${deal.id}/lose`).send({ reasonKey: 'gave_up' }).expect(400)).body.code).toBe('PROPOSAL_CONTRACTED');
      await s.as('post', `/banking/proposals/${p.id}/status`).send({ status: 'cancelled', message: 'Distrato combinado' }).expect(200);
      await t.relay.drain();
      await patch({ price: 470000, downPayment: 100000 }).expect(200);

      await s.as('post', `/real-estate/deals/${deal.id}/lose`).send({ reasonKey: 'gave_up' }).expect(200);
      expect((await patch({ price: 400000, downPayment: 100000 }).expect(400)).body.code).toBe('DEAL_CLOSED');
    });

    it('contrato editável: condomínio e IPTU valem daqui para a frente, sem reescrever o que já foi baixado', async () => {
      const s = await realty();
      const { body: l } = await s.lease().expect(201);
      const body = { condoFee: 400, iptuMonthly: 0, guaranteeType: 'none' };
      const patch = (b: Record<string, unknown>) => s.as('patch', `/real-estate/leases/${l.id}`).send({ ...body, ...b });

      // Só recebimento da 1ª e repasse da 2ª baixados.
      const rents = await s.entries('real_estate_lease');
      const rentOf = (chargeId: string, kind: string) => rents.find((e) => e.sourceId === chargeId && e.kind === kind)!;
      await s.pay(rentOf(l.charges[0].id, 'income').id).expect(201);
      await s.as('post', `/real-estate/leases/${l.id}/charges/${l.charges[1].id}/payout`).send({ paidAt: localToday(), accountId: s.cashId, acknowledgeUnreceived: true }).expect(200);

      // Sem mudar valores, nada é relançado.
      const { body: same } = await patch({ notes: 'Só observação' }).expect(200);
      expect(same).toMatchObject({ applied: null, notes: 'Só observação' });
      expect((await s.entries('real_estate_lease')).filter((e) => e.status === 'cancelled')).toEqual([]);

      const { body: edited } = await patch({ condoFee: 500, iptuMonthly: 100, applyFrom: l.charges[0].periodStart }).expect(200);
      expect(edited).toMatchObject({ condoFee: 500, iptuMonthly: 100, applied: { from: l.charges[0].periodStart, rebilled: 10, kept: 2 } });
      expect(edited.charges[0]).toMatchObject({ condoFee: 400, iptu: 0, total: 2900, receipt: 'paid' });
      expect(edited.charges[1]).toMatchObject({ condoFee: 400, iptu: 0, payoutStatus: 'paid' });
      expect(edited.charges[2]).toMatchObject({ rent: 2500, condoFee: 500, iptu: 100, total: 3100, adminFee: 250, payout: 2850 });

      // Sem duplicar: cada mensalidade tem uma receita e um repasse vivos; os antigos ficam cancelados.
      const after = await s.entries('real_estate_lease');
      expect(after.filter((e) => e.status === 'cancelled')).toHaveLength(20);
      expect(after.filter((e) => e.status !== 'cancelled')).toHaveLength(24);
      expect(after.filter((e) => e.kind === 'income' && e.status === 'pending' && e.amount === 3100)).toHaveLength(10);
      expect(after.filter((e) => e.kind === 'income' && e.amount === 2900 && e.status === 'paid')).toHaveLength(1);

      // Repetir o pedido não lança nada de novo.
      const { body: again } = await patch({ condoFee: 500, iptuMonthly: 100, applyFrom: l.charges[0].periodStart }).expect(200);
      expect(again.applied).toBeNull();
      expect((await s.entries('real_estate_lease')).filter((e) => e.status !== 'cancelled')).toHaveLength(24);

      // Depois do último mês lançado, não: as seguintes usariam o valor antes da hora.
      expect((await patch({ condoFee: 600, applyFrom: '2099-01-01' }).expect(400)).body.code).toBe('APPLY_FROM_TOO_FAR');

      // Garantia: mesmas regras do novo contrato.
      await patch({ guaranteeType: 'guarantor', guarantorName: 'Fiador', guarantorDocument: '111.111.111-11' }).expect(400);
      expect((await patch({ guaranteeType: 'deposit', guaranteeAmount: 9000 }).expect(400)).body.code).toBe('DEPOSIT_TOO_HIGH');
      expect((await patch({ guaranteeType: 'deposit', guaranteeAmount: 7500 }).expect(200)).body).toMatchObject({ guaranteeType: 'deposit', guaranteeAmount: 7500 });
      // A caução é só registro: nada no financeiro além das mensalidades.
      expect((await s.entries('real_estate_lease')).filter((e) => e.amount === 7500)).toEqual([]);

      await s.as('post', `/real-estate/leases/${l.id}/terminate`).send({ date: localToday(), reason: 'Acordo entre as partes' }).expect(200);
      expect((await patch({ notes: 'Depois' }).expect(400)).body.code).toBe('LEASE_CLOSED');
    });

    it('cobrança extra só em contrato ativo', async () => {
      const s = await realty();
      const { body: l } = await s.lease().expect(201);
      const extra = { kind: 'repair', amount: 300, dueDate: localToday(), passToOwner: true };
      await s.as('post', `/real-estate/leases/${l.id}/extras`).send(extra).expect(201);
      await s.as('post', `/real-estate/leases/${l.id}/terminate`).send({ date: localToday(), reason: 'Acordo entre as partes' }).expect(200);
      expect((await s.as('post', `/real-estate/leases/${l.id}/extras`).send(extra).expect(400)).body.code).toBe('LEASE_CLOSED');
    });

    it('repasse antes de receber exige confirmação e fica registrado; pelo financeiro, a baixa não passa', async () => {
      const s = await realty();
      const { body: l } = await s.lease().expect(201);
      const charge = l.charges[0];
      const entries = await s.entries('real_estate_lease');
      const payoutEntry = entries.find((e) => e.sourceId === charge.id && e.kind === 'expense')!;
      const rentEntry = entries.find((e) => e.sourceId === charge.id && e.kind === 'income')!;
      expect(payoutEntry.settleInFinance).toBe(false);
      expect(rentEntry.settleInFinance).toBe(true);

      // A tela do financeiro não paga repasse: o aviso está no contrato.
      expect((await s.pay(payoutEntry.id).expect(400)).body.code).toBe('ENTRY_FROM_MODULE');
      const payout = (body: Record<string, unknown>, chargeId = charge.id as string) => s.as('post', `/real-estate/leases/${l.id}/charges/${chargeId}/payout`).send({ paidAt: localToday(), accountId: s.cashId, ...body });

      const refused = await payout({}).expect(409);
      expect(refused.body.code).toBe('RENT_NOT_RECEIVED');
      expect((await s.entries('real_estate_lease')).find((e) => e.id === payoutEntry.id)!.status).toBe('pending');

      const { body: paid } = await payout({ acknowledgeUnreceived: true }).expect(200);
      expect(paid.charges[0]).toMatchObject({ receipt: 'pending', payoutStatus: 'paid' });
      expect((await payout({ acknowledgeUnreceived: true }).expect(400)).body.code).toBe('PAYOUT_ALREADY_PAID');
      expect((await s.entries('real_estate_lease')).filter((e) => e.sourceId === charge.id && e.kind === 'expense')).toHaveLength(1);
      const { body: audit } = await s.as('get', '/audit?limit=50').expect(200);
      const row = (Array.isArray(audit) ? audit : audit.items).find((e: { action: string }) => e.action === 'real_estate.lease.payout_paid');
      expect(row.data).toMatchObject({ beforeReceiving: true });

      // Recebido, o repasse sai sem pedir confirmação.
      const second = l.charges[1];
      await s.pay(entries.find((e) => e.sourceId === second.id && e.kind === 'income')!.id).expect(201);
      expect((await payout({}, second.id).expect(200)).body.charges[1]).toMatchObject({ receipt: 'paid', payoutStatus: 'paid' });

      // Permissão de baixa é a do financeiro; conta inválida e data futura são recusadas.
      const member = await memberWith(s, ['real_estate.leases.read', 'real_estate.leases.write']);
      await member.as('post', `/real-estate/leases/${l.id}/charges/${l.charges[2].id}/payout`).send({ paidAt: localToday(), accountId: s.cashId, acknowledgeUnreceived: true }).expect(403);
      expect((await payout({ acknowledgeUnreceived: true, paidAt: '2099-01-01' }, l.charges[2].id).expect(400)).body.code).toBe('PAID_IN_FUTURE');

      // Cobrança extra repassada segue a mesma regra; sem repasse, não há o que pagar.
      const { body: withExtra } = await s.as('post', `/real-estate/leases/${l.id}/extras`).send({ kind: 'repair', amount: 300, dueDate: localToday(), passToOwner: true }).expect(201);
      const extra = withExtra.extras[0];
      expect(extra.payoutStatus).toBe('pending');
      const extraPayout = (body: Record<string, unknown>) => s.as('post', `/real-estate/leases/${l.id}/extras/${extra.id}/payout`).send({ paidAt: localToday(), accountId: s.cashId, ...body });
      expect((await extraPayout({}).expect(409)).body.code).toBe('RENT_NOT_RECEIVED');
      expect((await extraPayout({ acknowledgeUnreceived: true }).expect(200)).body.extras[0].payoutStatus).toBe('paid');
      const { body: noPass } = await s.as('post', `/real-estate/leases/${l.id}/extras`).send({ kind: 'fine', amount: 100, dueDate: localToday() }).expect(201);
      const own = noPass.extras.find((e: { kind: string }) => e.kind === 'fine');
      expect((await s.as('post', `/real-estate/leases/${l.id}/extras/${own.id}/payout`).send({ paidAt: localToday(), accountId: s.cashId }).expect(400)).body.code).toBe('NO_PAYOUT');
    });
  });
});
