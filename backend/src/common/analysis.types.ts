export type AgentTaskType =
  | 'summarize'
  | 'extract_keywords'
  | 'classify'
  | 'suggest_improvements';

export interface AnalyzeRequestDto {
  text: string;
}

export interface AnalyzeResponseDto {
  summary: string;
  keywords: string[];
  category: string;
  suggestions: string[];
}

export type AnalyzeJobStatus = 'queued' | 'processing' | 'completed' | 'failed';

export interface AnalyzeJobCreatedDto {
  jobId: string;
  status: AnalyzeJobStatus;
}

export interface AnalyzeJobStatusDto {
  jobId: string;
  status: AnalyzeJobStatus;
  progress: {
    completed: number;
    total: number;
  };
  insights?: JobInsightsDto;
  result?: AnalyzeResponseDto;
  error?: string;
}

export interface JobInsightEvent {
  timestamp: number;
  stage: 'job_created' | 'tasks_decided' | 'queued' | 'worker_started' | 'worker_completed' | 'worker_failed';
  taskType?: AgentTaskType;
  message: string;
}

export interface TaskExecutionInsight {
  taskType: AgentTaskType;
  queuedAt?: number;
  startedAt?: number;
  completedAt?: number;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  durationMs?: number;
  outputPreview?: string;
  error?: string;
}

export interface JobInsightsDto {
  createdAt: number;
  decidedTasks: AgentTaskType[];
  llmDecisionPrompt: string;
  llmRawTaskDecision: string;
  /** Why this task bundle fits the input (agent-style rationale). */
  llmDecisionReasoning: string;
  /** Concrete signals in the user text that drove the choice. */
  llmDecisionInputSignals: string;
  /** Tradeoffs, risks, or alternatives the model considered. */
  llmDecisionTradeoffs: string;
  /** If any standard task was skipped, short explanation; otherwise empty. */
  llmDecisionSkipNote: string;
  queueName: string;
  events: JobInsightEvent[];
  tasks: TaskExecutionInsight[];
}

export interface QueueTaskMessage {
  taskId: string;
  type: AgentTaskType;
  payload: {
    text: string;
  };
}

export interface PartialAnalyzeResult {
  summary?: string;
  keywords?: string[];
  category?: string;
  suggestions?: string[];
}
