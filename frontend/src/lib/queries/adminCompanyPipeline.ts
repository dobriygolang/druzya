// adminCompanyPipeline — R7 Phase 1 queries for the redesigned admin
// company manager (validate + templates + thin wrappers around the
// existing stages PUT). Lives alongside mockAdmin.ts but keeps the
// pipeline-editor specific hooks isolated так что они переиспользуют
// существующие mutations (reorder/add/remove) поверх PUT-shape.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../apiClient'
import {
  useCompanyStagesQuery,
  usePutCompanyStagesMutation,
  type CompanyStageConfig,
  type StageKind,
} from './mockAdmin'

// ── validation report ────────────────────────────────────────────────────

export type StageValidation = {
  stage_kind: StageKind
  ordinal: number
  task_count: number
  question_count: number
  has_strictness: boolean
  is_task_solve: boolean
  is_question_pool: boolean
  errors: string[]
}

export type ValidationReport = {
  company_id: string
  ok: boolean
  stages: StageValidation[]
}

export function useValidatePipelineQuery(companyId: string | null) {
  return useQuery({
    queryKey: ['mock-admin', 'validate-pipeline', companyId],
    queryFn: () =>
      api<ValidationReport>(
        `/admin/mock/companies/${encodeURIComponent(companyId!)}/validate`,
      ),
    enabled: !!companyId,
    staleTime: 15_000,
  })
}

// ── stage templates ──────────────────────────────────────────────────────

export type StageTemplate = {
  id: string
  slug: string
  name: string
  description: string
  stages_json: Array<{ kind: StageKind; optional?: boolean }>
  usage_count: number
  is_builtin: boolean
}

export function useStageTemplatesQuery() {
  return useQuery({
    queryKey: ['mock-admin', 'stage-templates'],
    queryFn: async () => {
      const r = await api<{ items: StageTemplate[] }>('/admin/mock/stage-templates')
      return r.items
    },
    staleTime: 60_000,
  })
}

export function useApplyTemplateMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ companyId, templateSlug }: { companyId: string; templateSlug: string }) =>
      api<{ company_id: string; template_slug: string; stages: Array<{ kind: StageKind }> }>(
        `/admin/mock/companies/${encodeURIComponent(companyId)}/apply-template`,
        { method: 'POST', body: JSON.stringify({ template_slug: templateSlug }) },
      ),
    onSuccess: (_, { companyId }) => {
      void qc.invalidateQueries({ queryKey: ['mock-admin', 'company-stages', companyId] })
      void qc.invalidateQueries({ queryKey: ['mock-admin', 'validate-pipeline', companyId] })
      void qc.invalidateQueries({ queryKey: ['mock-admin', 'stage-templates'] })
    },
  })
}

// ── pipeline-editor helpers (thin wrappers over PUT stages) ──────────────

// Pipeline editor operates on the full stages array через single PUT —
// the helpers below let DnD callers mutate-then-save without rebuilding
// the full UI. We expose the existing query/mutation for transparency
// и оборачиваем reorder/add/remove чтобы UI код был declarative.

export function useCompanyPipelineQuery(companyId: string | null) {
  // Alias for naming consistency in CompanyManagerPage — uses the same
  // cache key как useCompanyStagesQuery, so it shares fetch results.
  return useCompanyStagesQuery(companyId)
}

type ReorderInput = {
  companyId: string
  fromIdx: number
  toIdx: number
  current: CompanyStageConfig[]
}

export function useReorderStagesMutation() {
  const put = usePutCompanyStagesMutation()
  return {
    mutateAsync: async ({ companyId, fromIdx, toIdx, current }: ReorderInput) => {
      if (
        fromIdx === toIdx ||
        fromIdx < 0 ||
        toIdx < 0 ||
        fromIdx >= current.length ||
        toIdx >= current.length
      ) {
        return current
      }
      const next = [...current]
      const [moved] = next.splice(fromIdx, 1)
      next.splice(toIdx, 0, moved)
      const stages = next.map((s, i) => ({ ...s, ordinal: i }))
      await put.mutateAsync({ companyId, stages })
      return stages
    },
    isPending: put.isPending,
    error: put.error,
  }
}

type AddInput = {
  companyId: string
  current: CompanyStageConfig[]
  stageKind: StageKind
}

export function useAddStageMutation() {
  const put = usePutCompanyStagesMutation()
  return {
    mutateAsync: async ({ companyId, current, stageKind }: AddInput) => {
      const next: CompanyStageConfig[] = [
        ...current,
        {
          stage_kind: stageKind,
          ordinal: current.length,
          optional: false,
          language_pool: [],
          task_pool_ids: [],
          ai_strictness_profile_id: null,
        },
      ]
      const stages = next.map((s, i) => ({ ...s, ordinal: i }))
      await put.mutateAsync({ companyId, stages })
      return stages
    },
    isPending: put.isPending,
    error: put.error,
  }
}

type RemoveInput = {
  companyId: string
  current: CompanyStageConfig[]
  stageKind: StageKind
}

export function useRemoveStageMutation() {
  const put = usePutCompanyStagesMutation()
  return {
    mutateAsync: async ({ companyId, current, stageKind }: RemoveInput) => {
      const stages = current
        .filter((s) => s.stage_kind !== stageKind)
        .map((s, i) => ({ ...s, ordinal: i }))
      await put.mutateAsync({ companyId, stages })
      return stages
    },
    isPending: put.isPending,
    error: put.error,
  }
}

type UpdateStageInput = {
  companyId: string
  current: CompanyStageConfig[]
  stageKind: StageKind
  patch: Partial<CompanyStageConfig>
}

export function useUpdateStageMutation() {
  const put = usePutCompanyStagesMutation()
  return {
    mutateAsync: async ({ companyId, current, stageKind, patch }: UpdateStageInput) => {
      const stages = current
        .map((s, i) =>
          s.stage_kind === stageKind ? { ...s, ...patch, ordinal: i } : { ...s, ordinal: i },
        )
      await put.mutateAsync({ companyId, stages })
      return stages
    },
    isPending: put.isPending,
    error: put.error,
  }
}
