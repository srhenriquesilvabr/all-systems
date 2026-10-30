import { ModuleRegistry, requestContext, type ModuleManifest } from '@all/module-sdk';
import { DynamicModule, Global, INestApplication, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { IsolateThrottlerStorage } from './common/isolate-throttler-storage';
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
import { CompanyController, PublicCompanyController } from './company/company.controller';
import { CompanyService } from './company/company.service';
import { CoreConfig, loadConfig } from './config';
import { CustomerDataRegistry } from './customers/customer-data.registry';
import { CustomersController, CustomFieldsController } from './customers/customers.controller';
import { CustomersService } from './customers/customers.service';
import { CustomFieldsService } from './customers/custom-fields.service';
import { MessageChannels } from './events/channels';
import { ScheduledJobs } from './events/jobs';
import { OutboxHandlers, OutboxRelay, OutboxService } from './events/outbox';
import { SecretBox } from './common/secrets';
import { FinanceController } from './finance/finance.controller';
import { FinanceService } from './finance/finance.service';
import { FilesController } from './files/files.controller';
import { FilesService } from './files/files.service';
import { FileStorage, LocalDiskStorage } from './files/storage';
import { SegmentationController } from './segmentation/segmentation.controller';
import { SegmentationService } from './segmentation/segmentation.service';
import { ModuleSettingsService } from './tenancy/module-settings.service';
import { ModulesController } from './tenancy/modules.controller';
import { SignupController } from './tenancy/signup.controller';
import { TenantDb } from './db/tenant-db';
import { MailService } from './mail/mail.service';
import { ModuleHooks } from './tenancy/module-hooks';
import { TenancyService } from './tenancy/tenancy.service';
import { UsersController } from './users/users.controller';
import { UsersService } from './users/users.service';
import { CepController, CepHttp } from './cep/cep.controller';
import { TeamController } from './team/team.controller';
import { TeamLinksRegistry } from './team/team-links.registry';
import { TeamService } from './team/team.service';

export interface CoreModuleOptions {
  /** Manifestos de todos os módulos instalados nesta build (core + shared + verticais). */
  manifests: ModuleManifest[];
  env?: Record<string, string | undefined>;
  /** Storage de arquivos. Padrão: disco local em STORAGE_DIR. */
  storage?: FileStorage;
  /**
   * Espelhar os manifestos no banco ao subir (padrão: sim). No Cloudflare cada isolate sobe
   * sozinho, então a sincronização roda uma vez no deploy (`cli sync`).
   */
  syncModulesOnBoot?: boolean;
}

@Global()
@Module({})
export class CoreModule {
  static forRoot(options: CoreModuleOptions): DynamicModule {
    const config = loadConfig(options.env ?? process.env);
    config.syncModulesOnBoot = options.syncModulesOnBoot ?? true;
    const registry = new ModuleRegistry(options.manifests);

    return {
      module: CoreModule,
      imports: [
        JwtModule.register({ secret: config.jwtSecret }),
        ThrottlerModule.forRoot({
          throttlers: [{ ttl: 60_000, limit: 300 }],
          storage: new IsolateThrottlerStorage(),
          skipIf: () => config.nodeEnv === 'test',
        }),
      ],
      controllers: [
        AuthController,
        MeController,
        CompanyController,
        PublicCompanyController,
        UsersController,
        AccessController,
        AuditController,
        CustomersController,
        CustomFieldsController,
        FinanceController,
        FilesController,
        ModulesController,
        SignupController,
        SegmentationController,
        TeamController,
        CepController,
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
        CompanyService,
        ModuleHooks,
        OutboxService,
        OutboxHandlers,
        OutboxRelay,
        CustomerDataRegistry,
        CustomersService,
        CustomFieldsService,
        FinanceService,
        FilesService,
        ModuleSettingsService,
        SegmentationService,
        TeamLinksRegistry,
        TeamService,
        CepHttp,
        { provide: FileStorage, useValue: options.storage ?? new LocalDiskStorage(config.storageDir) },
        { provide: SecretBox, useValue: new SecretBox(config.settingsEncryptionKey, config.jwtSecret) },
        MessageChannels,
        ScheduledJobs,
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
        FilesService,
        ModuleSettingsService,
        MessageChannels,
        ScheduledJobs,
        SecretBox,
        TeamLinksRegistry,
        TeamService,
        CepHttp,
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
