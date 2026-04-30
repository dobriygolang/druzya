// tutor.ts — react-query hooks for the tutor bounded context (Wave 2
// of docs/feature/tutor.md). Backend exposes Connect-RPC + REST aliases
// at /api/v1/tutor/*. PeekInvite is the only PUBLIC endpoint (used by
// /invite/{code} landing before student auth).
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

// ── Tutor-dashboard hooks (Wave 2.6) ──────────────────────────────────

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
  // English-track activity from Hone (extended snapshot — Wave 4 + 6.1).
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

/** ListInvites — tutor's own invites, recent first. */
export function useTutorInvitesQuery() {
  return useQuery({
    queryKey: ['tutor', 'invites'] as const,
    queryFn: () => api<{ items: TutorInvite[] }>('/tutor/invites'),
    staleTime: 30_000,
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

// ── Assignments (Wave 5.1) ────────────────────────────────────────────

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

/** Tutor-side: full backlog for one student (active + completed + archived). */
export function useTutorAssignmentsQuery(studentId: string | undefined) {
  return useQuery({
    queryKey: ['tutor', 'students', studentId, 'assignments'] as const,
    queryFn: () =>
      api<{ items: TutorAssignment[] }>(
        `/tutor/students/${encodeURIComponent(studentId!)}/assignments`,
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

/** Student-side: pending feed (active, not completed, not archived). */
export function usePendingAssignmentsQuery() {
  return useQuery({
    queryKey: ['tutor', 'assignments', 'pending'] as const,
    queryFn: () => api<{ items: TutorAssignment[] }>('/tutor/assignments/pending'),
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

// ── Broadcast (Wave 5.2a) ─────────────────────────────────────────────

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

// ── Events (Wave 5.2b) ────────────────────────────────────────────────

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
  created_at?: string
  updated_at?: string
}

// ── Tutor analytics (Wave 9.5) ────────────────────────────────────────

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

/** Tutor's full calendar list — all statuses, most-recently-scheduled first. */
export function useTutorEventsQuery() {
  return useQuery({
    queryKey: ['tutor', 'events'] as const,
    queryFn: () => api<{ items: TutorEvent[] }>('/tutor/events'),
    staleTime: 30_000,
  })
}

/** Student-side: scheduled events whose end time hasn't passed yet,
 *  earliest-first. Drives Hone's Calendar page + HomePage chip. */
export function useUpcomingEventsQuery() {
  return useQuery({
    queryKey: ['tutor', 'events', 'upcoming'] as const,
    queryFn: () => api<{ items: TutorEvent[] }>('/tutor/events/upcoming'),
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

// ── Wave 9.1 marketplace listings (Boosty-only payment) ───────────────
// Boosty handles all money flow — we only route the click outbound via
// `boosty_url`. Browse/detail endpoints live under /marketplace and are
// public (no auth gate); manage endpoints under /tutor/listings require
// the bearer.

export type TutorListing = {
  id: string
  tutor_id: string
  slug: string
  title: string
  summary: string
  body_md: string
  track_kind: string
  languages: string[]
  hourly_rate_minor: number
  currency: string
  boosty_url: string
  published_at: string
  archived_at: string
  created_at: string
  updated_at: string
}

export type TutorListingPackage = {
  id: string
  listing_id: string
  kind: string
  hours: number
  price_minor: number
  description: string
  archived_at: string
  created_at: string
}

export type TutorListingDetail = {
  listing: TutorListing
  packages: TutorListingPackage[]
  tutor_display: string
}

export function useBrowseListingsQuery(filter: {
  track_kinds?: string[]
  max_rate_minor?: number
  languages?: string[]
  limit?: number
}) {
  return useQuery({
    queryKey: ["marketplace", "browse", filter] as const,
    queryFn: () => {
      const params = new URLSearchParams()
      filter.track_kinds?.forEach((t) => params.append("track_kinds", t))
      filter.languages?.forEach((l) => params.append("languages", l))
      if (filter.max_rate_minor) params.set("max_rate_minor", String(filter.max_rate_minor))
      if (filter.limit) params.set("limit", String(filter.limit))
      const qs = params.toString()
      return api<{ items: TutorListing[] }>(`/marketplace/listings${qs ? "?" + qs : ""}`)
    },
    staleTime: 60_000,
  })
}

export function useListingBySlugQuery(slug: string | undefined) {
  return useQuery({
    queryKey: ["marketplace", "listing", slug] as const,
    queryFn: () => api<TutorListingDetail>(`/marketplace/listings/${encodeURIComponent(slug!)}`),
    enabled: Boolean(slug),
  })
}

export function useMyListingsQuery() {
  return useQuery({
    queryKey: ["tutor", "listings"] as const,
    queryFn: () => api<{ items: TutorListing[] }>("/tutor/listings"),
    staleTime: 30_000,
  })
}

export function useCreateListingMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: {
      slug: string
      title: string
      summary: string
      body_md: string
      track_kind: string
      languages: string[]
      hourly_rate_minor: number
      currency: string
      boosty_url: string
    }) => api<TutorListing>("/tutor/listings", { method: "POST", body: JSON.stringify(vars) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tutor", "listings"] }),
  })
}

export function useUpdateListingMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: {
      listing_id: string
      slug: string
      title: string
      summary: string
      body_md: string
      track_kind: string
      languages: string[]
      hourly_rate_minor: number
      currency: string
      boosty_url: string
    }) =>
      api<TutorListing>(`/tutor/listings/${encodeURIComponent(vars.listing_id)}`, {
        method: "PATCH",
        body: JSON.stringify(vars),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tutor", "listings"] }),
  })
}

export function usePublishListingMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (listing_id: string) =>
      api<Record<string, never>>(
        `/tutor/listings/${encodeURIComponent(listing_id)}/publish`,
        { method: "POST" },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tutor", "listings"] }),
  })
}

export function useArchiveListingMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (listing_id: string) =>
      api<Record<string, never>>(
        `/tutor/listings/${encodeURIComponent(listing_id)}/archive`,
        { method: "POST" },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tutor", "listings"] }),
  })
}

export function useAddListingPackageMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: {
      listing_id: string
      kind: string
      hours: number
      price_minor: number
      description: string
    }) =>
      api<TutorListingPackage>(
        `/tutor/listings/${encodeURIComponent(vars.listing_id)}/packages`,
        { method: "POST", body: JSON.stringify(vars) },
      ),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["marketplace", "listing"] })
      qc.invalidateQueries({ queryKey: ["tutor", "listings"] })
      void vars
    },
  })
}

export function useArchiveListingPackageMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (package_id: string) =>
      api<Record<string, never>>(
        `/tutor/packages/${encodeURIComponent(package_id)}/archive`,
        { method: "POST" },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["marketplace", "listing"] })
      qc.invalidateQueries({ queryKey: ["tutor", "listings"] })
    },
  })
}

