import { Module } from '@nestjs/common';
import { LlmModule } from '../llm/llm.module';
import { QueueModule } from '../queue/queue.module';
import { ResultStoreModule } from '../result-store/result-store.module';
import { WorkerService } from './worker.service';

@Module({
  imports: [QueueModule, LlmModule, ResultStoreModule],
  providers: [WorkerService],
})
export class WorkerModule {}
