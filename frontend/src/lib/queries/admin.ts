// admin.ts — react-query hooks for /admin landing surface.
//
// All endpoints sit behind the role=admin gate on the backend. The hooks
// don't perform their own access check — render-time guards (see
// AdminPage) call useProfileQuery and redirect when role !== 'admin'.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../apiClient'

// ─────────────────────────────────────────────────────────────────────────
// Dashboard
// ─────────────────────────────────────────────────────────────────────────

export type AdminDashboard = {
  users_total: number
  users_active_today: number
  users_active_week: number
  users_active_month: number
  users_banned: number
  matches_today: number
  matches_week: number
  katas_today: number
  katas_week: number
  active_mock_sessions: number
  active_arena_matches: number
  reports_pending: number
  anticheat_signals_24h: number
  generated_at: string
}

// staleTime mirrors the backend Redis TTL (60s) — refetching faster only
// burns network without earning fresher data.
const ADMIN_DASHBOARD_STALE_MS = 60_000
const ADMIN_DASHBOARD_GC_MS = 5 * 60_000

export const adminQueryKeys = {
  all: ['admin'] as const,
  dashboard: () => ['admin', 'dashboard'] as const,
  users: (params: ListUsersParams) =>
    ['admin', 'users', params.query ?? '', params.status ?? '', params.page ?? 1, params.limit ?? 25] as const,
  reports: (status: string) => ['admin', 'reports', status || 'pending'] as const,
}

export function useAdminDashboardQuery() {
  return useQuery({
    queryKey: adminQueryKeys.dashboard(),
    queryFn: () => api<AdminDashboard>('/admin/dashboard'),
    staleTime: ADMIN_DASHBOARD_STALE_MS,
    gcTime: ADMIN_DASHBOARD_GC_MS,
  })
}

// ─────────────────────────────────────────────────────────────────────────
// Users
// ─────────────────────────────────────────────────────────────────────────

export type AdminUserRow = {
  id: string
  username: string
  email: string
  display_name: string
  role: string
  created_at: string
  updated_at: string
  is_banned: boolean
  ban_reason: string
  ban_expires_at?: string | null
}

export type AdminUserList = {
  items: AdminUserRow[]
  total: number
  page: number
}

export type ListUsersParams = {
  query?: string
  status?: '' | 'all' | 'banned' | 'active'
  page?: number
  limit?: number
}

function buildQS(params: ListUsersParams): string {
  const qp = new URLSearchParams()
  if (params.query) qp.set('query', params.query)
  if (params.status) qp.set('status', params.status)
  if (params.page) qp.set('page', String(params.page))
  if (params.limit) qp.set('limit', String(params.limit))
  const s = qp.toString()
  return s ? `?${s}` : ''
}

export function useAdminUsersQuery(params: ListUsersParams) {
  return useQuery({
    queryKey: adminQueryKeys.users(params),
    queryFn: () => api<AdminUserList>(`/admin/users${buildQS(params)}`),
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    placeholderData: (prev) => prev, // keep previous page while typing
  })
}

export type BanUserPayload = {
  user_id: string
  reason: string
  expires_at?: string
}

export function useBanUserMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: BanUserPayload) =>
      api<{ user: AdminUserRow }>(`/admin/users/${encodeURIComponent(input.user_id)}/ban`, {
        method: 'POST',
        body: JSON.stringify({
          user_id: input.user_id,
          reason: input.reason,
          expires_at: input.expires_at,
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adminQueryKeys.all })
    },
  })
}

export function useUnbanUserMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (userID: string) =>
      api<{ user: AdminUserRow }>(`/admin/users/${encodeURIComponent(userID)}/unban`, {
        method: 'POST',
        body: JSON.stringify({ user_id: userID }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adminQueryKeys.all })
    },
  })
}

// ─────────────────────────────────────────────────────────────────────────
// Reports / moderation queue
// ─────────────────────────────────────────────────────────────────────────

export type AdminReport = {
  id: string
  reporter_id: string
  reporter_name: string
  reported_id: string
  reported_name: string
  reason: string
  description: string
  status: string
  created_at: string
}

export type AdminReportList = {
  items: AdminReport[]
  total: number
}

export function useAdminReportsQuery(status: string = '') {
  return useQuery({
    queryKey: adminQueryKeys.reports(status),
    queryFn: () => {
      const qp = status ? `?status=${encodeURIComponent(status)}` : ''
      return api<AdminReportList>(`/admin/reports${qp}`)
    },
    staleTime: 30_000,
    gcTime: 5 * 60_000,
  })
}
