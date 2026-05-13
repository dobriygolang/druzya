// REST контракты — see proto/druz9/v1/google_calendar.proto:
//   GET   /api/v1/google_calendar/status                  → ConnectionStatus
//   POST  /api/v1/google_calendar/oauth/start             → {auth_url, state}
//   POST  /api/v1/google_calendar/oauth/callback          → ConnectionStatus
//   POST  /api/v1/google_calendar/disconnect              → {}
//   POST  /api/v1/google_calendar/sync                    → {pulled, pushed}
//   GET   /api/v1/google_calendar/events                  → {items}
//
// Vanguard transcoder отдаёт camelCase в proto-JSON, поэтому wire-types
// поддерживают оба варианта (snake + camel) для устойчивости.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '../apiClient'

export interface ConnectionStatus {
  connected: boolean
  calendar_id: string
  last_synced: string | null
}

interface ConnectionStatusWire {
  connected?: boolean
  calendarId?: string
  calendar_id?: string
  lastSynced?: string | null
  last_synced?: string | null
}

function normalizeStatus(w: ConnectionStatusWire | null | undefined): ConnectionStatus {
  return {
    connected: Boolean(w?.connected),
    calendar_id: w?.calendar_id ?? w?.calendarId ?? '',
    last_synced: w?.last_synced ?? w?.lastSynced ?? null,
  }
}

export interface StartOAuthResponse {
  auth_url: string
  state: string
}

interface StartOAuthWire {
  authUrl?: string
  auth_url?: string
  state?: string
}

export interface GoogleCalendarEvent {
  id: string
  google_event_id: string
  title: string
  start: string
  end: string
  description: string
}

interface CalendarEventWire {
  id?: string
  googleEventId?: string
  google_event_id?: string
  title?: string
  start?: string
  end?: string
  description?: string
}

function normalizeEvent(w: CalendarEventWire): GoogleCalendarEvent {
  return {
    id: w.id ?? '',
    google_event_id: w.google_event_id ?? w.googleEventId ?? '',
    title: w.title ?? '',
    start: w.start ?? '',
    end: w.end ?? '',
    description: w.description ?? '',
  }
}

export interface SyncResult {
  pulled: number
  pushed: number
}

// ── REST helpers ─────────────────────────────────────────────────────────

export async function getConnectionStatus(): Promise<ConnectionStatus> {
  const r = await api<ConnectionStatusWire>('/google_calendar/status')
  return normalizeStatus(r)
}

export async function startOAuth(redirectURI: string): Promise<StartOAuthResponse> {
  const r = await api<StartOAuthWire>('/google_calendar/oauth/start', {
    method: 'POST',
    body: JSON.stringify({ redirect_uri: redirectURI }),
  })
  return {
    auth_url: r.auth_url ?? r.authUrl ?? '',
    state: r.state ?? '',
  }
}

export async function completeOAuth(input: {
  code: string
  state: string
  redirect_uri: string
}): Promise<ConnectionStatus> {
  const r = await api<ConnectionStatusWire>('/google_calendar/oauth/callback', {
    method: 'POST',
    body: JSON.stringify({
      code: input.code,
      state: input.state,
      redirect_uri: input.redirect_uri,
    }),
  })
  return normalizeStatus(r)
}

export async function disconnectGoogleCalendar(): Promise<void> {
  await api<unknown>('/google_calendar/disconnect', {
    method: 'POST',
    body: '{}',
  })
}

export async function syncEvents(): Promise<SyncResult> {
  const r = await api<{ pulled?: number; pushed?: number }>('/google_calendar/sync', {
    method: 'POST',
    body: '{}',
  })
  return { pulled: r.pulled ?? 0, pushed: r.pushed ?? 0 }
}

export async function listEvents(params?: { from?: string; to?: string }): Promise<GoogleCalendarEvent[]> {
  const q = new URLSearchParams()
  if (params?.from) q.set('from', params.from)
  if (params?.to) q.set('to', params.to)
  const suffix = q.toString() ? `?${q.toString()}` : ''
  const r = await api<{ items?: CalendarEventWire[] }>(`/google_calendar/events${suffix}`)
  return (r.items ?? []).map(normalizeEvent)
}

// ── react-query hooks ────────────────────────────────────────────────────

const STATUS_KEY = ['googleCalendar', 'status'] as const
const EVENTS_KEY = ['googleCalendar', 'events'] as const

export function useConnectionStatusQuery() {
  return useQuery({
    queryKey: STATUS_KEY,
    queryFn: getConnectionStatus,
    staleTime: 60_000,
  })
}

export function useStartOAuthMutation() {
  return useMutation({
    mutationFn: (redirectURI: string) => startOAuth(redirectURI),
  })
}

export function useCompleteOAuthMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: completeOAuth,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: STATUS_KEY })
      void qc.invalidateQueries({ queryKey: EVENTS_KEY })
    },
  })
}

export function useDisconnectMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: disconnectGoogleCalendar,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: STATUS_KEY })
      void qc.invalidateQueries({ queryKey: EVENTS_KEY })
    },
  })
}

export function useSyncEventsMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: syncEvents,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: STATUS_KEY })
      void qc.invalidateQueries({ queryKey: EVENTS_KEY })
    },
  })
}

export function useEventsQuery(params?: { from?: string; to?: string }, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: [...EVENTS_KEY, params?.from ?? '', params?.to ?? ''] as const,
    queryFn: () => listEvents(params),
    staleTime: 30_000,
    enabled: opts?.enabled ?? true,
  })
}
