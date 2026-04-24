// Copilot session-analysis query. Wraps GET /api/v1/copilot/sessions/:id/analysis.
//
// Returns the structured report the desktop's Session Summary view uses
// (tldr, key_topics, action_items, decisions, terminology, open_questions,
// usage) alongside the legacy rubric fields (overall_score, weaknesses,
// recommendations, report_markdown).
//
// Web surface: /copilot/reports/:id renders a read-only public copy of
// this same data — that's the URL the backend's `ReportURLFor` template
// resolves to. No auth required for a read (matches reports being
// share-by-link).

import { useQuery } from '@tanstack/react-query'

import { api } from '../apiClient'

export interface AnalysisItem {
  title: string
  detail?: string
}

export interface AnalysisTerm {
  term: string
  definition: string
}

export interface AnalysisUsage {
  turns: number
  tokensIn: number
  tokensOut: number
  totalLatencyMs: number
}

export interface CopilotSessionAnalysis {
  sessionId: string
  status: 'pending' | 'running' | 'ready' | 'failed' | ''
  overallScore: number
  sectionScores: Record<string, number>
  weaknesses: string[]
  recommendations: string[]
  reportMarkdown: string
  reportUrl: string
  errorMessage: string
  startedAt: string
  finishedAt: string

  // Phase 3 structured fields
  title: string
  tldr: string
  keyTopics: string[]
  actionItems: AnalysisItem[]
  terminology: AnalysisTerm[]
  decisions: AnalysisItem[]
  openQuestions: string[]
  usage: AnalysisUsage | null
}

type RawAnalysis = Record<string, unknown>

function fromRaw(raw: RawAnalysis): CopilotSessionAnalysis {
  const usageRaw = (raw.usage ?? null) as Record<string, unknown> | null
  const usage = usageRaw
    ? {
        turns: Number(usageRaw.turns ?? 0),
        tokensIn: Number(usageRaw.tokens_in ?? usageRaw.tokensIn ?? 0),
        tokensOut: Number(usageRaw.tokens_out ?? usageRaw.tokensOut ?? 0),
        totalLatencyMs: Number(usageRaw.total_latency_ms ?? usageRaw.totalLatencyMs ?? 0),
      }
    : null

  const asItems = (v: unknown): AnalysisItem[] =>
    ((v as Array<Record<string, unknown>>) ?? []).map((it) => ({
      title: String(it.title ?? ''),
      detail: it.detail ? String(it.detail) : undefined,
    }))
  const asTerms = (v: unknown): AnalysisTerm[] =>
    ((v as Array<Record<string, unknown>>) ?? []).map((it) => ({
      term: String(it.term ?? ''),
      definition: String(it.definition ?? ''),
    }))

  return {
    sessionId: String(raw.session_id ?? raw.sessionId ?? ''),
    status: (raw.status as CopilotSessionAnalysis['status']) ?? '',
    overallScore: Number(raw.overall_score ?? raw.overallScore ?? 0),
    sectionScores: (raw.section_scores ?? raw.sectionScores ?? {}) as Record<string, number>,
    weaknesses: (raw.weaknesses ?? []) as string[],
    recommendations: (raw.recommendations ?? []) as string[],
    reportMarkdown: String(raw.report_markdown ?? raw.reportMarkdown ?? ''),
    reportUrl: String(raw.report_url ?? raw.reportUrl ?? ''),
    errorMessage: String(raw.error_message ?? raw.errorMessage ?? ''),
    startedAt: String(raw.started_at ?? raw.startedAt ?? ''),
    finishedAt: String(raw.finished_at ?? raw.finishedAt ?? ''),
    title: String(raw.title ?? ''),
    tldr: String(raw.tldr ?? ''),
    keyTopics: (raw.key_topics ?? raw.keyTopics ?? []) as string[],
    actionItems: asItems(raw.action_items ?? raw.actionItems),
    terminology: asTerms(raw.terminology),
    decisions: asItems(raw.decisions),
    openQuestions: (raw.open_questions ?? raw.openQuestions ?? []) as string[],
    usage,
  }
}

export function useCopilotReportQuery(sessionId: string | undefined) {
  return useQuery({
    queryKey: ['copilot-session-analysis', sessionId] as const,
    enabled: !!sessionId,
    queryFn: async () => {
      const raw = await api<RawAnalysis>(`/api/v1/copilot/sessions/${sessionId}/analysis`)
      return fromRaw(raw)
    },
    // Analysis usually finalises within 10-30s of session end. If the
    // user lands while still 'pending' / 'running', refetch every 4s
    // so the page transitions to the final render without a reload.
    refetchInterval: (query) => {
      const d = query.state.data
      if (!d) return 4000
      return d.status === 'pending' || d.status === 'running' ? 4000 : false
    },
  })
}
