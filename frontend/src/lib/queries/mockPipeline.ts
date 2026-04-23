// mockPipeline — multi-stage mock interview pipeline (Wave-11).
//
// Pipeline = ordered sequence of 5 stages:
//   0. screening    (voice neural, cultural fit + warm-up)
//   1. go_sql       (live coding: Go + SQL)
//   2. algo         (algorithms / DS)
//   3. sys_design   (system design with Excalidraw whiteboard)
//   4. behavioral   (voice neural, STAR stories)
//
// Backend: GET/POST /api/v1/mock/pipelines (NOT yet shipped — endpoints
// gated behind WAVE-12). Until the orchestrator lands, the hooks return
// `{ enabled: false }` so consumers render <EmptyState variant="coming-soon" />
// rather than fake the data. ANTI-FALLBACK rule.
//
// Companies (`/mock/companies`) is a separate read endpoint that the
// company picker uses to populate cards. We try the live wire first; if
// the backend returns an empty array or 404, the picker shows an error
// state with retry — we DO NOT fall back to a hardcoded company list.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../apiClient'

export type StageKind = 'screening' | 'go_sql' | 'algo' | 'sys_design' | 'behavioral'
export type StageStatus = 'pending' | 'in_progress' | 'done' | 'skipped'
export type PipelineStatus = 'in_progress' | 'finished' | 'aborted'

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

export type MockPipelineStage = {
  stage_idx: number
  kind: StageKind
  status: StageStatus
  started_at: string | null
  finished_at: string | null
  score: number | null
  transcript: string | null
  /** Stage-specific session id — arena_match.id, voice_session.id, sysdesign_room.id, etc. */
  session_id: string | null
}

export type MockPipeline = {
  id: string
  user_id: string
  company_id: string
  status: PipelineStatus
  current_stage: number
  started_at: string
  finished_at: string | null
  stages: MockPipelineStage[]
  /**
   * Whether the candidate enabled the AI assistant chat panel during stages.
   * WAVE-12 UX consolidation: previously a separate "AI-allowed Interview"
   * arena card; now a per-pipeline toggle picked at company-selection time.
   * Backend orchestrator may not echo this field yet — frontend mirrors the
   * choice from localStorage `druz9.mock.ai_assist` until then.
   */
  ai_assist?: boolean
}

const PIPELINE_FEATURE_ENABLED = false // flipped on when backend ships

export const mockPipelineKeys = {
  all: ['mockPipeline'] as const,
  companies: ['mockPipeline', 'companies'] as const,
  pipeline: (id: string | undefined) => ['mockPipeline', 'pipeline', id] as const,
}

// useMockCompaniesQuery — public listing for the company picker.
// Returns the live wire result. Empty array surfaces as a query "success"
// but consumers should treat `data?.length === 0` as a UI error state.
export function useMockCompaniesQuery() {
  return useQuery({
    queryKey: mockPipelineKeys.companies,
    queryFn: async () => {
      if (!PIPELINE_FEATURE_ENABLED) {
        // Surface as a structured error so the UI shows coming-soon instead
        // of attempting a real fetch that would 404.
        throw new Error('mock_pipeline.coming_soon')
      }
      const wire = await api<{ items: MockCompany[] }>('/mock/companies')
      return wire.items ?? []
    },
    staleTime: 5 * 60_000,
    retry: false,
  })
}

export function useMockPipelineQuery(id: string | undefined) {
  return useQuery({
    queryKey: mockPipelineKeys.pipeline(id),
    queryFn: async () => {
      if (!PIPELINE_FEATURE_ENABLED) throw new Error('mock_pipeline.coming_soon')
      return api<MockPipeline>(`/mock/pipelines/${id}`)
    },
    enabled: !!id,
    retry: false,
  })
}

export const MOCK_AI_ASSIST_STORAGE_KEY = 'druz9.mock.ai_assist'

export function useCreateMockPipelineMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { company_id: string; ai_assist?: boolean }) => {
      if (!PIPELINE_FEATURE_ENABLED) throw new Error('mock_pipeline.coming_soon')
      return api<MockPipeline>('/mock/pipelines', {
        method: 'POST',
        body: JSON.stringify(input),
      })
    },
    onSuccess: (data, input) => {
      // Backend may not echo ai_assist yet (Wave-12 backend gated). Mirror the
      // user's choice locally so MockPipelinePage can decide whether to render
      // the AI assistant chat panel.
      try {
        if (typeof window !== 'undefined') {
          window.localStorage.setItem(
            `${MOCK_AI_ASSIST_STORAGE_KEY}.${data.id}`,
            input.ai_assist ? '1' : '0',
          )
        }
      } catch {
        /* ignore: localStorage may be unavailable in private mode */
      }
      qc.setQueryData(mockPipelineKeys.pipeline(data.id), {
        ...data,
        ai_assist: data.ai_assist ?? input.ai_assist ?? false,
      })
    },
  })
}

export function useStartStageMutation(pipelineId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (stageIdx: number) => {
      if (!PIPELINE_FEATURE_ENABLED) throw new Error('mock_pipeline.coming_soon')
      return api<{ stage: MockPipelineStage }>(
        `/mock/pipelines/${pipelineId}/stage/${stageIdx}/start`,
        { method: 'POST' },
      )
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: mockPipelineKeys.pipeline(pipelineId) })
    },
  })
}

export function useCompleteStageMutation(pipelineId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { stage_idx: number; score: number; transcript?: string }) => {
      if (!PIPELINE_FEATURE_ENABLED) throw new Error('mock_pipeline.coming_soon')
      return api<{ next_stage: MockPipelineStage | null }>(
        `/mock/pipelines/${pipelineId}/stage/${input.stage_idx}/complete`,
        {
          method: 'POST',
          body: JSON.stringify({ score: input.score, transcript: input.transcript }),
        },
      )
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: mockPipelineKeys.pipeline(pipelineId) })
    },
  })
}

export function useFinishMockPipelineMutation(pipelineId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      if (!PIPELINE_FEATURE_ENABLED) throw new Error('mock_pipeline.coming_soon')
      return api<MockPipeline>(`/mock/pipelines/${pipelineId}/finish`, { method: 'POST' })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: mockPipelineKeys.pipeline(pipelineId) })
    },
  })
}

export const STAGE_ORDER: StageKind[] = ['screening', 'go_sql', 'algo', 'sys_design', 'behavioral']

export const STAGE_LABEL: Record<StageKind, string> = {
  screening: 'Скрининг',
  go_sql: 'Go + SQL',
  algo: 'Алгоритмы',
  sys_design: 'System Design',
  behavioral: 'Behavioral',
}

export function isComingSoonError(err: unknown): boolean {
  return err instanceof Error && err.message === 'mock_pipeline.coming_soon'
}
