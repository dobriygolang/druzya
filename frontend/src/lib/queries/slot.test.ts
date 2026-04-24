import { describe, it, expect } from 'vitest'
import { derivePriceBuckets, normalizeSlot, type Slot } from './slot'

function slot(price: number, id = '00000000-0000-0000-0000-000000000000'): Slot {
  return {
    id,
    interviewer: { user_id: id, username: 'user' },
    starts_at: new Date().toISOString(),
    duration_min: 60,
    section: 'algorithms',
    language: 'ru',
    price_rub: price,
    status: 'available',
  }
}

describe('derivePriceBuckets', () => {
  it('returns empty array when no slots', () => {
    expect(derivePriceBuckets([])).toEqual([])
  })

  it('skips zero-price slots (free) for bucket math', () => {
    const out = derivePriceBuckets([slot(0), slot(0)])
    expect(out).toEqual([])
  })

  it('returns ascending unique buckets capped at 3', () => {
    const slots = [
      slot(500),
      slot(1000),
      slot(1500),
      slot(2000),
      slot(2500),
      slot(3000),
    ]
    const buckets = derivePriceBuckets(slots)
    expect(buckets.length).toBeLessThanOrEqual(3)
    // monotonic ascending
    for (let i = 1; i < buckets.length; i++) {
      expect(buckets[i]).toBeGreaterThan(buckets[i - 1])
    }
  })

  it('rounds buckets up to nearest 500', () => {
    const buckets = derivePriceBuckets([slot(750), slot(1234), slot(1812)])
    for (const b of buckets) {
      expect(b % 500).toBe(0)
    }
  })

  it('caps round up to the next 500₽ above the catalogue max', () => {
    const slots = [slot(800), slot(1600), slot(2400)]
    const buckets = derivePriceBuckets(slots)
    // max=2400 → ceil(2400/500)*500 = 2500 — fine to slightly exceed the
    // raw max so the chip label is friendlier ("до 2500₽" vs "до 2400₽").
    for (const b of buckets) {
      expect(b).toBeLessThanOrEqual(2500)
    }
  })

  it('handles a single slot', () => {
    const buckets = derivePriceBuckets([slot(1234)])
    expect(buckets.length).toBeGreaterThanOrEqual(1)
    expect(buckets[0]).toBe(1500) // ceil(1234/500)*500
  })

  it('deduplicates buckets when many slots cluster around the same price', () => {
    const buckets = derivePriceBuckets(
      Array.from({ length: 12 }, () => slot(900)),
    )
    expect(new Set(buckets).size).toBe(buckets.length)
  })
})

describe('normalizeSlot', () => {
  const base = {
    id: 'slot-1',
    interviewer: { user_id: 'u1', username: 'u' },
    starts_at: '2026-04-22T18:00:00Z',
    duration_min: 60,
    language: 'ru',
    price_rub: 1000,
  }

  it('maps canonical proto enum names to short form', () => {
    const out = normalizeSlot({
      ...base,
      section: 'SECTION_ALGORITHMS',
      difficulty: 'DIFFICULTY_MEDIUM',
      status: 'SLOT_STATUS_AVAILABLE',
    })
    expect(out.section).toBe('algorithms')
    expect(out.difficulty).toBe('medium')
    expect(out.status).toBe('available')
  })

  it('accepts legacy short-form enums', () => {
    const out = normalizeSlot({
      ...base,
      section: 'sql',
      difficulty: 'easy',
      status: 'booked',
    })
    expect(out.section).toBe('sql')
    expect(out.difficulty).toBe('easy')
    expect(out.status).toBe('booked')
  })

  it('leaves difficulty undefined when absent', () => {
    const out = normalizeSlot({
      ...base,
      section: 'SECTION_BEHAVIORAL',
      status: 'SLOT_STATUS_AVAILABLE',
    })
    expect(out.difficulty).toBeUndefined()
  })

  it('falls back to "available" on unknown status (forward-compat)', () => {
    const out = normalizeSlot({
      ...base,
      section: 'SECTION_GO',
      status: 'SLOT_STATUS_FUTURE_UNKNOWN',
    })
    expect(out.status).toBe('available')
  })

  it('throws on unknown section — surfaces proto drift loudly', () => {
    expect(() =>
      normalizeSlot({
        ...base,
        section: 'SECTION_FROM_MARS',
        status: 'SLOT_STATUS_AVAILABLE',
      }),
    ).toThrow(/unknown slot section/)
  })
})
