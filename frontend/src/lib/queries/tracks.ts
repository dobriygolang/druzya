// /lib/queries/tracks.ts — typed react-query hooks для curated learning
// tracks (Phase 2e). Backend контракт: services/tracks/ports/server.go.
//
// REST endpoints (vanguard-проброшенные из tracks.proto):
//   GET    /tracks              — публичный каталог
//   GET    /tracks/me           — enrolment-list текущего юзера
//   GET    /tracks/{slug}       — деталь + steps
//   POST   /tracks/{id}/join    — вступить (paused→resume)
//   POST   /tracks/{id}/advance — bump current_step
//   POST   /tracks/{id}/pause   — set paused_at = now
//   POST   /tracks/{id}/leave   — drop enrolment row
//
// Wire-формат: vanguard передаёт proto field names (snake_case) — таблица
// одинаковая с calendar.ts. Timestamps приходят строками RFC3339; пустая
// строка = «не выставлено».

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import i18n from '../i18n'
import { api } from '../apiClient'

export type TrackStepKind =
  | 'TRACK_STEP_KIND_UNSPECIFIED'
  | 'TRACK_STEP_KIND_KATA'
  | 'TRACK_STEP_KIND_ARENA'
  | 'TRACK_STEP_KIND_MOCK'
  | 'TRACK_STEP_KIND_CODEX_READ'
  | 'TRACK_STEP_KIND_FOCUS_BLOCK'

export interface LearningTrack {
  id: string
  slug: string
  name: string
  tagline: string
  description_md: string
  cover_image_url: string
  accent_color: string
  curator_id?: string
  estimated_weeks: number
  difficulty: string
  is_curated: boolean
  is_active: boolean
  tags: string[]
  company_focus: string[]
  created_at?: string
  updated_at?: string
}

export interface TrackStep {
  track_id: string
  step_index: number
  title: string
  description_md: string
  skill_keys: string[]
  required_kind: TrackStepKind
  required_count: number
  recommended_reading: string[]
  estimated_minutes: number
}

export interface LearningTrackEnrolment {
  user_id: string
  track_id: string
  joined_at?: string
  current_step: number
  paused_at?: string
  completed_at?: string
}

export interface LearningTrackProgress {
  enrolment: LearningTrackEnrolment
  track: LearningTrack
  steps_total: number
}

interface ListTracksResponse {
  items: LearningTrack[]
}

interface ListUserTracksResponse {
  items: LearningTrackProgress[]
}

interface GetTrackResponse {
  track: LearningTrack
  steps: TrackStep[]
}

const STALE_MS = 5 * 60_000

export const tracksKeys = {
  all: ['tracks'] as const,
  catalogue: () => ['tracks', 'catalogue'] as const,
  detail: (slug: string) => ['tracks', 'detail', slug] as const,
  user: () => ['tracks', 'user'] as const,
}

// useTracksCatalogue — публичный каталог (только активные треки).
export function useTracksCatalogue() {
  return useQuery({
    queryKey: tracksKeys.catalogue(),
    queryFn: async () => {
      const r = await api<ListTracksResponse>('/tracks')
      return r.items ?? []
    },
    staleTime: STALE_MS,
  })
}

// useTrack — детали по slug (track + ordered steps).
export function useTrack(slug: string | undefined) {
  return useQuery({
    queryKey: tracksKeys.detail(slug ?? ''),
    queryFn: async () => {
      if (!slug) throw new Error('useTrack: empty slug')
      return api<GetTrackResponse>(`/tracks/${encodeURIComponent(slug)}`)
    },
    enabled: Boolean(slug),
    staleTime: STALE_MS,
  })
}

// useUserTracks — мои enrolment'ы. Используется для:
//   1) пометки карточек в каталоге (joined / not joined),
//   2) Hone Today chip с активным треком,
//   3) Track Detail для рендера прогресс-бара.
export function useUserTracks() {
  return useQuery({
    queryKey: tracksKeys.user(),
    queryFn: async () => {
      const r = await api<ListUserTracksResponse>('/tracks/me')
      return r.items ?? []
    },
    staleTime: 60_000,
  })
}

// useJoinTrackMutation — JoinTrack(track_id). На paused-row сервер
// возобновляет (clears paused_at) — фронту не надо различать.
export function useJoinTrackMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (trackId: string) =>
      api<LearningTrackEnrolment>(
        `/tracks/${encodeURIComponent(trackId)}/join`,
        { method: 'POST', body: JSON.stringify({}) },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: tracksKeys.all })
    },
  })
}

// useAdvanceStepMutation — bump current_step (backend капит на len(steps)
// и стампит completed_at когда дошёл до последнего).
export function useAdvanceStepMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (trackId: string) =>
      api<LearningTrackEnrolment>(
        `/tracks/${encodeURIComponent(trackId)}/advance`,
        { method: 'POST', body: JSON.stringify({}) },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: tracksKeys.all })
    },
  })
}

export function usePauseTrackMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (trackId: string) =>
      api<LearningTrackEnrolment>(
        `/tracks/${encodeURIComponent(trackId)}/pause`,
        { method: 'POST', body: JSON.stringify({}) },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: tracksKeys.all })
    },
  })
}

export function useLeaveTrackMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (trackId: string) =>
      api<{ ok: boolean }>(
        `/tracks/${encodeURIComponent(trackId)}/leave`,
        { method: 'POST', body: JSON.stringify({}) },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: tracksKeys.all })
    },
  })
}

// ── selectors ────────────────────────────────────────────────────────────

// findEnrolment — utility для catalogue, чтобы пометить «joined».
export function findEnrolment(
  enrolments: LearningTrackProgress[] | undefined,
  trackId: string,
): LearningTrackProgress | undefined {
  if (!enrolments) return undefined
  return enrolments.find((p) => p.track.id === trackId || p.enrolment.track_id === trackId)
}

// activeEnrolment — первый трек, в котором юзер не на паузе и не закончил.
// Используется Hone Today chip и пиннингом первой карточки в каталоге.
export function activeEnrolment(
  enrolments: LearningTrackProgress[] | undefined,
): LearningTrackProgress | undefined {
  if (!enrolments) return undefined
  return enrolments.find(
    (p) => !p.enrolment.paused_at && !p.enrolment.completed_at,
  )
}

// stepKindLabel — human-readable подпись для UI, локализуется через i18n.
const KIND_KEY: Record<TrackStepKind, string> = {
  TRACK_STEP_KIND_UNSPECIFIED: 'unspecified',
  TRACK_STEP_KIND_KATA: 'kata',
  TRACK_STEP_KIND_ARENA: 'arena',
  TRACK_STEP_KIND_MOCK: 'mock',
  TRACK_STEP_KIND_CODEX_READ: 'codex_read',
  TRACK_STEP_KIND_FOCUS_BLOCK: 'focus_block',
}

export function stepKindLabel(kind: TrackStepKind): string {
  const k = KIND_KEY[kind]
  if (!k) return kind
  return i18n.t(`atlas:tracks.step_kind.${k}`)
}

// difficultyLabel — easy/medium/hard → подпись.
export function difficultyLabel(d: string): string {
  switch (d) {
    case 'easy': return i18n.t('atlas:tracks.difficulty.easy')
    case 'medium': return i18n.t('atlas:tracks.difficulty.medium')
    case 'hard': return i18n.t('atlas:tracks.difficulty.hard')
    default: return d || '—'
  }
}

// progressPct — процент пройденных шагов (0-100). Defensive: vanguard
// JSON-transcoder опускает int32-поля со значением 0, поэтому
// `current_step` / `steps_total` могут прийти undefined → `?? 0` стопит
// NaN-каскад в UI («STEP UNDEFINED/UNDEFINED» + NaN-кругляшки).
export function progressPct(p: LearningTrackProgress | undefined): number {
  const total = p?.steps_total ?? 0
  if (!p || total <= 0) return 0
  const cur = p.enrolment.current_step ?? 0
  const done = Math.min(cur, total)
  return Math.round((done / total) * 100)
}

// ── Phase 3.2 — Custom path generation ────────────────────────────

export interface CustomPathNode {
  id: string
  title: string
  group: string
  hint?: string
}

interface GenerateCustomPathResponse {
  nodes: CustomPathNode[]
}

/** Generate initial atlas from a free-form goal text. Backend → llmchain. */
export function useGenerateCustomPathMutation() {
  return useMutation({
    mutationFn: (goal: string) =>
      api<GenerateCustomPathResponse>('/tracks/custom-path/generate', {
        method: 'POST',
        body: JSON.stringify({ goal }),
      }),
  })
}
