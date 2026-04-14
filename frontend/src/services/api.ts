import type {
  AnalyzeJobCreatedResponse,
  AnalyzeJobStatusResponse,
  AnalyzeRequest,
} from '../types/analysis'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000'

const parseApiError = async (response: Response, fallback: string): Promise<never> => {
  let message = fallback

  try {
    const payload = (await response.json()) as { message?: string | string[] }
    if (Array.isArray(payload.message)) {
      message = payload.message.join(', ')
    } else if (typeof payload.message === 'string' && payload.message.trim()) {
      message = payload.message
    }
  } catch {
    // Keep fallback message.
  }

  throw new Error(message)
}

export const startAnalysis = async (
  payload: AnalyzeRequest,
): Promise<AnalyzeJobCreatedResponse> => {
  const response = await fetch(`${API_BASE_URL}/analyze`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    return parseApiError(response, `Failed to start analysis (${response.status})`)
  }

  return (await response.json()) as AnalyzeJobCreatedResponse
}

export const getAnalysisStatus = async (jobId: string): Promise<AnalyzeJobStatusResponse> => {
  const response = await fetch(`${API_BASE_URL}/analyze/${jobId}`, {
    method: 'GET',
  })

  if (!response.ok) {
    return parseApiError(response, `Failed to fetch status (${response.status})`)
  }

  return (await response.json()) as AnalyzeJobStatusResponse
}
