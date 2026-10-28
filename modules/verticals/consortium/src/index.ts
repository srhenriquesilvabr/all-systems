export { consortiumManifest, consortiumSettings, type ConsortiumSettings } from './manifest';
export { ConsortiumModule } from './api/consortium.module';
// Chamada externa isolada (trocada nos testes): leitura dos leads do Meta pela Graph API.
export { MetaGraphHttp } from './api/leads/ads';
export * from './contracts';
export * as consortiumSchema from './db/schema';
