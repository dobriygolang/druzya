// queries/circles.ts — REST-обёртки для circles + events bounded-contexts
// (bible §9 Phase 6.5.3). Backend контракты:
//   POST   /api/v1/circles                      → Circle
//   GET    /api/v1/circles                      → {items: Circle[]}
//   GET    /api/v1/circles/{id}                 → Circle (auto-join)
//   POST   /api/v1/circles/{id}/join            → {ok}
//   POST   /api/v1/circles/{id}/leave           → {ok}
//   DELETE /api/v1/circles/{id}                 → {ok}
//
//   POST   /api/v1/events                       → Event
//   GET    /api/v1/events                       → {items: Event[]}
//   GET    /api/v1/events/{id}                  → Event
//   POST   /api/v1/events/{id}/join             → Event
//   POST   /api/v1/events/{id}/leave            → {ok}
//   DELETE /api/v1/events/{id}                  → {ok}
//
// Web-UI единственное место создания circles/events; Hone только
// показывает + RSVP (bible §17 hard cut).

import { api } from '../apiClient'

export type CircleRole = 'admin' | 'member'

export interface CircleMember {
  user_id: string
  username: string
  role: CircleRole
  joined_at: string
}

export interface Circle {
  id: string
  name: string
  description: string
  owner_id: string
  member_count: number
  created_at: string
  updated_at: string
  members?: CircleMember[]
}

export interface CircleList {
  items: Circle[]
}

export type EventRecurrence = 'none' | 'weekly_friday'

export interface EventParticipant {
  user_id: string
  username: string
  joined_at: string
}

export interface CalendarEvent {
  id: string
  circle_id: string
  circle_name: string
  title: string
  description: string
  starts_at: string
  duration_min: number
  editor_room_id: string
  whiteboard_room_id: string
  recurrence: EventRecurrence
  created_by: string
  created_at: string
  participants?: EventParticipant[]
}

export interface EventList {
  items: CalendarEvent[]
}

// ── Circles ────────────────────────────────────────────────────────────────

export async function listMyCircles(): Promise<Circle[]> {
  const r = await api<CircleList>('/circles')
  return r.items ?? []
}

// DiscoverCircle — wire shape for /circles/discover. Lighter than `Circle`:
// no member array, just an aggregated count (the discover list never
// renders member chips).
export interface DiscoverCircle {
  id: string
  name: string
  description: string
  owner_id: string
  member_count: number
  created_at: string
}

export async function listDiscoverCircles(): Promise<DiscoverCircle[]> {
  const r = await api<{ items: DiscoverCircle[] }>('/circles/discover')
  return r.items ?? []
}

export async function getCircle(id: string): Promise<Circle> {
  return api<Circle>(`/circles/${encodeURIComponent(id)}`)
}

export async function createCircle(input: {
  name: string
  description?: string
}): Promise<Circle> {
  return api<Circle>('/circles', {
    method: 'POST',
    body: JSON.stringify({ name: input.name, description: input.description ?? '' }),
  })
}

export async function joinCircle(id: string): Promise<void> {
  await api<{ ok: boolean }>(`/circles/${encodeURIComponent(id)}/join`, {
    method: 'POST',
    body: '{}',
  })
}

export async function leaveCircle(id: string): Promise<void> {
  await api<{ ok: boolean }>(`/circles/${encodeURIComponent(id)}/leave`, {
    method: 'POST',
    body: '{}',
  })
}

export async function deleteCircle(id: string): Promise<void> {
  await api<{ ok: boolean }>(`/circles/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}

// ── Events ─────────────────────────────────────────────────────────────────

// Wire-shape для events — vanguard transcoder отдаёт proto-JSON в camelCase
// (`circleId`, `startsAt`, `durationMin`, ...), а наш UI везде читает
// snake_case. Без нормализатора `events.filter(e => e.circle_id === ...)`
// фильтрует в пустоту, и календарь выглядит «всегда пустым» даже если
// бэк вернул items. Тот же подход уже применён к slots
// (см. queries/slot.ts normalizeSlot, commit 21b7704).
type EventParticipantWire = {
  user_id?: string
  userId?: string
  username?: string
  joined_at?: string
  joinedAt?: string
}

type CalendarEventWire = {
  id: string
  circle_id?: string
  circleId?: string
  circle_name?: string
  circleName?: string
  title?: string
  description?: string
  starts_at?: string
  startsAt?: string
  duration_min?: number
  durationMin?: number
  editor_room_id?: string
  editorRoomId?: string
  whiteboard_room_id?: string
  whiteboardRoomId?: string
  recurrence?: string
  created_by?: string
  createdBy?: string
  created_at?: string
  createdAt?: string
  participants?: EventParticipantWire[]
}

type EventListWire = { items?: CalendarEventWire[] }

// proto enum → frontend enum. По-умолчанию protojson эмитит ИМЯ enum'а
// (`EVENT_RECURRENCE_WEEKLY_FRIDAY`); если когда-нибудь включат
// UseEnumNumbers / lowercase-aliasing, fallback'ы тоже ловятся.
function normalizeRecurrence(r: string | undefined): EventRecurrence {
  if (!r) return 'none'
  if (r === 'weekly_friday' || r === 'EVENT_RECURRENCE_WEEKLY_FRIDAY') return 'weekly_friday'
  return 'none'
}

function normalizeParticipant(p: EventParticipantWire): EventParticipant {
  return {
    user_id: p.user_id ?? p.userId ?? '',
    username: p.username ?? '',
    joined_at: p.joined_at ?? p.joinedAt ?? '',
  }
}

export function normalizeEvent(w: CalendarEventWire): CalendarEvent {
  return {
    id: w.id,
    circle_id: w.circle_id ?? w.circleId ?? '',
    circle_name: w.circle_name ?? w.circleName ?? '',
    title: w.title ?? '',
    description: w.description ?? '',
    starts_at: w.starts_at ?? w.startsAt ?? '',
    duration_min: w.duration_min ?? w.durationMin ?? 0,
    editor_room_id: w.editor_room_id ?? w.editorRoomId ?? '',
    whiteboard_room_id: w.whiteboard_room_id ?? w.whiteboardRoomId ?? '',
    recurrence: normalizeRecurrence(w.recurrence),
    created_by: w.created_by ?? w.createdBy ?? '',
    created_at: w.created_at ?? w.createdAt ?? '',
    participants: w.participants?.map(normalizeParticipant),
  }
}

export async function listMyEvents(): Promise<CalendarEvent[]> {
  const r = await api<EventListWire>('/events')
  return (r.items ?? []).map(normalizeEvent)
}

export async function getEvent(id: string): Promise<CalendarEvent> {
  const w = await api<CalendarEventWire>(`/events/${encodeURIComponent(id)}`)
  return normalizeEvent(w)
}

export async function createEvent(input: {
  circle_id: string
  title: string
  description?: string
  starts_at: string // RFC 3339
  duration_min: number
  editor_room_id?: string
  whiteboard_room_id?: string
  recurrence?: EventRecurrence
}): Promise<CalendarEvent> {
  const w = await api<CalendarEventWire>('/events', {
    method: 'POST',
    body: JSON.stringify({
      circle_id: input.circle_id,
      title: input.title,
      description: input.description ?? '',
      starts_at: input.starts_at,
      duration_min: input.duration_min,
      editor_room_id: input.editor_room_id ?? '',
      whiteboard_room_id: input.whiteboard_room_id ?? '',
      recurrence: input.recurrence ?? 'none',
    }),
  })
  return normalizeEvent(w)
}

export async function joinEvent(id: string): Promise<CalendarEvent> {
  const w = await api<CalendarEventWire>(`/events/${encodeURIComponent(id)}/join`, {
    method: 'POST',
    body: '{}',
  })
  return normalizeEvent(w)
}

export async function leaveEvent(id: string): Promise<void> {
  await api<{ ok: boolean }>(`/events/${encodeURIComponent(id)}/leave`, {
    method: 'POST',
    body: '{}',
  })
}

export async function deleteEvent(id: string): Promise<void> {
  await api<{ ok: boolean }>(`/events/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}

// Phase-4 ADR-001 Wave 2 — react-query hooks for the profile rewrite
// (CohortCard / CohortsPanel → circles-backed equivalents).
import { useQuery } from '@tanstack/react-query'

export function useMyCirclesQuery() {
  return useQuery({
    queryKey: ['circles', 'my'],
    queryFn: listMyCircles,
    staleTime: 60_000,
  })
}

export function useMyEventsQuery() {
  return useQuery({
    queryKey: ['events', 'my'],
    queryFn: listMyEvents,
    staleTime: 60_000,
  })
}

export function useDiscoverCirclesQuery() {
  return useQuery({
    queryKey: ['circles', 'discover'],
    queryFn: listDiscoverCircles,
    staleTime: 30_000,
  })
}
