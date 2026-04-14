<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { getAnalysisStatus, startAnalysis } from './services/api'
import type {
  AnalyzeResponse,
  AnalyzeJobStatus,
  AnalyzeJobStatusResponse,
} from './types/analysis'

const text = ref('')
const result = ref<AnalyzeResponse | null>(null)
const errorMessage = ref('')
const currentJobId = ref<string | null>(null)
const jobStatus = ref<AnalyzeJobStatus | null>(null)
const latestJobStatus = ref<AnalyzeJobStatusResponse | null>(null)
const completedTasks = ref(0)
const totalTasks = ref(0)
const isSubmitting = ref(false)
const submittingProgress = ref(0)
const submittingAnimationId = ref(0)
const submittingTransitionMs = ref(900)
const isLoading = computed(
  () => jobStatus.value === 'queued' || jobStatus.value === 'processing',
)
const isBusy = computed(() => isSubmitting.value || isLoading.value)
const technologyTags = [
  { name: 'Vue 3', iconUrl: 'https://cdn.simpleicons.org/vuedotjs/42b883' },
  { name: 'NestJS', iconUrl: 'https://cdn.simpleicons.org/nestjs/e0234e' },
  { name: 'RabbitMQ', iconUrl: 'https://cdn.simpleicons.org/rabbitmq/ff6600' },
  { name: 'Groq', iconUrl: 'https://groq.com/favicon.ico' },
  { name: 'TypeScript', iconUrl: 'https://cdn.simpleicons.org/typescript/3178c6' },
]
const resultSectionRef = ref<HTMLElement | null>(null)
const isInsightsOpen = ref(false)

const openInsights = () => {
  isInsightsOpen.value = true
}

const closeInsights = () => {
  isInsightsOpen.value = false
}
const currentInsights = computed(() => latestJobStatus.value?.insights ?? null)
const formatTimestamp = (timestamp: number) =>
  new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
const groupedTimeline = computed(() => {
  const insights = currentInsights.value
  if (!insights) {
    return []
  }

  const queuedCount = insights.tasks.filter((task) => task.queuedAt).length
  const startedCount = insights.tasks.filter((task) => task.startedAt).length
  const completedCount = insights.tasks.filter((task) => task.status === 'completed').length
  const failedCount = insights.tasks.filter((task) => task.status === 'failed').length

  const firstQueuedAt = Math.min(...insights.tasks.filter((task) => task.queuedAt).map((task) => task.queuedAt as number))
  const firstStartedAt = Math.min(...insights.tasks.filter((task) => task.startedAt).map((task) => task.startedAt as number))
  const lastCompletedAt = Math.max(
    ...insights.tasks
      .filter((task) => task.completedAt)
      .map((task) => task.completedAt as number),
    0,
  )

  const timeline: { timestamp: number; message: string }[] = []
  timeline.push({
    timestamp: insights.createdAt,
    message: 'LLM initialized task decision process.',
  })
  if (insights.decidedTasks.length > 0) {
    timeline.push({
      timestamp: insights.createdAt,
      message: `LLM selected ${insights.decidedTasks.length} tasks: ${insights.decidedTasks.join(', ')}`,
    })
  }
  if (queuedCount > 0) {
    timeline.push({
      timestamp: Number.isFinite(firstQueuedAt) ? firstQueuedAt : insights.createdAt,
      message: `📤 ${queuedCount} task(s) published to RabbitMQ (${insights.decidedTasks.join(', ')})`,
    })
  }
  if (startedCount > 0) {
    timeline.push({
      timestamp: Number.isFinite(firstStartedAt) ? firstStartedAt : insights.createdAt,
      message: `👷 Workers picked up ${startedCount} task(s).`,
    })
  }
  if (completedCount > 0 || failedCount > 0) {
    const statusText = failedCount > 0 ? `${completedCount} completed, ${failedCount} failed` : `${completedCount} completed`
    timeline.push({
      timestamp: lastCompletedAt > 0 ? lastCompletedAt : insights.createdAt,
      message: `🏁 Results aggregated and returned to API (${statusText}).`,
    })
  }

  return timeline
})
const taskDurationStats = computed(() => {
  const insights = currentInsights.value
  if (!insights) {
    return []
  }

  const maxDuration = Math.max(
    ...insights.tasks.map((task) => task.durationMs ?? 0),
    1,
  )

  return insights.tasks.map((task) => ({
    ...task,
    widthPercent: Math.max(8, Math.round(((task.durationMs ?? 0) / maxDuration) * 100)),
  }))
})

const hasInput = computed(() => text.value.trim().length > 0)
const canSubmit = computed(() => hasInput.value && !isBusy.value)
const characterCount = computed(() => text.value.length)
const progressPercent = computed(() => {
  if (!totalTasks.value) {
    return 0
  }
  return Math.min(100, Math.round((completedTasks.value / totalTasks.value) * 100))
})
const progressBarStyle = computed(() => {
  if (isSubmitting.value) {
    return {
      width: `${submittingProgress.value}%`,
      transition: `width ${submittingTransitionMs.value}ms cubic-bezier(0.22, 1, 0.36, 1)`,
    }
  }

  return {
    width: `${progressPercent.value}%`,
    transition: 'width 500ms ease',
  }
})
const submitButtonClass = computed(() => {
  if (isBusy.value) {
    return 'inline-flex h-10 w-36 items-center justify-center gap-2 rounded-xl bg-emerald-400 text-sm font-bold text-slate-950'
  }

  if (!hasInput.value) {
    return 'inline-flex h-10 w-36 items-center justify-center gap-2 rounded-xl bg-slate-600 text-sm font-bold text-slate-300'
  }

  return 'inline-flex h-10 w-36 items-center justify-center gap-2 rounded-xl bg-emerald-400 text-sm font-bold text-slate-950 transition hover:bg-teal-300'
})
const statusMessage = computed(() => {
  if (isSubmitting.value) {
    return 'Analyzing your request...'
  }
  if (jobStatus.value === 'queued') {
    return 'Request accepted. Tasks are queued...'
  }
  if (jobStatus.value === 'processing') {
    return `Processing tasks (${completedTasks.value}/${totalTasks.value})...`
  }
  if (jobStatus.value === 'completed') {
    return 'Analysis complete.'
  }
  if (jobStatus.value === 'failed') {
    return 'Analysis failed.'
  }
  return ''
})
const isResponseState = computed(
  () => Boolean(errorMessage.value) || (!isBusy.value && Boolean(jobStatus.value)),
)
const statusContainerClass = computed(() => {
  if (errorMessage.value) {
    return 'border-rose-400/40 bg-rose-500/10'
  }

  if (isBusy.value || Boolean(jobStatus.value)) {
    return 'border-emerald-400/40 bg-emerald-500/10'
  }

  return 'border-transparent bg-transparent'
})

const wordCount = computed(() => {
  const normalizedText = text.value.trim()
  if (!normalizedText) {
    return 0
  }
  return normalizedText.split(/\s+/).length
})

const resetViewState = () => {
  errorMessage.value = ''
  result.value = null
  currentJobId.value = null
  jobStatus.value = null
  latestJobStatus.value = null
  completedTasks.value = 0
  totalTasks.value = 0
  isSubmitting.value = false
  submittingProgress.value = 0
  submittingTransitionMs.value = 900
  submittingAnimationId.value += 1
}

const onSubmit = async () => {
  if (!canSubmit.value) {
    return
  }

  resetViewState()
  isSubmitting.value = true
  submittingProgress.value = 0
  void animateSubmittingProgress()

  try {
    const createdJob = await startAnalysis({ text: text.value.trim() })
    currentJobId.value = createdJob.jobId
    jobStatus.value = createdJob.status
    isSubmitting.value = false
    submittingAnimationId.value += 1
    await pollForResult(createdJob.jobId)
  } catch (error) {
    isSubmitting.value = false
    submittingAnimationId.value += 1
    errorMessage.value =
      error instanceof Error ? error.message : 'Analysis failed. Please try again.'
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const createWeightedStageDurations = (totalDurationMs: number, stageCount: number) => {
  const weights = Array.from({ length: stageCount }, () => 0.8 + Math.random() * 1.8)
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0)
  return weights.map((weight) => Math.round((totalDurationMs * weight) / totalWeight))
}

const animateSubmittingProgress = async () => {
  const animationId = Date.now()
  submittingAnimationId.value = animationId

  const stagedProgress = [15, 47, 63, 95]
  const stageDurations = createWeightedStageDurations(1000, stagedProgress.length)

  for (let index = 0; index < stagedProgress.length; index += 1) {
    if (!isSubmitting.value || submittingAnimationId.value !== animationId) {
      return
    }

    const stageDuration = stageDurations[index]
    submittingTransitionMs.value = stageDuration
    await sleep(30)
    submittingProgress.value = stagedProgress[index]
    await sleep(stageDuration)
  }
}

const pollForResult = async (jobId: string) => {
  const maxAttempts = 45
  let attempt = 0

  while (attempt < maxAttempts) {
    attempt += 1
    const status = await getAnalysisStatus(jobId)
    latestJobStatus.value = status
    jobStatus.value = status.status
    completedTasks.value = status.progress.completed
    totalTasks.value = status.progress.total

    if (status.status === 'completed' && status.result) {
      result.value = status.result
      await nextTick()
      resultSectionRef.value?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
        inline: 'nearest',
      })
      return
    }

    if (status.status === 'failed') {
      throw new Error(status.error ?? 'Analysis failed while processing tasks.')
    }

    await sleep(1000)
  }

  throw new Error('Analysis is taking too long. Please try again.')
}
</script>

<template>
  <main class="relative min-h-screen overflow-x-clip bg-[#040404] text-slate-100 selection:bg-emerald-400/30">
    <div class="pointer-events-none absolute inset-0">
      <div
        class="absolute -left-24 -top-24 h-80 w-80 rounded-full bg-emerald-400/10 blur-3xl animate-[pulse_8s_ease-in-out_infinite]"
      />
      <div
        class="absolute -right-16 top-1/4 h-72 w-72 rounded-full bg-teal-400/10 blur-3xl animate-[pulse_10s_ease-in-out_infinite]"
      />
      <div
        class="absolute -bottom-32 left-1/3 h-96 w-96 rounded-full bg-lime-300/10 blur-3xl animate-[pulse_12s_ease-in-out_infinite]"
      />
      <div
        class="absolute inset-0 bg-[linear-gradient(to_right,rgba(16,185,129,0.12)_0.0625rem,transparent_0.0625rem),linear-gradient(to_bottom,rgba(20,184,166,0.1)_0.0625rem,transparent_0.0625rem)] bg-size-[3rem_3rem] opacity-20"
      />
      <div class="absolute right-1/4 top-1/3 h-2 w-2 rounded-full bg-emerald-300/70 animate-ping" />
      <div
        class="absolute left-1/4 top-2/3 h-1.5 w-1.5 rounded-full bg-teal-200/70 animate-ping [animation-delay:1.2s]"
      />
      <div
        class="absolute right-1/3 top-3/4 h-1.5 w-1.5 rounded-full bg-lime-200/70 animate-ping [animation-delay:2.2s]"
      />
    </div>

    <div class="relative z-10 mx-auto flex w-full max-w-6xl flex-col gap-4 px-6 py-6 sm:py-8 mt-6">
      <header class="space-y-3 pt-6 sm:pt-8">
        <div class="flex flex-wrap items-center gap-2">
          <div class="inline-flex items-center rounded-full border border-emerald-400/35 bg-emerald-400/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-emerald-200">
            AI Insights Platform
          </div>
        </div>
        <div class="space-y-2">
          <h1 class="max-w-4xl text-3xl font-bold tracking-tight text-white sm:text-4xl">
            Intelligent Text Analysis for Modern Product Teams
          </h1>
          <p class="max-w-3xl text-sm leading-relaxed text-slate-300">
            Turn raw ideas into structured insights with a clean analysis pipeline designed for fast iteration,
            technical clarity, and production-style developer workflows.
          </p>
        </div>
      </header>

      <section class="rounded-xl border border-emerald-500/20 bg-[#06100d]/70 p-3 backdrop-blur">
        <div class="flex flex-wrap items-center gap-2">
          <span class="mr-1 text-xs uppercase tracking-widest text-slate-400">Powered by</span>
          <div
            v-for="technology in technologyTags"
            :key="technology.name"
            class="inline-flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-[#020705]/80 px-2.5 py-1.5"
          >
            <img :src="technology.iconUrl" :alt="`${technology.name} icon`" class="h-3.5 w-3.5 rounded-sm" />
            <span class="text-xs font-medium text-slate-300">{{ technology.name }}</span>
          </div>
        </div>
      </section>

      <section class="rounded-2xl border border-emerald-500/25 bg-[#05100d]/90 px-5 pb-5 pt-4 shadow-xl shadow-emerald-900/20 backdrop-blur sm:px-6 sm:pb-6 sm:pt-5">
        <form class="space-y-4" @submit.prevent="onSubmit">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <label for="inputText" class="text-sm font-semibold text-slate-200">Input Text</label>
            <div class="flex items-center gap-2">
              <span class="rounded-md border border-emerald-500/20 bg-[#020705]/80 px-2 py-1 text-xs text-slate-300">
                {{ wordCount }} words
              </span>
              <span class="rounded-md border border-emerald-500/20 bg-[#020705]/80 px-2 py-1 text-xs text-slate-300">
                {{ characterCount }} chars
              </span>
            </div>
          </div>
          <textarea
            id="inputText"
            v-model="text"
            rows="9"
            placeholder="Describe your concept, architecture, or roadmap..."
            class="w-full rounded-2xl border border-emerald-500/20 bg-[#010604] p-4 text-sm leading-relaxed text-slate-100 outline-none transition focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/20"
          />
          <div class="flex flex-wrap items-center justify-between gap-3">
            <p class="text-xs text-slate-400">Engine output includes summary, keywords, category, and suggestions.</p>
            <div class="flex items-center gap-2">
              <button
                type="submit"
                :disabled="!canSubmit"
                :class="submitButtonClass"
              >
                <svg
                  v-if="isBusy"
                  class="h-4 w-4 animate-spin text-slate-950"
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden="true"
                >
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                  <path
                    class="opacity-80"
                    fill="currentColor"
                    d="M12 2a10 10 0 0 1 10 10h-4a6 6 0 0 0-6-6V2z"
                  />
                </svg>
                <span v-if="!isBusy">Run Analysis</span>
              </button>
            </div>
          </div>
        </form>
      </section>

      <section class="h-24 rounded-2xl border p-4 text-sm overflow-hidden" :class="statusContainerClass">
        <div v-if="isBusy" class="grid h-full grid-rows-[1fr_auto] gap-2 -translate-y-1">
          <p class="self-center text-emerald-200 leading-relaxed">
            {{ statusMessage }}
          </p>
          <div class="h-2 w-full -translate-y-1.5 overflow-hidden rounded-full bg-slate-800/90">
            <div class="h-full rounded-full bg-emerald-300" :style="progressBarStyle" />
          </div>
        </div>

        <div
          v-else-if="isResponseState"
          class="flex h-full items-center"
        >
          <p
            class="leading-relaxed"
            :class="errorMessage ? 'text-rose-200' : 'text-emerald-200'"
          >
            {{ errorMessage || statusMessage }}
          </p>
        </div>

        <div v-else class="h-full" />
      </section>

      <section
        v-if="result"
        ref="resultSectionRef"
        class="grid scroll-mt-32 gap-4 sm:grid-cols-2"
      >
        <article class="rounded-2xl border border-emerald-500/20 bg-[#07110f]/85 p-6 shadow-lg sm:col-span-2">
          <h2 class="mb-3 text-lg font-semibold text-white">Summary</h2>
          <p class="whitespace-pre-wrap text-sm leading-relaxed text-slate-300">{{ result.summary }}</p>
        </article>

        <article class="rounded-2xl border border-emerald-500/20 bg-[#07110f]/85 p-6 shadow-lg">
          <h2 class="mb-3 text-lg font-semibold text-white">Keywords</h2>
          <ul class="flex flex-wrap gap-2">
            <li
              v-for="keyword in result.keywords"
              :key="keyword"
              class="rounded-full border border-emerald-400/40 bg-emerald-400/10 px-3 py-1 text-xs font-semibold text-emerald-100"
            >
              {{ keyword }}
            </li>
          </ul>
        </article>

        <article class="rounded-2xl border border-emerald-500/20 bg-[#07110f]/85 p-6 shadow-lg">
          <h2 class="mb-3 text-lg font-semibold text-white">Category</h2>
          <span
            class="inline-flex rounded-full border border-teal-400/45 bg-teal-400/10 px-3 py-1 text-xs font-semibold text-teal-100"
          >
            {{ result.category }}
          </span>
        </article>

        <article class="rounded-2xl border border-emerald-500/20 bg-[#07110f]/85 p-6 shadow-lg sm:col-span-2">
          <h2 class="mb-3 text-lg font-semibold text-white">Suggestions</h2>
          <ul class="list-disc space-y-2 pl-5 text-sm leading-relaxed text-slate-300">
            <li
              v-for="suggestion in result.suggestions"
              :key="suggestion"
            >
              {{ suggestion }}
            </li>
          </ul>
        </article>

        <div
          v-if="latestJobStatus?.status === 'completed'"
          class="flex justify-center sm:col-span-2"
        >
          <button
            type="button"
            class="-mb-24 mt-4 inline-flex h-12 items-center justify-center rounded-xl border border-emerald-300/50 bg-emerald-500/15 px-8 text-sm font-semibold uppercase tracking-[0.12em] text-emerald-100 transition hover:bg-emerald-500/25"
            @click="openInsights"
          >
            Developer Insights
          </button>
        </div>
      </section>
    </div>

    <button
      type="button"
      class="fixed bottom-6 right-8 z-20 inline-flex h-16 w-16 items-center justify-center rounded-full border border-emerald-400/45 bg-[#05110d]/95 leading-none text-emerald-200 shadow-[0_0_1.25rem_rgba(16,185,129,0.35)] transition hover:bg-emerald-500/20"
      aria-label="Open developer insights"
      @click="openInsights"
    >
      <span class="text-[1.875rem]" aria-hidden="true">💻</span>
    </button>

    <div
      v-if="isInsightsOpen"
      class="fixed inset-0 z-30 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm"
      @click.self="closeInsights"
    >
      <section class="w-full max-w-4xl rounded-2xl border border-emerald-500/35 bg-[#05100d] shadow-2xl">
        <header class="flex items-start justify-between gap-4 border-b border-emerald-500/20 px-5 py-4 sm:px-6">
          <div>
            <h2 class="text-lg font-semibold text-white">Developer Insights</h2>
            <p class="mt-1 text-sm text-slate-300">
              Request-level telemetry for this exact analysis run.
            </p>
          </div>
          <button
            type="button"
            class="inline-flex h-8 min-w-8 items-center justify-center rounded-lg border border-emerald-400/30 bg-emerald-500/10 text-sm font-semibold text-emerald-200 transition hover:bg-emerald-500/20"
            @click="closeInsights"
          >
            x
          </button>
        </header>

        <div class="max-h-[75vh] space-y-6 overflow-y-auto px-5 py-5 sm:px-6">
          <section v-if="!currentInsights" class="space-y-2">
            <h3 class="text-sm font-semibold uppercase tracking-widest text-emerald-200">No Request Data Yet</h3>
            <p class="text-sm leading-relaxed text-slate-300">
              Run an analysis first. This panel will then show request-specific internals including decided
              tasks, RabbitMQ publishes, worker execution events, and timing details for each stage.
            </p>
          </section>

          <template v-else>
            <section class="grid gap-3 sm:grid-cols-3">
              <article class="rounded-xl border border-emerald-500/20 bg-[#020705] p-3">
                <p class="text-xs uppercase tracking-widest text-slate-400">Job ID</p>
                <p class="mt-1 break-all text-xs text-emerald-200">{{ latestJobStatus?.jobId }}</p>
              </article>
              <article class="rounded-xl border border-emerald-500/20 bg-[#020705] p-3">
                <p class="text-xs uppercase tracking-widest text-slate-400">Queue</p>
                <p class="mt-1 text-xs text-emerald-200">{{ currentInsights.queueName }}</p>
              </article>
              <article class="rounded-xl border border-emerald-500/20 bg-[#020705] p-3">
                <p class="text-xs uppercase tracking-widest text-slate-400">Task Plan</p>
                <p class="mt-1 text-xs text-emerald-200">{{ currentInsights.decidedTasks.join(', ') }}</p>
              </article>
            </section>

            <section class="space-y-2">
              <h3 class="text-sm font-semibold uppercase tracking-widest text-emerald-200">Execution Timeline</h3>
              <p class="text-xs leading-relaxed text-slate-400">
                Backend timeline for this request: the LLM chooses tasks first, then each task is published to RabbitMQ
                (<span class="font-mono text-slate-300">{{ currentInsights.queueName }}</span>), workers pull messages and
                run the LLM per task, and the API aggregates results when everything finishes — not browser or UI events.
              </p>
              <div class="space-y-2">
                <article
                  v-for="event in groupedTimeline"
                  :key="`${event.timestamp}-${event.message}`"
                  class="rounded-lg border border-emerald-500/20 bg-[#020705] px-3 py-2"
                >
                  <div class="flex flex-wrap items-center justify-between gap-2">
                    <p class="text-xs font-semibold text-emerald-200">Pipeline step</p>
                    <p class="text-[0.6875rem] text-slate-400">{{ formatTimestamp(event.timestamp) }}</p>
                  </div>
                  <p class="mt-1 text-xs leading-relaxed text-slate-300">
                    {{ event.message }}
                  </p>
                </article>
              </div>
            </section>

            <section class="space-y-3">
              <h3 class="text-sm font-semibold uppercase tracking-widest text-emerald-200">Decision Internals</h3>
              <p class="text-xs leading-relaxed text-slate-400">
                How the agent interpreted your text, what it prioritized, and why it chose this task pipeline (not just the task list).
              </p>

              <article
                v-if="currentInsights.llmDecisionReasoning"
                class="space-y-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/6 p-3"
              >
                <p class="text-[0.6875rem] font-semibold uppercase tracking-wider text-emerald-200/95">Plan &amp; rationale</p>
                <p class="whitespace-pre-wrap text-sm leading-relaxed text-slate-100">{{ currentInsights.llmDecisionReasoning }}</p>
              </article>

              <article
                v-if="currentInsights.llmDecisionInputSignals"
                class="space-y-1.5 rounded-lg border border-emerald-500/20 bg-[#020705] p-3"
              >
                <p class="text-[0.6875rem] font-semibold uppercase tracking-wider text-slate-400">Signals from your input</p>
                <p class="whitespace-pre-wrap text-sm leading-relaxed text-slate-300">{{ currentInsights.llmDecisionInputSignals }}</p>
              </article>

              <article
                v-if="currentInsights.llmDecisionTradeoffs"
                class="space-y-1.5 rounded-lg border border-emerald-500/20 bg-[#020705] p-3"
              >
                <p class="text-[0.6875rem] font-semibold uppercase tracking-wider text-slate-400">Tradeoffs &amp; risks</p>
                <p class="whitespace-pre-wrap text-sm leading-relaxed text-slate-300">{{ currentInsights.llmDecisionTradeoffs }}</p>
              </article>

              <article
                v-if="currentInsights.llmDecisionSkipNote"
                class="space-y-1.5 rounded-lg border border-amber-500/25 bg-amber-500/6 p-3"
              >
                <p class="text-[0.6875rem] font-semibold uppercase tracking-wider text-amber-200/90">Tasks not run</p>
                <p class="whitespace-pre-wrap text-sm leading-relaxed text-amber-100/95">{{ currentInsights.llmDecisionSkipNote }}</p>
              </article>

              <details class="group rounded-lg border border-emerald-500/20 bg-[#020705]">
                <summary class="cursor-pointer list-none px-3 py-2.5 text-xs font-semibold text-emerald-200/90 transition hover:bg-emerald-500/10 [&::-webkit-details-marker]:hidden">
                  <span class="inline-flex items-center gap-2">
                    <span class="text-slate-500 transition group-open:rotate-90">▸</span>
                    Technical: system prompt &amp; raw model output
                  </span>
                </summary>
                <div class="space-y-2 border-t border-emerald-500/15 p-3 pt-2">
                  <p class="text-[0.6875rem] uppercase tracking-wider text-slate-500">Decision prompt</p>
                  <pre class="max-h-50 overflow-y-auto overflow-x-auto rounded-md border border-emerald-500/20 bg-[#010503] p-2 text-[0.6875rem] leading-relaxed text-slate-300">{{ currentInsights.llmDecisionPrompt }}</pre>
                  <p class="text-[0.6875rem] uppercase tracking-wider text-slate-500">Raw LLM response</p>
                  <pre class="max-h-50 overflow-y-auto overflow-x-auto rounded-md border border-emerald-500/20 bg-[#010503] p-2 text-[0.6875rem] leading-relaxed text-slate-300">{{ currentInsights.llmRawTaskDecision }}</pre>
                </div>
              </details>
            </section>

            <section class="space-y-2">
              <h3 class="text-sm font-semibold uppercase tracking-widest text-emerald-200">Task Duration View</h3>
              <div class="space-y-2 rounded-lg border border-emerald-500/20 bg-[#020705] p-3">
                <div
                  v-for="task in taskDurationStats"
                  :key="`${task.taskType}-duration`"
                  class="space-y-1"
                >
                  <div class="flex items-center justify-between gap-2 text-[0.75rem]">
                    <p class="text-slate-200">{{ task.taskType }}</p>
                    <p class="text-slate-400">{{ task.durationMs ?? 0 }}ms</p>
                  </div>
                  <div class="h-2 overflow-hidden rounded-full bg-slate-800/80">
                    <div class="h-full rounded-full bg-emerald-300/90" :style="{ width: `${task.widthPercent}%` }" />
                  </div>
                </div>
              </div>
            </section>

            <section class="space-y-2">
              <h3 class="text-sm font-semibold uppercase tracking-widest text-emerald-200">Per-Task Internals</h3>
              <div class="grid gap-2">
                <article
                  v-for="task in currentInsights.tasks"
                  :key="task.taskType"
                  class="rounded-lg border border-emerald-500/20 bg-[#020705] px-3 py-2"
                >
                  <div class="flex flex-wrap items-center justify-between gap-2">
                    <p class="text-xs font-semibold text-white">{{ task.taskType }}</p>
                    <span class="rounded-md border border-emerald-400/30 bg-emerald-500/10 px-2 py-0.5 text-[0.6875rem] uppercase tracking-wider text-emerald-200">
                      {{ task.status }}
                    </span>
                  </div>
                  <div class="mt-1.5 space-y-1 text-[0.75rem] text-slate-300">
                    <p v-if="task.durationMs">Duration: {{ task.durationMs }}ms</p>
                    <p v-if="task.outputPreview">Output Preview: {{ task.outputPreview }}</p>
                    <p v-if="task.error" class="text-rose-200">Error: {{ task.error }}</p>
                  </div>
                </article>
              </div>
            </section>
          </template>
        </div>
      </section>
    </div>
  </main>
</template>
