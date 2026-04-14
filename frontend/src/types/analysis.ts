export interface AnalyzeRequest {
  text: string
}

export interface AnalyzeResponse {
  summary: string
  keywords: string[]
  category: string
  suggestions: string[]
}

export type AgentTaskType =
  | 'summarize'
  | 'extract_keywords'
  | 'classify'
  | 'suggest_improvements'

export interface JobInsightEvent {
  timestamp: number
  stage: 'job_created' | 'tasks_decided' | 'queued' | 'worker_started' | 'worker_completed' | 'worker_failed'
  taskType?: AgentTaskType
  message: string
}

export interface TaskExecutionInsight {
  taskType: AgentTaskType
  queuedAt?: number
  startedAt?: number
  completedAt?: number
  status: 'queued' | 'processing' | 'completed' | 'failed'
  durationMs?: number
  outputPreview?: string
  error?: string
}

export interface JobInsights {
  createdAt: number
  decidedTasks: AgentTaskType[]
  llmDecisionPrompt: string
  llmRawTaskDecision: string
  llmDecisionReasoning: string
  llmDecisionInputSignals: string
  llmDecisionTradeoffs: string
  llmDecisionSkipNote: string
  queueName: string
  events: JobInsightEvent[]
  tasks: TaskExecutionInsight[]
}

export type AnalyzeJobStatus = 'queued' | 'processing' | 'completed' | 'failed'

export interface AnalyzeJobCreatedResponse {
  jobId: string
  status: AnalyzeJobStatus
}

export interface AnalyzeJobStatusResponse {
  jobId: string
  status: AnalyzeJobStatus
  progress: {
    completed: number
    total: number
  }
  insights?: JobInsights
  result?: AnalyzeResponse
  error?: string
}
