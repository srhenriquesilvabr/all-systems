import { ModuleRegistry, requestContext, type ModuleManifest } from '@all/module-sdk';
import { DynamicModule, Global, INestApplication, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { AccessController } from './access/access.controller';
import { AccessGuard } from './access/access.guard';
import { AccessService } from './access/access.service';
import { AuditController } from './audit/audit.controller';
import { AuditService } from './audit/audit.service';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { MeController } from './auth/me.controller';
import { SessionService } from './auth/session.service';
import { CoreConfig, loadConfig } from './config';
import { CustomerDataRegistry } from './customers/customer-data.registry';
import { CustomersController, CustomFieldsController } from './customers/customers.controller';
import { CustomersService } from './customers/customers.service';
import { CustomFieldsService } from './customers/custom-fields.service';
import { OutboxHandlers, OutboxRelay, OutboxService } from './events/outbox';
import { FinanceController } from './finance/finance.controller';
import { FinanceService } from './finance/finance.service';
import { TenantDb } from './db/tenant-db';
import { MailService } from './mail/mail.service';
import { ModuleHooks } from './tenancy/module-hooks';
import { TenancyService } from './tenancy/tenancy.service';
import { UsersController } from './users/users.controller';
import { UsersService } from './users/users.service';

export interface CoreModuleOptions {
  /** Manifestos de todos os módulos instalados nesta build (core + shared + verticais). */
  manifests: ModuleManifest[];
  env?: Record<string, string | undefined>;
}

@Global()
@Module({})
export class CoreModule {
  static forRoot(options: CoreModuleOptions): DynamicModule {
    const config = loadConfig(options.env ?? process.env);
    const registry = new ModuleRegistry(options.manifests);

    return {
      module: CoreModule,
      imports: [
        JwtModule.register({ secret: config.jwtSecret }),
        ThrottlerModule.forRoot({
          throttlers: [{ ttl: 60_000, limit: 300 }],
          skipIf: () => config.nodeEnv === 'test',
        }),
      ],
      controllers: [
        AuthController,
        MeController,
        UsersController,
        AccessController,
        AuditController,
        CustomersController,
        CustomFieldsController,
        FinanceController,
      ],
      providers: [
        { provide: CoreConfig, useValue: config },
        { provide: ModuleRegistry, useValue: registry },
        TenantDb,
        MailService,
        AuditService,
        AccessService,
        SessionService,
        AuthService,
        UsersService,
        TenancyService,
        ModuleHooks,
        OutboxService,
        OutboxHandlers,
        OutboxRelay,
        CustomerDataRegistry,
        CustomersService,
        CustomFieldsService,
        FinanceService,
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_GUARD, useClass: AccessGuard },
      ],
      exports: [
        CoreConfig,
        ModuleRegistry,
        TenantDb,
        AuditService,
        MailService,
        TenancyService,
        ModuleHooks,
        OutboxService,
        OutboxHandlers,
        OutboxRelay,
        CustomerDataRegistry,
        CustomersService,
        FinanceService,
      ],
    };
  }
}

/** Middlewares HTTP do core. Usado pelo main.ts e pelos testes e2e. */
export function configureHttp(app: INestApplication) {
  const config = app.get(CoreConfig);
  app.setGlobalPrefix('api');
  app.use(helmet());
  app.use(cookieParser());
  if (config.isProduction) app.getHttpAdapter().getInstance().set('trust proxy', 1);
  // Abre o contexto da requisição; o AccessGuard o preenche depois de autenticar.
  app.use((req: Request, _res: Response, next: NextFunction) => requestContext.run({ ip: req.ip }, next));
  app.enableShutdownHooks();
}
