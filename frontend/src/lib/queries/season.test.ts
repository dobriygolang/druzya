import { describe, it, expect } from 'vitest'
import { trackOf, type SeasonProgress } from './season'

function progress(): SeasonProgress {
  return {
    season: { id: 's', name: 'Test', slug: 'test' },
    my_points: 250,
    tier: 2,
    is_premium: false,
    tracks: [
      {
        kind: 'free',
        tiers: [
          { tier: 1, required_points: 100, reward_key: 'avatar_frame_01', claimed: true },
          { tier: 2, required_points: 250, reward_key: 'title_02', claimed: false },
        ],
      },
      {
        kind: 'premium',
        tiers: [
          { tier: 1, required_points: 100, reward_key: 'ai_credits_01', claimed: false },
        ],
      },
    ],
    weekly_challenges: [],
  }
}

describe('trackOf', () => {
  it('returns the free ladder when present', () => {
    const out = trackOf(progress(), 'free')
    expect(out).toHaveLength(2)
    expect(out[0].reward_key).toBe('avatar_frame_01')
  })

  it('returns the premium ladder when present', () => {
    const out = trackOf(progress(), 'premium')
    expect(out).toHaveLength(1)
    expect(out[0].reward_key).toBe('ai_credits_01')
  })

  it('returns [] when progress is undefined', () => {
    expect(trackOf(undefined, 'free')).toEqual([])
  })

  it('returns [] for an unknown kind on an existing payload', () => {
    const p = progress()
    p.tracks = [p.tracks[0]] // only free
    expect(trackOf(p, 'premium')).toEqual([])
  })

  it('preserves tier ordering as the API delivered it', () => {
    const p = progress()
    const free = trackOf(p, 'free')
    expect(free.map((t) => t.tier)).toEqual([1, 2])
  })

  it('does not mutate the original progress object', () => {
    const p = progress()
    const before = JSON.stringify(p)
    trackOf(p, 'free')
    expect(JSON.stringify(p)).toBe(before)
  })
})
