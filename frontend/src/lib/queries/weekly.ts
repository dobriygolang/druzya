import { useQuery } from '@tanstack/react-query'
import i18n, { bcp47 } from '../i18n'
import { api } from '../apiClient'
import type { WeeklyReport as ProfileWeeklyReport } from './profile'

// WeeklyReport — финальная shape, которую рендерит WeeklyReportPage. Читается
// напрямую из /profile/me/report, поля адаптируются под существующий UI прямо
// в queryFn. Удалённые поля (strong/weak_sections, weekly_xp, hourly_heatmap,
// elo_series, percentiles, achievements_this_week) бэк больше не наполняет —
// соответствующие виджеты убраны из WeeklyReportPage.
export type WeeklyReport = {
  period: string
  actions_count: number
  stats: {
    xp: { value: string; delta: string }
    matches: { value: string; wins: number; losses: number; delta: string }
    streak: { value: string; best: number }
    avg_lp: { value: string; total: string }
  }
  strong_sections: { id: string; name: string; sub: string; xp: string }[]
  weak_sections: { id: string; name: string; sub: string; xp: string; tone: string }[]
  stress_pattern: string
  actions: { p: string; text: string; sub: string }[]
  heatmap: number[]
  week_start: string
  week_end: string
  ai_insight: string
  share_token: string
}

const SECTION_NAMES: Record<string, string> = {
  algorithms: 'Algorithms',
  sql: 'SQL',
  go: 'Go',
  system_design: 'System Design',
  behavioral: 'Behavioral',
}

const SECTION_LETTERS: Record<string, string> = {
  algorithms: 'A',
  sql: 'Q',
  go: 'G',
  system_design: 'S',
  behavioral: 'B',
}

function fmtPercent(curr: number, prev: number): string {
  if (prev <= 0) {
    if (curr === 0) return '0%'
    return '+∞%'
  }
  const delta = ((curr - prev) / prev) * 100
  const sign = delta >= 0 ? '+' : ''
  return `${sign}${Math.round(delta)}%`
}

function fmtPeriod(weekStart: string, weekEnd: string): string {
  // weekStart/weekEnd are YYYY-MM-DD strings.
  try {
    const start = new Date(weekStart)
    const end = new Date(weekEnd)
    const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long' }
    const startStr = start.toLocaleDateString('ru', { day: 'numeric' })
    const endStr = end.toLocaleDateString('ru', opts)
    return `${startStr}–${endStr}`
  } catch {
    return `${weekStart} — ${weekEnd}`
  }
}

function adapt(raw: ProfileWeeklyReport): WeeklyReport {
  const m = raw.metrics
  const wins = m.matches_won ?? 0
  const matchesTotal = m.tasks_solved && m.tasks_solved >= wins ? m.tasks_solved : wins
  const losses = Math.max(matchesTotal - wins, 0)
  const xpEarned = m.xp_earned ?? 0
  const prevXP = raw.prev_xp_earned ?? 0
  const lpDelta = m.rating_change ?? 0
  const avgLp = matchesTotal > 0 ? lpDelta / matchesTotal : 0
  const streakCur = raw.streak_days ?? 0
  const streakBest = raw.best_streak ?? 0

  const strong = (raw.strong_sections ?? []).map((s) => ({
    id: SECTION_LETTERS[s.section] ?? s.section.charAt(0).toUpperCase(),
    name: SECTION_NAMES[s.section] ?? s.section,
    sub: i18n.t('pages:weekly.section_summary', { matches: s.matches, rate: s.win_rate_pct }),
    xp: `${s.xp_delta >= 0 ? '+' : ''}${s.xp_delta} XP`,
  }))
  const weak = (raw.weak_sections ?? []).map((s, idx) => ({
    id: SECTION_LETTERS[s.section] ?? s.section.charAt(0).toUpperCase(),
    name: SECTION_NAMES[s.section] ?? s.section,
    sub: i18n.t('pages:weekly.section_summary', { matches: s.matches, rate: s.win_rate_pct }),
    xp: `${s.xp_delta >= 0 ? '+' : ''}${s.xp_delta} XP`,
    tone: idx === 0 ? 'danger' : 'warn',
  }))
  const actions = (raw.recommendations ?? []).slice(0, 3).map((r, idx) => ({
    p: idx === 0 ? 'P1' : idx === 1 ? 'P1' : 'P2',
    text: r.title,
    sub: '',
  }))

  return {
    period: fmtPeriod(raw.week_start, raw.week_end),
    actions_count: raw.actions_count ?? matchesTotal,
    stats: {
      xp: { value: xpEarned.toLocaleString(bcp47(), { signDisplay: 'always' }), delta: fmtPercent(xpEarned, prevXP) },
      matches: { value: String(matchesTotal), wins, losses, delta: fmtPercent(matchesTotal, 0) },
      streak: { value: streakCur > 0 ? `${streakCur} 🔥` : '0', best: streakBest },
      avg_lp: { value: `${avgLp >= 0 ? '+' : ''}${avgLp.toFixed(1)}`, total: i18n.t('pages:weekly.lp_total', { delta: lpDelta >= 0 ? `+${lpDelta}` : String(lpDelta) }) },
    },
    strong_sections: strong,
    weak_sections: weak,
    stress_pattern: raw.stress_analysis ?? '',
    actions,
    heatmap: raw.heatmap ?? [],
    week_start: raw.week_start,
    week_end: raw.week_end,
    ai_insight: raw.ai_insight ?? '',
    share_token: raw.share_token ?? '',
  }
}

export function useWeeklyReportQuery() {
  return useQuery({
    queryKey: ['profile', 'me', 'report'],
    queryFn: async () => {
      const raw = await api<ProfileWeeklyReport>('/profile/me/report')
      return adapt(raw)
    },
    staleTime: 30_000,
    gcTime: 5 * 60_000,
  })
}
