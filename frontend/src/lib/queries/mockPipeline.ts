// mockPipeline — multi-stage mock interview pipeline (Phase B.2 / ADR-002).
//
// Phase B.1 backend (chi REST under /api/v1/mock/*) is shipped. The pipeline
// is a server-driven HR / algo / coding / sysdesign / behavioral sequence;
// each stage owns one or more `attempts` (questions). The frontend reads
// the full pipeline via `useMockPipelineQuery` and dispatches mutations to
// advance stages or submit answers.
//
// Anti-fallback: companies endpoint is the only one that may legitimately
// be empty (admin hasn't seeded). All other endpoints surface real backend
// errors; we never fake data.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../apiClient'

// ── New (Phase B.2) backend contract types ───────────────────────────────

export type StageKind = 'hr' | 'algo' | 'coding' | 'sysdesign' | 'behavioral'
export type StageStatus = 'pending' | 'in_progress' | 'finished' | 'skipped'
export type StageVerdict = 'pass' | 'fail' | 'borderline' | null
export type AttemptKind = 'task_solve' | 'question_answer' | 'sysdesign_canvas' | 'voice_answer'
export type AttemptVerdict = 'pass' | 'fail' | 'borderline' | 'pending'
export type PipelineVerdict = 'in_progress' | 'pass' | 'fail' | 'cancelled'

export type ReferenceCriteria = {
  must_mention?: string[]
  nice_to_have?: string[]
  common_pitfalls?: string[]
}

export type PipelineAttempt = {
  id: string
  kind: AttemptKind
  question_body: string | null
  expected_answer_md: string | null
  reference_criteria: ReferenceCriteria
  user_answer_md: string | null
  // Phase D.1: user-provided sysdesign-canvas extras. Empty for non-canvas
  // attempts; backend always emits them.
  user_context_md?: string | null
  user_excalidraw_image_url?: string | null
  ai_score: number | null
  ai_verdict: AttemptVerdict
  ai_water_score: number | null
  ai_feedback_md: string | null
  ai_missing_points: string[]
  ai_judged_at: string | null
  // Phase D.2: present only when attempt is rooted on a mock_tasks row.
  task_functional_requirements_md?: string | null
  task_language?: string | null
}

export type PipelineStage = {
  id: string
  stage_kind: StageKind
  ordinal: number
  status: StageStatus
  score: number | null
  verdict: StageVerdict
  ai_feedback_md: string | null
  ai_strictness_profile_id: string | null
  started_at: string | null
  finished_at: string | null
  attempts: PipelineAttempt[]
}

export type Pipeline = {
  id: string
  user_id: string
  company_id: string | null
  ai_assist: boolean
  current_stage_idx: number
  verdict: PipelineVerdict
  total_score: number | null
  started_at: string
  finished_at: string | null
  stages: PipelineStage[]
}

// Phase F-5 cleanup: LegacyStageKind / LegacyStageStatus removed — their
// only consumer (PipelineStepper.tsx) deleted in F-5. Phase B/C/D contracts
// are now the single source of truth.

export type MockCompany = {
  id: string
  slug: string
  name: string
  logo_url: string | null
  level: 'mid' | 'senior' | 'staff'
  tier: 'tier1' | 'tier2' | 'tier3'
  default_languages: string[]
  default_section_focus: string | null
}

const PIPELINE_FEATURE_ENABLED = true

export const mockPipelineKeys = {
  all: ['mockPipeline'] as const,
  companies: ['mockPipeline', 'companies'] as const,
  pipeline: (id: string | undefined) => ['mock-pipeline', id] as const,
  leaderboard: (companyId: string | undefined, limit: number) =>
    ['mockPipeline', 'leaderboard', companyId ?? 'global', limit] as const,
}

export type LeaderboardEntry = {
  rank: number
  user_id: string
  display_name: string
  avatar_url: string
  pipelines_finished: number
  pipelines_passed: number
  avg_score: number
}

export type LeaderboardResponse = {
  items: LeaderboardEntry[]
  fairness_watermark: 'ai_assist_off_only'
}

// useMockLeaderboardQuery — fairness-watermarked leaderboard. Backend
// excludes ai_assist=true pipelines so the ranking reflects unaided
// performance only.
export function useMockLeaderboardQuery(opts: { companyId?: string; limit?: number } = {}) {
  const { companyId, limit = 10 } = opts
  return useQuery({
    queryKey: mockPipelineKeys.leaderboard(companyId, limit),
    queryFn: async () => {
      const qs = new URLSearchParams()
      qs.set('limit', String(limit))
      if (companyId) qs.set('company_id', companyId)
      return api<LeaderboardResponse>(`/mock/leaderboard?${qs.toString()}`)
    },
    staleTime: 60_000,
    retry: false,
  })
}

// ── Companies (read) ─────────────────────────────────────────────────────

export function useMockCompaniesQuery() {
  return useQuery({
    queryKey: mockPipelineKeys.companies,
    queryFn: async () => {
      if (!PIPELINE_FEATURE_ENABLED) {
        throw new Error('mock_pipeline.coming_soon')
      }
      const wire = await api<{ items: MockCompany[] }>('/mock/companies')
      return wire.items ?? []
    },
    staleTime: 5 * 60_000,
    retry: false,
  })
}

// ── Pipeline (read) ──────────────────────────────────────────────────────
//
// Polling: only while at least one attempt has `user_answer_md` set AND
// `ai_verdict === 'pending'` (i.e. the AI judge is currently processing).
// Otherwise no polling — single fetch on mount + invalidations on mutations.

export function useMockPipelineQuery(id: string | undefined) {
  return useQuery({
    queryKey: mockPipelineKeys.pipeline(id),
    queryFn: async () => {
      if (!PIPELINE_FEATURE_ENABLED) throw new Error('mock_pipeline.coming_soon')
      return api<Pipeline>(`/mock/pipelines/${id}`)
    },
    enabled: !!id,
    retry: false,
    refetchInterval: (query) => {
      const data = query.state.data as Pipeline | undefined
      if (!data) return false
      const judging = data.stages.some((s) =>
        s.attempts.some((a) => a.user_answer_md && a.ai_verdict === 'pending'),
      )
      return judging ? 1500 : false
    },
  })
}

// ── ai_assist localStorage mirror ────────────────────────────────────────

export const MOCK_AI_ASSIST_STORAGE_KEY = 'druz9.mock.ai_assist'

// ── Pipeline (mutations) ─────────────────────────────────────────────────

export function useCreateMockPipelineMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { company_id?: string; ai_assist?: boolean }) => {
      if (!PIPELINE_FEATURE_ENABLED) throw new Error('mock_pipeline.coming_soon')
      return api<Pipeline>('/mock/pipelines', {
        method: 'POST',
        body: JSON.stringify(input),
      })
    },
    onSuccess: (data, input) => {
      try {
        if (typeof window !== 'undefined') {
          window.localStorage.setItem(
            `${MOCK_AI_ASSIST_STORAGE_KEY}.${data.id}`,
            input.ai_assist ? '1' : '0',
          )
        }
      } catch {
        /* localStorage may be unavailable in private mode */
      }
      qc.setQueryData(mockPipelineKeys.pipeline(data.id), data)
    },
  })
}

export function useStartNextStageMutation(pipelineId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      if (!pipelineId) throw new Error('pipeline_id_required')
      return api<Pipeline>(`/mock/pipelines/${pipelineId}/start-next-stage`, {
        method: 'POST',
        body: '{}',
      })
    },
    onSuccess: (data) => {
      qc.setQueryData(mockPipelineKeys.pipeline(pipelineId), data)
    },
  })
}

export function useSubmitAnswerMutation(pipelineId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ attemptId, userAnswer }: { attemptId: string; userAnswer: string }) => {
      return api<unknown>(`/mock/attempts/${attemptId}/submit`, {
        method: 'POST',
        body: JSON.stringify({ user_answer_md: userAnswer }),
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: mockPipelineKeys.pipeline(pipelineId) })
    },
  })
}

// Phase D.2 — sysdesign-canvas submit. Posts the rendered PNG (data URL) +
// non-functional reqs + free-form context. Backend orchestrator calls the
// vision judge and writes the result back atomically. We invalidate the
// pipeline query so the polling refetch picks up the verdict.
export function useSubmitCanvasMutation(pipelineId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      attemptId,
      imageDataURL,
      contextMD,
      nonFunctionalMD,
    }: {
      attemptId: string
      imageDataURL: string
      contextMD: string
      nonFunctionalMD: string
    }) =>
      api<unknown>(`/mock/attempts/${attemptId}/submit-canvas`, {
        method: 'POST',
        body: JSON.stringify({
          image_data_url: imageDataURL,
          context_md: contextMD,
          non_functional_md: nonFunctionalMD,
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: mockPipelineKeys.pipeline(pipelineId) })
    },
  })
}

export function useFinishStageMutation(pipelineId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (stageId: string) => {
      return api<unknown>(`/mock/stages/${stageId}/finish`, {
        method: 'POST',
        body: '{}',
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: mockPipelineKeys.pipeline(pipelineId) })
    },
  })
}

export function useCancelPipelineMutation(pipelineId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      if (!pipelineId) throw new Error('pipeline_id_required')
      return api<unknown>(`/mock/pipelines/${pipelineId}/cancel`, {
        method: 'POST',
        body: '{}',
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: mockPipelineKeys.pipeline(pipelineId) })
    },
  })
}

// ── Labels ───────────────────────────────────────────────────────────────

export const STAGE_LABEL: Record<StageKind, string> = {
  hr: 'HR',
  algo: 'Алгоритмы',
  coding: 'Live Coding',
  sysdesign: 'System Design',
  behavioral: 'Behavioral',
}

export function isComingSoonError(err: unknown): boolean {
  return err instanceof Error && err.message === 'mock_pipeline.coming_soon'
}
