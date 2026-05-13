import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../apiClient'

// ── Wire types ────────────────────────────────────────────────────────

export type TutorInviteStatus =
  | 'INVITE_STATUS_UNSPECIFIED'
  | 'INVITE_STATUS_ACTIVE'
  | 'INVITE_STATUS_ACCEPTED'
  | 'INVITE_STATUS_REVOKED'
  | 'INVITE_STATUS_EXPIRED'

export type TutorInvite = {
  id: string
  tutor_id: string
  code: string
  note?: string
  created_at?: string // RFC3339
  expires_at?: string
  accepted_at?: string
  accepted_by?: string
  revoked_at?: string
  status: TutorInviteStatus
}

export type TutorRelationship = {
  id: string
  tutor_id: string
  student_id: string
  invite_id?: string
  started_at?: string
  ended_at?: string
  note?: string
}

export type TutorPeekInviteResponse = {
  invite: TutorInvite
  tutor_display: string // empty when wirer didn't plug in display lookup
}

// ── Public hook (no bearer required) ──────────────────────────────────

/** PeekInvite — read invite metadata by code. Used by /invite/{code}. */
export function usePeekInviteQuery(code: string | undefined) {
  return useQuery({
    queryKey: ['tutor', 'invite', 'peek', code] as const,
    queryFn: () => api<TutorPeekInviteResponse>(`/tutor/invites/peek/${encodeURIComponent(code!)}`),
    enabled: Boolean(code),
    retry: false,
    staleTime: 60_000,
  })
}

// ── Authenticated hooks ───────────────────────────────────────────────

export function useAcceptInviteMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (code: string) =>
      api<TutorRelationship>('/tutor/invites/accept', {
        method: 'POST',
        body: JSON.stringify({ code }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['profile', 'me'] })
      qc.invalidateQueries({ queryKey: ['tutor'] })
    },
  })
}


// Snapshot wire shape — proto3 timestamps come through as RFC3339 strings
// via the vanguard transcoder. Empty `last_active_at` means «no activity
// in the window» — render as «—».
export type TutorWeakSpot = {
  node_key: string
  title: string
  progress: number
}

export type TutorStudentSnapshot = {
  student_id: string
  window_days: number
  last_active_at?: string
  focus_minutes_window: number
  focus_sessions_count: number
  english_mocks_count: number
  english_mocks_avg_score: number
  english_mocks_last_score: number
  weak_spots: TutorWeakSpot[]
  notes_count: number
  reading_sessions_count: number
  reading_minutes_window: number
  reading_materials_total: number
  writing_grades_count: number
  listening_materials_total: number
  vocab_queue_total: number
  vocab_due_today: number
}

export type TutorPreSessionBrief = {
  snapshot: TutorStudentSnapshot
  brief: string // markdown; empty when LLMChain unavailable
}

/** ListInvites — tutor's own invites, recent first. limit caps the
 *  result; the wire endpoint also supports keyset cursor for the next
 *  page (UI infinite-scroll deferred to a UX pass). */
export function useTutorInvitesQuery(limit = 200) {
  return useQuery({
    queryKey: ['tutor', 'invites', limit] as const,
    queryFn: () =>
      api<{ items: TutorInvite[]; next_cursor?: string }>(
        `/tutor/invites?limit=${limit}`,
      ),
    staleTime: 30_000,
  })
}

/** Pending invite адресованный текущему юзеру (target_user_id == me). */
export type TutorPendingInvite = {
  id: string
  code: string
  note: string
  created_at?: string
  expires_at?: string
  tutor_id: string
  tutor_username?: string
  tutor_display_name?: string
  tutor_display_avatar?: string
}

export function usePendingInvitesForMeQuery() {
  return useQuery({
    queryKey: ['tutor', 'invites', 'pending-for-me'] as const,
    queryFn: () =>
      api<{ items: TutorPendingInvite[] }>('/tutor/invites/pending-for-me'),
    staleTime: 30_000,
  })
}

/** Tutor pre-binds invite к @username. Студент видит его в pending-for-me. */
export function useInviteByUsernameMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { username: string; note?: string }) =>
      api<TutorInvite>('/tutor/invites/by-username', {
        method: 'POST',
        body: JSON.stringify(vars),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tutor', 'invites'] })
    },
  })
}

/** CreateInvite — tutor mints a new code. Optional `note` is for the tutor's own bookkeeping. */
export function useCreateInviteMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (note: string) =>
      api<TutorInvite>('/tutor/invites', {
        method: 'POST',
        body: JSON.stringify({ note }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tutor', 'invites'] })
    },
  })
}

/** RevokeInvite — tutor cancels an unused code. The row is soft-revoked. */
export function useRevokeInviteMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (inviteId: string) =>
      api<TutorInvite>(`/tutor/invites/${encodeURIComponent(inviteId)}/revoke`, {
        method: 'POST',
        body: JSON.stringify({ invite_id: inviteId }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tutor', 'invites'] })
    },
  })
}

/** ListStudents — tutor's active relationships. */
// useMyTutorsQuery — student-side endpoint. Возвращает all active
// tutor↔student relationships где caller = student. Включает human-туторов
// и AI (у AI tutor_id = ai_user_id персоны). Для отображения display_name
// нужен отдельный lookup; для текущего UI показываем tutor_id и opaque.
export type TutorRelationshipWithDisplay = {
  id: string
  tutor_id: string
  student_id: string
  started_at?: string
  display_username?: string
  display_name?: string
  display_avatar_url?: string
}

export function useMyTutorsQuery() {
  return useQuery({
    queryKey: ['tutor', 'my-tutors'] as const,
    queryFn: () =>
      api<{ items: TutorRelationshipWithDisplay[] }>('/tutor/my-tutors'),
    staleTime: 30_000,
  })
}

export function useTutorStudentsQuery() {
  return useQuery({
    queryKey: ['tutor', 'students'] as const,
    queryFn: () => api<{ items: TutorRelationship[] }>('/tutor/students'),
    staleTime: 30_000,
  })
}

/** EndRelationship — tutor soft-ends a relationship. The student keeps their data. */
export function useEndRelationshipMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (studentId: string) =>
      api<Record<string, never>>(`/tutor/students/${encodeURIComponent(studentId)}/end`, {
        method: 'POST',
        body: JSON.stringify({ student_id: studentId }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tutor'] })
    },
  })
}

/** GetStudentSnapshot — aggregated 7-day view (server-default). */
export function useStudentSnapshotQuery(studentId: string | undefined, windowDays = 7) {
  return useQuery({
    queryKey: ['tutor', 'students', studentId, 'snapshot', windowDays] as const,
    queryFn: () =>
      api<TutorStudentSnapshot>(
        `/tutor/students/${encodeURIComponent(studentId!)}/snapshot?window_days=${windowDays}`,
      ),
    enabled: Boolean(studentId),
    staleTime: 60_000,
  })
}

/** GeneratePreSessionBrief — markdown narrative + snapshot. LLM-backed; when
 *  the chain is unavailable the `brief` field is empty and the snapshot is
 *  still returned. */
export function useStudentBriefQuery(studentId: string | undefined, windowDays = 7) {
  return useQuery({
    queryKey: ['tutor', 'students', studentId, 'brief', windowDays] as const,
    queryFn: () =>
      api<TutorPreSessionBrief>(
        `/tutor/students/${encodeURIComponent(studentId!)}/brief?window_days=${windowDays}`,
      ),
    enabled: Boolean(studentId),
    staleTime: 60_000,
    // The brief is expensive (LLM round-trip). Don't refetch on focus —
    // the tutor explicitly clicks the «Refresh» button when they need a
    // fresh take.
    refetchOnWindowFocus: false,
  })
}


// All timestamps come from the vanguard transcoder as RFC3339 strings.
// Empty fields (= zero proto Timestamp) come back as undefined.
export type TutorAssignment = {
  id: string
  tutor_id: string
  student_id: string
  title: string
  body_md: string
  due_at?: string
  created_at?: string
  completed_at?: string
  archived_at?: string
}

/** Tutor-side: full backlog for one student (active + completed + archived).
 *  Wire endpoint supports keyset cursor pagination — UI infinite-scroll
 *  deferred to a UX pass; default limit=200 covers typical backlogs. */
export function useTutorAssignmentsQuery(studentId: string | undefined, limit = 200) {
  return useQuery({
    queryKey: ['tutor', 'students', studentId, 'assignments', limit] as const,
    queryFn: () =>
      api<{ items: TutorAssignment[]; next_cursor?: string }>(
        `/tutor/students/${encodeURIComponent(studentId!)}/assignments?limit=${limit}`,
      ),
    enabled: Boolean(studentId),
    staleTime: 30_000,
  })
}

/** Tutor pushes a new assignment to a student. */
export function usePushAssignmentMutation(studentId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { title: string; body_md: string; due_at?: string }) =>
      api<TutorAssignment>(`/tutor/students/${encodeURIComponent(studentId)}/assignments`, {
        method: 'POST',
        body: JSON.stringify({
          student_id: studentId,
          title: vars.title,
          body_md: vars.body_md,
          // Empty due_at omitted so the backend doesn't see a zero-Timestamp
          // and treat it as «set» — proto3 has no nullable scalars.
          ...(vars.due_at ? { due_at: vars.due_at } : {}),
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tutor', 'students', studentId, 'assignments'] })
    },
  })
}

/** Tutor archives a stale assignment (soft-delete; keeps the audit row). */
export function useArchiveAssignmentMutation(studentId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (assignmentId: string) =>
      api<Record<string, never>>(
        `/tutor/assignments/${encodeURIComponent(assignmentId)}/archive`,
        {
          method: 'POST',
          body: JSON.stringify({ assignment_id: assignmentId }),
        },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tutor', 'students', studentId, 'assignments'] })
    },
  })
}

/** Student-side: pending feed (active, not completed, not archived).
 *  Wire endpoint supports cursor pagination; UI infinite-scroll deferred. */
export function usePendingAssignmentsQuery(limit = 100) {
  return useQuery({
    queryKey: ['tutor', 'assignments', 'pending', limit] as const,
    queryFn: () =>
      api<{ items: TutorAssignment[]; next_cursor?: string }>(
        `/tutor/assignments/pending?limit=${limit}`,
      ),
    staleTime: 30_000,
  })
}

/** Student marks an assignment complete. Idempotent on the server (returns
 *  FailedPrecondition for already-completed); we surface that as a no-op
 *  — the UI will refetch and show the ✓. */
export function useCompleteAssignmentMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (assignmentId: string) =>
      api<Record<string, never>>(
        `/tutor/assignments/${encodeURIComponent(assignmentId)}/complete`,
        {
          method: 'POST',
          body: JSON.stringify({ assignment_id: assignmentId }),
        },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tutor', 'assignments', 'pending'] })
    },
  })
}


export type TutorBroadcastFailure = {
  student_id: string
  error: string
}

export type TutorBroadcastResult = {
  pushed: TutorAssignment[]
  failed: TutorBroadcastFailure[]
}

/** Tutor sends one assignment to every active student. Partial-failure
 *  semantics: the response always lands; per-student errors are in `failed`,
 *  successful pushes in `pushed`. The hook invalidates per-student
 *  assignment lists so any open student page refreshes. */
export function useBroadcastAssignmentMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { title: string; body_md: string; due_at?: string }) =>
      api<TutorBroadcastResult>('/tutor/assignments/broadcast', {
        method: 'POST',
        body: JSON.stringify({
          title: vars.title,
          body_md: vars.body_md,
          ...(vars.due_at ? { due_at: vars.due_at } : {}),
        }),
      }),
    onSuccess: () => {
      // Invalidate every per-student assignment query — different students
      // get fresh rows and the dashboard can reflect them on next visit.
      qc.invalidateQueries({ queryKey: ['tutor', 'students'] })
    },
  })
}


export type TutorSharedMaterial = {
  id: string
  tutor_id: string
  title: string
  source_url: string
  body_md: string
  student_count: number
  created_at?: string
}

/** Wire endpoint supports keyset cursor pagination (D1).
 *  UI infinite-scroll deferred to a UX pass; default limit covers
 *  typical libraries. */
export function useTutorSharedReadingQuery(limit = 100) {
  return useQuery({
    queryKey: ['tutor', 'shared-reading', limit] as const,
    queryFn: () =>
      api<{ items: TutorSharedMaterial[]; next_cursor?: string }>(
        `/tutor/shared-reading?limit=${limit}`,
      ),
    staleTime: 30_000,
  })
}

export function usePushSharedReadingMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { title: string; source_url?: string; note?: string }) =>
      api<{
        material: TutorSharedMaterial
        pushed_count: number
        failed_count: number
      }>(`/tutor/shared-reading`, {
        method: 'POST',
        body: JSON.stringify({
          title: vars.title,
          source_url: vars.source_url ?? '',
          note: vars.note ?? '',
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tutor', 'shared-reading'] })
      qc.invalidateQueries({ queryKey: ['tutor', 'students'] })
    },
  })
}


export type TutorEventStatus = 'scheduled' | 'cancelled' | 'completed' | string

export type TutorEvent = {
  id: string
  tutor_id: string
  /** Set for 1-on-1 events. Empty when this is a circle (group) event. */
  student_id: string
  /** V2 group classes. Empty in V1. */
  circle_id: string
  title: string
  body_md: string
  scheduled_at?: string
  duration_min: number
  meet_url: string
  /** Only meaningful for circle events; 0 = unlimited / not applicable. */
  capacity: number
  status: TutorEventStatus
  cancellation_reason: string
  /** Wave 5.2d — non-empty iff status='completed'. Tutor's session write-up. */
  session_note: string
  /** Phase K T4 — 'private' | 'shared'. Default 'private'. */
  visibility?: 'private' | 'shared'
  /** Phase K T4 — optional curated copy для student-facing audience. */
  shared_content_md?: string
  /** Phase K T4 — stamp of first private→shared transition. RFC3339. */
  shared_at?: string
  created_at?: string
  updated_at?: string
}


export type TutorActivity = {
  window_days: number
  active_student_count: number
  events_completed: number
  events_cancelled: number
  events_scheduled: number
  minutes_taught: number
  /** 0..1; 0 when no events in window. */
  cancellation_rate: number
}

/** Tutor dashboard analytics — counters + minutes taught + cancellation rate. */
export function useTutorActivityQuery(windowDays = 30) {
  return useQuery({
    queryKey: ['tutor', 'activity', windowDays] as const,
    queryFn: () => api<TutorActivity>(`/tutor/activity?window_days=${windowDays}`),
    staleTime: 60_000,
  })
}

// Drives the «Тебя сегодня учат: ...» card on /today + Hone Home rail.
// Privacy contract: NO other-student names, NO event titles — only
// aggregate counts + the tutor's own public display fields.

export type MyTutorActivitySummary = {
  tutor_user_id: string
  tutor_display_name: string
  tutor_username: string
  tutor_avatar_url: string
  /** RFC3339 or empty when never active. */
  last_active_at?: string
  active_student_count_other: number
  recent_events_count: number
}

export function useMyTutorsActivityQuery(recentWindowDays = 7) {
  return useQuery({
    queryKey: ['tutor', 'my-tutors', 'activity', recentWindowDays] as const,
    queryFn: () =>
      api<{ items: MyTutorActivitySummary[] }>(
        `/tutor/my-tutors/activity?recent_window_days=${recentWindowDays}`,
      ),
    // Backend caches per-user 5 min; frontend keeps its own short stale
    // window so a tutor's just-scheduled event reflects on next navigate.
    staleTime: 120_000,
  })
}

/** Tutor's full calendar list — all statuses, most-recently-scheduled first.
 *  Wire endpoint supports cursor pagination; UI infinite-scroll deferred. */
export function useTutorEventsQuery(limit = 200) {
  return useQuery({
    queryKey: ['tutor', 'events', limit] as const,
    queryFn: () =>
      api<{ items: TutorEvent[]; next_cursor?: string }>(
        `/tutor/events?limit=${limit}`,
      ),
    staleTime: 30_000,
  })
}

/** Student-side: scheduled events whose end time hasn't passed yet,
 *  earliest-first. Drives Hone's Calendar page + HomePage chip.
 *  Wire endpoint supports cursor pagination; UI infinite-scroll deferred. */
export function useUpcomingEventsQuery(limit = 100) {
  return useQuery({
    queryKey: ['tutor', 'events', 'upcoming', limit] as const,
    queryFn: () =>
      api<{ items: TutorEvent[]; next_cursor?: string }>(
        `/tutor/events/upcoming?limit=${limit}`,
      ),
    staleTime: 30_000,
  })
}

/** Tutor schedules a calendar event for one student.
 *  - `scheduled_at` must be in the future (server enforces a 5-min slack).
 *  - `duration_min` 1..480.
 *  - `meet_url` optional; we don't validate the protocol/host server-side. */
export function useCreateEventMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: {
      student_id: string
      title: string
      body_md: string
      scheduled_at: string // ISO 8601
      duration_min: number
      meet_url: string
    }) =>
      api<TutorEvent>('/tutor/events', {
        method: 'POST',
        body: JSON.stringify(vars),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tutor', 'events'] })
    },
  })
}

/** Tutor cancels an event with a reason. Server requires a non-empty reason
 *  (CHECK constraint mirrors a deliberate UX rule — no silent cancellations). */
export function useCancelEventMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { event_id: string; reason: string }) =>
      api<Record<string, never>>(
        `/tutor/events/${encodeURIComponent(vars.event_id)}/cancel`,
        {
          method: 'POST',
          body: JSON.stringify({
            event_id: vars.event_id,
            reason: vars.reason,
          }),
        },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tutor', 'events'] })
    },
  })
}

/** Tutor schedules a GROUP event on a circle (Wave 5.2). The circle must
 *  be one the tutor owns or admins; capacity is required and capped at 200. */
export function useCreateGroupEventMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: {
      circle_id: string
      title: string
      body_md: string
      scheduled_at: string
      duration_min: number
      meet_url: string
      capacity: number
    }) =>
      api<TutorEvent>('/tutor/events/group', {
        method: 'POST',
        body: JSON.stringify(vars),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tutor', 'events'] })
    },
  })
}

/** Group events the student can see via circle membership but hasn't joined yet. */
export function useUpcomingGroupEventsQuery() {
  return useQuery({
    queryKey: ['tutor', 'events', 'upcoming-group'] as const,
    queryFn: () => api<{ items: TutorEvent[] }>('/tutor/events/upcoming/group'),
    staleTime: 30_000,
  })
}

export function useEventRSVPCountQuery(eventId: string | undefined) {
  return useQuery({
    queryKey: ['tutor', 'events', eventId, 'rsvp-count'] as const,
    queryFn: () =>
      api<{ count: number }>(
        `/tutor/events/${encodeURIComponent(eventId!)}/rsvp-count`,
      ),
    enabled: Boolean(eventId),
    staleTime: 15_000,
  })
}

export function useJoinEventMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (event_id: string) =>
      api<Record<string, never>>(
        `/tutor/events/${encodeURIComponent(event_id)}/join`,
        { method: 'POST' },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tutor', 'events'] })
    },
  })
}

export function useLeaveEventMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (event_id: string) =>
      api<Record<string, never>>(
        `/tutor/events/${encodeURIComponent(event_id)}/leave`,
        { method: 'POST' },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tutor', 'events'] })
    },
  })
}

/** Tutor marks an event complete with a session note (Wave 5.2d). Server
 *  requires a non-empty note — completion without recording outcomes is
 *  a deliberate UX dead-end. Already-terminal events return
 *  FailedPrecondition; we surface it as a no-op refetch on the caller side. */
export function useCompleteEventMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { event_id: string; session_note: string }) =>
      api<Record<string, never>>(
        `/tutor/events/${encodeURIComponent(vars.event_id)}/complete`,
        {
          method: 'POST',
          body: JSON.stringify({
            event_id: vars.event_id,
            session_note: vars.session_note,
          }),
        },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tutor', 'events'] })
    },
  })
}

/** Phase K T4 (2026-05-13) — tutor toggles session-note visibility for
 *  the student. visibility='private' hides (default); 'shared' surfaces
 *  the note via the student-side feed. Optional `shared_content_md`
 *  lets the tutor craft a curated student-facing copy без editing the
 *  full private note (empty = share raw private note as-is). */
export function useSetSessionNoteVisibilityMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: {
      event_id: string
      visibility: 'private' | 'shared'
      shared_content_md?: string
    }) =>
      api<{ event: TutorEvent }>(
        `/tutor/events/${encodeURIComponent(vars.event_id)}/note-visibility`,
        {
          method: 'POST',
          body: JSON.stringify({
            event_id: vars.event_id,
            visibility: vars.visibility,
            shared_content_md: vars.shared_content_md ?? '',
          }),
        },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tutor', 'events'] })
    },
  })
}

// ── Phase 3.3: tutor session notes-pad ──────────────────────────────

export type TutorSessionNotes = {
  student_id: string
  body_md: string
  updated_at?: string
}

const sessionNotesKey = (studentId: string) =>
  ['tutor', 'session-notes', studentId] as const

/** Read tutor's private notepad for this student. body_md == '' is a
 *  valid «no notes yet» state (server returns empty string, not 404). */
export function useSessionNotesQuery(studentId: string | undefined) {
  return useQuery({
    queryKey: sessionNotesKey(studentId ?? ''),
    queryFn: () =>
      api<TutorSessionNotes>(
        `/tutor/students/${encodeURIComponent(studentId!)}/notes`,
      ),
    enabled: Boolean(studentId),
    staleTime: 60_000,
  })
}

/** Upsert markdown notepad. Empty body allowed (= cleared). Caller
 *  should debounce ~1.5s to avoid thrashing on every keystroke. */
export function useSaveSessionNotesMutation(studentId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (bodyMd: string) =>
      api<TutorSessionNotes>(
        `/tutor/students/${encodeURIComponent(studentId!)}/notes`,
        {
          method: 'PUT',
          body: JSON.stringify({ student_id: studentId, body_md: bodyMd }),
        },
      ),
    onSuccess: (data) => {
      if (studentId) qc.setQueryData(sessionNotesKey(studentId), data)
    },
  })
}

// Student-discovery surface. Tutor authors a profile (visible toggle),
// students browse + apply. Identity rule: free per identity, no rates.

/** Predefined expertise tag set — keep in sync with backend domain. */
export const TUTOR_EXPERTISE_TAGS = [
  'go_senior',
  'ml_engineering',
  'english_polish',
  'system_design',
  'algorithms',
  'cross_cutting',
] as const
export type TutorExpertiseTag = (typeof TUTOR_EXPERTISE_TAGS)[number]

export const TUTOR_EXPERTISE_TAG_LABELS: Record<TutorExpertiseTag, string> = {
  go_senior: 'Go senior',
  ml_engineering: 'ML engineering',
  english_polish: 'English polish',
  system_design: 'System design',
  algorithms: 'Algorithms',
  cross_cutting: 'Cross-cutting',
}

export const TUTOR_LANGUAGE_CODES = ['ru', 'en'] as const
export type TutorLanguageCode = (typeof TUTOR_LANGUAGE_CODES)[number]
export const TUTOR_LANGUAGE_LABELS: Record<TutorLanguageCode, string> = {
  ru: 'Русский',
  en: 'English',
}

export type TutorDirectoryProfile = {
  user_id: string
  visible: boolean
  bio_md: string
  expertise_tags: string[]
  languages: string[]
  timezone?: string
  availability_md?: string
  linkedin_url?: string
  github_url?: string
  verified_at?: string // RFC3339 or empty
  application_message?: string
  created_at?: string
  updated_at?: string
}

export type TutorDirectoryEntry = {
  user_id: string
  display_name: string
  username: string
  avatar_url: string
  bio_md: string
  expertise_tags: string[]
  languages: string[]
  timezone?: string
  verified: boolean
}

export type TutorDirectoryApplication = {
  id: string
  tutor_id: string
  student_id: string
  message: string
  status: 'pending' | 'accepted' | 'declined'
  created_at?: string
  student_display_name?: string
  student_username?: string
  student_avatar_url?: string
}

/** GetMyDirectoryProfile — tutor reads его собственный directory profile. */
export function useMyDirectoryProfileQuery() {
  return useQuery({
    queryKey: ['tutor', 'directory', 'me'] as const,
    queryFn: () =>
      api<{ profile: TutorDirectoryProfile }>('/tutor/directory/me'),
    staleTime: 30_000,
  })
}

export type UpsertDirectoryProfileInput = {
  visible: boolean
  bio_md: string
  expertise_tags: string[]
  languages: string[]
  timezone?: string
  availability_md?: string
  linkedin_url?: string
  github_url?: string
  application_message?: string
}

/** UpsertDirectoryProfile — tutor saves profile state. */
export function useUpsertDirectoryProfileMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: UpsertDirectoryProfileInput) =>
      api<{ profile: TutorDirectoryProfile }>('/tutor/directory/me', {
        method: 'PUT',
        body: JSON.stringify(vars),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tutor', 'directory'] })
    },
  })
}

/** ListDirectoryTutors — student browses visible profiles. */
export type ListDirectoryTutorsFilter = {
  expertise_tags?: string[]
  languages?: string[]
}

export function useDirectoryTutorsQuery(
  filter: ListDirectoryTutorsFilter = {},
  pageSize = 25,
) {
  const params = new URLSearchParams()
  ;(filter.expertise_tags ?? []).forEach((t) =>
    params.append('expertise_tags', t),
  )
  ;(filter.languages ?? []).forEach((l) => params.append('languages', l))
  if (pageSize) params.set('page_size', String(pageSize))
  return useQuery({
    queryKey: ['tutor', 'directory', 'list', filter, pageSize] as const,
    queryFn: () =>
      api<{ items: TutorDirectoryEntry[]; next_page_token?: string }>(
        `/tutor/directory?${params.toString()}`,
      ),
    staleTime: 30_000,
  })
}

/** ApplyToTutor — student applies, tutor sees pending. */
export function useApplyToTutorMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { tutor_user_id: string; message?: string }) =>
      api<{ application: TutorDirectoryApplication }>(
        '/tutor/directory/apply',
        {
          method: 'POST',
          body: JSON.stringify(vars),
        },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tutor', 'directory', 'applications'] })
    },
  })
}

/** ListPendingApplications — tutor's queue. */
export function usePendingApplicationsQuery() {
  return useQuery({
    queryKey: ['tutor', 'directory', 'applications'] as const,
    queryFn: () =>
      api<{ items: TutorDirectoryApplication[] }>(
        '/tutor/directory/applications',
      ),
    staleTime: 20_000,
  })
}

/** AcceptApplication — tutor accepts; relationship is created server-side. */
export function useAcceptApplicationMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (applicationId: string) =>
      api<{ relationship: TutorRelationship }>(
        `/tutor/directory/applications/${encodeURIComponent(applicationId)}/accept`,
        {
          method: 'POST',
          body: JSON.stringify({ application_id: applicationId }),
        },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tutor', 'directory', 'applications'] })
      qc.invalidateQueries({ queryKey: ['tutor', 'students'] })
    },
  })
}

/** DeclineApplication — tutor declines (soft mark). */
export function useDeclineApplicationMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (applicationId: string) =>
      api<Record<string, never>>(
        `/tutor/directory/applications/${encodeURIComponent(applicationId)}/decline`,
        {
          method: 'POST',
          body: JSON.stringify({ application_id: applicationId }),
        },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tutor', 'directory', 'applications'] })
    },
  })
}

