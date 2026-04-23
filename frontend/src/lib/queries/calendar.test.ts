import { describe, expect, it } from 'vitest'
import { adaptCalendar, formatCountdown, priorityLabelRU } from './calendar'

describe('formatCountdown', () => {
  it('возвращает "Xд YYч MMм" для будущей даты', () => {
    const now = new Date('2026-04-22T12:00:00Z')
    // ровно 3 дня и 4 часа 5 минут вперёд
    const target = new Date('2026-04-25T16:05:00Z').toISOString()
    expect(formatCountdown(target, now)).toBe('3д 04ч 05м')
  })

  it('даёт пустую строку, если дата уже прошла', () => {
    const now = new Date('2026-04-22T12:00:00Z')
    expect(formatCountdown('2026-01-01T00:00:00Z', now)).toBe('')
  })

  it('даёт пустую строку для невалидной даты', () => {
    expect(formatCountdown('not-a-date')).toBe('')
  })
})

describe('adaptCalendar', () => {
  const now = new Date('2026-04-22T10:00:00Z')

  it('первый незакрытый task → active, остальные → future', () => {
    const view = adaptCalendar(
      {
        id: 'cal-1',
        company_id: 'c1',
        role: 'Senior Backend',
        interview_date: '2026-05-01T10:00:00Z',
        days_left: 9,
        readiness_pct: 55,
        today: [
          { kind: 'solve_task', title: 'Two Sum', estimated_min: 10, done: true, target_id: 't1' },
          { kind: 'mock', title: 'Mock SD', estimated_min: 40, done: false, target_id: 't2' },
          { kind: 'podcast', title: 'Kafka deep dive', estimated_min: 25, done: false, target_id: 't3' },
        ],
        week_plan: [],
        weak_zones: [],
      },
      now,
    )
    expect(view.today_tasks.map((t) => t.status)).toEqual(['done', 'active', 'future'])
    expect(view.today_tasks[1].sub).toBe('Mock-собес · 40 мин')
  })

  it('считает countdown по interview_date', () => {
    const view = adaptCalendar(
      {
        id: 'cal-1',
        company_id: 'c1',
        role: 'Senior Backend',
        interview_date: '2026-04-25T13:30:00Z',
        days_left: 3,
        readiness_pct: 60,
        today: [],
        week_plan: [],
        weak_zones: [],
      },
      now,
    )
    expect(view.countdown).toBe('3д 03ч 30м')
  })

  it('переносит weak_zones и week_plan без изменений', () => {
    const view = adaptCalendar(
      {
        id: 'cal-1',
        company_id: 'c1',
        role: 'X',
        interview_date: '2030-01-01T00:00:00Z',
        days_left: 100,
        readiness_pct: 0,
        today: [],
        week_plan: [{ date: '2026-04-23', tasks: [] }],
        weak_zones: [{ atlas_node_key: 'algo_dp', priority: 'high' }],
      },
      now,
    )
    expect(view.week_plan).toHaveLength(1)
    expect(view.weak_zones).toHaveLength(1)
    expect(view.weak_zones[0].atlas_node_key).toBe('algo_dp')
  })
})

describe('priorityLabelRU', () => {
  it('переводит известные приоритеты', () => {
    expect(priorityLabelRU('high')).toBe('Высокий')
    expect(priorityLabelRU('medium')).toBe('Средний')
    expect(priorityLabelRU('low')).toBe('Низкий')
  })
  it('возвращает исходное значение, если приоритет неизвестен', () => {
    expect(priorityLabelRU('critical')).toBe('critical')
  })
})
