// Mock-interview admin queries — Phase A.2 of ADR-002.
//
// Wraps every endpoint under /api/v1/admin/mock/*. One file because the
// surface is tightly scoped to a single admin feature (companies,
// strictness profiles, tasks + task-questions, default questions, and
// company-overlay questions). Hooks are colocated with their own type
// shapes; panels under src/pages/admin/Mock*.tsx import these.
//
// Cache-key strategy: a single root prefix `['mock-admin', ...]` so any
// mutation can `invalidateQueries({ queryKey: ['mock-admin'] })` on
// catastrophic edits, and finer-grained keys (`['mock-admin', 'tasks',
// filter]`) for normal flows. We keep optimistic updates simple — invalidate
// on success, no rollback ceremony.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../apiClient'

// ── shared shapes ────────────────────────────────────────────────────────

export type StageKind = 'hr' | 'algo' | 'coding' | 'sysdesign' | 'behavioral'
export type TaskLanguage = 'go' | 'python' | 'sql' | 'any'

export type ReferenceCriteria = {
  must_mention?: string[]
  nice_to_have?: string[]
  common_pitfalls?: string[]
}

// ── companies ────────────────────────────────────────────────────────────

export type Company = {
  id: string
  slug: string
  name: string
  description?: string | null
  logo_url?: string | null
  sort_order: number
  active: boolean
  created_at?: string
  updated_at?: string
}

export type CompanyCreateBody = {
  slug: string
  name: string
  description?: string
  logo_url?: string
  sort_order?: number
}

export type CompanyPatchBody = Partial<{
  name: string
  description: string
  logo_url: string
  sort_order: number
  active: boolean
}>

const KEY_COMPANIES = ['mock-admin', 'companies'] as const

type ListResp<T> = { items: T[] } | T[]

function unwrap<T>(r: ListResp<T>): T[] {
  return Array.isArray(r) ? r : r.items
}

export function useCompaniesQuery() {
  return useQuery({
    queryKey: KEY_COMPANIES,
    queryFn: async () => unwrap(await api<ListResp<Company>>('/admin/mock/companies')),
    staleTime: 30_000,
  })
}

export function useCreateCompanyMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: CompanyCreateBody) =>
      api<Company>('/admin/mock/companies', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY_COMPANIES }),
  })
}

export function useUpdateCompanyMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: CompanyPatchBody }) =>
      api<Company>(`/admin/mock/companies/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY_COMPANIES }),
  })
}

export function useToggleCompanyActiveMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      api<Company>(`/admin/mock/companies/${encodeURIComponent(id)}/active`, {
        method: 'POST',
        body: JSON.stringify({ active }),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY_COMPANIES }),
  })
}

// ── strictness profiles ──────────────────────────────────────────────────

export type StrictnessProfile = {
  id: string
  slug: string
  name: string
  off_topic_penalty: number
  must_mention_penalty: number
  hallucination_penalty: number
  bias_toward_fail: boolean
  custom_prompt_template?: string | null
  active?: boolean
  created_at?: string
  updated_at?: string
}

export type StrictnessCreateBody = {
  slug: string
  name: string
  off_topic_penalty: number
  must_mention_penalty: number
  hallucination_penalty: number
  bias_toward_fail: boolean
  custom_prompt_template?: string
}

export type StrictnessPatchBody = Partial<
  Omit<StrictnessCreateBody, 'slug'> & { active: boolean }
>

const KEY_STRICTNESS = ['mock-admin', 'strictness'] as const

export function useStrictnessQuery() {
  return useQuery({
    queryKey: KEY_STRICTNESS,
    queryFn: async () => unwrap(await api<ListResp<StrictnessProfile>>('/admin/mock/strictness')),
    staleTime: 30_000,
  })
}

export function useCreateStrictnessMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: StrictnessCreateBody) =>
      api<StrictnessProfile>('/admin/mock/strictness', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY_STRICTNESS }),
  })
}

export function useUpdateStrictnessMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: StrictnessPatchBody }) =>
      api<StrictnessProfile>(`/admin/mock/strictness/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY_STRICTNESS }),
  })
}

// ── tasks ────────────────────────────────────────────────────────────────

export type TaskQuestion = {
  id: string
  task_id?: string
  body: string
  expected_answer_md?: string | null
  reference_criteria?: ReferenceCriteria | null
  sort_order: number
}

export type MockTask = {
  id: string
  stage_kind: StageKind
  language: TaskLanguage
  difficulty: number
  title: string
  body_md?: string
  sample_io_md?: string | null
  reference_criteria?: ReferenceCriteria | null
  reference_solution_md?: string | null
  functional_requirements_md?: string | null
  time_limit_min?: number | null
  ai_strictness_profile_id?: string | null
  active?: boolean
  questions?: TaskQuestion[]
}

export type TaskCreateBody = {
  stage_kind: StageKind
  language: TaskLanguage
  difficulty: number
  title: string
  body_md?: string
  sample_io_md?: string
  reference_criteria?: ReferenceCriteria
  reference_solution_md?: string
  functional_requirements_md?: string
  time_limit_min?: number
  ai_strictness_profile_id?: string
}

export type TaskPatchBody = Partial<TaskCreateBody & { active: boolean }>

export type TasksFilter = {
  stage?: StageKind
  language?: TaskLanguage
  active?: boolean
}

const KEY_TASKS = ['mock-admin', 'tasks'] as const

export function useTasksQuery(filter: TasksFilter = {}) {
  const qs = new URLSearchParams()
  if (filter.stage) qs.set('stage', filter.stage)
  if (filter.language) qs.set('language', filter.language)
  if (typeof filter.active === 'boolean') qs.set('active', String(filter.active))
  const search = qs.toString()
  return useQuery({
    queryKey: [...KEY_TASKS, filter],
    queryFn: async () =>
      unwrap(await api<ListResp<MockTask>>(`/admin/mock/tasks${search ? `?${search}` : ''}`)),
    staleTime: 30_000,
  })
}

export function useTaskQuery(id: string | null) {
  return useQuery({
    queryKey: ['mock-admin', 'task', id],
    queryFn: () => api<MockTask>(`/admin/mock/tasks/${encodeURIComponent(id!)}`),
    enabled: !!id,
    staleTime: 15_000,
  })
}

export function useCreateTaskMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: TaskCreateBody) =>
      api<MockTask>('/admin/mock/tasks', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY_TASKS }),
  })
}

export function useUpdateTaskMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: TaskPatchBody }) =>
      api<MockTask>(`/admin/mock/tasks/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    onSuccess: (_, { id }) => {
      void qc.invalidateQueries({ queryKey: KEY_TASKS })
      void qc.invalidateQueries({ queryKey: ['mock-admin', 'task', id] })
    },
  })
}

// ── task questions ───────────────────────────────────────────────────────

export type TaskQuestionCreateBody = {
  body: string
  expected_answer_md?: string
  reference_criteria?: ReferenceCriteria
  sort_order?: number
}

export type TaskQuestionPatchBody = Partial<TaskQuestionCreateBody>

export function useCreateTaskQuestionMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ taskId, body }: { taskId: string; body: TaskQuestionCreateBody }) =>
      api<TaskQuestion>(`/admin/mock/tasks/${encodeURIComponent(taskId)}/questions`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: (_, { taskId }) => {
      void qc.invalidateQueries({ queryKey: ['mock-admin', 'task', taskId] })
    },
  })
}

export function useUpdateTaskQuestionMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: TaskQuestionPatchBody; taskId?: string }) =>
      api<TaskQuestion>(`/admin/mock/task-questions/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    onSuccess: (_, { taskId }) => {
      if (taskId) void qc.invalidateQueries({ queryKey: ['mock-admin', 'task', taskId] })
      else void qc.invalidateQueries({ queryKey: ['mock-admin'] })
    },
  })
}

export function useDeleteTaskQuestionMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id }: { id: string; taskId?: string }) =>
      api<void>(`/admin/mock/task-questions/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      }),
    onSuccess: (_, { taskId }) => {
      if (taskId) void qc.invalidateQueries({ queryKey: ['mock-admin', 'task', taskId] })
      else void qc.invalidateQueries({ queryKey: ['mock-admin'] })
    },
  })
}

// ── default questions ────────────────────────────────────────────────────

export type DefaultQuestion = {
  id: string
  stage_kind: StageKind
  body: string
  expected_answer_md?: string | null
  reference_criteria?: ReferenceCriteria | null
  sort_order: number
}

export type DefaultQuestionCreateBody = {
  stage_kind: StageKind
  body: string
  expected_answer_md?: string
  reference_criteria?: ReferenceCriteria
  sort_order?: number
}

export type DefaultQuestionPatchBody = Partial<DefaultQuestionCreateBody>

export function useDefaultQuestionsQuery(stage?: StageKind) {
  return useQuery({
    queryKey: ['mock-admin', 'default-questions', stage ?? 'all'],
    queryFn: async () =>
      unwrap(
        await api<ListResp<DefaultQuestion>>(
          `/admin/mock/default-questions${stage ? `?stage=${stage}` : ''}`,
        ),
      ),
    staleTime: 30_000,
  })
}

export function useCreateDefaultQuestionMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: DefaultQuestionCreateBody) =>
      api<DefaultQuestion>('/admin/mock/default-questions', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['mock-admin', 'default-questions'] }),
  })
}

export function useUpdateDefaultQuestionMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: DefaultQuestionPatchBody }) =>
      api<DefaultQuestion>(`/admin/mock/default-questions/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['mock-admin', 'default-questions'] }),
  })
}

export function useDeleteDefaultQuestionMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      api<void>(`/admin/mock/default-questions/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['mock-admin', 'default-questions'] }),
  })
}

// ── company-specific questions ───────────────────────────────────────────

export type CompanyQuestion = {
  id: string
  company_id: string
  stage_kind: StageKind
  body: string
  expected_answer_md?: string | null
  reference_criteria?: ReferenceCriteria | null
  sort_order: number
}

export type CompanyQuestionCreateBody = {
  stage_kind: StageKind
  body: string
  expected_answer_md?: string
  reference_criteria?: ReferenceCriteria
  sort_order?: number
}

export type CompanyQuestionPatchBody = Partial<CompanyQuestionCreateBody>

export function useCompanyQuestionsQuery(companyId: string | null, stage?: StageKind) {
  return useQuery({
    queryKey: ['mock-admin', 'company-questions', companyId, stage ?? 'all'],
    queryFn: async () =>
      unwrap(
        await api<ListResp<CompanyQuestion>>(
          `/admin/mock/companies/${encodeURIComponent(companyId!)}/questions${stage ? `?stage=${stage}` : ''}`,
        ),
      ),
    enabled: !!companyId,
    staleTime: 30_000,
  })
}

export function useCreateCompanyQuestionMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ companyId, body }: { companyId: string; body: CompanyQuestionCreateBody }) =>
      api<CompanyQuestion>(
        `/admin/mock/companies/${encodeURIComponent(companyId)}/questions`,
        { method: 'POST', body: JSON.stringify(body) },
      ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['mock-admin', 'company-questions'] }),
  })
}

export function useUpdateCompanyQuestionMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: CompanyQuestionPatchBody }) =>
      api<CompanyQuestion>(`/admin/mock/company-questions/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['mock-admin', 'company-questions'] }),
  })
}

export function useDeleteCompanyQuestionMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      api<void>(`/admin/mock/company-questions/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['mock-admin', 'company-questions'] }),
  })
}

// ── company stages config ────────────────────────────────────────────────

export type CompanyStageConfig = {
  stage_kind: StageKind
  ordinal: number
  optional: boolean
  language_pool: TaskLanguage[]
  task_pool_ids: string[]
  ai_strictness_profile_id?: string | null
}

export function useCompanyStagesQuery(companyId: string | null) {
  return useQuery({
    queryKey: ['mock-admin', 'company-stages', companyId],
    queryFn: async () => {
      const r = await api<{ stages?: CompanyStageConfig[] } | CompanyStageConfig[]>(
        `/admin/mock/companies/${encodeURIComponent(companyId!)}/stages`,
      )
      if (Array.isArray(r)) return r
      return r.stages ?? []
    },
    enabled: !!companyId,
    staleTime: 30_000,
  })
}

export function usePutCompanyStagesMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ companyId, stages }: { companyId: string; stages: CompanyStageConfig[] }) =>
      api<{ stages: CompanyStageConfig[] }>(
        `/admin/mock/companies/${encodeURIComponent(companyId)}/stages`,
        { method: 'PUT', body: JSON.stringify({ stages }) },
      ),
    onSuccess: (_, { companyId }) => {
      void qc.invalidateQueries({ queryKey: ['mock-admin', 'company-stages', companyId] })
    },
  })
}

// ── error helper ─────────────────────────────────────────────────────────

export function mockAdminErrorMessage(err: unknown): string {
  const status = (err as { status?: number } | null)?.status
  if (status === 400) return 'Проверь поля — сервер не принял запрос.'
  if (status === 403) return 'Нет доступа. Админских прав не хватает.'
  if (status === 404) return 'Не найдено.'
  if (status && status >= 500) return 'Сервер ответил ошибкой. Попробуй ещё раз.'
  return 'Не удалось выполнить запрос.'
}
