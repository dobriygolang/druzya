// Cohort announcement queries — wrappers over the
// CohortAnnouncementService Connect-RPC contract
// (proto/druz9/v1/cohort_announcement.proto). Vanguard transcodes to
// the REST routes mounted in cmd/monolith/services/cohort_announcement.go.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../apiClient'

export type ReactionGroup = {
  emoji: string
  count: number
}

export type CohortAnnouncement = {
  id: string
  cohort_id: string
  author_id: string
  author_username?: string
  author_display_name?: string
  body: string
  pinned: boolean
  created_at: string
  updated_at: string
  reactions?: ReactionGroup[]
  viewer_reacted?: string[]
}

export const ALLOWED_REACTIONS = ['🔥', '👍', '❤️', '🎉', '🤔', '👀'] as const
export type AllowedReaction = (typeof ALLOWED_REACTIONS)[number]

const announcementKeys = {
  byCohort: (cohortID: string) => ['cohort_announcement', 'list', cohortID] as const,
}

export function useCohortAnnouncementsQuery(cohortID: string | undefined, opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: announcementKeys.byCohort(cohortID ?? ''),
    queryFn: async () => {
      if (!cohortID) return [] as CohortAnnouncement[]
      const wire = await api<{ items: CohortAnnouncement[] }>(
        `/cohort/${encodeURIComponent(cohortID)}/announcement?limit=50`,
      )
      return wire.items ?? []
    },
    enabled: (opts.enabled ?? true) && !!cohortID,
    staleTime: 30_000,
  })
}

export type CreateAnnouncementInput = {
  cohort_id: string
  body: string
  pinned?: boolean
}

export function useCreateAnnouncementMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ cohort_id, body, pinned }: CreateAnnouncementInput) =>
      api<CohortAnnouncement>(`/cohort/${encodeURIComponent(cohort_id)}/announcement`, {
        method: 'POST',
        body: JSON.stringify({ cohort_id, body, pinned: !!pinned }),
      }),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: announcementKeys.byCohort(vars.cohort_id) })
    },
  })
}

export function useDeleteAnnouncementMutation(cohortID: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (announcementID: string) =>
      api<Record<string, never>>(`/cohort/announcement/${encodeURIComponent(announcementID)}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      if (cohortID) void qc.invalidateQueries({ queryKey: announcementKeys.byCohort(cohortID) })
    },
  })
}

export type ReactionMutation = {
  cohortID: string
  announcementID: string
  emoji: AllowedReaction
}

export function useAddReactionMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ announcementID, emoji }: ReactionMutation) =>
      api<{ count: number }>(`/cohort/announcement/${encodeURIComponent(announcementID)}/react`, {
        method: 'POST',
        body: JSON.stringify({ announcement_id: announcementID, emoji }),
      }),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: announcementKeys.byCohort(vars.cohortID) })
    },
  })
}

export function useRemoveReactionMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ announcementID, emoji }: ReactionMutation) =>
      api<{ count: number }>(
        `/cohort/announcement/${encodeURIComponent(announcementID)}/react/${encodeURIComponent(emoji)}`,
        { method: 'DELETE' },
      ),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: announcementKeys.byCohort(vars.cohortID) })
    },
  })
}
