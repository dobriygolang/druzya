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

// Backend marshals via protojson which emits camelCase keys + stringly-
// encoded int64s (per proto3 JSON spec). Map to our snake_case + number
// shape on read so consumers don't have to think about it.
type wireDashboard = Partial<{
  usersTotal: number | string
  usersActiveToday: number | string
  usersActiveWeek: number | string
  usersActiveMonth: number | string
  usersBanned: number | string
  matchesToday: number | string
  matchesWeek: number | string
  katasToday: number | string
  katasWeek: number | string
  activeMockSessions: number | string
  activeArenaMatches: number | string
  reportsPending: number | string
  anticheatSignals24H: number | string
  anticheatSignals_24h: number | string // proto's _24h field maps to this
  generatedAt: string
}>
function toNum(v: number | string | undefined | null): number {
  if (v == null) return 0
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

export function useAdminDashboardQuery() {
  return useQuery({
    queryKey: adminQueryKeys.dashboard(),
    queryFn: async () => {
      const w = await api<wireDashboard>('/admin/dashboard')
      const d: AdminDashboard = {
        users_total: toNum(w.usersTotal),
        users_active_today: toNum(w.usersActiveToday),
        users_active_week: toNum(w.usersActiveWeek),
        users_active_month: toNum(w.usersActiveMonth),
        users_banned: toNum(w.usersBanned),
        matches_today: toNum(w.matchesToday),
        matches_week: toNum(w.matchesWeek),
        katas_today: toNum(w.katasToday),
        katas_week: toNum(w.katasWeek),
        active_mock_sessions: toNum(w.activeMockSessions),
        active_arena_matches: toNum(w.activeArenaMatches),
        reports_pending: toNum(w.reportsPending),
        anticheat_signals_24h: toNum(w.anticheatSignals24H ?? w.anticheatSignals_24h),
        generated_at: w.generatedAt ?? '',
      }
      return d
    },
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

type wireUserRow = Partial<{
  id: string
  username: string
  email: string
  displayName: string
  role: string
  createdAt: string
  updatedAt: string
  isBanned: boolean
  banReason: string
  banExpiresAt: string | null
}>
type wireUserList = Partial<{
  items: wireUserRow[]
  total: number | string
  page: number | string
}>

export function useAdminUsersQuery(params: ListUsersParams) {
  return useQuery({
    queryKey: adminQueryKeys.users(params),
    queryFn: async () => {
      const w = await api<wireUserList>(`/admin/users${buildQS(params)}`)
      const items: AdminUserRow[] = (w.items ?? []).map((r) => ({
        id: r.id ?? '',
        username: r.username ?? '',
        email: r.email ?? '',
        display_name: r.displayName ?? '',
        role: r.role ?? '',
        created_at: r.createdAt ?? '',
        updated_at: r.updatedAt ?? '',
        is_banned: Boolean(r.isBanned),
        ban_reason: r.banReason ?? '',
        ban_expires_at: r.banExpiresAt ?? null,
      }))
      const out: AdminUserList = { items, total: toNum(w.total), page: toNum(w.page) }
      return out
    },
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

type wireReport = Partial<{
  id: string
  reporterId: string
  reporterName: string
  reportedId: string
  reportedName: string
  reason: string
  description: string
  status: string
  createdAt: string
}>
type wireReportList = Partial<{ items: wireReport[]; total: number | string }>

export function useAdminReportsQuery(status: string = '') {
  return useQuery({
    queryKey: adminQueryKeys.reports(status),
    queryFn: async () => {
      const qp = status ? `?status=${encodeURIComponent(status)}` : ''
      const w = await api<wireReportList>(`/admin/reports${qp}`)
      const items: AdminReport[] = (w.items ?? []).map((r) => ({
        id: r.id ?? '',
        reporter_id: r.reporterId ?? '',
        reporter_name: r.reporterName ?? '',
        reported_id: r.reportedId ?? '',
        reported_name: r.reportedName ?? '',
        reason: r.reason ?? '',
        description: r.description ?? '',
        status: r.status ?? 'pending',
        created_at: r.createdAt ?? '',
      }))
      const out: AdminReportList = { items, total: toNum(w.total) }
      return out
    },
    staleTime: 30_000,
    gcTime: 5 * 60_000,
  })
}
