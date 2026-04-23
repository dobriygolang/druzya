import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../apiClient'

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
}

export type AtlasEdge = { from: string; to: string }

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
