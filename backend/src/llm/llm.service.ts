import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Groq from 'groq-sdk';
import {
  AgentTaskType,
  PartialAnalyzeResult,
  QueueTaskMessage,
} from '../common/analysis.types';

const TASK_DECISION_PROMPT = `You are an AI agent planning an analysis pipeline.

Available tasks (pick a subset that best fits the user input — order matters, run only what adds value):
- summarize — compress the gist for quick reading
- extract_keywords — surface salient terms for scanning / SEO-style tags
- classify — assign one concise category or domain label
- suggest_improvements — strategic, actionable advice (not copyediting)

You must reason about the input: what is the user trying to learn? What is redundant? What is missing?

Return ONLY valid JSON (no markdown fences, no commentary before or after) with this exact shape:
{
  "tasks": ["task_name", ...],
  "reasoning": "2-5 sentences: why this bundle and order, what you optimized for.",
  "input_signals": "Short notes on what in the user's text drove this plan (use \\n between points if helpful).",
  "tradeoffs": "1-3 sentences: risks, deprioritized options, or alternatives you considered.",
  "skip_note": "If you omitted any of the four tasks, name each one and why (required whenever the task list is not all four). Otherwise \"\"."
}`;

const DEFAULT_TASKS: AgentTaskType[] = [
  'summarize',
  'extract_keywords',
  'classify',
  'suggest_improvements',
];

@Injectable()
export class LlmService {
  constructor(private readonly configService: ConfigService) {}

  async decideTasks(text: string): Promise<{
    selectedTasks: AgentTaskType[];
    rawOutput: string;
    prompt: string;
    reasoning: string;
    inputSignals: string;
    tradeoffs: string;
    skipNote: string;
  }> {
    const rawOutput = await this.generateText(
      `${TASK_DECISION_PROMPT}\n\nUser input:\n${text}`,
      0.2,
    );

    const allowedTasks: AgentTaskType[] = [...DEFAULT_TASKS];

    const normalizeTaskList = (list: unknown): AgentTaskType[] => {
      if (!Array.isArray(list)) {
        return [];
      }
      const seen = new Set<AgentTaskType>();
      const out: AgentTaskType[] = [];
      for (const task of list) {
        if (
          typeof task === 'string' &&
          allowedTasks.includes(task as AgentTaskType) &&
          !seen.has(task as AgentTaskType)
        ) {
          const t = task as AgentTaskType;
          seen.add(t);
          out.push(t);
        }
      }
      return out;
    };

    const str = (value: unknown): string =>
      typeof value === 'string' ? value.trim() : '';

    try {
      const objectJson = this.extractJsonObjectCandidate(rawOutput);
      if (objectJson) {
        const parsed = JSON.parse(objectJson) as Record<string, unknown>;
        const selectedTasks = normalizeTaskList(parsed.tasks);
        return {
          selectedTasks,
          rawOutput,
          prompt: TASK_DECISION_PROMPT,
          reasoning: str(parsed.reasoning),
          inputSignals: str(parsed.input_signals),
          tradeoffs: str(parsed.tradeoffs),
          skipNote: str(parsed.skip_note),
        };
      }

      const arrayJson = this.extractJsonCandidate(rawOutput);
      if (arrayJson) {
        const parsed = JSON.parse(arrayJson) as unknown;
        const selectedTasks = normalizeTaskList(parsed);
        return {
          selectedTasks,
          rawOutput,
          prompt: TASK_DECISION_PROMPT,
          reasoning: '',
          inputSignals: '',
          tradeoffs: '',
          skipNote: '',
        };
      }
    } catch {
      // fall through to defaults
    }

    return {
      selectedTasks: [...DEFAULT_TASKS],
      rawOutput,
      prompt: TASK_DECISION_PROMPT,
      reasoning:
        'Structured decision JSON could not be parsed; defaulted to the full four-task pipeline.',
      inputSignals: '',
      tradeoffs: '',
      skipNote: '',
    };
  }

  async executeTask(task: QueueTaskMessage): Promise<PartialAnalyzeResult> {
    switch (task.type) {
      case 'summarize': {
        const rawSummary = await this.generateText(
          `Summarize the text below in exactly 2-3 concise sentences.
Rules:
- Return only the summary text.
- Do not add prefaces like "Here is a summary".
- Do not mention these instructions.

Text:
${task.payload.text}`,
          0.2,
        );
        const summary = this.cleanSummary(rawSummary);
        return { summary };
      }
      case 'extract_keywords': {
        const rawKeywords = await this.generateText(
          `Extract exactly 5 relevant keywords from the text.
Rules:
- Return ONLY a valid JSON array of strings.
- No markdown, no code fences, no extra commentary.

Text:
${task.payload.text}`,
          0.2,
        );

        const parsedKeywords = this.extractStringArray(rawKeywords, 5);
        const fallbackKeywords = this.fallbackSplit(rawKeywords, 5);

        return { keywords: parsedKeywords.length > 0 ? parsedKeywords : fallbackKeywords };
      }
      case 'classify': {
        const rawCategory = await this.generateText(
          `Classify the text into one concise category.
Rules:
- Return only the category label.
- No preface or explanation.

Text:
${task.payload.text}`,
          0.2,
        );
        const category = this.cleanSingleLine(rawCategory);
        return { category };
      }
      case 'suggest_improvements': {
        const rawSuggestions = await this.generateText(
          `You are a senior product and engineering advisor.
Provide 3-4 high-value, practical recommendations for the proposal below.

Rules:
- Return ONLY a valid JSON array of strings.
- Focus on strategy, architecture, product execution, GTM, and adoption risks.
- Avoid grammar/style feedback.
- Make each recommendation specific and actionable.
- Each item should be one concise sentence.
- Include risk/pitfall context inside the sentence when relevant.
- No markdown, no code fences, no extra commentary.

Text:
${task.payload.text}`,
          0.2,
        );

        const parsedSuggestions = this.extractStringArray(rawSuggestions, 4);
        const fallbackSuggestions = this.extractSuggestionFallback(rawSuggestions, 4);

        return {
          suggestions: parsedSuggestions.length > 0 ? parsedSuggestions : fallbackSuggestions,
        };
      }
      default:
        return {};
    }
  }

  private async generateText(prompt: string, temperature: number): Promise<string> {
    const completion = await this.getGroqClient().chat.completions.create({
      model:
        this.configService.get<string>('GROQ_MODEL') ??
        'llama-3.1-8b-instant',
      messages: [{ role: 'user', content: prompt }],
      temperature,
    });

    return completion.choices[0]?.message?.content?.trim() ?? '';
  }

  private getGroqClient(): Groq {
    const apiKey = this.configService.get<string>('GROQ_API_KEY');
    if (!apiKey) {
      throw new InternalServerErrorException('GROQ_API_KEY is not configured');
    }

    return new Groq({ apiKey });
  }

  private cleanSummary(input: string): string {
    const withoutFences = input.replace(/```[\s\S]*?```/g, (block) =>
      block.replace(/```(?:json)?/g, '').trim(),
    );

    return withoutFences
      .replace(/^here(?:'s| is)\s+(?:a\s+)?(?:2-3\s+sentence\s+)?summary(?:\s+of\s+the\s+text)?:?\s*/i, '')
      .replace(/^summary:?\s*/i, '')
      .trim();
  }

  private cleanSingleLine(input: string): string {
    return input
      .replace(/^category:?\s*/i, '')
      .split('\n')[0]
      .trim();
  }

  private extractStringArray(raw: string, maxItems: number): string[] {
    const jsonCandidate = this.extractJsonCandidate(raw);
    if (!jsonCandidate) {
      return [];
    }

    try {
      const parsed = JSON.parse(jsonCandidate) as unknown;
      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed
        .map((item) => this.normalizeArrayItem(item))
        .filter((item): item is string => Boolean(item))
        .slice(0, maxItems);
    } catch {
      return [];
    }
  }

  private extractJsonCandidate(raw: string): string | null {
    const fencedMatch = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fencedMatch?.[1]) {
      return fencedMatch[1].trim();
    }

    const bracketStart = raw.indexOf('[');
    const bracketEnd = raw.lastIndexOf(']');
    if (bracketStart !== -1 && bracketEnd > bracketStart) {
      return raw.slice(bracketStart, bracketEnd + 1).trim();
    }

    return null;
  }

  private extractJsonObjectCandidate(raw: string): string | null {
    const fencedMatch = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fencedMatch?.[1]) {
      const inner = fencedMatch[1].trim();
      if (inner.startsWith('{')) {
        return inner;
      }
    }

    const braceStart = raw.indexOf('{');
    const braceEnd = raw.lastIndexOf('}');
    if (braceStart !== -1 && braceEnd > braceStart) {
      return raw.slice(braceStart, braceEnd + 1).trim();
    }

    return null;
  }

  private normalizeArrayItem(item: unknown): string | null {
    if (typeof item === 'string') {
      return item.trim();
    }

    if (item && typeof item === 'object') {
      const candidate = item as Record<string, unknown>;
      const valueFields = ['value', 'suggestion', 'text', 'label', 'title'];
      for (const field of valueFields) {
        if (typeof candidate[field] === 'string') {
          return candidate[field].trim();
        }
      }
    }

    return null;
  }

  private fallbackSplit(raw: string, maxItems: number): string[] {
    return raw
      .replace(/```[\s\S]*?```/g, '')
      .replace(/^[^\[]*?:\s*/i, '')
      .split(/,|\n/)
      .map((item) => item.replace(/^[-*\d.)\s]+/, '').trim())
      .filter(Boolean)
      .slice(0, maxItems);
  }

  private extractSuggestionFallback(
    raw: string,
    maxItems: number,
  ): string[] {
    const lines = raw
      .replace(/```[\s\S]*?```/g, '')
      .split('\n')
      .map((line) => line.replace(/^[-*\d.)\s]+/, '').trim())
      .filter(Boolean)
      .filter((line) => !/^here(?:'s| is)/i.test(line));

    return lines.slice(0, maxItems);
  }

}
