export { recruitingManifest, recruitingSettings, RECRUITING, type RecruitingSettings } from './manifest';
export { RecruitingModule } from './api/recruiting.module';
export { RecruitingService } from './api/recruiting.service';
// Chamadas externas isoladas (trocadas por falsos nos testes) e funções puras testáveis.
export { AnthropicHttp, buildAnalysisRequest, parseAnalysisResponse, type AnthropicRequest } from './api/anthropic';
export { GupyHttp, gupyPayload, GupyApiAdapter, SimulatedGupyAdapter, JobBoardError, type JobBoardAdapter, type BoardJob } from './api/gupy';
export { heuristicScore } from './api/heuristic';
export { pdfText } from './api/pdf-text';
export { indeedFeed, linkedinPost } from './api/indeed';
export * from './contracts';
export * as recruitingSchema from './db/schema';
