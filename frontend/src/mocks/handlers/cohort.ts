// MSW handlers for the cohort bounded context. Mirrors the chi-direct
// REST endpoints in backend/cmd/monolith/services/cohort.go:
//   GET  /api/v1/cohort/list
//   POST /api/v1/cohort
//   GET  /api/v1/cohort/{slug}
//   POST /api/v1/cohort/{id}/join
//   POST /api/v1/cohort/{id}/leave
//   GET  /api/v1/cohort/{id}/leaderboard
//
// Seeded with three demo cohorts (one the dev is in, one open-to-join,
// one almost-full SQL track) so the catalogue isn't empty before any
// mutation. State persists for the page session — resets on reload.
import { http, HttpResponse } from 'msw'

const base = '/api/v1'

type WireCohort = {
  id: string
  slug: string
  name: string
  owner_id: string
  starts_at: string
  ends_at: string
  status: 'active' | 'graduated' | 'cancelled'
  visibility: 'public' | 'invite'
  created_at: string
  members_count: number
  capacity: number
}

type WireMember = {
  user_id: string
  display_name: string
  username: string
  avatar_url: string
  avatar_seed: string
  role: 'member' | 'coach' | 'owner'
  joined_at: string
}

type WireCohortDetail = {
  cohort: WireCohort
  members: WireMember[]
}

const SELF_ID = '00000000-0000-0000-0000-000000000001'

function isoIn(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString()
}

const cohorts: WireCohort[] = [
  {
    id: 'c-yandex-spring-26',
    slug: 'yandex-spring-26',
    name: "Яндекс spring'26",
    owner_id: 'u-mentor-1',
    starts_at: isoIn(-30),
    ends_at: isoIn(14),
    status: 'active',
    visibility: 'public',
    created_at: isoIn(-45),
    members_count: 24,
    capacity: 50,
  },
  {
    id: 'c-faang-autumn',
    slug: 'faang-autumn',
    name: 'FAANG autumn',
    owner_id: 'u-mentor-2',
    starts_at: isoIn(-7),
    ends_at: isoIn(38),
    status: 'active',
    visibility: 'public',
    created_at: isoIn(-21),
    members_count: 41,
    capacity: 50,
  },
  {
    id: 'c-sql-mastery-q2',
    slug: 'sql-mastery-q2',
    name: 'SQL mastery Q2',
    owner_id: 'u-mentor-3',
    starts_at: isoIn(7),
    ends_at: isoIn(63),
    status: 'active',
    visibility: 'public',
    created_at: isoIn(-3),
    members_count: 3,
    capacity: 12,
  },
  {
    id: 'c-system-design-foundations',
    slug: 'system-design-foundations',
    name: 'System Design foundations',
    owner_id: 'u-mentor-4',
    starts_at: isoIn(-60),
    ends_at: isoIn(-1),
    status: 'graduated',
    visibility: 'public',
    created_at: isoIn(-90),
    members_count: 38,
    capacity: 50,
  },
]

// Track membership locally so join/leave flips the catalogue card.
const memberships = new Set<string>(['c-yandex-spring-26'])

// Phase-2: in-memory invite-token store. Resets on page reload.
type InviteState = {
  cohort_id: string
  max_uses: number   // 0 = unlimited
  used_count: number
  expires_at: number // 0 = never expires; otherwise unix ms
}
const inviteTokens = new Map<string, InviteState>()

const detailCache: Record<string, WireCohortDetail> = {
  'yandex-spring-26': {
    cohort: cohorts[0]!,
    members: seedMembers(['Анна', 'Кирилл', 'Мария', 'Глеб', 'Сергей', 'Илья', 'Дмитрий', 'Ольга', 'Полина', 'Юля']),
  },
  'faang-autumn': {
    cohort: cohorts[1]!,
    members: seedMembers(['Артём', 'Лиза', 'Ваня', 'Костя', 'Никита']),
  },
  'sql-mastery-q2': {
    cohort: cohorts[2]!,
    members: seedMembers(['Соня', 'Ринат', 'Таня']),
  },
  'system-design-foundations': {
    cohort: cohorts[3]!,
    members: seedMembers(['Геннадий', 'Алексей', 'Виктор']),
  },
}

function seedMembers(names: string[]): WireMember[] {
  return names.map((n, i) => ({
    user_id: `u-${i}-${n.toLowerCase()}`,
    display_name: n,
    username: `${n.toLowerCase()}_${i}`,
    avatar_url: '',
    avatar_seed: n,
    role: i === 0 ? 'owner' : 'member',
    joined_at: isoIn(-Math.floor(Math.random() * 30)),
  }))
}

export const cohortHandlers = [
  http.get(`${base}/cohort/list`, ({ request }) => {
    const url = new URL(request.url)
    const status = url.searchParams.get('status')
    const search = (url.searchParams.get('search') ?? '').trim().toLowerCase()
    const items = cohorts
      .filter((c) => {
        if (status && c.status !== status) return false
        if (search) {
          const haystack = `${c.name} ${c.slug}`.toLowerCase()
          if (!haystack.includes(search)) return false
        }
        return true
      })
      .map((c) => {
        const detail = detailCache[c.slug]
        const top = (detail?.members ?? []).slice(0, 3).map((m) => ({
          user_id: m.user_id,
          username: m.username,
          display_name: m.display_name,
          avatar_url: m.avatar_url,
        }))
        return {
          ...c,
          is_member: memberships.has(c.id),
          top_members: top,
        }
      })
    return HttpResponse.json({
      items,
      total: items.length,
      page: 1,
      page_size: 50,
    })
  }),

  http.post(`${base}/cohort`, async ({ request }) => {
    const body = (await request.json()) as {
      name?: string
      slug?: string
      starts_at?: string
      ends_at?: string
      visibility?: 'public' | 'invite'
      capacity?: number
    }
    if (!body.name) return new HttpResponse('name required', { status: 400 })
    const slug =
      body.slug?.trim() ||
      body.name
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, '-')
        .replace(/(^-|-$)/g, '') ||
      `cohort-${Date.now()}`
    const c: WireCohort = {
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
      capacity: body.capacity && body.capacity >= 2 && body.capacity <= 500 ? body.capacity : 50,
    }
    cohorts.unshift(c)
    memberships.add(c.id)
    detailCache[slug] = {
      cohort: c,
      members: [
        {
          user_id: SELF_ID,
          display_name: 'ты',
          username: 'me',
          avatar_url: '',
          avatar_seed: 'me',
          role: 'owner',
          joined_at: c.created_at,
        },
      ],
    }
    return HttpResponse.json({ id: c.id })
  }),

  http.get(`${base}/cohort/:slug`, ({ params }) => {
    const slug = String(params.slug)
    const detail = detailCache[slug]
    if (!detail) return new HttpResponse('not found', { status: 404 })
    return HttpResponse.json(detail)
  }),

  http.post(`${base}/cohort/:id/join`, ({ params }) => {
    const id = String(params.id)
    const c = cohorts.find((c) => c.id === id)
    if (!c) return new HttpResponse('not found', { status: 404 })
    if (!memberships.has(id)) {
      memberships.add(id)
      c.members_count += 1
      // Push self into detail.
      const detail = detailCache[c.slug]
      if (detail) {
        detail.members.push({
          user_id: SELF_ID,
          display_name: 'ты',
          username: 'me',
          avatar_url: '',
          avatar_seed: 'me',
          role: 'member',
          joined_at: new Date().toISOString(),
        })
      }
    }
    return HttpResponse.json({ status: 'joined', cohort_id: id })
  }),

  http.post(`${base}/cohort/:id/leave`, ({ params }) => {
    const id = String(params.id)
    const c = cohorts.find((c) => c.id === id)
    if (!c) return new HttpResponse('not found', { status: 404 })
    if (memberships.has(id)) {
      memberships.delete(id)
      c.members_count = Math.max(0, c.members_count - 1)
      const detail = detailCache[c.slug]
      if (detail) {
        detail.members = detail.members.filter((m) => m.user_id !== SELF_ID)
      }
    }
    return HttpResponse.json({ status: 'left', cohort_id: id })
  }),

  // M5c: PATCH /cohort/{id}
  http.patch(`${base}/cohort/:id`, async ({ params, request }) => {
    const id = String(params.id)
    const c = cohorts.find((c) => c.id === id)
    if (!c) return new HttpResponse('not found', { status: 404 })
    const body = (await request.json()) as {
      name?: string
      ends_at?: string
      visibility?: 'public' | 'invite'
      capacity?: number
    }
    if (body.name !== undefined) c.name = body.name
    if (body.ends_at !== undefined) c.ends_at = body.ends_at
    if (body.visibility !== undefined) c.visibility = body.visibility
    if (body.capacity !== undefined) {
      if (body.capacity < 2 || body.capacity > 500 || body.capacity < c.members_count) {
        return new HttpResponse('invalid capacity', { status: 400 })
      }
      c.capacity = body.capacity
    }
    return HttpResponse.json({ ...c, is_member: memberships.has(c.id) })
  }),

  // POST /cohort/{id}/graduate — owner closes the cohort and emits the
  // CohortGraduated event (mock just flips status; achievement award
  // happens server-side in real backend).
  http.post(`${base}/cohort/:id/graduate`, ({ params }) => {
    const id = String(params.id)
    const c = cohorts.find((c) => c.id === id)
    if (!c) return new HttpResponse('not found', { status: 404 })
    c.status = 'graduated'
    return HttpResponse.json({ ...c, is_member: memberships.has(c.id) })
  }),

  // M5c: POST /cohort/{id}/disband
  http.post(`${base}/cohort/:id/disband`, ({ params }) => {
    const id = String(params.id)
    const c = cohorts.find((c) => c.id === id)
    if (!c) return new HttpResponse('not found', { status: 404 })
    c.status = 'cancelled'
    return HttpResponse.json({ status: 'disbanded', cohort_id: id })
  }),

  // M5c: POST /cohort/{id}/members/{userID}/role
  http.post(`${base}/cohort/:id/members/:userID/role`, async ({ params, request }) => {
    const cid = String(params.id)
    const uid = String(params.userID)
    const body = (await request.json()) as { role?: string }
    const detail = Object.values(detailCache).find((d) => d.cohort.id === cid)
    if (!detail) return new HttpResponse('not found', { status: 404 })
    const target = detail.members.find((m) => m.user_id === uid)
    if (!target) return new HttpResponse('member not found', { status: 404 })
    if (body.role === 'member' || body.role === 'coach') {
      target.role = body.role
    } else {
      return new HttpResponse('invalid role', { status: 400 })
    }
    return HttpResponse.json({ status: 'ok' })
  }),

  // Phase-2 invite-token: POST /cohort/{id}/invite
  http.post(`${base}/cohort/:id/invite`, async ({ params, request }) => {
    const cohortID = String(params.id)
    const c = cohorts.find((c) => c.id === cohortID)
    if (!c) return new HttpResponse('not found', { status: 404 })
    const body = (await request.json()) as { max_uses?: number; ttl_seconds?: number }
    const token = `mock-${Math.random().toString(36).slice(2, 14)}`
    const ttl = body.ttl_seconds ?? 0
    inviteTokens.set(token, {
      cohort_id: cohortID,
      max_uses: body.max_uses ?? 0,
      used_count: 0,
      expires_at: ttl > 0 ? Date.now() + ttl * 1000 : 0,
    })
    return HttpResponse.json({
      token,
      url: `/c/join/${token}`,
      expires_at: ttl > 0 ? new Date(Date.now() + ttl * 1000).toISOString() : '',
    })
  }),

  // Phase-2 invite-token: POST /cohort/join/by-token
  http.post(`${base}/cohort/join/by-token`, async ({ request }) => {
    const body = (await request.json()) as { token?: string }
    const inv = body.token ? inviteTokens.get(body.token) : undefined
    if (!inv) return new HttpResponse('invite expired or invalid', { status: 410 })
    if (inv.expires_at && Date.now() > inv.expires_at) {
      return new HttpResponse('invite expired', { status: 410 })
    }
    if (inv.max_uses > 0 && inv.used_count >= inv.max_uses) {
      return new HttpResponse('invite exhausted', { status: 410 })
    }
    inv.used_count += 1
    const c = cohorts.find((c) => c.id === inv.cohort_id)
    if (!c) return new HttpResponse('cohort gone', { status: 404 })
    if (!memberships.has(c.id)) {
      memberships.add(c.id)
      c.members_count += 1
      const detail = detailCache[c.slug]
      if (detail) {
        detail.members.push({
          user_id: SELF_ID,
          display_name: 'ты',
          username: 'me',
          avatar_url: '',
          avatar_seed: 'me',
          role: 'member',
          joined_at: new Date().toISOString(),
        })
      }
    }
    return HttpResponse.json({ status: 'joined', cohort_id: c.id, slug: c.slug })
  }),

  // Phase 2: GET /cohort/{id}/streak?days=14
  http.get(`${base}/cohort/:id/streak`, ({ params, request }) => {
    const id = String(params.id)
    const c = cohorts.find((c) => c.id === id)
    if (!c) return HttpResponse.json({ items: [], days: 14 })
    const url = new URL(request.url)
    const days = Math.min(30, Math.max(1, parseInt(url.searchParams.get('days') ?? '14', 10) || 14))
    const detail = detailCache[c.slug]
    const today = new Date()
    today.setUTCHours(0, 0, 0, 0)
    const items = (detail?.members ?? []).map((m) => {
      // Pseudo-random but stable per (user_id, date): hash → bool. The
      // mock devs see consistent rows on reload during the same UTC day.
      const dayCells = Array.from({ length: days }, (_, i) => {
        const d = new Date(today.getTime() - (days - 1 - i) * 86_400_000)
        const dateISO = d.toISOString().slice(0, 10)
        // Hash user_id + date → 0..1 → solved if < 0.55. Self gets a
        // slightly higher rate so the dev sees their own line stand out.
        let h = 0
        const seed = `${m.user_id}|${dateISO}`
        for (let k = 0; k < seed.length; k++) h = (h * 31 + seed.charCodeAt(k)) >>> 0
        const r = (h % 1000) / 1000
        const threshold = m.user_id === SELF_ID ? 0.78 : 0.55
        return { date: dateISO, solved: r < threshold }
      })
      return {
        user_id: m.user_id,
        username: m.username,
        display_name: m.display_name,
        days: dayCells,
      }
    })
    return HttpResponse.json({ items, days })
  }),

  http.get(`${base}/cohort/:id/leaderboard`, ({ params }) => {
    const id = String(params.id)
    const c = cohorts.find((c) => c.id === id)
    if (!c) return HttpResponse.json({ items: [] })
    const detail = detailCache[c.slug]
    const items = (detail?.members ?? [])
      .map((m, i) => ({
        user_id: m.user_id,
        display_name: m.display_name,
        overall_elo: 2400 - i * 60 + Math.floor(Math.random() * 40),
        weekly_xp: 580 - i * 20 + Math.floor(Math.random() * 50),
      }))
      .sort((a, b) => b.overall_elo - a.overall_elo)
    return HttpResponse.json({ items })
  }),
]

// isMember exposed so the page can render «ТЫ» chip + «Открыть» CTA.
export function isCohortMember(cohortID: string): boolean {
  return memberships.has(cohortID)
}
