// Auto-mirrored from review.ts (tsconfig has noEmit:true; this .js is a
// stale-shadow companion kept in sync because handlers/index.js imports
// it explicitly). See review.ts for the source-of-truth.
import { http, HttpResponse } from 'msw';

const base = '/api/v1';

const reviews = new Map();
const key = (bookingID, direction) => `${bookingID}:${direction}`;

export const reviewHandlers = [
  http.post(`${base}/review`, async ({ request }) => {
    const body = await request.json();
    if (!body.booking_id) return new HttpResponse('booking_id required', { status: 400 });
    if (!body.rating || body.rating < 1 || body.rating > 5) {
      return new HttpResponse('rating out of range', { status: 400 });
    }
    const dirRaw = body.direction || 'REVIEW_DIRECTION_CANDIDATE_TO_INTERVIEWER';
    const isC2I = dirRaw === 'REVIEW_DIRECTION_CANDIDATE_TO_INTERVIEWER';
    const dir = isC2I ? 'candidate_to_interviewer' : 'interviewer_to_candidate';
    const k = key(body.booking_id, dir);
    if (reviews.has(k)) return new HttpResponse('already reviewed', { status: 409 });
    const now = new Date().toISOString();
    const r = {
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
    };
    reviews.set(k, r);
    return HttpResponse.json(r);
  }),

  http.get(`${base}/review`, ({ request }) => {
    const url = new URL(request.url);
    const interviewerID = url.searchParams.get('interviewer_id');
    const items = Array.from(reviews.values())
      .filter((r) => r.direction === 'candidate_to_interviewer')
      .filter((r) => !interviewerID || r.subject_id === interviewerID)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    return HttpResponse.json({ items });
  }),

  http.get(`${base}/review/stats/:interviewer_id`, ({ params }) => {
    const id = String(params.interviewer_id);
    const list = Array.from(reviews.values()).filter(
      (r) => r.subject_id === id && r.direction === 'candidate_to_interviewer',
    );
    if (list.length === 0) {
      return HttpResponse.json({ interviewer_id: id, avg_rating: 0, reviews_count: 0 });
    }
    const avg = list.reduce((s, r) => s + r.rating, 0) / list.length;
    return HttpResponse.json({ interviewer_id: id, avg_rating: avg, reviews_count: list.length });
  }),
];

export function hasReview(bookingID, direction = 'candidate_to_interviewer') {
  return reviews.has(key(bookingID, direction));
}
