// Revenda de veículos: estoque (carros, motos e utilitário), negociações em todas as etapas e
// financiamentos pelas instituições simuladas da integração bancária.
import { step } from '../lib.mjs';
import { connectionFor, ensureConnections, ensureCredit, pickers } from './_banking.mjs';

const BANKS = [
  { name: 'Banco Horizonte Auto (simulação)', products: ['vehicle_financing'], vehicleMonthlyRate: 1.79, tacFee: 750 },
  { name: 'Financeira Paulista (simulação)', products: ['vehicle_financing'], vehicleMonthlyRate: 2.29, tacFee: 0 },
];

/** Estoque de demonstração; a placa identifica o veículo (rodar de novo não duplica). */
const STOCK = [
  { kind: 'car', brand: 'Toyota', model: 'Corolla', version: '2.0 XEi', yearManufacture: 2021, yearModel: 2022, plate: 'RVK2E41', color: 'Prata', km: 48200, fuel: 'flex', transmission: 'cvt', fipePrice: 126500, cost: 112000, price: 129900, notes: 'Único dono, revisões na concessionária.' },
  { kind: 'car', brand: 'Honda', model: 'HR-V', version: '1.5 EXL', yearManufacture: 2022, yearModel: 2023, plate: 'SGT5B82', color: 'Cinza', km: 31500, fuel: 'flex', transmission: 'cvt', fipePrice: 139800, cost: 124000, price: 142900, notes: 'Teto solar, bancos de couro, garantia de fábrica até 2026.' },
  { kind: 'car', brand: 'Volkswagen', model: 'T-Cross', version: '1.4 TSI Highline', yearManufacture: 2023, yearModel: 2023, plate: 'TAZ1C37', color: 'Branco', km: 18900, fuel: 'flex', transmission: 'automatic', fipePrice: 146300, cost: 131000, price: 149900, notes: null },
  { kind: 'car', brand: 'Chevrolet', model: 'Onix Plus', version: '1.0 Turbo Premier', yearManufacture: 2022, yearModel: 2023, plate: 'RTP8H19', color: 'Azul', km: 27300, fuel: 'flex', transmission: 'automatic', fipePrice: 96400, cost: 84500, price: 98900, notes: 'Wi-Fi nativo e MyLink.' },
  { kind: 'utility', brand: 'Fiat', model: 'Toro', version: '2.0 Volcano 4x4 Diesel', yearManufacture: 2021, yearModel: 2022, plate: 'QXW4J66', color: 'Vermelho', km: 64000, fuel: 'diesel', transmission: 'automatic', fipePrice: 151200, cost: 136000, price: 154900, notes: 'Capota marítima e engate.' },
  { kind: 'car', brand: 'Jeep', model: 'Compass', version: '1.3 T270 Longitude', yearManufacture: 2021, yearModel: 2022, plate: 'RNB7A03', color: 'Preto', km: 52000, fuel: 'flex', transmission: 'automatic', fipePrice: 137900, cost: 121000, price: 139900, notes: null },
  { kind: 'car', brand: 'Hyundai', model: 'HB20', version: '1.0 Comfort', yearManufacture: 2020, yearModel: 2020, plate: 'QPL9G54', color: 'Branco', km: 58700, fuel: 'flex', transmission: 'manual', fipePrice: 63800, cost: 55000, price: 64900, notes: null },
  { kind: 'car', brand: 'Renault', model: 'Kwid', version: '1.0 Zen', yearManufacture: 2022, yearModel: 2023, plate: 'SEF3D28', color: 'Laranja', km: 22100, fuel: 'flex', transmission: 'manual', fipePrice: 58700, cost: 51000, price: 59900, notes: 'Ótimo para aplicativo: econômico e com baixo custo de manutenção.' },
  { kind: 'car', brand: 'Nissan', model: 'Kicks', version: '1.6 SV', yearManufacture: 2021, yearModel: 2021, plate: 'RJH6F71', color: 'Prata', km: 45000, fuel: 'flex', transmission: 'cvt', fipePrice: 102300, cost: 91000, price: 104900, notes: null },
  { kind: 'motorcycle', brand: 'Honda', model: 'CG 160', version: 'Titan', yearManufacture: 2023, yearModel: 2023, plate: 'TDC2B45', color: 'Vermelha', km: 8400, fuel: 'flex', transmission: 'manual', fipePrice: 18900, cost: 16200, price: 19490, notes: null },
  { kind: 'motorcycle', brand: 'Yamaha', model: 'Fazer FZ25', version: 'ABS', yearManufacture: 2022, yearModel: 2022, plate: 'SHK0A92', color: 'Azul', km: 15200, fuel: 'gasoline', transmission: 'manual', fipePrice: 22400, cost: 19500, price: 22900, notes: null },
  { kind: 'motorcycle', brand: 'Honda', model: 'Biz 125', version: null, yearManufacture: 2021, yearModel: 2022, plate: 'RMQ5E10', color: 'Preta', km: 12000, fuel: 'flex', transmission: 'manual', fipePrice: 15400, cost: 13000, price: 15900, notes: null },
  { kind: 'motorcycle', brand: 'BMW', model: 'R 1250 GS', version: 'Adventure', yearManufacture: 2021, yearModel: 2021, plate: 'SBV8C33', color: 'Branca', km: 21000, fuel: 'gasoline', transmission: 'manual', fipePrice: 107500, cost: 96000, price: 109900, notes: 'Malas laterais e top case originais.' },
  { kind: 'utility', brand: 'Fiat', model: 'Strada', version: '1.3 Freedom Cabine Simples', yearManufacture: 2023, yearModel: 2023, plate: 'TFA1H27', color: 'Branco', km: 9800, fuel: 'flex', transmission: 'manual', fipePrice: 104600, cost: 93000, price: 109900, status: 'inactive', notes: 'Em preparação: polimento e revisão antes de anunciar.' },
];

/**
 * Negociações: `buyer` indexa pessoas (p) ou empresas (c) da carteira; `credit` leva a proposta ao
 * desfecho; `end` fecha ou perde a negociação.
 */
const DEALS = [
  { plate: 'RVK2E41', buyer: 'p0', label: 'Corolla vendido à vista', body: { price: 129900, discount: 2900, paymentType: 'cash', notes: 'Pagamento por PIX e TED. Película e tapetes de brinde.' }, end: 'close' },
  {
    plate: 'SGT5B82',
    buyer: 'p1',
    label: 'HR-V financiado (contratado) com troca, vendido',
    body: { price: 142900, discount: 2900, paymentType: 'financing', downPayment: 22000, tradeIn: { brand: 'Fiat', model: 'Uno Way 1.0', yearModel: 2016, plate: 'FQX3A21', km: 92000, value: 28000 }, notes: 'Troca avaliada pelo gerente.' },
    credit: { bank: 0, outcome: 'contracted', term: 48 },
    end: 'close',
  },
  { plate: 'TAZ1C37', buyer: 'p2', label: 'T-Cross com crédito aprovado', body: { price: 149900, discount: 0, paymentType: 'financing', downPayment: 45000, notes: 'Cliente quer retirar no sábado.' }, credit: { bank: 0, outcome: 'approved', term: 60 } },
  { plate: 'RTP8H19', buyer: 'p3', label: 'Onix Plus com crédito em análise', body: { price: 98900, discount: 1900, paymentType: 'financing', downPayment: 20000 }, credit: { bank: 1, outcome: 'pending', term: 48 } },
  { plate: 'QXW4J66', buyer: 'c0', label: 'Toro com crédito recusado', body: { price: 154900, discount: 0, paymentType: 'financing', downPayment: 30000, notes: 'Compra pelo CNPJ para uso na obra.' }, credit: { bank: 1, outcome: 'rejected', term: 60 } },
  {
    plate: 'RNB7A03',
    buyer: 'p4',
    label: 'Compass em negociação com troca',
    body: { price: 139900, discount: 3000, paymentType: 'cash', tradeIn: { brand: 'Volkswagen', model: 'Gol 1.6 MSI', yearModel: 2018, plate: 'EZT8B14', km: 76000, value: 42000 }, notes: 'Cliente pediu R$ 45 mil na troca; contraproposta de R$ 42 mil.' },
  },
  { plate: 'QPL9G54', buyer: 'p5', label: 'HB20 perdido para concorrente', body: { price: 64900, discount: 1500, paymentType: 'cash' }, end: 'lose', reasonKey: 'bought_elsewhere', reason: 'Cliente comprou em outra loja por R$ 3 mil a menos' },
  { plate: 'SEF3D28', buyer: 'p6', label: 'Kwid perdido por crédito recusado', body: { price: 59900, discount: 0, paymentType: 'financing', downPayment: 6000 }, credit: { bank: 1, outcome: 'rejected', term: 48 }, end: 'lose', reasonKey: 'financing_denied', reason: 'Financiamento recusado e cliente sem entrada maior' },
  { plate: 'SHK0A92', buyer: 'p7', label: 'Fazer FZ25 vendida à vista', body: { price: 22900, discount: 400, paymentType: 'cash' }, end: 'close' },
];

/** @param {{ api, rng, log, tenant: {id,name}, customers: {id,name,type,phone,email}[], users: {membershipId,name,email,roleKeys:string[]}[] }} ctx */
export default async function seed(ctx) {
  const { api, log } = ctx;
  const banks = await step(log, 'bancos e financeiras (simulação)', () => ensureConnections(api, log, BANKS));
  const stock = await step(log, 'estoque de veículos', () => seedStock(ctx));
  if (!stock) return;

  const deals = await api.get('/vehicles/deals');
  const connections = banks ?? (await api.get('/banking/connections'));
  const buyer = pickers(ctx.customers);
  for (const s of DEALS) {
    await step(log, `negociação: ${s.label}`, () => runDeal(ctx, s, stock.get(s.plate), buyer(s.buyer), deals, connections));
  }
}

async function seedStock({ api, log }) {
  const existing = await api.get('/vehicles/stock');
  const byPlate = new Map(existing.filter((v) => v.plate).map((v) => [v.plate, v]));
  const missing = STOCK.filter((v) => !byPlate.has(v.plate));
  for (const v of missing) byPlate.set(v.plate, await api.post('/vehicles/stock', { status: 'available', ...v }));
  log(`    ${missing.length ? `${missing.length} veículos cadastrados` : 'estoque de demonstração já cadastrado'} (${byPlate.size} no total)`);
  return byPlate;
}

async function runDeal({ api, rng, log }, s, vehicle, customer, deals, connections) {
  if (!vehicle) throw new Error(`veículo ${s.plate} não está no estoque`);
  let deal = deals.find((d) => d.vehicle.id === vehicle.id);
  if (!deal) {
    if (vehicle.status !== 'available') throw new Error(`veículo ${s.plate} está ${vehicle.status}`);
    deal = await api.post('/vehicles/deals', { customerId: customer.id, vehicleId: vehicle.id, ...s.body });
  }
  if (deal.status === 'closed' || deal.status === 'lost') return log(`    já encerrada (${deal.status})`);

  if (s.credit) {
    const p = await ensureCredit(api, rng, {
      sourceType: 'vehicle_deal',
      sourceId: deal.id,
      customer: deal.customer,
      connection: connectionFor(connections, 'vehicle_financing', BANKS[s.credit.bank].name),
      product: 'vehicle_financing',
      amount: deal.financedAmount,
      termMonths: s.credit.term,
      system: 'price',
      outcome: s.credit.outcome,
      details: { vehicle: deal.vehicle.title, plate: deal.vehicle.plate, saleValue: deal.price - deal.discount, downPayment: deal.downPayment },
    });
    log(`    proposta em ${p.connection.name}: ${p.status}`);
  }
  if (s.end === 'close') await api.post(`/vehicles/deals/${deal.id}/close`);
  if (s.end === 'lose') await api.post(`/vehicles/deals/${deal.id}/lose`, { reasonKey: s.reasonKey, reason: s.reason });
}
