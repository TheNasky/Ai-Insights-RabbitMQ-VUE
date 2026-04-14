import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { LlmService } from '../llm/llm.service';
import { QueueService } from '../queue/queue.service';
import { ResultStoreService } from '../result-store/result-store.service';
import {
  AgentTaskType,
  AnalyzeJobCreatedDto,
  AnalyzeJobStatusDto,
} from '../common/analysis.types';

@Injectable()
export class AnalyzeService {
  private readonly logger = new Logger(AnalyzeService.name);

  constructor(
    private readonly llmService: LlmService,
    private readonly queueService: QueueService,
    private readonly resultStoreService: ResultStoreService,
  ) {}

  async startAnalysis(text: string): Promise<AnalyzeJobCreatedDto> {
    let decisionResult: {
      selectedTasks: AgentTaskType[];
      rawOutput: string;
      prompt: string;
      reasoning: string;
      inputSignals: string;
      tradeoffs: string;
      skipNote: string;
    };
    try {
      decisionResult = await this.llmService.decideTasks(text);
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : '';
      const isQuotaIssue =
        rawMessage.includes('insufficient_quota') ||
        rawMessage.includes('RESOURCE_EXHAUSTED') ||
        rawMessage.includes('rate_limit_exceeded') ||
        rawMessage.includes('Rate limit') ||
        rawMessage.includes('429');

      if (isQuotaIssue) {
        this.logger.error(
          `LLM quota failure while starting analysis: ${rawMessage || 'unknown error'}`,
          error instanceof Error ? error.stack : undefined,
        );
        throw new ServiceUnavailableException(
          'LLM quota exceeded. Update billing or API key and try again.',
        );
      }

      this.logger.error(
        `LLM provider failure while starting analysis: ${rawMessage || 'unknown error'}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new ServiceUnavailableException(
        'LLM provider is currently unavailable. Please try again.',
      );
    }
    const tasks: AgentTaskType[] =
      decisionResult.selectedTasks.length > 0
        ? decisionResult.selectedTasks
        : ['summarize', 'extract_keywords', 'classify', 'suggest_improvements'];
    const jobId = randomUUID();

    const createdJob = this.resultStoreService.createJob(jobId, tasks.length, text.trim());
    this.resultStoreService.recordTaskPlan(
      jobId,
      tasks,
      decisionResult.prompt,
      decisionResult.rawOutput,
      decisionResult.reasoning,
      decisionResult.inputSignals,
      decisionResult.tradeoffs,
      decisionResult.skipNote,
    );

    try {
      await Promise.all(
        tasks.map((taskType) =>
          this.queueService.publishTask({
            taskId: jobId,
            type: taskType,
            payload: { text },
          }).then(() => {
            this.resultStoreService.recordQueuePublish(jobId, taskType);
          }),
        ),
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to enqueue analysis tasks';
      this.resultStoreService.markFailed(jobId, message);
      throw error;
    }

    return createdJob;
  }

  getAnalysisStatus(jobId: string): AnalyzeJobStatusDto | null {
    return this.resultStoreService.getJobStatus(jobId);
  }
}
