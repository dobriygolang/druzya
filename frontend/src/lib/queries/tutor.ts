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
