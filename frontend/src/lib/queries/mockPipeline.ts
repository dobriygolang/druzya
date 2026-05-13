// Anti-fallback: companies endpoint is the only one that may legitimately
// be empty (admin hasn't seeded). All other endpoints surface real backend
// errors; we never fake data.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../apiClient'


export type StageKind =
  | 'hr'
  | 'algo'
  | 'coding'
  | 'sysdesign'
  | 'behavioral'
  | 'ml_coding'
  | 'ml_system_design'
  | 'ml_theory'
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
  user_context_md?: string | null
  // Legacy: pre-F-3 v2 inline data URL. Empty/null on new rows.
  user_excalidraw_image_url?: string | null
  // F-3 v2: Excalidraw scene blob (elements + files). Frontend re-renders
  // it in viewMode when the user revisits the attempt. Shape mirrors the
  // result of `excalidrawAPI.getSceneElements()` + `getFiles()`.
  user_excalidraw_scene_json?: {
    elements?: readonly unknown[]
    files?: Record<string, unknown>
  } | null
  ai_score: number | null
  ai_verdict: AttemptVerdict
  ai_water_score: number | null
  ai_feedback_md: string | null
  ai_missing_points: string[]
  ai_judged_at: string | null
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


// MockCompany — wire shape mirrors backend companyDTO
// (services/mock_interview/ports/dto.go). The earlier ad-hoc shape with
// `level`/`tier`/`default_languages` was speculative — backend never
// emitted those fields, which crashed the picker on prod with
// `Cannot read properties of undefined (reading 'slice')`.
export type MockCompany = {
  id: string
  slug: string
  name: string
  difficulty: string
  min_level_required: number
  sections: string[]
  logo_url: string
  description: string
  active: boolean
  sort_order: number
  created_at: string
  updated_at: string
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
      const judging =
        data.stages?.some((s) =>
          s.attempts?.some((a) => a.user_answer_md && a.ai_verdict === 'pending'),
        ) ?? false
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
    // Phase 1.6 — sections is an optional allow-list. Empty / missing
    // → server runs the full 5-stage pipeline; ['hr','algo'] runs only
    // those two in their natural order.
    mutationFn: async (input: { company_id?: string; ai_assist?: boolean; sections?: string[] }) => {
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

// useStartNextStageMutation — POST /mock/pipelines/{id}/start-next-stage.
//
// Backend returns one StageWithAttempts (the just-flipped stage), NOT a
// full Pipeline. Don't try to splice that into the pipeline cache —
// the shapes don't match and the previous version overwrote the cached
// pipeline with a single-stage payload, which made `pipeline.verdict`
// undefined and triggered a navigate to /debrief (the white-screen
// crash users saw right after picking a company).
//
// Cleanest path: invalidate so the pipeline query refetches a fresh
// PipelineFull, which already includes the materialised attempts for
// the new stage.
export function useStartNextStageMutation(pipelineId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      if (!pipelineId) throw new Error('pipeline_id_required')
      return api<unknown>(`/mock/pipelines/${pipelineId}/start-next-stage`, {
        method: 'POST',
        body: '{}',
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: mockPipelineKeys.pipeline(pipelineId) })
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

// F-3 v2 — sysdesign-canvas submit. Posts:
//   - image_data_url: rendered PNG, consumed once by the vision judge and
//     discarded server-side (NOT stored).
//   - scene_json:     Excalidraw scene blob, persisted as jsonb so the
//     post-submit review path re-renders the diagram from source instead
//     of fetching a presigned PNG.
// We invalidate the pipeline query so the polling refetch picks up the
// verdict.
export function useSubmitCanvasMutation(pipelineId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      attemptId,
      imageDataURL,
      sceneJSON,
      contextMD,
      nonFunctionalMD,
    }: {
      attemptId: string
      imageDataURL: string
      sceneJSON: { elements: readonly unknown[]; files: Record<string, unknown> }
      contextMD: string
      nonFunctionalMD: string
    }) =>
      api<unknown>(`/mock/attempts/${attemptId}/submit-canvas`, {
        method: 'POST',
        body: JSON.stringify({
          image_data_url: imageDataURL,
          scene_json: sceneJSON,
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
      // FinishStage may transition the pipeline to a terminal verdict
      // (FinishPipeline runs server-side when all stages are done) →
      // user's atlas progress / weekly report / daily brief all become
      // stale. Invalidate them so the next mount of /atlas, /insights,
      // and /profile sees the fresh state without a manual refresh.
      qc.invalidateQueries({ queryKey: ['profile', 'me', 'atlas'] })
      qc.invalidateQueries({ queryKey: ['profile', 'me', 'report'] })
      qc.invalidateQueries({ queryKey: ['intelligence', 'daily-brief'] })
    },
  })
}

// ── Algo stage «Run tests» (R2) ─────────────────────────────────────────
//
// Dry-run sandboxed execution against the task's test-cases. Does NOT
// persist anything to pipeline_attempts — that flow stays on SubmitAnswer.
// Hidden test cases come back with input/expected/actual blanked but still
// counted in passed/total so the candidate sees the real ratio.

export type AlgoTestResult = {
  ordinal: number
  passed: boolean
  input: string
  expected_output: string
  actual_output: string
  stderr: string
  is_hidden: boolean
  runtime_ms: number
}

export type AlgoVerdict = {
  passed: number
  total: number
  runtime_ms: number
  memory_kb: number
  sandbox_unavailable: boolean
  status: 'ok' | 'compile_error' | 'runtime_error' | 'unavailable' | 'invalid' | string
  tests: AlgoTestResult[]
}

export function useRunAlgoMutation() {
  return useMutation({
    mutationFn: async (input: { attemptId: string; code: string; language: string }) => {
      return api<AlgoVerdict>(`/mock/attempts/${input.attemptId}/run-algo`, {
        method: 'POST',
        body: JSON.stringify({ code: input.code, language: input.language }),
      })
    },
  })
}

// ── Coding stage rubric (R2 closing wave) ───────────────────────────────────
//
// Open-ended code grading via free LLM cascade. Unlike Algo (Judge0 exact
// match), returns a 1..5 rubric score + strengths/weaknesses + suggested line
// numbers. Anti-fallback: `unavailable=true` surfaces visibly in UI instead
// of pretending a score happened.

export type CodingVerdict = {
  score: number
  strengths: string[]
  weaknesses: string[]
  suggested_lines: number[]
  rubric_md: string
  unavailable: boolean
}

export function useRunCodingMutation() {
  return useMutation({
    mutationFn: async (input: { attemptId: string; code: string; language: string }) => {
      return api<CodingVerdict>(`/mock/attempts/${input.attemptId}/run-coding`, {
        method: 'POST',
        body: JSON.stringify({ code: input.code, language: input.language }),
      })
    },
  })
}

// ── SysDesign stage rubric ──────────────────────────────────────────────────
//
// 5-axis text-only rubric (availability / consistency / scalability / cost /
// simplicity). Pairs with the SubmitCanvas vision judge — this UC is the
// cheap iterative knob; vision judge is the final-grade path.

export type SysDesignAxes = {
  availability: number
  consistency: number
  scalability: number
  cost: number
  simplicity: number
}

export type SysDesignVerdict = {
  axes: SysDesignAxes
  narrative_critique: string
  missing_concepts: string[]
  unavailable: boolean
}

export function useRunSysDesignMutation() {
  return useMutation({
    mutationFn: async (input: { attemptId: string; canvasJson: string; narrationText: string }) => {
      return api<SysDesignVerdict>(`/mock/attempts/${input.attemptId}/run-sysdesign`, {
        method: 'POST',
        body: JSON.stringify({
          canvas_json: input.canvasJson,
          narration_text: input.narrationText,
        }),
      })
    },
  })
}

// ── Behavioral stage rubric ─────────────────────────────────────────────────

export type BehavioralAxes = {
  situation: number
  task: number
  action: number
  result: number
}

export type BehavioralVerdict = {
  axes: BehavioralAxes
  communication_score: number
  body_md: string
  unavailable: boolean
}

export function useRunBehavioralMutation() {
  return useMutation({
    mutationFn: async (input: { attemptId: string; answerText: string }) => {
      return api<BehavioralVerdict>(`/mock/attempts/${input.attemptId}/run-behavioral`, {
        method: 'POST',
        body: JSON.stringify({ answer_text: input.answerText }),
      })
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
  ml_coding: 'ML Coding',
  ml_system_design: 'ML System Design',
  ml_theory: 'ML Theory',
}

export function isComingSoonError(err: unknown): boolean {
  return err instanceof Error && err.message === 'mock_pipeline.coming_soon'
}

// ── Mock Replay (Wave 15) ────────────────────────────────────────────────

export type MockReplayAnnotationType = 'missing' | 'incorrect' | 'good'

export interface MockReplayAnnotation {
  your_excerpt: string
  ideal_excerpt: string
  type: MockReplayAnnotationType
  comment: string
}

export interface MockReplay {
  attempt_id: string
  ideal_answer_md: string
  annotations: MockReplayAnnotation[]
  generated_at: string
  question_body: string
  your_answer_md: string
}

/** Sentinel used by the page to distinguish "ready" from "ask to generate". */
export interface MockReplayNotReady {
  status: 'not_ready'
}

const REPLAY_NOT_READY: MockReplayNotReady = { status: 'not_ready' }

function isMockReplay(x: MockReplay | MockReplayNotReady): x is MockReplay {
  return 'attempt_id' in x
}

// apiClient surfaces 202 as a successful response with the typed body —
// so when the backend returns `{status:"not_ready"}` we route that to a
// sentinel instead of swallowing it. Transport-level errors still throw.
async function fetchReplayOrNotReady(
  attemptId: string,
): Promise<MockReplay | MockReplayNotReady> {
  const raw = await api<unknown>(`/mock/attempts/${encodeURIComponent(attemptId)}/replay`)
  if (raw && typeof raw === 'object' && 'status' in raw && (raw as { status: string }).status === 'not_ready') {
    return REPLAY_NOT_READY
  }
  return raw as MockReplay
}

export function useMockReplayQuery(attemptId: string | undefined) {
  return useQuery<MockReplay | MockReplayNotReady, Error>({
    queryKey: ['mock', 'replay', attemptId ?? 'none'],
    queryFn: () => {
      if (!attemptId) throw new Error('attempt_id_required')
      return fetchReplayOrNotReady(attemptId)
    },
    enabled: typeof attemptId === 'string' && attemptId.length > 0,
    staleTime: 5 * 60_000,
  })
}

export function useGenerateMockReplayMutation(attemptId: string | undefined) {
  const qc = useQueryClient()
  return useMutation<MockReplay, Error>({
    mutationFn: async () => {
      if (!attemptId) throw new Error('attempt_id_required')
      return await api<MockReplay>(`/mock/attempts/${encodeURIComponent(attemptId)}/replay/generate`, {
        method: 'POST',
        body: '{}',
      })
    },
    onSuccess: (data) => {
      if (attemptId) {
        qc.setQueryData(['mock', 'replay', attemptId], data)
      }
    },
  })
}

export { isMockReplay }
// Pure marker re-export so the page can `import { isMockReplay }` for
// the discriminated-union check without re-declaring the type guard.
