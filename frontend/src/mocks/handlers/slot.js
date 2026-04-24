// Auto-mirrored from slot.ts (tsconfig has noEmit:true; this .js is a stale
// pre-existing duplicate kept in sync because index.js imports it explicitly).
// See slot.ts for the source-of-truth and full doc comments.
import { http, HttpResponse } from 'msw';

const base = '/api/v1';

const today = new Date();
function isoIn(hours) {
  return new Date(today.getTime() + hours * 3600_000).toISOString();
}

const slots = [
  {
    id: '10000000-0000-0000-0000-000000000001',
    interviewer: { user_id: 'u-mentor-1', username: 'grim_grimoire', avg_rating: 4.8, reviews_count: 42 },
    starts_at: isoIn(3),
    duration_min: 60,
    section: 'SECTION_ALGORITHMS',
    difficulty: 'DIFFICULTY_MEDIUM',
    language: 'ru',
    price_rub: 0,
    status: 'SLOT_STATUS_AVAILABLE',
  },
  {
    id: '10000000-0000-0000-0000-000000000002',
    interviewer: { user_id: 'u-mentor-2', username: 'aurelius_dba', avg_rating: 4.6, reviews_count: 18 },
    starts_at: isoIn(8),
    duration_min: 90,
    section: 'SECTION_SQL',
    difficulty: 'DIFFICULTY_HARD',
    language: 'ru',
    price_rub: 1500,
    status: 'SLOT_STATUS_AVAILABLE',
  },
  {
    id: '10000000-0000-0000-0000-000000000003',
    interviewer: { user_id: 'u-mentor-3', username: 'shadow_777', avg_rating: 4.2, reviews_count: 7 },
    starts_at: isoIn(24),
    duration_min: 60,
    section: 'SECTION_GO',
    difficulty: 'DIFFICULTY_EASY',
    language: 'ru',
    price_rub: 0,
    status: 'SLOT_STATUS_AVAILABLE',
  },
  {
    id: '10000000-0000-0000-0000-000000000004',
    interviewer: { user_id: 'u-mentor-4', username: 'arch_magus', avg_rating: 4.9, reviews_count: 71 },
    starts_at: isoIn(30),
    duration_min: 90,
    section: 'SECTION_SYSTEM_DESIGN',
    difficulty: 'DIFFICULTY_HARD',
    language: 'en',
    price_rub: 2500,
    status: 'SLOT_STATUS_AVAILABLE',
  },
  {
    id: '10000000-0000-0000-0000-000000000005',
    interviewer: { user_id: 'u-mentor-5', username: 'star_sibyl' },
    starts_at: isoIn(48),
    duration_min: 45,
    section: 'SECTION_BEHAVIORAL',
    language: 'ru',
    price_rub: 800,
    status: 'SLOT_STATUS_AVAILABLE',
  },
  {
    id: '10000000-0000-0000-0000-000000000006',
    interviewer: { user_id: 'u-mentor-6', username: 'void_caller', avg_rating: 5.0, reviews_count: 3 },
    starts_at: isoIn(54),
    duration_min: 60,
    section: 'SECTION_ALGORITHMS',
    difficulty: 'DIFFICULTY_HARD',
    language: 'en',
    price_rub: 1200,
    status: 'SLOT_STATUS_BOOKED',
  },
];

const bookings = new Map();

function findSlot(id) {
  return slots.find((s) => s.id === id);
}

function applyFilters(url) {
  const section = url.searchParams.get('section');
  const difficulty = url.searchParams.get('difficulty');
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  return slots.filter((s) => {
    if (section && s.section !== section) return false;
    if (difficulty && s.difficulty !== difficulty) return false;
    if (from && s.starts_at < from) return false;
    if (to && s.starts_at > to) return false;
    return true;
  });
}

export const slotHandlers = [
  http.get(`${base}/slot`, ({ request }) => {
    const items = applyFilters(new URL(request.url));
    return HttpResponse.json({ items });
  }),

  http.post(`${base}/slot/:id/book`, ({ params }) => {
    const id = String(params.id);
    const slot = findSlot(id);
    if (!slot) return new HttpResponse('not found', { status: 404 });
    if (slot.status !== 'SLOT_STATUS_AVAILABLE') {
      return new HttpResponse('slot not bookable', { status: 409 });
    }
    slot.status = 'SLOT_STATUS_BOOKED';
    const booking = {
      id: `b-${Date.now()}`,
      slot: { ...slot },
      meet_url: `https://meet.google.com/mock-${id.slice(0, 8)}`,
      created_at: new Date().toISOString(),
    };
    bookings.set(id, booking);
    return HttpResponse.json(booking);
  }),

  http.delete(`${base}/slot/:id/cancel`, ({ params }) => {
    const id = String(params.id);
    const slot = findSlot(id);
    if (!slot) return new HttpResponse('not found', { status: 404 });
    slot.status = 'SLOT_STATUS_CANCELLED';
    bookings.delete(id);
    return new HttpResponse(null, { status: 204 });
  }),

  http.post(`${base}/slot`, async ({ request }) => {
    const body = await request.json();
    const created = {
      id: `created-${Date.now()}`,
      interviewer: { user_id: 'u-self', username: 'me' },
      starts_at: body.starts_at ?? isoIn(2),
      duration_min: body.duration_min ?? 60,
      section: body.section ?? 'SECTION_ALGORITHMS',
      difficulty: body.difficulty,
      language: body.language ?? 'ru',
      price_rub: body.price_rub ?? 0,
      status: 'SLOT_STATUS_AVAILABLE',
    };
    slots.unshift(created);
    return HttpResponse.json(created);
  }),

  http.get(`${base}/slot/my/bookings`, () => {
    const items = Array.from(bookings.values()).map((b) => ({
      id: b.id,
      slot_id: b.slot.id,
      meet_url: b.meet_url,
      status: 'active',
      created_at: b.created_at,
      starts_at: b.slot.starts_at,
      duration_min: b.slot.duration_min,
      section: b.slot.section,
      difficulty: b.slot.difficulty,
      language: b.slot.language,
      price_rub: b.slot.price_rub,
      slot_status: b.slot.status,
    }));
    return HttpResponse.json({ items });
  }),
];
