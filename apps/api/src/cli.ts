import 'reflect-metadata';
import { TenancyService } from '@all/core';
import { NestFactory } from '@nestjs/core';
import { parseArgs } from 'node:util';
import { AppModule } from './app.module';

const HELP = `
Operações de plataforma (equivalem ao que o provisionamento automático fará na Fase 4).

  pnpm --filter @all/api cli seed-demo
      Cria a empresa de demonstração "Lavanderia Bolha Azul" com o dono
      dono@demo.com / senha "demo123456" e o módulo laundry ativo.

  pnpm --filter @all/api cli seed-verticals
      Cria uma empresa de demonstração por vertical (pet shop, veterinária, estética,
      ortodontia, padaria, advocacia, salão, veículos, imóveis, consórcio, contabilidade
      e RH), cada uma com o dono
      demo+<vertical>@demo.com / senha "demo123456". Empresas já criadas são puladas.

  pnpm --filter @all/api cli tenant:create --name "Empresa" --owner-email x@y.com --owner-name "Nome" [--modules laundry]
      Cria a empresa e envia o convite ao dono por e-mail.

  pnpm --filter @all/api cli sync
      Espelha os manifestos desta build no banco e alinha as empresas existentes.
      Roda no deploy do Cloudflare, depois das migrations.

  pnpm --filter @all/api cli module:enable  --tenant <id> --module laundry
  pnpm --filter @all/api cli module:disable --tenant <id> --module laundry
  pnpm --filter @all/api cli module:list    --tenant <id>
`;

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (!command || command === 'help') return console.log(HELP);

  const { values } = parseArgs({
    args: rest,
    options: {
      name: { type: 'string' },
      'owner-email': { type: 'string' },
      'owner-name': { type: 'string' },
      modules: { type: 'string' },
      tenant: { type: 'string' },
      module: { type: 'string' },
    },
  });

  const app = await NestFactory.createApplicationContext(AppModule.forRoot(), { logger: ['error', 'warn'] });
  const tenancy = app.get(TenancyService);
  const required = (key: keyof typeof values) => {
    const v = values[key];
    if (!v) throw new Error(`Informe --${key}`);
    return v as string;
  };

  try {
    switch (command) {
      case 'seed-demo': {
        const { tenantId } = await tenancy.createTenant({
          name: 'Lavanderia Bolha Azul',
          packageKey: 'laundry-essential',
          modules: ['laundry', 'integration.payments'],
          owner: { email: 'dono@demo.com', name: 'Dona da Lavanderia', password: 'demo123456' },
        });
        console.log(`Empresa criada: ${tenantId}\nLogin: dono@demo.com / demo123456`);
        break;
      }
      case 'seed-verticals': {
        const demos = [
          ['petshop', 'Pet Shop Patinhas', ['petshop', 'integration.whatsapp', 'integration.payments']],
          ['vet', 'Clínica Veterinária Amigo Fiel', ['vet', 'integration.whatsapp']],
          ['estetica', 'Estética Bella Pele', ['aesthetics', 'integration.whatsapp']],
          ['orto', 'OrtoSorriso Clínica Ortodôntica', ['orthodontics', 'integration.whatsapp']],
          ['padaria', 'Padaria Pão Dourado', ['bakery', 'integration.whatsapp', 'integration.payments']],
          ['advocacia', 'Silva & Andrade Advocacia', ['legal']],
          ['salao', 'Salão Bella Hair', ['beauty', 'integration.whatsapp']],
          ['veiculos', 'Auto Center Rota Sul', ['vehicles', 'integration.whatsapp']],
          ['imoveis', 'Imobiliária Casa Nova', ['real_estate', 'integration.whatsapp']],
          ['consorcio', 'Planeje Consórcios', ['consortium', 'integration.whatsapp']],
          ['contabil', 'Contábil Exata', ['accounting']],
          ['rh', 'Indústria Modelo (RH)', ['hr']],
          ['consultoria-rh', 'Talentos Consultoria de RH', ['hr_consulting']],
        ] as const;
        const existing = new Set((await tenancy.listTenants()).map((t) => t.name));
        for (const [slug, name, modules] of demos) {
          const email = `demo+${slug}@demo.com`;
          if (existing.has(name)) {
            console.log(`${name}: já existe, pulada`);
            continue;
          }
          try {
            const { tenantId } = await tenancy.createTenant({ name, modules: [...modules], owner: { email, name: `Dono(a) — ${name}`, password: 'demo123456' } });
            console.log(`${name}: ${tenantId} (${email})`);
          } catch (err) {
            console.log(`${name}: pulada (${(err as Error).message})`);
          }
        }
        break;
      }
      case 'sync':
        // O boot do contexto (TenancyService.onApplicationBootstrap) já fez a sincronização.
        console.log('Módulos sincronizados.');
        break;
      case 'tenant:create': {
        const result = await tenancy.createTenant({
          name: required('name'),
          modules: values.modules?.split(',').map((m) => m.trim()).filter(Boolean) ?? [],
          owner: { email: required('owner-email'), name: required('owner-name') },
        });
        console.log(`Empresa criada: ${result.tenantId} (convite enviado ao dono)`);
        break;
      }
      case 'module:enable':
        console.log('Ativados:', (await tenancy.enableModules(required('tenant'), [required('module')])).join(', '));
        break;
      case 'module:disable':
        await tenancy.disableModule(required('tenant'), required('module'));
        console.log('Desativado.');
        break;
      case 'module:list':
        console.table(
          (await tenancy.listModules(required('tenant'))).map((m) => ({ módulo: m.moduleKey, status: m.status, origem: m.source })),
        );
        break;
      default:
        console.log(`Comando desconhecido: ${command}\n${HELP}`);
        process.exitCode = 1;
    }
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
