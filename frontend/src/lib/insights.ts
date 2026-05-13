// Цель: coach не ждёт юзера. Detection rules смотрят на F5 activity log,
// F2 goal, F3 readiness + F9 diagnostic и produce «nudge» / «warn» events.
// Coach начинает «говорить сам»: «Не log'ал 3 дня — что случилось?»,
// «Streak 5 дней — продолжай», «Дедлайн через 20 дней, readiness 35%».

import { computeStreak, computeTrajectory, getActivitySummary, listActivities } from './activity'
import { getCueSessionsSummary } from './cueSessions'
import { loadProgress } from './diagnostic'
import { getGoal } from './goal'
import { generateMilestones } from './milestones'
import { loadResult, resultAgeDays } from './miniMock'
import { computeReadiness } from './readiness'

export type InsightKind =
  | 'user_inactive'        // нет activities X дней
  | 'streak_active'        // log'ает уже N дней подряд
  | 'habit_locked'         // 30+ day streak — celebrate
  | 'mock_overdue'         // нет mock'а >7 дней при active goal
  | 'mini_mock_pending'    // goal есть, mini-mock не пройден
  | 'mini_mock_stale'      // mini-mock >14d, нужен refresh
  | 'mini_mock_strong'     // recent mini-mock ≥4.0 — positive reinforcement
  | 'mini_mock_weak'       // recent mini-mock <2.0 — критический gap
  | 'trajectory_declining' // verdict='просел' за 2 недели
  | 'trajectory_uptrend'   // verdict='на подъёме' — celebrate
  | 'milestone_overdue'    // current week milestone не done > 3 дней
  | 'milestone_focus'      // gentle reminder про current week milestone
  | 'milestone_streak'     // N подряд закрытых milestone — celebrate
  | 'deadline_close'       // <30 дней до goal date + low readiness
  | 'readiness_stale'      // goal есть но F9 не пройдена
  | 'first_step'           // нет goal — gentle nudge к diagnostic
  | 'cue_struggling'       // Cue session показал struggling stages
  | 'cue_recent_review'    // Recent Cue session — обсудить с coach

export type InsightSeverity = 'cruise' | 'nudge' | 'warn' | 'critical'

export interface InsightAction {
  /** Куда ведёт CTA (relative path или external URL). */
  href: string
  /** Текст CTA. */
  label: string
}

export interface CoachInsight {
  id: string  // stable, used for dismiss persistence
  kind: InsightKind
  severity: InsightSeverity
  /** Short banner text (max ~80 chars для smooth render). */
  headline: string
  /** Optional longer rationale (rendered как secondary text). */
  detail?: string
  /** Optional primary CTA. */
  action?: InsightAction
  /** Может ли юзер dismiss через × button. По умолчанию true. */
  dismissible?: boolean
}

// ── Detection rules ─────────────────────────────────────────────────────

function daysSince(ms: number): number {
  const diff = Date.now() - ms
  return Math.floor(diff / (1000 * 60 * 60 * 24))
}

/**
 * Detect ALL applicable insights. Caller сортирует по severity / dismiss
 * filter и берёт top 1-N для render'а.
 */
export function detectInsights(): CoachInsight[] {
  const out: CoachInsight[] = []
  const goal = getGoal()
  const answers = loadProgress()
  const summary = getActivitySummary()
  const recent = listActivities()

  // ── 1. No goal → first_step nudge ─────────────────────────────────────
  if (!goal) {
    out.push({
      id: 'first-step-set-goal',
      kind: 'first_step',
      severity: 'nudge',
      headline: 'Поставь цель — coach начнёт строить план',
      detail:
        'Без цели coach плывёт без курса. 8-минутный quiz даст suggested цель + 3 first actions.',
      action: { href: '/diagnostic', label: 'Пройти диагностику' },
    })
    // Other insights требуют goal — return early.
    return out
  }

  const readiness = computeReadiness(goal)
  const hasDiagnostic = Object.keys(answers).length > 0
  const lastActivityAt = summary.lastActivityAt
  const daysSinceLast = lastActivityAt !== null ? daysSince(lastActivityAt) : null

  // ── 2. Inactivity ─────────────────────────────────────────────────────
  if (lastActivityAt === null) {
    // Никогда не log'ал — gentle (это same что first-step но goal уже есть)
    out.push({
      id: 'inactive-never-logged',
      kind: 'user_inactive',
      severity: 'nudge',
      headline: 'Журнал пуст. Что сделал сегодня?',
      detail: 'Логирование активности позволит coach отслеживать прогресс и адаптировать план.',
      action: { href: '/today#activity', label: 'Залогировать занятие' },
    })
  } else if (daysSinceLast !== null) {
    if (daysSinceLast >= 7) {
      out.push({
        id: 'inactive-7d',
        kind: 'user_inactive',
        severity: 'critical',
        headline: `Неделя без активности (последнее ${daysSinceLast} дн. назад)`,
        detail:
          'Coach начинает забывать контекст. Coach memory декаит — даже малое занятие восстановит momentum.',
        action: { href: '/today#activity', label: 'Залогировать что-то' },
      })
    } else if (daysSinceLast >= 4) {
      out.push({
        id: 'inactive-4d',
        kind: 'user_inactive',
        severity: 'warn',
        headline: `${daysSinceLast} ${pluralDays(daysSinceLast)} без активности — теряем темп`,
        detail: 'Coach помнит только что было; без сигналов план застывает.',
        action: { href: '/today#activity', label: 'Что сделал?' },
      })
    } else if (daysSinceLast >= 2) {
      out.push({
        id: 'inactive-2d',
        kind: 'user_inactive',
        severity: 'nudge',
        headline: `${daysSinceLast} ${pluralDays(daysSinceLast)} без сигнала — что случилось?`,
        action: { href: '/today#activity', label: 'Залогировать' },
      })
    }
  }

  // ── 3. Streak detection ───────────────────────────────────────────────
  // Считаем consecutive дней с >=1 activity (newest backward).
  if (recent.length > 0) {
    const days = new Set<string>()
    for (const a of recent) {
      const d = new Date(a.occurredAt)
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
      days.add(key)
    }
    // Check streak: today, yesterday, day-before...
    let streak = 0
    const cursor = new Date()
    for (let i = 0; i < 30; i++) {
      const key = `${cursor.getFullYear()}-${cursor.getMonth()}-${cursor.getDate()}`
      if (days.has(key)) {
        streak++
        cursor.setDate(cursor.getDate() - 1)
      } else {
        break
      }
    }
    if (streak >= 5) {
      out.push({
        id: `streak-${streak}`,
        kind: 'streak_active',
        severity: 'cruise',
        headline: `${streak} ${pluralDays(streak)} подряд — держишь ритм`,
        detail: 'Coach видит momentum. Readiness ускоряется когда practice ежедневная.',
      })
    } else if (streak >= 3) {
      out.push({
        id: `streak-${streak}`,
        kind: 'streak_active',
        severity: 'cruise',
        headline: `${streak} дня подряд — продолжай`,
      })
    }
  }

  // ── 4. Mock overdue — нет mock >7 дней + goal active ──────────────────
  const lastMock = recent.find((a) => a.kind === 'mock')
  if (!lastMock) {
    // Goal есть но ни одного mock — гентли nudge.
    out.push({
      id: 'mock-never',
      kind: 'mock_overdue',
      severity: 'nudge',
      headline: 'Ни одного mock в журнале — нужен baseline',
      detail: 'Mock — единственный честный метрик где ты слаб. Хотя бы mini-mock покажет ось.',
      action: { href: '/mock', label: 'Сыграть mock' },
    })
  } else {
    const daysSinceLastMock = daysSince(lastMock.occurredAt)
    if (daysSinceLastMock >= 14) {
      out.push({
        id: 'mock-overdue-14d',
        kind: 'mock_overdue',
        severity: 'warn',
        headline: `2 недели без mock — что-то изменилось?`,
        detail:
          'Readiness без mock-сессий это self-report. Лучшая калибровка — реальная mock.',
        action: { href: '/mock', label: 'Mock' },
      })
    } else if (daysSinceLastMock >= 7) {
      out.push({
        id: 'mock-overdue-7d',
        kind: 'mock_overdue',
        severity: 'nudge',
        headline: 'Mock-checkpoint назрел (>7 дней)',
        action: { href: '/mock', label: 'Mock' },
      })
    }
  }

  // ── 5. Deadline close + low readiness ─────────────────────────────────
  if (readiness.daysToTarget !== null && goal.targetDate) {
    if (readiness.daysToTarget < 14 && readiness.readinessPct < 60) {
      out.push({
        id: 'deadline-14d-low',
        kind: 'deadline_close',
        severity: 'critical',
        headline: `${readiness.daysToTarget} дн. до срока — readiness ${readiness.readinessPct}%`,
        detail:
          'Времени мало. Coach рекомендует daily mock-сессии + focus на weakest area; что unrealistic закрыть — отметь как next iteration goal.',
        action: { href: '/mock', label: 'Срочный mock' },
      })
    } else if (readiness.daysToTarget < 30 && readiness.readinessPct < 50) {
      out.push({
        id: 'deadline-30d-low',
        kind: 'deadline_close',
        severity: 'warn',
        headline: `Месяц до срока, readiness ${readiness.readinessPct}%`,
        detail: 'Темп нужно ускорить или пересмотреть scope. Open Coach обсудить trade-offs.',
        action: { href: '/tutor/ai/algo-coach', label: 'Coach: обсудить' },
      })
    }
  }

  // ── 6. Readiness stale — goal есть, F9 не пройдена ────────────────────
  if (!hasDiagnostic) {
    out.push({
      id: 'readiness-stale-no-quiz',
      kind: 'readiness_stale',
      severity: 'nudge',
      headline: `Readiness основан только на goal kind — пройди quiz чтобы уточнить`,
      detail:
        'F9 диагностика добавит до 35% дельты к readiness (experience / budget / weakest area). 8 минут.',
      action: { href: '/diagnostic', label: 'Пройти диагностику' },
    })
  }

  // ── 7. Cue session signals (F10 cross-product moat) ────────────────────
  const cueSummary = getCueSessionsSummary()
  if (cueSummary.lastSessionAt !== null) {
    const daysSinceCue = daysSince(cueSummary.lastSessionAt)
    if (daysSinceCue <= 2) {
      // Recent Cue — рекомендуем review.
      out.push({
        id: `cue-recent-${cueSummary.lastSessionAt}`,
        kind: 'cue_recent_review',
        severity: 'nudge',
        headline: 'Свежая Cue session — разобрать с coach?',
        detail:
          'AI помнит transcript собеса; разбор за 10 минут даст concrete next-step. Это валит mock prep на голову лучше абстрактных drills.',
        action: { href: '/tutor/ai/algo-coach', label: 'Разбор с Coach' },
      })
    }
    if (cueSummary.strugglingStages.length > 0) {
      // Struggling stages — warn-level.
      out.push({
        id: `cue-struggling-${cueSummary.strugglingStages.join('-')}`,
        kind: 'cue_struggling',
        severity: 'warn',
        headline: `Cue выявила weak: ${cueSummary.strugglingStages.join(', ')}`,
        detail:
          'Self-rating <=2 на этих стадиях по 2+ сессиям — pattern. Focus block имеет смысл закрыть именно их.',
        action: { href: '/today', label: 'Открыть план' },
      })
    }
  }

  // ── 8. F8 mini-mock signals ────────────────────────────────────────────
  // Goal is set (мы прошли guard выше). Surface mini-mock-driven nudges.
  const mmResult = loadResult()
  const mmAge = resultAgeDays()
  if (mmResult === null) {
    out.push({
      id: 'minimock-pending',
      kind: 'mini_mock_pending',
      severity: 'nudge',
      headline: 'Mini-mock не пройден — readiness основан на heuristic',
      detail:
        '20-минутный self-check даст ±15% к F3 readiness на основе реального ответа. До этого % — догадки.',
      action: { href: '/mock/diagnostic', label: 'Пройти mini-mock' },
    })
  } else if (mmAge !== null && mmAge > 14) {
    out.push({
      id: `minimock-stale-${mmAge}`,
      kind: 'mini_mock_stale',
      severity: 'nudge',
      headline: `Mini-mock устарел (${mmAge} ${pluralDays(mmAge)} назад)`,
      detail:
        'Свежее прохождение перетянет factor — за 2 недели юзер успевает закрыть gaps. Заодно проверишь себя.',
      action: { href: '/mock/diagnostic', label: 'Перепройти' },
    })
  } else if (mmResult.overallScore >= 4.0) {
    // Positive reinforcement — strong signal, redirect к ambitious push.
    out.push({
      id: `minimock-strong-${mmResult.takenOn}`,
      kind: 'mini_mock_strong',
      severity: 'cruise',
      headline: `Mini-mock ${mmResult.overallScore.toFixed(1)}/5 — fundamentals strong`,
      detail:
        'Не теряй momentum. Сделай полный mock pipeline чтобы поднять planku до senior bar.',
      action: { href: '/mock', label: 'Полный mock' },
    })
  } else if (mmResult.overallScore < 2.0) {
    out.push({
      id: `minimock-weak-${mmResult.takenOn}`,
      kind: 'mini_mock_weak',
      severity: 'critical',
      headline: `Mini-mock ${mmResult.overallScore.toFixed(1)}/5 — критический gap`,
      detail:
        'Прежде чем гнать темп, нужно закрыть базу. Coach подскажет с чего начать конкретно.',
      action: { href: '/tutor/ai/algo-coach', label: 'Открыть Coach' },
    })
  }

  // ── 9. Trajectory signals (week-vs-week trend) ─────────────────────────
  // Тributorial: surface только при достаточной данных (lastWeek > 0 чтобы
  // delta была meaningful). Anti-fallback: первая неделя — никаких verdict.
  const trajectory = computeTrajectory()
  if (trajectory.lastWeek > 0) {
    if (trajectory.verdict === 'просел') {
      out.push({
        id: `trajectory-declining-${trajectory.thisWeek}-${trajectory.lastWeek}`,
        kind: 'trajectory_declining',
        severity: 'warn',
        headline: `Темп просел: ${trajectory.thisWeek} vs ${trajectory.lastWeek} на прошлой неделе`,
        detail:
          'Что-то сместило фокус? Открой план — adjust budget или типы actions можно прямо сейчас.',
        action: { href: '/today', label: 'Адаптировать план' },
      })
    } else if (trajectory.verdict === 'на подъёме') {
      out.push({
        id: `trajectory-uptrend-${trajectory.thisWeek}`,
        kind: 'trajectory_uptrend',
        severity: 'cruise',
        headline: `Темп +${trajectory.weekDelta} занятий — на подъёме`,
        detail:
          'Coach видит uptrend. Это window когда practice-density максимальна — fix-it дольше так чтобы readiness ускорилась.',
      })
    }
  }

  // ── 10. Habit locked — 30+ day streak ─────────────────────────────────
  const streak = computeStreak()
  if (streak.days >= 30) {
    out.push({
      id: `habit-locked-${streak.days}`,
      kind: 'habit_locked',
      severity: 'cruise',
      headline: `${streak.days} ${pluralDays(streak.days)} подряд — habit locked in`,
      detail:
        'Это discipline-tier. Senior interview prep на этой стадии — вопрос времени, не воли. Streak-факт уже +15% к readiness.',
    })
  }

  // ── 11. Milestone-aware signals (F2 roadmap) ───────────────────────────
  // Generate milestones из goal + targetDate → проверяем какие сделаны,
  // какой current (first not-done), сколько streak закрытых.
  const milestones = generateMilestones(goal)
  if (milestones.length > 0) {
    const firstUndoneIdx = milestones.findIndex((m) => !m.done)
    const current = firstUndoneIdx === -1 ? null : milestones[firstUndoneIdx]
    if (current) {
      const weekStartMs = new Date(current.weekStart).getTime()
      const daysIntoWeek = Math.floor((Date.now() - weekStartMs) / (24 * 60 * 60 * 1000))
      if (daysIntoWeek > 10) {
        out.push({
          id: `milestone-overdue-${current.id}`,
          kind: 'milestone_overdue',
          severity: 'warn',
          headline: `${current.title} — застрял (${daysIntoWeek} дн от начала недели)`,
          detail:
            'Roadmap буксует. Либо milestone слишком жирный — разбей его. Либо нужно реально сесть и закрыть. Coach обсудит план.',
          action: { href: '/today#milestones', label: 'К roadmap' },
        })
      } else if (daysIntoWeek >= 0 && daysIntoWeek <= 6) {
        out.push({
          id: `milestone-focus-${current.id}`,
          kind: 'milestone_focus',
          severity: 'nudge',
          headline: `Сейчас: ${current.title}`,
          detail: current.detail,
          action: { href: '/today#milestones', label: 'К roadmap' },
        })
      }
    }
    // Trailing streak — N последних milestones done (from the beginning).
    let streakDone = 0
    for (const m of milestones) {
      if (m.done) streakDone++
      else break
    }
    if (streakDone >= 3 && streakDone < milestones.length) {
      out.push({
        id: `milestone-streak-${streakDone}`,
        kind: 'milestone_streak',
        severity: 'cruise',
        headline: `${streakDone} ${pluralMilestones(streakDone)} подряд закрыто`,
        detail: 'Roadmap идёт по плану. Это сигнал что цель reachable в срок.',
      })
    }
  }

  return out
}

function pluralMilestones(n: number): string {
  if (n === 1) return 'milestone'
  if (n >= 2 && n <= 4) return 'milestones'
  return 'milestones'
}

function pluralDays(n: number): string {
  if (n === 1) return 'день'
  if (n >= 2 && n <= 4) return 'дня'
  return 'дней'
}

// ── Dismiss persistence ─────────────────────────────────────────────────

const DISMISS_KEY = 'druz9.insights.dismissed.v1'

interface DismissedRecord {
  /** Set of dismissed insight ids; expires per id_lifetime ms (24h default
   * для inactivity/streak — они автоматически меняют id каждый день. */
  ids: Record<string, number> // id → dismissed_at ms
}

function readDismissed(): DismissedRecord {
  if (typeof window === 'undefined') return { ids: {} }
  try {
    const raw = window.localStorage.getItem(DISMISS_KEY)
    if (!raw) return { ids: {} }
    const parsed = JSON.parse(raw) as DismissedRecord
    return parsed.ids ? parsed : { ids: {} }
  } catch {
    return { ids: {} }
  }
}

function writeDismissed(rec: DismissedRecord): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(DISMISS_KEY, JSON.stringify(rec))
  } catch {
    /* ignore */
  }
}

const DEFAULT_DISMISS_LIFETIME_MS = 24 * 60 * 60 * 1000 // 24h

/**
 * Filter insights, dropping those dismissed in last 24h (per id). Cleans
 * expired entries from storage as side-effect.
 */
export function filterDismissed(insights: CoachInsight[]): CoachInsight[] {
  const rec = readDismissed()
  const now = Date.now()
  const fresh: Record<string, number> = {}
  for (const [id, ts] of Object.entries(rec.ids)) {
    if (now - ts < DEFAULT_DISMISS_LIFETIME_MS) fresh[id] = ts
  }
  if (Object.keys(fresh).length !== Object.keys(rec.ids).length) {
    writeDismissed({ ids: fresh })
  }
  return insights.filter((i) => !(i.id in fresh))
}

export function dismissInsight(id: string): void {
  const rec = readDismissed()
  rec.ids[id] = Date.now()
  writeDismissed(rec)
}

// Severity → priority для sort'а; critical first.
const SEVERITY_RANK: Record<InsightSeverity, number> = {
  critical: 0,
  warn: 1,
  nudge: 2,
  cruise: 3,
}

/**
 * Top-1 рендерится в banner; остальное можно показать в expanded view.
 * Возвращает sorted descending by severity (critical first), исключая
 * dismissed.
 */
export function getActiveInsights(): CoachInsight[] {
  const all = detectInsights()
  const live = filterDismissed(all)
  return live.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])
}
