export { creditBureauManifest, creditBureauSettings, type CreditBureauSettings } from './manifest';
export { CreditBureauModule } from './api/credit-bureau.module';
export { CreditBureauService } from './api/credit-bureau.service';
// Chamadas externas isoladas (trocadas por falsos nos testes) e adaptadores dos birôs.
export { BureauHttp, BureauError, SimulatedBureau, riskBandOf, type CreditBureauAdapter, type BureauResult } from './api/providers';
export * from './contracts';
export * as creditBureauSchema from './db/schema';
