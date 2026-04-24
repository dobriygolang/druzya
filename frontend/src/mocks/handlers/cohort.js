// Auto-mirrored from cohort.ts (tsconfig has noEmit:true; this .js is a
// stale-shadow companion kept in sync because handlers/index.js imports
// it explicitly). See cohort.ts for the source-of-truth.
import { http, HttpResponse } from 'msw';

const base = '/api/v1';
const SELF_ID = '00000000-0000-0000-0000-000000000001';

function isoIn(days) {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

const cohorts = [
  { id: 'c-yandex-spring-26', slug: 'yandex-spring-26', name: "Яндекс spring'26", owner_id: 'u-mentor-1', starts_at: isoIn(-30), ends_at: isoIn(14), status: 'active', visibility: 'public', created_at: isoIn(-45), members_count: 24 },
  { id: 'c-faang-autumn', slug: 'faang-autumn', name: 'FAANG autumn', owner_id: 'u-mentor-2', starts_at: isoIn(-7), ends_at: isoIn(38), status: 'active', visibility: 'public', created_at: isoIn(-21), members_count: 41 },
  { id: 'c-sql-mastery-q2', slug: 'sql-mastery-q2', name: 'SQL mastery Q2', owner_id: 'u-mentor-3', starts_at: isoIn(7), ends_at: isoIn(63), status: 'active', visibility: 'public', created_at: isoIn(-3), members_count: 3 },
  { id: 'c-system-design-foundations', slug: 'system-design-foundations', name: 'System Design foundations', owner_id: 'u-mentor-4', starts_at: isoIn(-60), ends_at: isoIn(-1), status: 'graduated', visibility: 'public', created_at: isoIn(-90), members_count: 38 },
];

const memberships = new Set(['c-yandex-spring-26']);

function seedMembers(names) {
  return names.map((n, i) => ({
    user_id: `u-${i}-${n.toLowerCase()}`,
    display_name: n,
    avatar_seed: n,
    role: i === 0 ? 'owner' : 'member',
    joined_at: isoIn(-Math.floor(Math.random() * 30)),
  }));
}

const detailCache = {
  'yandex-spring-26': { cohort: cohorts[0], members: seedMembers(['Анна', 'Кирилл', 'Мария', 'Глеб', 'Сергей', 'Илья', 'Дмитрий', 'Ольга', 'Полина', 'Юля']) },
  'faang-autumn': { cohort: cohorts[1], members: seedMembers(['Артём', 'Лиза', 'Ваня', 'Костя', 'Никита']) },
  'sql-mastery-q2': { cohort: cohorts[2], members: seedMembers(['Соня', 'Ринат', 'Таня']) },
  'system-design-foundations': { cohort: cohorts[3], members: seedMembers(['Геннадий', 'Алексей', 'Виктор']) },
};

export const cohortHandlers = [
  http.get(`${base}/cohort/list`, ({ request }) => {
    const url = new URL(request.url);
    const status = url.searchParams.get('status');
    const search = (url.searchParams.get('search') ?? '').trim().toLowerCase();
    const items = cohorts
      .filter((c) => {
        if (status && c.status !== status) return false;
        if (search && !`${c.name} ${c.slug}`.toLowerCase().includes(search)) return false;
        return true;
      })
      .map((c) => ({ ...c, is_member: memberships.has(c.id), capacity: 50 }));
    return HttpResponse.json({ items, total: items.length, page: 1, page_size: 50 });
  }),

  http.post(`${base}/cohort`, async ({ request }) => {
    const body = await request.json();
    if (!body.name) return new HttpResponse('name required', { status: 400 });
    const slug =
      body.slug?.trim() ||
      body.name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/(^-|-$)/g, '') ||
      `cohort-${Date.now()}`;
    const c = {
      id: `c-${Date.now()}`,
      slug,
      name: body.name,
      owner_id: SELF_ID,
      starts_at: body.starts_at ?? new Date().toISOString(),
      ends_at: body.ends_at ?? isoIn(56),
      status: 'active',
      visibility: body.visibility ?? 'public',
      created_at: new Date().toISOString(),
      members_count: 1,
    };
    cohorts.unshift(c);
    memberships.add(c.id);
    detailCache[slug] = {
      cohort: c,
      members: [{ user_id: SELF_ID, display_name: 'ты', avatar_seed: 'me', role: 'owner', joined_at: c.created_at }],
    };
    return HttpResponse.json({ id: c.id });
  }),

  http.get(`${base}/cohort/:slug`, ({ params }) => {
    const slug = String(params.slug);
    const detail = detailCache[slug];
    if (!detail) return new HttpResponse('not found', { status: 404 });
    return HttpResponse.json(detail);
  }),

  http.post(`${base}/cohort/:id/join`, ({ params }) => {
    const id = String(params.id);
    const c = cohorts.find((c) => c.id === id);
    if (!c) return new HttpResponse('not found', { status: 404 });
    if (!memberships.has(id)) {
      memberships.add(id);
      c.members_count += 1;
      const detail = detailCache[c.slug];
      if (detail) {
        detail.members.push({ user_id: SELF_ID, display_name: 'ты', avatar_seed: 'me', role: 'member', joined_at: new Date().toISOString() });
      }
    }
    return HttpResponse.json({ status: 'joined', cohort_id: id });
  }),

  http.post(`${base}/cohort/:id/leave`, ({ params }) => {
    const id = String(params.id);
    const c = cohorts.find((c) => c.id === id);
    if (!c) return new HttpResponse('not found', { status: 404 });
    if (memberships.has(id)) {
      memberships.delete(id);
      c.members_count = Math.max(0, c.members_count - 1);
      const detail = detailCache[c.slug];
      if (detail) detail.members = detail.members.filter((m) => m.user_id !== SELF_ID);
    }
    return HttpResponse.json({ status: 'left', cohort_id: id });
  }),

  http.get(`${base}/cohort/:id/leaderboard`, ({ params }) => {
    const id = String(params.id);
    const c = cohorts.find((c) => c.id === id);
    if (!c) return HttpResponse.json({ items: [] });
    const detail = detailCache[c.slug];
    const items = (detail?.members ?? [])
      .map((m, i) => ({
        user_id: m.user_id,
        display_name: m.display_name,
        overall_elo: 2400 - i * 60 + Math.floor(Math.random() * 40),
        weekly_xp: 580 - i * 20 + Math.floor(Math.random() * 50),
      }))
      .sort((a, b) => b.overall_elo - a.overall_elo);
    return HttpResponse.json({ items });
  }),
];

export function isCohortMember(cohortID) {
  return memberships.has(cohortID);
}
