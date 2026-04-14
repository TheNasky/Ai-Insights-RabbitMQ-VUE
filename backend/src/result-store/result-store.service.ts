import { Injectable } from '@nestjs/common';
import {
  AnalyzeJobCreatedDto,
  AgentTaskType,
  JobInsightEvent,
  JobInsightsDto,
  TaskExecutionInsight,
  AnalyzeJobStatus,
  AnalyzeJobStatusDto,
  AnalyzeResponseDto,
  PartialAnalyzeResult,
} from '../common/analysis.types';

interface TaskState {
  status: AnalyzeJobStatus;
  expectedTaskCount: number;
  completedTaskCount: number;
  /** Original user text — used when summary is missing or the summarize task was skipped. */
  sourceText: string;
  result: PartialAnalyzeResult;
  insights: JobInsightsDto;
  error?: string;
  createdAt: number;
  completedAt?: number;
}

@Injectable()
export class ResultStoreService {
  private readonly store = new Map<string, TaskState>();
  private readonly completedTtlMs = 5 * 60 * 1000;

  createJob(taskId: string, expectedTaskCount: number, sourceText: string): AnalyzeJobCreatedDto {
    this.cleanupExpiredJobs();
    this.store.set(taskId, {
      status: expectedTaskCount > 0 ? 'queued' : 'completed',
      expectedTaskCount,
      completedTaskCount: 0,
      sourceText,
      result: {},
      insights: {
        createdAt: Date.now(),
        decidedTasks: [],
        llmDecisionPrompt: '',
        llmRawTaskDecision: '',
        llmDecisionReasoning: '',
        llmDecisionInputSignals: '',
        llmDecisionTradeoffs: '',
        llmDecisionSkipNote: '',
        queueName: 'text_tasks',
        events: [
          {
            timestamp: Date.now(),
            stage: 'job_created',
            message: 'LLM initialized task decision process.',
          },
        ],
        tasks: [],
      },
      createdAt: Date.now(),
      completedAt: expectedTaskCount > 0 ? undefined : Date.now(),
    });

    return { jobId: taskId, status: expectedTaskCount > 0 ? 'queued' : 'completed' };
  }

  markProcessing(taskId: string): void {
    const state = this.store.get(taskId);
    if (!state || state.status === 'completed') {
      return;
    }

    state.status = 'processing';
  }

  recordTaskPlan(
    taskId: string,
    tasks: AgentTaskType[],
    prompt: string,
    rawDecision: string,
    reasoning: string,
    inputSignals: string,
    tradeoffs: string,
    skipNote: string,
  ): void {
    const state = this.store.get(taskId);
    if (!state) {
      return;
    }

    state.insights.decidedTasks = tasks;
    state.insights.llmDecisionPrompt = prompt;
    state.insights.llmRawTaskDecision = rawDecision;
    state.insights.llmDecisionReasoning = reasoning;
    state.insights.llmDecisionInputSignals = inputSignals;
    state.insights.llmDecisionTradeoffs = tradeoffs;
    state.insights.llmDecisionSkipNote = skipNote;
    state.insights.tasks = tasks.map((taskType) => ({
      taskType,
      status: 'queued',
    }));
    this.pushEvent(state, {
      timestamp: Date.now(),
      stage: 'tasks_decided',
      message: `LLM selected ${tasks.length} task(s): ${tasks.join(', ')}.`,
    });
  }

  recordQueuePublish(taskId: string, taskType: AgentTaskType): void {
    const state = this.store.get(taskId);
    if (!state) {
      return;
    }

    const task = this.getOrCreateTaskInsight(state, taskType);
    task.status = 'queued';
    task.queuedAt = Date.now();

    this.pushEvent(state, {
      timestamp: Date.now(),
      stage: 'queued',
      taskType,
      message: `Published "${taskType}" task to RabbitMQ.`,
    });
  }

  recordTaskStart(taskId: string, taskType: AgentTaskType): void {
    const state = this.store.get(taskId);
    if (!state) {
      return;
    }

    const task = this.getOrCreateTaskInsight(state, taskType);
    task.status = 'processing';
    task.startedAt = Date.now();

    this.pushEvent(state, {
      timestamp: Date.now(),
      stage: 'worker_started',
      taskType,
      message: `Worker started processing "${taskType}".`,
    });
  }

  recordTaskComplete(
    taskId: string,
    taskType: AgentTaskType,
    partialResult: PartialAnalyzeResult,
  ): void {
    const state = this.store.get(taskId);
    if (!state) {
      return;
    }

    const task = this.getOrCreateTaskInsight(state, taskType);
    task.status = 'completed';
    task.completedAt = Date.now();
    if (task.startedAt) {
      task.durationMs = task.completedAt - task.startedAt;
    }
    task.outputPreview = this.previewPartialResult(partialResult);

    this.pushEvent(state, {
      timestamp: Date.now(),
      stage: 'worker_completed',
      taskType,
      message: `Worker completed "${taskType}".`,
    });
  }

  recordTaskFailure(taskId: string, taskType: AgentTaskType, error: string): void {
    const state = this.store.get(taskId);
    if (!state) {
      return;
    }

    const task = this.getOrCreateTaskInsight(state, taskType);
    task.status = 'failed';
    task.error = error;
    task.completedAt = Date.now();
    if (task.startedAt) {
      task.durationMs = task.completedAt - task.startedAt;
    }

    this.pushEvent(state, {
      timestamp: Date.now(),
      stage: 'worker_failed',
      taskType,
      message: `Worker failed "${taskType}": ${error}`,
    });
  }

  applyPartialResult(taskId: string, partialResult: PartialAnalyzeResult): void {
    const state = this.store.get(taskId);
    if (!state) {
      return;
    }

    state.result = { ...state.result, ...partialResult };
    state.completedTaskCount += 1;

    if (state.completedTaskCount >= state.expectedTaskCount) {
      state.status = 'completed';
      state.completedAt = Date.now();
      this.pushEvent(state, {
        timestamp: Date.now(),
        stage: 'worker_completed',
        message: 'Results aggregated and returned to API.',
      });
    }
  }

  markFailed(taskId: string, error: string): void {
    const state = this.store.get(taskId);
    if (!state) {
      return;
    }

    state.status = 'failed';
    state.error = error;
    state.completedAt = Date.now();
  }

  getJobStatus(taskId: string): AnalyzeJobStatusDto | null {
    this.cleanupExpiredJobs();
    const state = this.store.get(taskId);
    if (!state) {
      return null;
    }

    return {
      jobId: taskId,
      status: state.status,
      progress: {
        completed: state.completedTaskCount,
        total: state.expectedTaskCount,
      },
      insights: {
        ...state.insights,
        llmDecisionSkipNote: this.mergeSkipNoteForResponse(state),
      },
      result: state.status === 'completed' ? this.toAnalyzeResponse(state) : undefined,
      error: state.error,
    };
  }

  private mergeSkipNoteForResponse(state: TaskState): string {
    const note = state.insights.llmDecisionSkipNote.trim();
    const tasks = state.insights.decidedTasks;
    const skippedSummarize = !tasks.includes('summarize');

    if (!skippedSummarize) {
      return note;
    }

    const supplement =
      'The summarize task was not selected for this pipeline. The Summary panel shows your original input as a fallback.';

    if (!note) {
      return supplement;
    }

    if (/\bsummarize\b/i.test(note)) {
      return note;
    }

    return `${note}\n\n${supplement}`;
  }

  private toAnalyzeResponse(state: TaskState): AnalyzeResponseDto {
    const result = state.result;
    const decided = state.insights.decidedTasks;
    const ranSummarize = decided.includes('summarize');

    let summary = (result.summary ?? '').trim();
    if (!summary) {
      const src = state.sourceText.trim();
      if (!src) {
        summary = 'No summary available.';
      } else if (!ranSummarize) {
        summary = `Original input (summary step was not run):\n\n${src}`;
      } else {
        summary = `Original input (summary step was empty):\n\n${src}`;
      }
    }

    return {
      summary,
      keywords: result.keywords ?? [],
      category: result.category ?? 'uncategorized',
      suggestions: result.suggestions ?? [],
    };
  }

  private cleanupExpiredJobs(): void {
    const now = Date.now();
    for (const [jobId, state] of this.store.entries()) {
      if (!state.completedAt) {
        continue;
      }

      if (now - state.completedAt > this.completedTtlMs) {
        this.store.delete(jobId);
      }
    }
  }

  private getOrCreateTaskInsight(
    state: TaskState,
    taskType: AgentTaskType,
  ): TaskExecutionInsight {
    const existing = state.insights.tasks.find((task) => task.taskType === taskType);
    if (existing) {
      return existing;
    }

    const created: TaskExecutionInsight = {
      taskType,
      status: 'queued',
    };
    state.insights.tasks.push(created);
    return created;
  }

  private pushEvent(state: TaskState, event: JobInsightEvent): void {
    state.insights.events.push(event);
    if (state.insights.events.length > 100) {
      state.insights.events.splice(0, state.insights.events.length - 100);
    }
  }

  private previewPartialResult(partialResult: PartialAnalyzeResult): string {
    if (partialResult.summary) {
      return this.truncateAtWord(partialResult.summary, 90);
    }
    if (partialResult.category) {
      return this.truncateAtWord(partialResult.category, 90);
    }
    if (partialResult.keywords && partialResult.keywords.length > 0) {
      return this.truncateAtWord(partialResult.keywords.join(', '), 90);
    }
    if (partialResult.suggestions && partialResult.suggestions.length > 0) {
      return this.truncateAtWord(partialResult.suggestions[0], 90);
    }
    return '';
  }

  private truncateAtWord(value: string, maxLength: number): string {
    if (value.length <= maxLength) {
      return value;
    }

    const slice = value.slice(0, maxLength);
    const lastSpace = slice.lastIndexOf(' ');
    if (lastSpace <= 0) {
      return `${slice.trim()}...`;
    }

    return `${slice.slice(0, lastSpace).trim()}...`;
  }
}
