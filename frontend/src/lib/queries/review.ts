// Review queries — wrapper over the ReviewService Connect-RPC contract
// (proto/druz9/v1/review.proto). Vanguard transcodes to:
//
//   POST /api/v1/review                          — CreateReview
//   GET  /api/v1/review?interviewer_id=...       — ListReviewsByInterviewer
//   GET  /api/v1/review/stats/{interviewer_id}   — GetInterviewerStats
//
// Wire shape mirrors druz9v1.Review 1:1 — snake_case so we decode without a
// mapper.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../apiClient'

export type Review = {
  id: string
  booking_id: string
  reviewer_id: string
  interviewer_id: string
  rating: number
  feedback?: string
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
}

// useCreateReview wraps POST /api/v1/review. Invalidates the candidate's
// bookings on success so the «Оставить отзыв» CTA disappears.
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
        }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['slots', 'my-bookings'] })
      void qc.invalidateQueries({ queryKey: ['reviews'] })
    },
  })
}

// useReviewsByInterviewer wraps GET /api/v1/review?interviewer_id=...
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
