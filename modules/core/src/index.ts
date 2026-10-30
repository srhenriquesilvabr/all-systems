export { CoreModule, configureHttp, type CoreModuleOptions } from './core.module';
export { CoreConfig } from './config';
export { TenantDb } from './db/tenant-db';
export { AuditService, type AuditEntry } from './audit/audit.service';
export { MailService, type MailMessage } from './mail/mail.service';
export { TenancyService, type CreateTenantInput } from './tenancy/tenancy.service';
export { companyLogoUrl } from './company/company.service';
export { ModuleHooks, type ModuleLifecycle } from './tenancy/module-hooks';
export { OutboxService, OutboxHandlers, OutboxRelay, type OutboxEvent } from './events/outbox';
export { MessageChannels, type ChannelResult, type MessageChannel, type OutgoingMessage } from './events/channels';
export { ScheduledJobs } from './events/jobs';
export { SecretBox } from './common/secrets';
export { CustomersService, type CustomerInput, type TimelineEntry } from './customers/customers.service';
export { CustomerDataRegistry, type CustomerDataProvider } from './customers/customer-data.registry';
export { FinanceService, type SourcedEntryInput } from './finance/finance.service';
export { FilesService, MAX_DOCUMENT_BYTES, MAX_IMAGE_BYTES, type FileDto, type UploadedFile } from './files/files.service';
export { FileStorage, LocalDiskStorage, R2Storage, type R2BucketLike } from './files/storage';
export { ModuleSettingsService } from './tenancy/module-settings.service';
export { SegmentationService, type CustomerRfm, type Segment, type SegmentSummary } from './segmentation/segmentation.service';
export { ZodPipe } from './common/zod.pipe';
export { nextSequence } from './common/sequence';
export { toCents, centsToDecimal, centsToNumber } from './common/money';
export { addMonths, localToday, splitCents } from './common/dates';
export {
  TeamService,
  TEAM_MEMBER_ENDED,
  splitName,
  fullName,
  teamMemberInput,
  type TeamMemberEnded,
  type TeamMemberInput,
  type TeamMemberPatch,
  type TeamMemberRow,
  type TeamMemberSummary,
  type TeamMemberDetail,
} from './team/team.service';
export { TeamLinksRegistry, type TeamLink, type TeamLinkProvider } from './team/team-links.registry';
export { CepHttp, type CepAddress } from './cep/cep.controller';
export { coreManifests, OWNER_ROLE } from './manifests';
export * as coreSchema from './db/schema';
export * as customersSchema from './customers/schema';
export * as financeSchema from './finance/schema';

export { IsolateThrottlerStorage } from './common/isolate-throttler-storage';
