import { Injectable, OnModuleInit } from '@nestjs/common';
import { LlmService } from '../llm/llm.service';
import { QueueService } from '../queue/queue.service';
import { ResultStoreService } from '../result-store/result-store.service';

@Injectable()
export class WorkerService implements OnModuleInit {
  constructor(
    private readonly queueService: QueueService,
    private readonly llmService: LlmService,
    private readonly resultStoreService: ResultStoreService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.queueService.startConsumer(async (taskMessage) => {
      this.resultStoreService.markProcessing(taskMessage.taskId);
      this.resultStoreService.recordTaskStart(taskMessage.taskId, taskMessage.type);

      try {
        const partialResult = await this.llmService.executeTask(taskMessage);
        this.resultStoreService.recordTaskComplete(
          taskMessage.taskId,
          taskMessage.type,
          partialResult,
        );
        this.resultStoreService.applyPartialResult(taskMessage.taskId, partialResult);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Task processing failed';
        this.resultStoreService.recordTaskFailure(
          taskMessage.taskId,
          taskMessage.type,
          message,
        );
        this.resultStoreService.markFailed(
          taskMessage.taskId,
          message,
        );
      }
    });
  }
}
