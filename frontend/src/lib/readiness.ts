// readiness.ts — F3 (Phase B) MVP readiness prediction engine.
//
// Цель: deterministic computation готовности 0..100% к active goal'у. Без
// backend / без LLM — pure heuristic. Когда Phase C ship'нет
// `GetReadinessPrediction` RPC, можно swap source но keep UI shape стабильным.
//
// Inputs (all localStorage-backed):
//   - F2 goal (lib/goal.ts) — target_date, kind, target_company
//   - F9 diagnostic answers (lib/diagnostic.ts → loadProgress)
//
// Output:
//   - readinessPct: 5..95 (clamped — anti-fallback, не симулируем 0/100)
//   - weeksToTarget: целое число недель до deadline (null если goal без date)
//   - factors: bullet rationale который влияет на score (для trust)
//
// Каждый factor — текст + delta points. Sum(deltas) + base = readiness.

import { computeActivityBoost, computeStreakBonus } from './activity'
import { loadProgress, type AnswerMap } from './diagnostic'
import type { UserGoal } from './goal'
import { computeMiniMockFactor } from './miniMock'

export interface ReadinessFactor {
  label: string
  /** Целое число процентов, со знаком: +5, -10. */
  delta: number
}

export interface Readiness {
  readinessPct: number
  weeksToTarget: number | null
  daysToTarget: number | null
  factors: ReadinessFactor[]
}

const MIN_PCT = 5
const MAX_PCT = 95

// Base scores per goal kind. Higher = «typically закрывается легче». Юзер с
// «Google senior» имеет более высокий barrier чем «senior at any RU co»;
// model reflects этот hardness.
function baseForGoal(goal: UserGoal): { base: number; label: string } {
  switch (goal.kind) {
    case 'top_tier_co': {
      const co = goal.targetCompany ?? ''
      if (co === 'Google' || co === 'Meta' || co === 'Amazon') {
        return { base: 20, label: `Goal — Senior @ ${co}: FAANG hiring bar высокий` }
      }
      if (co) {
        return { base: 30, label: `Goal — Senior @ ${co}: top-tier RU bar` }
      }
      return { base: 30, label: 'Goal — Senior @ top-tier company' }
    }
    case 'ml_offer':
      return { base: 25, label: 'Goal — ML Engineer offer: narrow specialization' }
    case 'any_senior':
      return { base: 40, label: 'Goal — Senior at any Co: широкий рынок' }
    case 'english_target':
      return { base: 35, label: 'Goal — English fluency' }
    case 'custom':
      return { base: 35, label: 'Goal — Custom' }
  }
}

function applyDiagnosticAdjustments(answers: AnswerMap, factors: ReadinessFactor[]): number {
  let delta = 0

  // Experience boost — самый сильный signal.
  switch (answers.experience) {
    case '5_plus':
      delta += 25
      factors.push({ label: '5+ лет на Go', delta: 25 })
      break
    case '3_5':
      delta += 15
      factors.push({ label: '3-5 лет опыта', delta: 15 })
      break
    case '1_3':
      delta += 5
      factors.push({ label: '1-3 года опыта', delta: 5 })
      break
    case '0_1':
      // 0 delta — junior territory; не учитываем, не штрафуем
      break
  }

  // Daily budget — больше времени = больше прогресса в единицу времени.
  switch (answers.daily_budget) {
    case '4_plus':
      delta += 10
      factors.push({ label: '4+ часов в день — sabbatical мод', delta: 10 })
      break
    case '2_4':
      delta += 5
      factors.push({ label: '2-4 часа в день', delta: 5 })
      break
    case '0_1':
      delta -= 5
      factors.push({ label: '<1 часа в день — узкий budget', delta: -5 })
      break
  }

  // Status — refreshing / growing → стабильный темп; searching / between jobs
  // — стресс снижает учебный КПД.
  switch (answers.status) {
    case 'employed_growing':
    case 'refreshing':
      delta += 3
      factors.push({ label: 'Стабильный темп подготовки', delta: 3 })
      break
    case 'between_jobs':
      delta -= 5
      factors.push({ label: 'Между офферами — стресс снижает КПД', delta: -5 })
      break
  }

  // Self-honest gap — если юзер указал weakest area = target_level high,
  // это reality check.
  if (
    answers.weakest === 'sysdesign' &&
    (answers.target_level === 'staff' || answers.target_co === 'big_tech')
  ) {
    delta -= 10
    factors.push({
      label: 'Слабый sys-design на staff/FAANG target — критический gap',
      delta: -10,
    })
  }

  if (answers.weakest === 'algos' && answers.target_co === 'big_tech') {
    delta -= 5
    factors.push({
      label: 'Слабые algo на FAANG screen-кругу',
      delta: -5,
    })
  }

  return delta
}

function applyTimeAdjustments(
  goal: UserGoal,
  factors: ReadinessFactor[],
): { delta: number; weeksToTarget: number | null; daysToTarget: number | null } {
  if (!goal.targetDate) {
    return { delta: 0, weeksToTarget: null, daysToTarget: null }
  }
  const target = new Date(goal.targetDate)
  if (isNaN(target.getTime())) {
    return { delta: 0, weeksToTarget: null, daysToTarget: null }
  }
  const now = new Date()
  const daysToTarget = Math.max(0, Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)))
  const weeksToTarget = Math.ceil(daysToTarget / 7)

  let delta = 0
  if (daysToTarget < 30) {
    delta -= 10
    factors.push({ label: `Меньше месяца до ${goal.targetDate} — мало рантайм`, delta: -10 })
  } else if (daysToTarget < 90) {
    delta -= 5
    factors.push({ label: `<3 месяцев до ${goal.targetDate}`, delta: -5 })
  } else if (daysToTarget > 365) {
    delta += 5
    factors.push({ label: '>1 года до цели — запас времени', delta: 5 })
  }

  return { delta, weeksToTarget, daysToTarget }
}

function clamp(n: number): number {
  return Math.max(MIN_PCT, Math.min(MAX_PCT, Math.round(n)))
}

/**
 * compute() — main entrypoint. Возвращает readiness для goal'а на основе
 * (a) deterministic base per goal kind, (b) F9 diagnostic answers если есть,
 * (c) days_to_target adjustment.
 *
 * MVP: без backend, без activity log. Когда F5 (activity logging) ship'нет,
 * будем добавлять activity-based positive factors («+30% от 12 events за 7d»).
 */
export function computeReadiness(goal: UserGoal): Readiness {
  const factors: ReadinessFactor[] = []
  const { base, label } = baseForGoal(goal)
  factors.push({ label, delta: base })

  // F9 diagnostic answers — если юзер прошёл quiz, инкорпорируем.
  const answers = loadProgress()
  const diagnosticDelta = Object.keys(answers).length > 0
    ? applyDiagnosticAdjustments(answers, factors)
    : 0

  const time = applyTimeAdjustments(goal, factors)

  // F5 activity boost — closes the loop: do action → log → readiness ticks.
  // Capped at +20% inside computeActivityBoost; visible factor если >0.
  const activity = computeActivityBoost()
  if (activity.delta > 0 && activity.reason) {
    factors.push({ label: activity.reason, delta: activity.delta })
  }

  // Streak bonus — habit signal на top of raw activity count. Tiered
  // +3/+5/+10/+15 для 3/7/14/30-day streaks. Consistency сигналит discipline.
  const streak = computeStreakBonus()
  if (streak.delta > 0 && streak.reason) {
    factors.push({ label: streak.reason, delta: streak.delta })
  }

  // F8 mini-mock factor — strongest signal когда recent (≤14d). Может быть
  // negative — gaps выявлены. null если юзер не проходил mini-mock или
  // result stale.
  const miniMock = computeMiniMockFactor()
  if (miniMock) {
    factors.push({ label: miniMock.reason, delta: miniMock.delta })
  }

  const total =
    base +
    diagnosticDelta +
    time.delta +
    activity.delta +
    streak.delta +
    (miniMock?.delta ?? 0)
  return {
    readinessPct: clamp(total),
    weeksToTarget: time.weeksToTarget,
    daysToTarget: time.daysToTarget,
    factors,
  }
}
