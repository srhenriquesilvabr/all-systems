import { Module } from '@nestjs/common';
import { AnalysisService } from './analysis.service';
import { AnthropicHttp } from './anthropic';
import { GupyHttp } from './gupy';
import { JobSyncService } from './job-sync.service';
import { PublicJobsService } from './public.service';
import { PublicJobsController, RecruitingController } from './recruiting.controller';
import { RecruitingService } from './recruiting.service';

@Module({
  controllers: [RecruitingController, PublicJobsController],
  providers: [RecruitingService, PublicJobsService, AnalysisService, JobSyncService, AnthropicHttp, GupyHttp],
  exports: [RecruitingService],
})
export class RecruitingModule {}
