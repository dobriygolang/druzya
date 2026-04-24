// MSW handlers for ReviewService — match the vanguard-transcoded REST shape
// of proto/druz9/v1/review.proto:
//
//   POST /api/v1/review                           — CreateReview
//   GET  /api/v1/review?interviewer_id=&limit=    — ListReviewsByInterviewer
//   GET  /api/v1/review/stats/{interviewer_id}    — GetInterviewerStats
//
// In-memory state is process-local; resets on page reload (acceptable for
// MSW dev-mock parity with the slot handler's bookings map).
import { http, HttpResponse } from 'msw'

const base = '/api/v1'

type WireReview = {
  id: string
  booking_id: string
  reviewer_id: string
  interviewer_id: string
  subject_id: string
  rating: number
  feedback?: string
  direction: string
  created_at: string
  updated_at: string
}

// Keyed by `${booking_id}:${direction}` since two rows per booking are
// allowed (one per side).
const reviews = new Map<string, WireReview>()
function key(bookingID: string, direction: string): string {
  return `${bookingID}:${direction}`
}

export const reviewHandlers = [
  http.post(`${base}/review`, async ({ request }) => {
    const body = (await request.json()) as {
      booking_id?: string
      rating?: number
      feedback?: string
      direction?: string
    }
    if (!body.booking_id) return new HttpResponse('booking_id required', { status: 400 })
    if (!body.rating || body.rating < 1 || body.rating > 5) {
      return new HttpResponse('rating out of range', { status: 400 })
    }
    const dirRaw = body.direction || 'REVIEW_DIRECTION_CANDIDATE_TO_INTERVIEWER'
    const isC2I = dirRaw === 'REVIEW_DIRECTION_CANDIDATE_TO_INTERVIEWER'
    const dir = isC2I ? 'candidate_to_interviewer' : 'interviewer_to_candidate'
    const k = key(body.booking_id, dir)
    if (reviews.has(k)) return new HttpResponse('already reviewed', { status: 409 })
    const now = new Date().toISOString()
    const r: WireReview = {
      id: k,
      booking_id: body.booking_id,
      reviewer_id: 'u-self',
      interviewer_id: 'u-mentor-mock',
      subject_id: isC2I ? 'u-mentor-mock' : 'u-self',
      direction: dir,
      rating: body.rating,
      feedback: body.feedback,
      created_at: now,
      updated_at: now,
    }
    reviews.set(k, r)
    return HttpResponse.json(r)
  }),

  http.get(`${base}/review`, ({ request }) => {
    const url = new URL(request.url)
    const interviewerID = url.searchParams.get('interviewer_id')
    const items = Array.from(reviews.values())
      // Public interviewer card surfaces only candidate→interviewer.
      .filter((r) => r.direction === 'candidate_to_interviewer')
      .filter((r) => !interviewerID || r.subject_id === interviewerID)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
    return HttpResponse.json({ items })
  }),

  http.get(`${base}/review/stats/:interviewer_id`, ({ params }) => {
    const id = String(params.interviewer_id)
    const list = Array.from(reviews.values()).filter(
      (r) => r.subject_id === id && r.direction === 'candidate_to_interviewer',
    )
    if (list.length === 0) {
      return HttpResponse.json({ interviewer_id: id, avg_rating: 0, reviews_count: 0 })
    }
    const avg = list.reduce((s, r) => s + r.rating, 0) / list.length
    return HttpResponse.json({ interviewer_id: id, avg_rating: avg, reviews_count: list.length })
  }),
]

// hasReview is exposed so the slot mock can set has_review per direction
// without duplicating the in-memory map.
export function hasReview(bookingID: string, direction: string = 'candidate_to_interviewer'): boolean {
  return reviews.has(key(bookingID, direction))
}
