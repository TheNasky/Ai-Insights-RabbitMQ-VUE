import { Module } from '@nestjs/common';
import { AnalyzeController } from './analyze.controller';
import { AnalyzeService } from './analyze.service';
import { LlmModule } from '../llm/llm.module';
import { QueueModule } from '../queue/queue.module';
import { ResultStoreModule } from '../result-store/result-store.module';

@Module({
  imports: [LlmModule, QueueModule, ResultStoreModule],
  controllers: [AnalyzeController],
  providers: [AnalyzeService],
})
export class AnalyzeModule {}
