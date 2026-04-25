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

export async function listMyEvents(): Promise<CalendarEvent[]> {
  const r = await api<EventList>('/events')
  return r.items ?? []
}

export async function getEvent(id: string): Promise<CalendarEvent> {
  return api<CalendarEvent>(`/events/${encodeURIComponent(id)}`)
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
  return api<CalendarEvent>('/events', {
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
}

export async function joinEvent(id: string): Promise<CalendarEvent> {
  return api<CalendarEvent>(`/events/${encodeURIComponent(id)}/join`, {
    method: 'POST',
    body: '{}',
  })
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
