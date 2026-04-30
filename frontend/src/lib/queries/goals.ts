// queries/goals.ts — Phase 4.3 frontend wrappers вокруг chi-direct
// REST endpoints для user_goals CRUD:
//
//   GET    /goals
//   POST   /goals
//   POST   /goals/{id}/status
//   DELETE /goals/{id}
//
// Backend: cmd/monolith/services/intelligence/intelligence_goals_http.go.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../apiClient'

export type UserGoalKind = 'job_target' | 'skill_target' | 'track_target'
export type UserGoalStatus = 'active' | 'paused' | 'done' | 'abandoned'

export interface UserGoal {
  id: string
  kind: UserGoalKind
  status: UserGoalStatus
  title: string
  notes_md: string
  deadline?: string // YYYY-MM-DD
  days_to_deadline: number // -1 = no deadline; 0 = today; N = in N days
  track_id?: string
  skill_keys: string[]
  created_at: string
}

interface GoalsListResp {
  items: UserGoal[]
}

export interface CreateGoalPayload {
  kind: UserGoalKind
  title: string
  notes_md?: string
  deadline?: string // YYYY-MM-DD
  track_id?: string
  skill_keys?: string[]
}

const STALE_MS = 60_000

export const goalsKeys = {
  list: () => ['goals'] as const,
}

export function useGoalsQuery() {
  return useQuery({
    queryKey: goalsKeys.list(),
    queryFn: async () => {
      const r = await api<GoalsListResp>('/goals')
      return r.items ?? []
    },
    staleTime: STALE_MS,
  })
}

export function useCreateGoalMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: CreateGoalPayload) =>
      api<UserGoal>('/goals', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: goalsKeys.list() })
    },
  })
}

export function useSetGoalStatusMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: UserGoalStatus }) =>
      api<UserGoal>(`/goals/${encodeURIComponent(id)}/status`, {
        method: 'POST',
        body: JSON.stringify({ status }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: goalsKeys.list() })
    },
  })
}

export function useDeleteGoalMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      api<{ ok: boolean }>(`/goals/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: goalsKeys.list() })
    },
  })
}

// ── selectors ─────────────────────────────────────────────────────────

export const KIND_LABEL: Record<UserGoalKind, string> = {
  job_target: 'Job target',
  skill_target: 'Skill target',
  track_target: 'Track target',
}

export const STATUS_LABEL: Record<UserGoalStatus, string> = {
  active: 'Active',
  paused: 'Paused',
  done: 'Done',
  abandoned: 'Abandoned',
}

// goalSeverity — UI accent. Только для active goals с deadline.
//   ≤3d → critical, ≤7d → warn, иначе → cruise.
//   no deadline / overdue → cruise (overdue = поздно паниковать).
export function goalSeverity(g: UserGoal): 'critical' | 'warn' | 'cruise' {
  if (g.status !== 'active') return 'cruise'
  if (g.days_to_deadline < 0) return 'cruise' // -1 = no deadline OR overdue
  if (g.days_to_deadline <= 3) return 'critical'
  if (g.days_to_deadline <= 7) return 'warn'
  return 'cruise'
}
