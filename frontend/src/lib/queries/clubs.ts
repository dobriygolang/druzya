// queries/clubs.ts — Phase 3 Clubs MVP.
//
// REST endpoints (chi-direct, services/clubs/):
//
//   GET  /clubs                          — public catalogue
//   GET  /clubs/{slug}                   — club detail (sessions split)
//   GET  /clubs/sessions/{id}            — session detail (materials)
//   POST /clubs/sessions/{id}/rsvp       — RSVP (auth)
//
// Curator CRUD — отдельной фазой; здесь read + RSVP, минимум для shipping.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../apiClient'

export type SessionStatus = 'scheduled' | 'live' | 'done' | 'cancelled'
export type AttendeeStatus = 'rsvp_yes' | 'rsvp_no' | 'attended' | 'no_show'

export interface Club {
  id: string
  circle_id: string
  slug: string
  name: string
  topic_tag: string
  curator_id?: string
  curriculum_md: string
  schedule_kind: string
  default_zoom_link: string
  tg_anchor_url: string
  cover_image_url: string
  is_public: boolean
  created_at: string
}

export interface ClubSession {
  id: string
  club_id: string
  scheduled_at: string
  duration_min: number
  topic_title: string
  topic_md: string
  presenter_handle: string
  zoom_link: string
  tg_post_url: string
  recording_url: string
  pre_read_md: string
  summary_md: string
  takeaways_md: string
  status: SessionStatus
  attached_codex_slugs: string[]
  attached_event_ids: string[]
}

export interface ClubMaterial {
  id: string
  kind: string
  label: string
  url: string
  sort_order: number
}

interface ListResp {
  items: Club[]
}

interface DetailResp {
  club: Club
  upcoming: ClubSession[]
  past: ClubSession[]
}

interface SessionDetailResp {
  session: ClubSession
  materials: ClubMaterial[]
  attendee_status?: AttendeeStatus
}

const STALE_MS = 60_000

export const clubsKeys = {
  all: ['clubs'] as const,
  list: () => ['clubs', 'list'] as const,
  detail: (slug: string) => ['clubs', 'detail', slug] as const,
  session: (id: string) => ['clubs', 'session', id] as const,
}

export function useClubsListQuery() {
  return useQuery({
    queryKey: clubsKeys.list(),
    queryFn: async () => {
      const r = await api<ListResp>('/clubs')
      return r.items ?? []
    },
    staleTime: STALE_MS,
  })
}

export function useClubQuery(slug: string | undefined) {
  return useQuery({
    queryKey: clubsKeys.detail(slug ?? ''),
    queryFn: () => api<DetailResp>(`/clubs/${encodeURIComponent(slug ?? '')}`),
    enabled: Boolean(slug),
    staleTime: STALE_MS,
  })
}

export function useClubSessionQuery(id: string | undefined) {
  return useQuery({
    queryKey: clubsKeys.session(id ?? ''),
    queryFn: () => api<SessionDetailResp>(`/clubs/sessions/${encodeURIComponent(id ?? '')}`),
    enabled: Boolean(id),
    staleTime: STALE_MS,
  })
}

export function useRSVPMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ sessionId, status }: { sessionId: string; status: AttendeeStatus }) =>
      api<{ session_id: string; user_id: string; status: AttendeeStatus; rsvp_at: string }>(
        `/clubs/sessions/${encodeURIComponent(sessionId)}/rsvp`,
        { method: 'POST', body: JSON.stringify({ status }) },
      ),
    onSuccess: (_, vars) => {
      void qc.invalidateQueries({ queryKey: clubsKeys.session(vars.sessionId) })
    },
  })
}

// ── Curator-only mutations (admin role required server-side) ──

export interface CreateClubBody {
  circle_id: string
  slug: string
  name: string
  topic_tag?: string
  curator_id?: string
  curriculum_md?: string
  schedule_kind?: string
  default_zoom_link?: string
  tg_anchor_url?: string
  cover_image_url?: string
  is_public?: boolean
}

export interface CreateSessionBody {
  scheduled_at: string
  duration_min?: number
  topic_title: string
  topic_md?: string
  presenter_handle?: string
  zoom_link?: string
  tg_post_url?: string
  pre_read_md?: string
  attached_codex_slugs?: string[]
}

export function useCreateClubMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: CreateClubBody) =>
      api<Club>('/admin/clubs', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: clubsKeys.list() })
    },
  })
}

export function useCreateSessionMutation(slug: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: CreateSessionBody) =>
      api<ClubSession>(
        `/admin/clubs/${encodeURIComponent(slug ?? '')}/sessions`,
        { method: 'POST', body: JSON.stringify(body) },
      ),
    onSuccess: () => {
      if (slug) void qc.invalidateQueries({ queryKey: clubsKeys.detail(slug) })
    },
  })
}

// ── Hone Today chip ──

export interface UpcomingForMe {
  session_id: string
  club_id: string
  club_slug: string
  club_name: string
  scheduled_at: string
  topic_title: string
  zoom_link: string
  hours_from_now: number
}

export function useUpcomingClubSession() {
  return useQuery({
    queryKey: ['clubs', 'upcoming-for-me'],
    queryFn: async () => {
      const r = await api<{ session: UpcomingForMe | null }>('/clubs/upcoming-for-me')
      return r.session
    },
    staleTime: 5 * 60_000,
  })
}

// ── selectors ─────────────────────────────────────────────────────────

export function statusLabel(s: SessionStatus): string {
  switch (s) {
    case 'scheduled': return 'Запланирована'
    case 'live': return 'Идёт'
    case 'done': return 'Прошла'
    case 'cancelled': return 'Отменена'
    default: return s
  }
}

// daysFromNow — целое число дней до scheduled_at (today=0, tomorrow=1, -1=yesterday).
export function daysFromNow(iso: string, now: Date = new Date()): number {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 0
  const startUTC = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  const nowUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  return Math.round((startUTC - nowUTC) / 86_400_000)
}

export function relativeDay(iso: string): string {
  const days = daysFromNow(iso)
  if (days === 0) return 'Сегодня'
  if (days === 1) return 'Завтра'
  if (days === -1) return 'Вчера'
  if (days > 0 && days <= 7) return `через ${days} дн.`
  if (days < 0 && days >= -7) return `${-days} дн. назад`
  const d = new Date(iso)
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
}
