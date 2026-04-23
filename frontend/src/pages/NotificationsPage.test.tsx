import { describe, expect, it } from 'vitest'
import { bucketOf, groupByBucket, type NotificationItem } from '../lib/queries/notifications'

const NOW = new Date('2026-04-23T12:00:00Z')

const mk = (iso: string, over: Partial<NotificationItem> = {}): NotificationItem => ({
  id: 1, channel: 'system', type: 'x', title: '', body: '', payload: null,
  priority: 0, read_at: null, created_at: iso, ...over,
})

describe('bucketOf', () => {
  it('today returns today', () => {
    expect(bucketOf('2026-04-23T08:00:00Z', NOW)).toBe('today')
  })
  it('yesterday', () => {
    expect(bucketOf('2026-04-22T18:00:00Z', NOW)).toBe('yesterday')
  })
  it('this_week', () => {
    expect(bucketOf('2026-04-19T18:00:00Z', NOW)).toBe('this_week')
  })
  it('older', () => {
    expect(bucketOf('2026-03-01T18:00:00Z', NOW)).toBe('older')
  })
})

describe('groupByBucket', () => {
  it('partitions correctly', () => {
    const items = [
      mk('2026-04-23T08:00:00Z'),
      mk('2026-04-22T08:00:00Z'),
      mk('2026-04-19T08:00:00Z'),
      mk('2026-03-01T08:00:00Z'),
    ]
    const g = groupByBucket(items, NOW)
    expect(g.today.length).toBe(1)
    expect(g.yesterday.length).toBe(1)
    expect(g.this_week.length).toBe(1)
    expect(g.older.length).toBe(1)
  })
})
