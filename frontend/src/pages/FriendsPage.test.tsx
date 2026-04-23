import { describe, expect, it } from 'vitest'
import { recentSorted, type FriendDTO } from '../lib/queries/friends'

const mk = (over: Partial<FriendDTO>): FriendDTO => ({
  user_id: 'u', username: 'u', display_name: '', avatar_url: '',
  tier: '', online: false, last_match_at: null, ...over,
})

describe('recentSorted', () => {
  it('puts most recent first, nulls last, max 10', () => {
    const items = [
      mk({ user_id: 'a', last_match_at: null }),
      mk({ user_id: 'b', last_match_at: '2026-04-23T01:00:00Z' }),
      mk({ user_id: 'c', last_match_at: '2026-04-22T01:00:00Z' }),
    ]
    const got = recentSorted(items)
    expect(got.map((x) => x.user_id)).toEqual(['b', 'c', 'a'])
  })

  it('caps to 10', () => {
    const items = Array.from({ length: 20 }).map((_, i) =>
      mk({ user_id: String(i), last_match_at: `2026-04-${10 + i}T00:00:00Z` }),
    )
    expect(recentSorted(items).length).toBe(10)
  })
})
