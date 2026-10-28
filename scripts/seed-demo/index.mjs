// Popula as empresas de demonstração (fake-*) pela API, com clientes, equipe, financeiro
// e os dados de cada setor. Pode rodar de novo: o que já existe é pulado.
//
//   node --env-file=.env.production scripts/seed-demo/index.mjs [--base URL] [--only fake-rh,fake-salao] [--core-only | --extras-only]
//
// --extras-only roda só extras/ (caixas, coletas, locações, salas…) sobre o que já existe.
// Credenciais do dono das empresas: PALMER_OWNER_EMAIL e PALMER_OWNER_PASSWORD.
import { parseArgs } from 'node:util';
import seedCore, { loadCore } from './core.mjs';
import { createClient, createRng } from './lib.mjs';
import { seedPropertyPhotos, seedVehiclePhotos } from './photos.mjs';

/** Etapas dos fluxos mais novos; cada arquivo só age nas empresas do seu setor. */
const EXTRAS = ['register-sellers', 'logistics-leases', 'consortium-hr', 'hr-consulting', 'recruiting', 'agenda', 'aesthetics-specialties'];

/** Empresa → setor (arquivo em verticals/) e o que ela vende, para o financeiro soar real. */
const TENANTS = {
  'fake-lavanderia': { vertical: 'laundry', income: ['Lavagem e passadoria', 'Lavagem de edredom', 'Lavagem a seco', 'Higienização de tapete'], ticket: [45, 260] },
  'fake-padaria': { vertical: 'bakery', income: ['Encomenda de bolo', 'Kit festa', 'Café da manhã corporativo', 'Salgados para evento'], ticket: [60, 380] },
  'fake-petshop': { vertical: 'petshop', income: ['Banho e tosa', 'Banho', 'Ração e acessórios', 'Hidratação de pelagem'], ticket: [55, 240] },
  'fake-veterinaria': { vertical: 'vet', income: ['Consulta veterinária', 'Vacinação', 'Exames laboratoriais', 'Retorno'], ticket: [120, 450] },
  'fake-salao': { vertical: 'beauty', income: ['Corte e escova', 'Coloração', 'Manicure e pedicure', 'Progressiva'], ticket: [60, 420] },
  'fake-estetica': { vertical: 'aesthetics', income: ['Limpeza de pele', 'Pacote de drenagem', 'Peeling', 'Depilação a laser'], ticket: [150, 900] },
  'fake-ortodontia': { vertical: 'orthodontics', income: ['Manutenção do aparelho', 'Consulta inicial', 'Documentação ortodôntica', 'Mensalidade do tratamento'], ticket: [180, 650] },
  'fake-advocacia': { vertical: 'legal', income: ['Honorários contratuais', 'Consulta jurídica', 'Honorários de êxito', 'Parecer'], ticket: [800, 6500] },
  'fake-contabilidade': { vertical: 'accounting', income: ['Honorários contábeis mensais', 'Abertura de empresa', 'Declaração de IR', 'Folha de pagamento'], ticket: [450, 2200] },
  'fake-rh': { vertical: 'hr', income: ['Venda de produtos', 'Contrato de fornecimento', 'Prestação de serviço'], ticket: [2500, 18000] },
  'fake-veiculos': { vertical: 'vehicles', income: ['Venda de veículo — sinal', 'Despachante', 'Comissão de financiamento', 'Revisão pré-venda'], ticket: [900, 12000] },
  'fake-imobiliaria': { vertical: 'realestate', income: ['Comissão de venda', 'Taxa de administração de aluguel', 'Avaliação de imóvel', 'Comissão de locação'], ticket: [700, 15000] },
  'fake-consorcio': { vertical: 'consortium', income: ['Taxa de administração', 'Comissão de venda de cota', 'Fundo de reserva'], ticket: [300, 2800] },
};

const { values } = parseArgs({ options: { base: { type: 'string', default: 'https://palmer-systems.all-systems.workers.dev' }, only: { type: 'string' }, 'core-only': { type: 'boolean', default: false }, 'extras-only': { type: 'boolean', default: false } } });
const email = process.env.PALMER_OWNER_EMAIL;
const password = process.env.PALMER_OWNER_PASSWORD;
if (!email || !password) {
  console.error('Defina PALMER_OWNER_EMAIL e PALMER_OWNER_PASSWORD (node --env-file=.env.production ...)');
  process.exit(1);
}
const only = values.only?.split(',').map((s) => s.trim());

const api = createClient(values.base);
const tenants = await api.login(email, password);

for (const [name, profile] of Object.entries(TENANTS)) {
  if (only && !only.includes(name)) continue;
  const tenant = tenants.find((t) => t.name === name);
  if (!tenant) {
    console.log(`${name}: não encontrada para este usuário, pulada`);
    continue;
  }
  await api.enter(tenant.id);
  const log = (msg) => console.log(msg);
  const rng = createRng(name);
  console.log(`\n${name}`);

  if (values['extras-only']) {
    await seedExtras({ api, rng, log, tenant, ...(await loadCore({ api })) });
    continue;
  }
  const { customers, users } = await seedCore({ api, rng, log, tenant, profile });
  if (values['core-only']) continue;
  const { default: seedVertical } = await import(`./verticals/${profile.vertical}.mjs`);
  await seedVertical({ api, rng, log, tenant, customers, users });
  if (profile.vertical === 'vehicles') await seedVehiclePhotos({ api, log });
  if (profile.vertical === 'realestate') await seedPropertyPhotos({ api, log });
  await seedExtras({ api, rng, log, tenant, customers, users });
}

async function seedExtras(ctx) {
  for (const name of EXTRAS) {
    const { default: seed } = await import(`./extras/${name}.mjs`);
    await seed(ctx);
  }
}
