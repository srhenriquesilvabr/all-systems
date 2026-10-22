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

  pnpm --filter @all/api cli tenant:create --name "Empresa" --owner-email x@y.com --owner-name "Nome" [--modules laundry]
      Cria a empresa e envia o convite ao dono por e-mail.

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
          modules: ['laundry'],
          owner: { email: 'dono@demo.com', name: 'Dona da Lavanderia', password: 'demo123456' },
        });
        console.log(`Empresa criada: ${tenantId}\nLogin: dono@demo.com / demo123456`);
        break;
      }
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
