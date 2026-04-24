import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, API_BASE, forceRefresh } from '../apiClient'

export type Attributes = {
  intellect: number
  strength: number
  dexterity: number
  will: number
}

export type Subscription = {
  plan: string
  current_period_end: string
}

export type Profile = {
  id: string
  username: string
  display_name: string
  email?: string
  level: number
  xp: number
  xp_to_next: number
  char_class: string
  title: string
  attributes: Attributes
  global_power_score: number
  career_stage: string
  subscription: Subscription
  tier?: 'free' | 'premium' | 'pro'
  ai_credits: number
  created_at: string
  achievements?: Achievement[]
  avatar_frame?: string
  avatar_url?: string
  // role mirrors users.role; surfaced for UI RBAC gates (e.g. interviewer-
  // only «Создать слот» CTA on /slots). Wire enum is the canonical proto
  // string (USER_ROLE_INTERVIEWER, …) — accept both forms in helpers below.
  role?: string
}

// isInterviewerOrAdmin matches the backend SlotService.CreateSlot guard
// (services/slot/ports/server.go). Use to gate interviewer-only CTAs.
export function isInterviewerOrAdmin(role: string | null | undefined): boolean {
  if (!role) return false
  const norm = role.toUpperCase()
  return norm === 'USER_ROLE_INTERVIEWER' || norm === 'INTERVIEWER'
    || norm === 'USER_ROLE_ADMIN' || norm === 'ADMIN'
}

// PublicProfile matches backend ProfilePublic — strictly the SEO-visible
// subset of Profile. Private fields (email, ai_credits, subscription) are
// intentionally absent.
export type PublicProfile = {
  username: string
  display_name: string
  title: string
  level: number
  char_class: string
  career_stage: string
  global_power_score: number
  ratings?: PublicSectionRating[]
}

export type PublicSectionRating = {
  section: string
  elo: number
  matches_count: number
  percentile: number
  decaying: boolean
}

export type Achievement = {
  key: string
  title: string
  description: string
  earned_at: string
}

export type KataRef = {
  id: string
  title: string
  difficulty: string // 'easy' | 'medium' | 'hard'
  estimated_minutes?: number
}

export type AtlasNode = {
  key: string
  title: string
  section: string
  // Wave-10 (migration 00034): kind ∈ {"hub","keystone","notable","small"}.
  // Older deployments may still emit "center"/"normal"/"ascendant" — frontend
  // maps them via labels.ts adapter for graceful degrade.
  kind: string
  progress: number
  unlocked: boolean
  decaying: boolean
  description: string
  // Wave-2 поля. Бэкенд отдаёт их через расширенный SkillNode-proto;
  // legacy-ответы без них дают undefined → фронт показывает «нет данных».
  solved_count?: number
  total_count?: number
  last_solved_at?: string
  recommended_kata?: KataRef[]

  // ── Wave-10 PoE-passive-tree fields ──
  cluster?: string
  // Designer-pinned canvas coordinates (typically 0..1400 viewBox).
  // pos_set === true means pos_x/pos_y carry meaningful values; otherwise
  // the frontend ring-fallback layout places the node deterministically.
  pos_x?: number
  pos_y?: number
  pos_set?: boolean
  // PoE allocation: there exists a path of mastered nodes from the hub
  // to this node. Frontend dims unreachable branches during planning.
  reachable?: boolean
}

export type AtlasEdge = {
  from: string
  to: string
  // Wave-10: kind ∈ {"prereq","suggested","crosslink"}. Drives stroke
  // grammar (thick-arrow / thin-line / dashed-faded). Empty/undefined
  // from older deployments → frontend treats as "prereq".
  kind?: string
}

export type Atlas = {
  center_node: string
  nodes: AtlasNode[]
  edges: AtlasEdge[]
}

export type SectionBreakdown = {
  section: string
  matches: number
  wins: number
  losses: number
  xp_delta: number
  win_rate_pct: number
}

export type WeekComparison = {
  label: string
  xp: number
  pct: number
}

// Phase A killer-stats типы. Бэк (proto/druz9/v1/profile.proto) расширил
// WeeklyReport под /weekly dashboard rewrite — фронт читает их напрямую,
// без перепаковки в weekly.ts adapter (там и так всё мёртвое legacy).
export type EloPoint = {
  date: string // ISO YYYY-MM-DD
  elo: number
  section: string // совпадает с pb.Section, без префиксов
}

export type PercentileView = {
  in_tier: number // 0..100, целое
  in_friends: number
  in_global: number
}

export type AchievementBrief = {
  code: string
  title: string
  unlocked_at: string // ISO-8601
  tier: string // bronze|silver|gold|...
}

export type WeeklyReport = {
  week_start: string
  week_end: string
  metrics: {
    tasks_solved: number
    matches_won: number
    rating_change: number
    xp_earned: number
    time_minutes: number
  }
  heatmap: number[]
  strengths: string[]
  weaknesses: { atlas_node_key: string; reason: string }[]
  stress_analysis: string
  recommendations: {
    title: string
    action: { kind: string; params?: Record<string, unknown> }
  }[]
  // Поля ниже добавлены вместе с расширением WeeklyReport-proto. Старые
  // ответы (без них) безопасно дают undefined → фронт показывает «нет данных».
  actions_count?: number
  streak_days?: number
  best_streak?: number
  prev_xp_earned?: number
  strong_sections?: SectionBreakdown[]
  weak_sections?: SectionBreakdown[]
  weekly_xp?: WeekComparison[]
  // Phase A killer-stats поля. Опциональны — старый бэк отдаст undefined,
  // фронт безопасно переходит к empty-state.
  hourly_heatmap?: number[] // 168 ячеек, dow*24+hour
  elo_series?: EloPoint[]
  percentiles?: PercentileView
  ai_insight?: string
  achievements_this_week?: AchievementBrief[]
  share_token?: string
}

// Stable cache keys used across the app. Exported so write-paths (settings,
// admin tools) can invalidate without re-stringifying the key by hand.
export const profileQueryKeys = {
  all: ['profile'] as const,
  me: () => ['profile', 'me'] as const,
  meAtlas: () => ['profile', 'me', 'atlas'] as const,
  meReport: () => ['profile', 'me', 'report'] as const,
  public: (username: string) => ['profile', 'public', username.toLowerCase()] as const,
}

// staleTime of 60s mirrors the server-side Redis TTL — the backend cache
// won't refresh more often than that anyway, so re-fetching faster just
// burns network without helping freshness.
const PROFILE_STALE_MS = 60_000
const PROFILE_GC_MS = 5 * 60_000

export function useProfileQuery() {
  return useQuery({
    queryKey: profileQueryKeys.me(),
    queryFn: () => api<Profile>('/profile/me'),
    staleTime: PROFILE_STALE_MS,
    gcTime: PROFILE_GC_MS,
  })
}

// useBecomeInterviewer wraps POST /api/v1/profile/me/become-interviewer.
// Idempotent backend — calling on an already-interviewer is a no-op.
//
// IMPORTANT: the auth middleware reads role from the bearer-token claims
// (see backend/services/auth/ports/middleware.go), not from the DB. After
// promotion the user's existing access token still encodes the OLD role,
// so subsequent role-gated RPCs (e.g. CreateSlot) would 403. We force a
// refresh here so the next access token picks up the fresh role from
// users.role via Refresh.Do → Users.FindByID.
export function useBecomeInterviewer() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const profile = await api<Profile>('/profile/me/become-interviewer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
      // Re-mint the access token with the new role baked into the claims.
      // Failure is non-fatal — the silent-refresh timer will eventually
      // pick it up; the worst-case UX is one stale 403 on first
      // CreateSlot click which the user can retry after ~minutes.
      await forceRefresh()
      return profile
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: profileQueryKeys.me() })
    },
  })
}

// usePublicProfileQuery is the hook for /profile/:username. Pass an empty
// string to disable the query (useful when the route param hasn't resolved
// yet); the request will not fire until a non-empty username is supplied.
export function usePublicProfileQuery(username: string | undefined) {
  const safe = (username ?? '').trim()
  return useQuery({
    queryKey: profileQueryKeys.public(safe),
    queryFn: () => api<PublicProfile>(`/profile/${encodeURIComponent(safe)}`),
    staleTime: PROFILE_STALE_MS,
    gcTime: PROFILE_GC_MS,
    enabled: safe.length > 0,
    retry: (failureCount, err) => {
      // Don't retry on 404 (profile-not-found is a terminal state for that
      // username). Network errors and 5xx still get the default 3 retries.
      const status = (err as { status?: number } | null)?.status
      if (status === 404) return false
      return failureCount < 3
    },
  })
}

export function useAtlasQuery() {
  return useQuery({
    queryKey: profileQueryKeys.meAtlas(),
    queryFn: () => api<Atlas>('/profile/me/atlas'),
    staleTime: PROFILE_STALE_MS,
    gcTime: PROFILE_GC_MS,
  })
}

export function useWeeklyReportQuery() {
  return useQuery({
    queryKey: profileQueryKeys.meReport(),
    queryFn: () => api<WeeklyReport>('/profile/me/report'),
    staleTime: PROFILE_STALE_MS,
    gcTime: PROFILE_GC_MS,
  })
}

// useInvalidateProfile returns a callable that busts every cached profile
// view (own + public). Mutations that change profile shape (settings save,
// avatar update, etc.) should call this on success.
export function useInvalidateProfile() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: profileQueryKeys.all })
}

// ── Phase C: weekly-report public share link ────────────────────────────────
//
// useWeeklyShareQuery — публичная страница /weekly/share/:token. Не требует
// bearer (REST gate пропускает по publicPaths-prefix). Используем сырой
// fetch, а не api(), чтобы случайно не залить access-токен и не дёрнуть
// 401-refresh-loop, если у анонима его нет.
export const weeklyShareQueryKey = (token: string) =>
  ['profile', 'weekly', 'share', token] as const

// fetchWeeklyShare — выделено отдельно от хука для unit-тестов: vitest умеет
// замокать globalThis.fetch и проверить контракт без поднятия react-query.
export async function fetchWeeklyShare(token: string): Promise<WeeklyReport> {
  const res = await fetch(`${API_BASE}/profile/weekly/share/${encodeURIComponent(token)}`, {
    headers: { 'Content-Type': 'application/json' },
  })
  if (res.status === 404) {
    throw Object.assign(new Error('share token not found'), { status: 404 })
  }
  if (!res.ok) {
    throw Object.assign(new Error(`share request failed: ${res.status}`), { status: res.status })
  }
  return (await res.json()) as WeeklyReport
}

export function useWeeklyShareQuery(token: string | undefined) {
  const safe = (token ?? '').trim()
  return useQuery({
    queryKey: weeklyShareQueryKey(safe),
    queryFn: () => fetchWeeklyShare(safe),
    enabled: safe.length > 0,
    staleTime: PROFILE_STALE_MS,
    gcTime: PROFILE_GC_MS,
    retry: (failureCount, err) => {
      const status = (err as { status?: number } | null)?.status
      if (status === 404) return false
      return failureCount < 2
    },
  })
}

// useIssueShareTokenMutation — кнопка «Поделиться» на /weekly. Дёргает
// /profile/me/report?include_share_token=true (через transcoded REST), бэк
// возвращает WeeklyReport со свежим share_token. Возвращаем строку токена
// (или пустую строку, если бэк по какой-то причине не выдал).
export function useIssueShareTokenMutation() {
  return useMutation({
    mutationFn: async (): Promise<string> => {
      const r = await api<WeeklyReport>('/profile/me/report?include_share_token=true')
      return r.share_token ?? ''
    },
  })
}
