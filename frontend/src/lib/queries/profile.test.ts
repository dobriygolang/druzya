import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchWeeklyShare } from './profile'

// Smoke-тест для публичной share-ссылки. Проверяем, что:
//  - при 200 возвращается распарсенный WeeklyReport
//  - при 404 кидается ошибка со статусом (нужно для retry: false / 404-view)
//  - при 5xx кидается ошибка со статусом (общий retry-bann не должен
//    проглатывать сетевые сбои)
describe('fetchWeeklyShare', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('возвращает WeeklyReport на 200', async () => {
    const fakeReport = {
      week_start: '2026-04-13',
      week_end: '2026-04-20',
      metrics: { tasks_solved: 0, matches_won: 5, rating_change: 12, xp_earned: 800, time_minutes: 120 },
      heatmap: [],
      strengths: [],
      weaknesses: [],
      stress_analysis: '',
      recommendations: [],
      share_token: 'abc',
    }
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(fakeReport),
      } as unknown as Response),
    )
    const out = await fetchWeeklyShare('abc')
    expect(out.metrics.xp_earned).toBe(800)
    expect(out.share_token).toBe('abc')
  })

  it('кидает ошибку со status=404 при отсутствующем токене', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: () => Promise.resolve({}),
      } as unknown as Response),
    )
    await expect(fetchWeeklyShare('missing')).rejects.toMatchObject({ status: 404 })
  })

  it('кидает ошибку со status=500 при backend-сбое', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({}),
      } as unknown as Response),
    )
    await expect(fetchWeeklyShare('boom')).rejects.toMatchObject({ status: 500 })
  })
})
