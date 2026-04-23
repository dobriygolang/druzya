import { http, HttpResponse } from 'msw';
const base = '/api/v1';
// Demo slots — deterministic snapshot so the page doesn't thrash every reload.
// STUB: replace with real SlotService.ListSlots results.
const slots = [
    {
        id: '10000000-0000-0000-0000-000000000001',
        mentor: {
            user_id: 'u-mentor-1',
            username: 'grim_grimoire',
            title: 'Staff · ex-Yandex',
            elo: 2180,
        },
        section: 'algorithms',
        starts_at: '2026-04-22T18:00:00+03:00',
        duration_min: 60,
        price_ai_credits: 100,
        format: 'video_call',
        spots_left: 1,
    },
    {
        id: '10000000-0000-0000-0000-000000000002',
        mentor: {
            user_id: 'u-mentor-2',
            username: 'aurelius_dba',
            title: 'Principal · ex-Ozon',
            elo: 2250,
        },
        section: 'sql',
        starts_at: '2026-04-22T20:00:00+03:00',
        duration_min: 90,
        price_ai_credits: 150,
        format: 'video_call',
        spots_left: 1,
    },
    {
        id: '10000000-0000-0000-0000-000000000003',
        mentor: {
            user_id: 'u-mentor-3',
            username: 'shadow_777',
            title: 'Senior · ex-Avito',
            elo: 2040,
        },
        section: 'go',
        starts_at: '2026-04-23T14:00:00+03:00',
        duration_min: 60,
        price_ai_credits: 0,
        format: 'video_call',
        spots_left: 1,
    },
    {
        id: '10000000-0000-0000-0000-000000000004',
        mentor: {
            user_id: 'u-mentor-4',
            username: 'arch_magus',
            title: 'Staff · ex-VK',
            elo: 2310,
        },
        section: 'system_design',
        starts_at: '2026-04-23T19:00:00+03:00',
        duration_min: 90,
        price_ai_credits: 200,
        format: 'video_call',
        spots_left: 1,
    },
    {
        id: '10000000-0000-0000-0000-000000000005',
        mentor: {
            user_id: 'u-mentor-5',
            username: 'star_sibyl',
            title: 'EM · ex-Google',
            elo: 2190,
        },
        section: 'behavioral',
        starts_at: '2026-04-24T17:00:00+03:00',
        duration_min: 45,
        price_ai_credits: 80,
        format: 'video_call',
        spots_left: 1,
    },
    {
        id: '10000000-0000-0000-0000-000000000006',
        mentor: {
            user_id: 'u-mentor-6',
            username: 'void_caller',
            title: 'Principal · ex-Meta',
            elo: 2380,
        },
        section: 'algorithms',
        starts_at: '2026-04-24T21:00:00+03:00',
        duration_min: 60,
        price_ai_credits: 120,
        format: 'video_call',
        spots_left: 0, // already booked — render disabled
    },
];
// In-memory booking state (reset on page reload, acceptable for STUB).
const bookings = new Map();
export const slotHandlers = [
    http.get(`${base}/slots`, () => HttpResponse.json({
        slots,
        bookings: Array.from(bookings.entries()).map(([slot_id, b]) => ({
            slot_id,
            ...b,
        })),
    })),
    http.post(`${base}/slots/:id/book`, ({ params }) => {
        const id = String(params.id);
        const slot = slots.find((s) => s.id === id);
        if (!slot || slot.spots_left <= 0) {
            return new HttpResponse('sold out', { status: 409 });
        }
        slot.spots_left = 0;
        const booking = {
            booking_id: `b-${Date.now()}`,
            meet_url: `https://meet.druz9.online/${id.slice(0, 8)}`,
        };
        bookings.set(id, booking);
        return HttpResponse.json({ slot_id: id, ...booking });
    }),
];
