// Review queries — wrapper over the ReviewService Connect-RPC contract
// (proto/druz9/v1/review.proto).
//
//   POST /api/v1/review                          — CreateReview (bidirectional)
//   GET  /api/v1/review?interviewer_id=...       — ListReviewsByInterviewer
//   GET  /api/v1/review/stats/{interviewer_id}   — GetInterviewerStats
//
// Wire shape mirrors druz9v1.Review 1:1 — snake_case so we decode without a
// mapper.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../apiClient'

// Direction mirrors proto enum ReviewDirection. Wire values are the proto
// short strings below (not the full REVIEW_DIRECTION_* names — vanguard
// accepts either form on input; on output we store the short value).
export type ReviewDirection =
  | 'REVIEW_DIRECTION_CANDIDATE_TO_INTERVIEWER'
  | 'REVIEW_DIRECTION_INTERVIEWER_TO_CANDIDATE'

export type Review = {
  id: string
  booking_id: string
  reviewer_id: string
  interviewer_id: string
  subject_id: string
  rating: number
  feedback?: string
  direction: ReviewDirection
  created_at: string
  updated_at: string
}

export type InterviewerStats = {
  interviewer_id: string
  avg_rating: number
  reviews_count: number
}

export type CreateReviewInput = {
  booking_id: string
  rating: number
  feedback?: string
  direction: ReviewDirection
}

// useCreateReview wraps POST /api/v1/review. Invalidates both bookings
// queries on success so the «Оставить отзыв» CTA disappears on either
// drawer tab after the write.
export function useCreateReview() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateReviewInput) =>
      api<Review>('/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          booking_id: input.booking_id,
          rating: input.rating,
          feedback: input.feedback ?? '',
          direction: input.direction,
        }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['slots', 'my-bookings'] })
      void qc.invalidateQueries({ queryKey: ['slots', 'my-hosted'] })
      void qc.invalidateQueries({ queryKey: ['reviews'] })
    },
  })
}

// useReviewsByInterviewer wraps GET /api/v1/review?interviewer_id=...
// Returns only CANDIDATE→INTERVIEWER reviews (server-side filter) — safe
// to show on the public interviewer card.
export function useReviewsByInterviewer(interviewerID: string | undefined, limit = 20) {
  return useQuery({
    queryKey: ['reviews', 'interviewer', interviewerID ?? '', limit],
    queryFn: async () => {
      if (!interviewerID) return [] as Review[]
      const wire = await api<{ items: Review[] }>(
        `/review?interviewer_id=${encodeURIComponent(interviewerID)}&limit=${limit}`,
      )
      return wire.items ?? []
    },
    enabled: !!interviewerID,
  })
}

// useInterviewerStatsQuery wraps GET /api/v1/review/stats/{id}. Used by
// the public /interviewer/:id page.
export function useInterviewerStatsQuery(interviewerID: string | undefined) {
  return useQuery({
    queryKey: ['reviews', 'stats', interviewerID ?? ''],
    queryFn: async () => {
      if (!interviewerID) return { interviewer_id: '', avg_rating: 0, reviews_count: 0 } as InterviewerStats
      return api<InterviewerStats>(`/review/stats/${encodeURIComponent(interviewerID)}`)
    },
    enabled: !!interviewerID,
  })
}
