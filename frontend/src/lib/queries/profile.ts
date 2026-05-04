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
  tier?: 'free' | 'pro' | 'max'
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
  // Phase 3.1 — true когда узел из user_atlas_nodes (создан через
  // classify-flow). Frontend рендерит "your TODO" badge.
  is_user_owned?: boolean
  // Phase 3 — per-user pin/hide overlay (user_atlas_node_prefs).
  // Mutually exclusive по DB CHECK.
  pinned?: boolean
  hidden?: boolean
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
  myInterviewerApp: () => ['profile', 'me', 'interviewer-app'] as const,
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

// InterviewerApplication mirrors profile.proto:InterviewerApplication.
// Wire status — proto enum InterviewerApplicationStatus, эмитится JSON'ом
// как NAME (например INTERVIEWER_APPLICATION_STATUS_PENDING). Legacy
// deploys могут возвращать lowercase ('pending') — нормализатор ниже
// принимает оба формата.
export type InterviewerStatusCanonical = 'not_submitted' | 'pending' | 'approved' | 'rejected' | 'unspecified'

export type InterviewerApplication = {
  id: string
  user_id: string
  motivation: string
  status: InterviewerStatusCanonical | string
  reviewed_by?: string
  reviewed_at?: string
  decision_note: string
  created_at: string
  user_username?: string
  user_display_name?: string
}

// normalizeInterviewerStatus принимает оба формата (legacy lowercase +
// proto enum NAME). Unknown → 'unspecified'.
export function normalizeInterviewerStatus(raw: string | undefined | null): InterviewerStatusCanonical {
  if (!raw) return 'unspecified'
  switch (raw) {
    case 'not_submitted':
    case 'INTERVIEWER_APPLICATION_STATUS_NOT_SUBMITTED':
      return 'not_submitted'
    case 'pending':
    case 'INTERVIEWER_APPLICATION_STATUS_PENDING':
      return 'pending'
    case 'approved':
    case 'INTERVIEWER_APPLICATION_STATUS_APPROVED':
      return 'approved'
    case 'rejected':
    case 'INTERVIEWER_APPLICATION_STATUS_REJECTED':
      return 'rejected'
    default:
      return 'unspecified'
  }
}

// interviewerStatusToProtoName — caller передаёт canonical, мы шлём proto
// enum NAME (vanguard transcoder парсит NAME либо int; lowercase больше
// не валиден после Phase enum-migration).
function interviewerStatusToProtoName(s: 'pending' | 'approved' | 'rejected'): string {
  switch (s) {
    case 'approved':
      return 'INTERVIEWER_APPLICATION_STATUS_APPROVED'
    case 'rejected':
      return 'INTERVIEWER_APPLICATION_STATUS_REJECTED'
    default:
      return 'INTERVIEWER_APPLICATION_STATUS_PENDING'
  }
}

// Admin-side hooks (gated server-side).
export function useAdminInterviewerApplicationsQuery(status: 'pending' | 'approved' | 'rejected' = 'pending') {
  return useQuery({
    queryKey: ['profile', 'admin', 'interviewer-apps', status],
    queryFn: async () => {
      const wire = await api<{ items: InterviewerApplication[] }>(`/admin/interviewer-applications?status=${interviewerStatusToProtoName(status)}`)
      return wire.items ?? []
    },
  })
}

export function useApproveInterviewerApplication() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, note }: { id: string; note?: string }) =>
      api<InterviewerApplication>(`/admin/interviewer-applications/${encodeURIComponent(id)}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: note ?? '' }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['profile', 'admin', 'interviewer-apps'] })
      // Force-refresh in case the approving admin promoted themselves —
      // the JWT-claim role would otherwise stay stale.
      void forceRefresh()
    },
  })
}

export function useRejectInterviewerApplication() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, note }: { id: string; note?: string }) =>
      api<InterviewerApplication>(`/admin/interviewer-applications/${encodeURIComponent(id)}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: note ?? '' }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['profile', 'admin', 'interviewer-apps'] })
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

// normalizeAtlas — vanguard transcoder отдаёт proto-JSON в camelCase
// (recommendedKata / solvedCount / totalCount / lastSolvedAt / posX / posY /
// posSet / centerNode), а компоненты атласа читают snake_case. Без этой
// нормализации drawer выдаёт «каталог не размечен» для каждой ноды,
// потому что `node.recommended_kata` вечно undefined. Фикс симметричен
// тому, что мы делаем для slots/dashboard: терпим обе формы на чтении.
function normalizeAtlas(raw: unknown): Atlas {
  const r = (raw ?? {}) as Record<string, unknown>
  const rawNodes = (r.nodes as unknown[]) ?? []
  const rawEdges = (r.edges as unknown[]) ?? []
  const pickKata = (k: unknown): KataRef => {
    const x = (k ?? {}) as Record<string, unknown>
    return {
      id: String(x.id ?? ''),
      title: String(x.title ?? ''),
      difficulty: String(x.difficulty ?? ''),
      estimated_minutes:
        (x.estimated_minutes as number | undefined) ??
        (x.estimatedMinutes as number | undefined),
    }
  }
  const nodes: AtlasNode[] = rawNodes.map((n) => {
    const x = (n ?? {}) as Record<string, unknown>
    const kataRaw =
      (x.recommended_kata as unknown[] | undefined) ??
      (x.recommendedKata as unknown[] | undefined) ??
      []
    return {
      key: String(x.key ?? ''),
      title: String(x.title ?? ''),
      section: String(x.section ?? ''),
      kind: String(x.kind ?? ''),
      progress: Number(x.progress ?? 0),
      unlocked: Boolean(x.unlocked),
      decaying: Boolean(x.decaying),
      description: String(x.description ?? ''),
      solved_count:
        (x.solved_count as number | undefined) ??
        (x.solvedCount as number | undefined),
      total_count:
        (x.total_count as number | undefined) ??
        (x.totalCount as number | undefined),
      last_solved_at:
        (x.last_solved_at as string | undefined) ??
        (x.lastSolvedAt as string | undefined),
      recommended_kata: kataRaw.map(pickKata),
      cluster: (x.cluster as string | undefined) ?? undefined,
      pos_x: (x.pos_x as number | undefined) ?? (x.posX as number | undefined),
      pos_y: (x.pos_y as number | undefined) ?? (x.posY as number | undefined),
      pos_set:
        (x.pos_set as boolean | undefined) ??
        (x.posSet as boolean | undefined),
      reachable: x.reachable as boolean | undefined,
      is_user_owned:
        (x.is_user_owned as boolean | undefined) ??
        (x.isUserOwned as boolean | undefined),
      pinned: x.pinned as boolean | undefined,
      hidden: x.hidden as boolean | undefined,
    }
  })
  const edges: AtlasEdge[] = rawEdges.map((e) => {
    const x = (e ?? {}) as Record<string, unknown>
    return {
      from: String(x.from ?? ''),
      to: String(x.to ?? ''),
      kind: (x.kind as string | undefined) ?? undefined,
    }
  })
  return {
    center_node:
      (r.center_node as string | undefined) ??
      (r.centerNode as string | undefined) ??
      '',
    nodes,
    edges,
  }
}

export function useAtlasQuery() {
  return useQuery({
    queryKey: profileQueryKeys.meAtlas(),
    queryFn: async () => normalizeAtlas(await api<unknown>('/profile/me/atlas')),
    staleTime: PROFILE_STALE_MS,
    gcTime: PROFILE_GC_MS,
  })
}

// ── Phase 3.1: classify free-form TODO into atlas node ──────────────────

export interface UserAtlasNode {
  node_key: string
  title: string
  description: string
  section: string
  kind: string
  cluster: string
  source_text: string
  created_at: string
}

export interface ClassifyAtlasTodoResponse {
  matched_key?: string
  new_node?: UserAtlasNode
}

/** Classify a free-form TODO («изучить транзакции в Postgres») into either
 *  an existing curated atlas node (matched_key) or a freshly persisted
 *  user_atlas_nodes row (new_node). Backend → llmchain (TaskAtlasClassify).
 *  On success invalidates the atlas cache so the new node appears. */
export function useClassifyAtlasTodoMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (todo: string) =>
      api<ClassifyAtlasTodoResponse>('/profile/me/atlas/todo', {
        method: 'POST',
        body: JSON.stringify({ todo }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: profileQueryKeys.meAtlas() })
    },
  })
}

// ── Phase 3 — pin/hide overlay (user_atlas_node_prefs, мig 00064) ──────

export function useSetAtlasNodePrefMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (args: { nodeKey: string; pinned: boolean; hidden: boolean }) =>
      api<{ ok: boolean }>('/profile/me/atlas/pref', {
        method: 'POST',
        body: JSON.stringify({
          node_key: args.nodeKey,
          pinned: args.pinned,
          hidden: args.hidden,
        }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: profileQueryKeys.meAtlas() })
    },
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
