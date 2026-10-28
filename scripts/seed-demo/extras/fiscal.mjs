// Nota fiscal no modo simulado, ambiente de homologação (sem valor fiscal):
// - fake-salao: NFS-e de serviços da agenda;
// - fake-padaria: NFC-e de produtos do caixa.
// Em cada uma: dados fiscais da empresa, cadastro fiscal de alguns serviços/produtos, ~10 notas
// autorizadas, 1 rejeitada (com o motivo do "provedor") e 1 cancelada. Os códigos são ilustrativos:
// em produção, quem confere é o contador do cliente.
//
// O módulo precisa estar ativo na empresa. Não há rota de API para ativar módulos; ative pelo CLI:
//   pnpm --filter @all/api cli module:enable --tenant <id da empresa> --module integration.fiscal
//
// Pode rodar de novo: dados que já existem são mantidos e só se completa o que falta (conta as notas
// autorizadas, rejeitadas e canceladas que já estão lá).
import { createRng, step } from '../lib.mjs';

const TARGET_AUTHORIZED = 10;

/** Códigos ilustrativos por produto da padaria (NCM, CSOSN, CEST). */
const BAKERY_CODES = {
  'Pão francês': { ncm: '19059090' },
  'Pão de queijo': { ncm: '19059090' },
  'Pão de forma caseiro': { ncm: '19059090' },
  Sonho: { ncm: '19059090' },
  'Bolo de cenoura com chocolate (fatia)': { ncm: '19059090' },
  Coxinha: { ncm: '21069090' },
  'Presunto fatiado': { ncm: '16024100' },
  'Queijo muçarela fatiado': { ncm: '04061010' },
  'Leite integral 1 L': { ncm: '04011010' },
  // Bebida com substituição tributária: ICMS já recolhido antes (CSOSN 500) e CEST.
  'Refrigerante lata 350 ml': { ncm: '22021000', cest: '0301100', icmsSituation: '500' },
};

/** Serviços do salão: item 06.01 da LC 116 (cabeleireiros, manicuros e congêneres). */
const SALON_SERVICES = ['Corte feminino', 'Corte masculino', 'Escova', 'Coloração', 'Manicure', 'Pedicure', 'Hidratação', 'Progressiva'];

const PROFILE = {
  'fake-salao': { kind: 'nfse', cnae: '9602501', legalName: 'Salão Fake Beleza Ltda' },
  'fake-padaria': { kind: 'nfce', cnae: '1091102', legalName: 'Padaria Fake Pães e Doces Ltda' },
};

/** @param {{ api, rng, log, tenant: {id,name}, customers: {id,name,type}[], users: object[] }} ctx */
export default async function seedFiscal({ api, log, tenant, customers }) {
  const profile = PROFILE[tenant.name];
  if (!profile) return;
  const rng = createRng(`${tenant.name}:fiscal`);

  const me = await api.get('/me').catch(() => null);
  if (!me?.modules?.some((m) => (m.key ?? m) === 'integration.fiscal')) {
    log(`  – nota fiscal: módulo inativo. Ative com: pnpm --filter @all/api cli module:enable --tenant ${tenant.id} --module integration.fiscal`);
    return;
  }

  await step(log, 'nota fiscal: dados fiscais da empresa', () => companyData(api, rng, profile));
  await step(log, 'nota fiscal: configuração (simulado, homologação)', async () => {
    const { settings } = await api.get('/fiscal/overview');
    await api.put('/fiscal/settings', {
      ...settings,
      provider: 'simulated',
      environment: 'homologation',
      taxRegime: 'simples',
      cnae: profile.cnae,
      municipalityCode: '3550308',
      nfseStandard: 'national',
      defaultIssRate: 2,
      defaultLc116: '06.01',
      defaultNationalCode: '060101',
      additionalInfo: 'Documento emitido por ME ou EPP optante pelo Simples Nacional.',
      // Clientes de demonstração não recebem e-mail.
      sendEmail: false,
      sendWhatsapp: false,
    });
  });

  const items = profile.kind === 'nfse' ? await step(log, 'nota fiscal: cadastro fiscal dos serviços', () => salonCodes(api)) : await step(log, 'nota fiscal: cadastro fiscal dos produtos', () => bakeryCodes(api));
  if (!items?.length) return;

  const docs = await api.get('/fiscal/documents', { limit: 500, from: '2000-01-01' });
  const count = (status) => docs.filter((d) => d.status === status).length;
  const people = customers.filter((c) => c.type === 'person');
  const make = (opts = {}) => (profile.kind === 'nfse' ? salonNote(rng, items, people, opts) : bakeryNote(rng, items, people, opts));

  let authorized = count('authorized') + count('cancelled');
  let created = 0;
  while (authorized < TARGET_AUTHORIZED) {
    const doc = await step(log, `nota fiscal: ${profile.kind === 'nfse' ? 'NFS-e' : 'NFC-e'} autorizada ${authorized + 1}/${TARGET_AUTHORIZED}`, () => emit(api, make()));
    if (!doc || doc.status !== 'authorized') break;
    authorized++;
    created++;
  }

  if (!count('rejected')) {
    // NFS-e: alíquota de ISS abaixo do mínimo municipal (2%); NFC-e: rejeição simulada a pedido.
    await step(log, 'nota fiscal: uma rejeitada, com o motivo', async () => {
      const doc = await emit(api, make(profile.kind === 'nfse' ? { issRate: 1.5 } : { additionalInfo: 'REJEITAR — exemplo de rejeição para demonstração' }));
      if (doc.status !== 'rejected') throw new Error(`esperava rejeitada, ficou ${doc.status}`);
    });
  }

  if (!count('cancelled')) {
    await step(log, 'nota fiscal: uma cancelada', async () => {
      const doc = await emit(api, make());
      await api.post(`/fiscal/documents/${doc.id}/cancel`, { reason: profile.kind === 'nfse' ? 'Serviço lançado em duplicidade para o mesmo atendimento' : 'Venda registrada em duplicidade no caixa' });
    });
  }
  if (created) log(`  ✓ nota fiscal: ${created} nota(s) nova(s)`);
}

/** Completa CNPJ, razão social, endereço e inscrições da empresa, sem sobrescrever o que existe. */
async function companyData(api, rng, profile) {
  const c = await api.get('/company');
  const patch = {};
  if (!c.document) patch.document = rng.cnpj();
  if (!c.legalName) patch.legalName = profile.legalName;
  if (!c.stateRegistration) patch.stateRegistration = '110.042.490.114';
  if (!c.municipalRegistration) patch.municipalRegistration = String(rng.int(1_000_000, 9_999_999));
  if (!c.address?.street || !c.address?.zip || !c.address?.city) {
    patch.address = { zip: '01310-100', street: 'Av. Paulista', number: String(rng.int(100, 2000)), district: 'Bela Vista', city: 'São Paulo', state: 'SP' };
  }
  if (Object.keys(patch).length) await api.patch('/company', patch);
}

async function salonCodes(api) {
  const services = await api.get('/scheduling/services');
  const out = [];
  for (const name of SALON_SERVICES) {
    const s = services.find((x) => x.name === name);
    if (!s) continue;
    await api.put('/fiscal/codes/services', { refType: 'sch_service', refId: s.id, serviceName: s.name, lc116: '06.01', nationalCode: '060101', issRate: 2, issWithheld: false });
    out.push(s);
  }
  return out;
}

async function bakeryCodes(api) {
  const products = await api.get('/sales/products', { limit: 500 });
  const out = [];
  for (const [name, codes] of Object.entries(BAKERY_CODES)) {
    const p = products.find((x) => x.name === name);
    if (!p) continue;
    await api.put('/fiscal/codes/products', {
      productId: p.id,
      productName: p.name,
      ncm: codes.ncm,
      cfop: '5102',
      cest: codes.cest ?? null,
      origin: 0,
      icmsSituation: codes.icmsSituation ?? '102',
      taxUnit: p.unit.toUpperCase(),
    });
    out.push(p);
  }
  return out;
}

function salonNote(rng, services, people, opts) {
  const s = rng.pick(services);
  const customer = people.length ? rng.pick(people) : null;
  return {
    type: 'nfse',
    customerId: customer?.id ?? null,
    items: [{ kind: 'service', refType: 'sch_service', refId: s.id, description: s.name, quantity: 1, unitPrice: s.price, ...(opts.issRate ? { issRate: opts.issRate } : {}) }],
    additionalInfo: opts.additionalInfo ?? null,
  };
}

function bakeryNote(rng, products, people, opts) {
  const picked = rng.shuffle(products).slice(0, rng.int(1, 4));
  const items = picked.map((p) => {
    const quantity = p.unit === 'kg' ? rng.int(150, 900) / 1000 : rng.int(1, 4);
    return { kind: 'product', refType: 'sales_product', refId: p.id, description: p.name, quantity, unit: p.unit, unitPrice: p.price };
  });
  const total = Math.round(items.reduce((s, i) => s + i.quantity * i.unitPrice, 0) * 100) / 100;
  // Um terço com CPF na nota.
  const customer = people.length && rng.chance(0.33) ? rng.pick(people) : null;
  return {
    type: 'nfce',
    customerId: customer?.id ?? null,
    items,
    payments: [{ method: rng.pick(['pix', 'debit_card', 'credit_card', 'cash']), amount: total }],
    additionalInfo: opts.additionalInfo ?? null,
  };
}

/** Rascunho → emitir → consultar até sair do "enviada" (NFS-e é assíncrona). */
async function emit(api, body) {
  const draft = await api.post('/fiscal/documents', body);
  let doc = await api.post(`/fiscal/documents/${draft.id}/issue`);
  for (let i = 0; i < 4 && doc.status === 'sending'; i++) doc = await api.post(`/fiscal/documents/${draft.id}/refresh`);
  return doc;
}
