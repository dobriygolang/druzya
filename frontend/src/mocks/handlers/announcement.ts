// MSW handlers for cohort announcements (M-ann). State is in-memory and
// per-page-session; resets on reload.
import { http, HttpResponse } from 'msw'

const base = '/api/v1'

type WireReactionGroup = { emoji: string; count: number }
type WireAnnouncement = {
  id: string
  cohort_id: string
  author_id: string
  author_username: string
  author_display_name: string
  body: string
  pinned: boolean
  created_at: string
  updated_at: string
  reactions: WireReactionGroup[]
  viewer_reacted: string[]
}

const SELF_ID = '00000000-0000-0000-0000-000000000001'
const ALLOWED = new Set(['🔥', '👍', '❤️', '🎉', '🤔', '👀'])

const announcements = new Map<string, WireAnnouncement>()
// reactionUsers: announcementID → emoji → Set<userID>
const reactions = new Map<string, Map<string, Set<string>>>()

function isoAgo(min: number): string {
  return new Date(Date.now() - min * 60_000).toISOString()
}
function recompute(announcementID: string, viewerID: string): void {
  const a = announcements.get(announcementID)
  if (!a) return
  const rmap = reactions.get(announcementID) ?? new Map<string, Set<string>>()
  a.reactions = []
  a.viewer_reacted = []
  rmap.forEach((users, emoji) => {
    a.reactions.push({ emoji, count: users.size })
    if (users.has(viewerID)) a.viewer_reacted.push(emoji)
  })
}

// Pre-seed: one pinned + one regular post on the dev's pre-joined cohort.
;(function seed(): void {
  const cohortID = 'c-yandex-spring-26'
  const a1: WireAnnouncement = {
    id: 'ann-seed-1',
    cohort_id: cohortID,
    author_id: 'u-mentor-1',
    author_username: 'grim_grimoire',
    author_display_name: 'Глеб',
    body: 'Привет! Завтра в 19:00 — стрим по dynamic programming, разберём 5 leetcode-medium. Заходите 🤘',
    pinned: true,
    created_at: isoAgo(60 * 4),
    updated_at: isoAgo(60 * 4),
    reactions: [],
    viewer_reacted: [],
  }
  const a2: WireAnnouncement = {
    id: 'ann-seed-2',
    cohort_id: cohortID,
    author_id: 'u-mentor-1',
    author_username: 'grim_grimoire',
    author_display_name: 'Глеб',
    body: 'Кто решил weekly challenge — кидайте свои решения в Discord, обсудим.',
    pinned: false,
    created_at: isoAgo(60 * 28),
    updated_at: isoAgo(60 * 28),
    reactions: [],
    viewer_reacted: [],
  }
  announcements.set(a1.id, a1)
  announcements.set(a2.id, a2)
  // Seed: 3 reactions on the pinned post (one from self).
  const r1 = new Map<string, Set<string>>([
    ['🔥', new Set(['u-mentor-2', 'u-mentor-3', SELF_ID])],
    ['🎉', new Set(['u-mentor-2'])],
  ])
  reactions.set(a1.id, r1)
  recompute(a1.id, SELF_ID)
})()

export const announcementHandlers = [
  http.get(`${base}/cohort/:cohortID/announcement`, ({ params }) => {
    const cohortID = String(params.cohortID)
    const items = Array.from(announcements.values())
      .filter((a) => a.cohort_id === cohortID)
      .sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
        return b.created_at.localeCompare(a.created_at)
      })
    items.forEach((a) => recompute(a.id, SELF_ID))
    return HttpResponse.json({ items })
  }),

  http.post(`${base}/cohort/:cohortID/announcement`, async ({ params, request }) => {
    const cohortID = String(params.cohortID)
    const body = (await request.json()) as { body?: string; pinned?: boolean }
    if (!body.body || !body.body.trim()) {
      return new HttpResponse('body required', { status: 400 })
    }
    const a: WireAnnouncement = {
      id: `ann-${Date.now()}`,
      cohort_id: cohortID,
      author_id: SELF_ID,
      author_username: 'me',
      author_display_name: 'ты',
      body: body.body,
      pinned: !!body.pinned,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      reactions: [],
      viewer_reacted: [],
    }
    announcements.set(a.id, a)
    return HttpResponse.json(a)
  }),

  http.delete(`${base}/cohort/announcement/:id`, ({ params }) => {
    const id = String(params.id)
    if (!announcements.has(id)) return new HttpResponse('not found', { status: 404 })
    announcements.delete(id)
    reactions.delete(id)
    return HttpResponse.json({})
  }),

  http.post(`${base}/cohort/announcement/:id/react`, async ({ params, request }) => {
    const id = String(params.id)
    const body = (await request.json()) as { emoji?: string }
    const emoji = body.emoji ?? ''
    if (!ALLOWED.has(emoji)) return new HttpResponse('invalid emoji', { status: 400 })
    if (!announcements.has(id)) return new HttpResponse('not found', { status: 404 })
    let m = reactions.get(id)
    if (!m) {
      m = new Map()
      reactions.set(id, m)
    }
    let users = m.get(emoji)
    if (!users) {
      users = new Set()
      m.set(emoji, users)
    }
    users.add(SELF_ID)
    recompute(id, SELF_ID)
    return HttpResponse.json({ announcement_id: id, emoji, count: users.size })
  }),

  http.delete(`${base}/cohort/announcement/:id/react/:emoji`, ({ params }) => {
    const id = String(params.id)
    const emoji = decodeURIComponent(String(params.emoji))
    const m = reactions.get(id)
    const users = m?.get(emoji)
    if (users) {
      users.delete(SELF_ID)
      if (users.size === 0) m?.delete(emoji)
    }
    recompute(id, SELF_ID)
    return HttpResponse.json({ announcement_id: id, emoji, count: users?.size ?? 0 })
  }),
]
