// honeTasks.ts — react-query hooks для TaskBoard (Phase G FE).
//
// Bridge между UI компонентами (TaskBoardPage / TaskCard / ColumnList)
// и backend HoneService TaskBoard ручками. Wire shape — proto enum NAME
// эмитится через vanguard transcoder; нормализуем через canonical-helpers
// чтобы UI работал с одним canonical-формат строкой ("todo"/"in_progress"/...)
// независимо от того, прислал ли бэк lowercase или TASK_STATUS_TODO.
//
// Все mutations при success делают invalidateQueries — список перезагружается.
// Optimistic updates оставлены как follow-up для DnD-polish (Phase G.2).
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../apiClient'

// ── Canonical types ────────────────────────────────────────────────────

export type TaskStatusCanonical = 'todo' | 'in_progress' | 'in_review' | 'done' | 'dismissed' | 'unspecified'
export type TaskKindCanonical = 'algo' | 'sysdesign' | 'quiz' | 'reflection' | 'reading' | 'ml' | 'custom' | 'unspecified'
export type TaskSourceCanonical = 'ai' | 'user' | 'unspecified'
export type TaskCommentAuthorCanonical = 'ai' | 'user' | 'unspecified'

// Wire-side принимает оба формата (legacy lowercase и proto enum NAME).
// UI всегда работает с canonical через нормализаторы.
export function normalizeTaskStatus(raw: string | undefined | null): TaskStatusCanonical {
  if (!raw) return 'unspecified'
  switch (raw) {
    case 'todo':
    case 'TASK_STATUS_TODO':
      return 'todo'
    case 'in_progress':
    case 'TASK_STATUS_IN_PROGRESS':
      return 'in_progress'
    case 'in_review':
    case 'TASK_STATUS_IN_REVIEW':
      return 'in_review'
    case 'done':
    case 'TASK_STATUS_DONE':
      return 'done'
    case 'dismissed':
    case 'TASK_STATUS_DISMISSED':
      return 'dismissed'
    default:
      return 'unspecified'
  }
}

export function normalizeTaskKind(raw: string | undefined | null): TaskKindCanonical {
  if (!raw) return 'unspecified'
  switch (raw) {
    case 'algo':
    case 'TASK_KIND_ALGO':
      return 'algo'
    case 'sysdesign':
    case 'TASK_KIND_SYSDESIGN':
      return 'sysdesign'
    case 'quiz':
    case 'TASK_KIND_QUIZ':
      return 'quiz'
    case 'reflection':
    case 'TASK_KIND_REFLECTION':
      return 'reflection'
    case 'reading':
    case 'TASK_KIND_READING':
      return 'reading'
    case 'ml':
    case 'TASK_KIND_ML':
      return 'ml'
    case 'custom':
    case 'TASK_KIND_CUSTOM':
      return 'custom'
    default:
      return 'unspecified'
  }
}

export function normalizeTaskSource(raw: string | undefined | null): TaskSourceCanonical {
  if (!raw) return 'unspecified'
  if (raw === 'ai' || raw === 'TASK_SOURCE_AI') return 'ai'
  if (raw === 'user' || raw === 'TASK_SOURCE_USER') return 'user'
  return 'unspecified'
}

export function normalizeCommentAuthor(raw: string | undefined | null): TaskCommentAuthorCanonical {
  if (!raw) return 'unspecified'
  if (raw === 'ai' || raw === 'TASK_COMMENT_AUTHOR_AI') return 'ai'
  if (raw === 'user' || raw === 'TASK_COMMENT_AUTHOR_USER') return 'user'
  return 'unspecified'
}

// Обратная конверсия: caller передаёт canonical, мы шлём proto enum NAME
// (vanguard парсит NAME либо int; lowercase больше не валиден).
export function taskStatusToWire(s: TaskStatusCanonical): string {
  switch (s) {
    case 'todo':
      return 'TASK_STATUS_TODO'
    case 'in_progress':
      return 'TASK_STATUS_IN_PROGRESS'
    case 'in_review':
      return 'TASK_STATUS_IN_REVIEW'
    case 'done':
      return 'TASK_STATUS_DONE'
    case 'dismissed':
      return 'TASK_STATUS_DISMISSED'
    default:
      return 'TASK_STATUS_UNSPECIFIED'
  }
}

export function taskKindToWire(k: TaskKindCanonical): string {
  switch (k) {
    case 'algo':
      return 'TASK_KIND_ALGO'
    case 'sysdesign':
      return 'TASK_KIND_SYSDESIGN'
    case 'quiz':
      return 'TASK_KIND_QUIZ'
    case 'reflection':
      return 'TASK_KIND_REFLECTION'
    case 'reading':
      return 'TASK_KIND_READING'
    case 'ml':
      return 'TASK_KIND_ML'
    case 'custom':
      return 'TASK_KIND_CUSTOM'
    default:
      return 'TASK_KIND_UNSPECIFIED'
  }
}

// ── Wire types (raw response shape) + UI types (normalized) ────────────

type WireTask = {
  id: string
  status: string
  kind: string
  source: string
  title: string
  briefMd?: string
  brief_md?: string
  skillKey?: string
  skill_key?: string
  deepLink?: string
  deep_link?: string
  recommendedReading?: string[]
  recommended_reading?: string[]
  priority: number
  createdAt?: string
  created_at?: string
  updatedAt?: string
  updated_at?: string
  completedAt?: string
  completed_at?: string
}

type WireTaskComment = {
  id: string
  authorKind?: string
  author_kind?: string
  bodyMd?: string
  body_md?: string
  createdAt?: string
  created_at?: string
}

export type Task = {
  id: string
  status: TaskStatusCanonical
  kind: TaskKindCanonical
  source: TaskSourceCanonical
  title: string
  briefMd: string
  skillKey: string
  deepLink: string
  recommendedReading: string[]
  priority: number
  createdAt: string
  updatedAt: string
  completedAt: string
}

export type TaskComment = {
  id: string
  authorKind: TaskCommentAuthorCanonical
  bodyMd: string
  createdAt: string
}

function adaptTask(w: WireTask): Task {
  return {
    id: w.id,
    status: normalizeTaskStatus(w.status),
    kind: normalizeTaskKind(w.kind),
    source: normalizeTaskSource(w.source),
    title: w.title,
    briefMd: w.briefMd ?? w.brief_md ?? '',
    skillKey: w.skillKey ?? w.skill_key ?? '',
    deepLink: w.deepLink ?? w.deep_link ?? '',
    recommendedReading: w.recommendedReading ?? w.recommended_reading ?? [],
    priority: w.priority ?? 0,
    createdAt: w.createdAt ?? w.created_at ?? '',
    updatedAt: w.updatedAt ?? w.updated_at ?? '',
    completedAt: w.completedAt ?? w.completed_at ?? '',
  }
}

function adaptComment(w: WireTaskComment): TaskComment {
  return {
    id: w.id,
    authorKind: normalizeCommentAuthor(w.authorKind ?? w.author_kind),
    bodyMd: w.bodyMd ?? w.body_md ?? '',
    createdAt: w.createdAt ?? w.created_at ?? '',
  }
}

// ── Query keys ──────────────────────────────────────────────────────────

export const honeTaskKeys = {
  all: ['hone', 'tasks'] as const,
  list: () => ['hone', 'tasks', 'list'] as const,
  comments: (taskId: string) => ['hone', 'tasks', taskId, 'comments'] as const,
}

// ── Hooks ───────────────────────────────────────────────────────────────

export function useTaskListQuery() {
  return useQuery({
    queryKey: honeTaskKeys.list(),
    queryFn: async () => {
      const w = await api<{ tasks?: WireTask[] }>('/hone/tasks')
      return (w.tasks ?? []).map(adaptTask)
    },
    staleTime: 30_000,
  })
}

export function useCreateTaskMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      kind: TaskKindCanonical
      title: string
      briefMd?: string
      skillKey?: string
      deepLink?: string
    }) =>
      api<WireTask>('/hone/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: taskKindToWire(input.kind),
          title: input.title,
          briefMd: input.briefMd ?? '',
          skillKey: input.skillKey ?? '',
          deepLink: input.deepLink ?? '',
        }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: honeTaskKeys.list() })
    },
  })
}

export function useMoveTaskStatusMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: TaskStatusCanonical }) =>
      api<WireTask>(`/hone/tasks/${encodeURIComponent(id)}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status: taskStatusToWire(status) }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: honeTaskKeys.list() })
    },
  })
}

export function useDeleteTaskMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      api<{ ok: boolean }>(`/hone/tasks/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: honeTaskKeys.list() })
    },
  })
}

export function useTaskCommentsQuery(taskId: string | undefined) {
  return useQuery({
    queryKey: taskId ? honeTaskKeys.comments(taskId) : ['hone', 'tasks', 'no-id'],
    queryFn: async () => {
      const w = await api<{ comments?: WireTaskComment[] }>(
        `/hone/tasks/${encodeURIComponent(taskId ?? '')}/comments`,
      )
      return (w.comments ?? []).map(adaptComment)
    },
    enabled: !!taskId,
    staleTime: 15_000,
  })
}

export function useAddTaskCommentMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ taskId, bodyMd }: { taskId: string; bodyMd: string }) =>
      api<WireTaskComment>(`/hone/tasks/${encodeURIComponent(taskId)}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: taskId, bodyMd }),
      }),
    onSuccess: (_, vars) => {
      void qc.invalidateQueries({ queryKey: honeTaskKeys.comments(vars.taskId) })
    },
  })
}
