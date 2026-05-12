// dailyPlan.ts — F7 (Phase C) MVP daily plan engine.
//
// Цель: generate 3-5 actions per day на основе (a) F2 goal kind/company,
// (b) F3 readiness pct (low → focus learning, high → focus practice),
// (c) F9 diagnostic weakest area, (d) daily budget (из F9 diagnostic).
//
// Plan'ит ровно один день за раз — стек MVP не покрывает weekly milestones
// (тот scope в Phase C — F2 goal_milestones table). Каждое утро (или manual
// refresh) — fresh plan.
//
// Backend-free MVP: deterministic mapping. Когда Phase C ship'нет
// `GetDailyPlan` UC + LLM milestone decomposition, swap engine но keep
// shape стабильным.

import { loadProgress, type AnswerMap } from './diagnostic'
import { getGoal, type UserGoal } from './goal'
import { computeReadiness, type Readiness } from './readiness'

export type ActionKind =
  | 'mock'         // AI-mock session
  | 'reading'      // Codex / external resource
  | 'coach'        // AI-tutor chat session
  | 'reflection'   // end-of-day quick reflection
  | 'focus_block'  // structured focus session (Hone)
  | 'log'          // log activity (F5 entry)
  | 'diagnostic'   // F9 retake (если readiness low + не пройдена)

export interface DailyAction {
  /** Stable id для дедупа between days и для click-tracking. */
  id: string
  title: string
  rationale: string
  estimatedMin: number
  kind: ActionKind
  /** Optional CTA link — относительный path / external URL. */
  href?: string
  /** Priority 'p0' рендерится первым. Lower = first. */
  priority: 0 | 1 | 2
}

export interface DailyPlan {
  /** ISO yyyy-mm-dd — для дедупа «уже сгенерили сегодня». */
  date: string
  actions: DailyAction[]
  /** Total estimated minutes. */
  budgetMin: number
  /** Why этот план — для trust («Подобрали 3 действия потому что...»). */
  rationale: string
}

// Daily budget mapping из F9 diagnostic answer.
function budgetFromDiagnostic(answers: AnswerMap): number {
  switch (answers.daily_budget) {
    case '4_plus':
      return 240
    case '2_4':
      return 150
    case '1_2':
      return 90
    case '0_1':
      return 45
    default:
      return 60
  }
}

function todayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

interface Candidate extends DailyAction {
  /** Higher score = более релевантно today'у. */
  score: number
}

function buildCandidates(
  _goal: UserGoal,
  readiness: Readiness,
  answers: AnswerMap,
): Candidate[] {
  // _goal reserved для future: per-company action templates (e.g. Google →
  // specific FAANG screen prep links). MVP heuristic пока использует только
  // diagnostic + readiness; goal-conditional logic будет когда наполним
  // per-company libs.
  const candidates: Candidate[] = []
  const weakest = answers.weakest
  const targetLevel = answers.target_level
  const targetCo = answers.target_co
  const status = answers.status
  const timeline = answers.timeline
  const lowReadiness = readiness.readinessPct < 35
  const midReadiness = readiness.readinessPct >= 35 && readiness.readinessPct < 65

  // ── 1. Critical-gap focus (если diagnostic выявил weak area) ─────────
  if (weakest === 'sysdesign') {
    candidates.push({
      id: 'sysdesign-deep-block',
      title: 'Sys-Design focus 45 min',
      rationale: 'Sys-design — слабое место по диагностике. Без него senior offer не закроешь.',
      estimatedMin: 45,
      kind: 'focus_block',
      href: '/atlas/track/system-design',
      priority: 0,
      score: 100,
    })
  }
  if (weakest === 'algos') {
    candidates.push({
      id: 'algo-leetcode-block',
      title: '2 LeetCode medium-hard (algo)',
      rationale: 'Algos — слабая ось. Каждый день по 2 задачи поднимут рабочую память.',
      estimatedMin: 45,
      kind: 'focus_block',
      href: '/atlas/track/algorithms',
      priority: 0,
      score: 100,
    })
  }
  if (weakest === 'concurrency') {
    candidates.push({
      id: 'go-concurrency-block',
      title: 'Go concurrency drill (45 min)',
      rationale: 'Channels / goroutines internals — твоя зона роста.',
      estimatedMin: 45,
      kind: 'focus_block',
      href: '/atlas/track/go-concurrency',
      priority: 0,
      score: 95,
    })
  }
  if (weakest === 'databases') {
    candidates.push({
      id: 'db-internals-block',
      title: 'DB internals (DDIA ch. 3 — 7)',
      rationale: 'Indices / isolation levels — senior gates.',
      estimatedMin: 45,
      kind: 'reading',
      href: '/codex',
      priority: 0,
      score: 90,
    })
  }
  if (weakest === 'distributed') {
    candidates.push({
      id: 'distributed-paper-read',
      title: 'Raft paper + Kleinberg ch. 5',
      rationale: 'Consensus + replication — backbone senior+ sysdesign.',
      estimatedMin: 60,
      kind: 'reading',
      href: '/codex',
      priority: 0,
      score: 85,
    })
  }

  // ── 2. Mock cadence (urgency-driven) ──────────────────────────────────
  if (
    status === 'employed_searching' ||
    status === 'between_jobs' ||
    timeline === '1m'
  ) {
    candidates.push({
      id: 'mock-pipeline-today',
      title: 'Mock pipeline (HR + Algo)',
      rationale: 'Активный поиск / горящие сроки — нужен mock каждые 2-3 дня для калибровки.',
      estimatedMin: 75,
      kind: 'mock',
      href: '/mock',
      priority: 1,
      score: 80,
    })
  } else if (lowReadiness) {
    candidates.push({
      id: 'mock-diagnostic-today',
      title: 'Mini-mock для baseline',
      rationale: 'Readiness низкий — нужен baseline чтобы знать с чего стартуем.',
      estimatedMin: 30,
      kind: 'mock',
      href: '/mock',
      priority: 1,
      score: 70,
    })
  } else if (midReadiness && Math.random() > 0.4) {
    // Mid-readiness: mock примерно каждый второй день. Math.random для
    // variety; deterministic alternative — даты parity. Sergey 2026-05-12:
    // MVP-OK seedless random.
    candidates.push({
      id: 'mock-checkpoint-today',
      title: 'Mock checkpoint (40 min)',
      rationale: 'Mid readiness — checkpoint показывает где залип.',
      estimatedMin: 40,
      kind: 'mock',
      href: '/mock',
      priority: 1,
      score: 60,
    })
  }

  // ── 3. Coach session (caches readiness context) ──────────────────────
  candidates.push({
    id: 'coach-checkin',
    title: 'Coach check-in (10 min)',
    rationale: 'Coach helps вычистить blockers и валидировать план — daily 10 min достаточно.',
    estimatedMin: 10,
    kind: 'coach',
    href: '/tutor/ai/algo-coach',
    priority: 1,
    score: 55,
  })

  // ── 4. Codex reading (для тех у кого есть time budget) ───────────────
  if (targetCo === 'big_tech' || targetLevel === 'staff') {
    candidates.push({
      id: 'codex-distributed-read',
      title: 'Прочесть 1 Codex статью (sysdesign)',
      rationale: 'FAANG / staff trajectory — sysdesign depth тут выигрывает.',
      estimatedMin: 20,
      kind: 'reading',
      href: '/codex',
      priority: 2,
      score: 45,
    })
  }

  // ── 5. Reflection (end of day, лёгкая) ───────────────────────────────
  candidates.push({
    id: 'reflection-eod',
    title: 'Reflection: что зашло сегодня',
    rationale: '5-минутный лог что выучил → coach сохранит в memory.',
    estimatedMin: 5,
    kind: 'reflection',
    href: '/today#reflection',
    priority: 2,
    score: 40,
  })

  // ── 6. Diagnostic retake (если readiness low + factors короткий = quiz
  //       не пройдён) ────────────────────────────────────────────────────
  if (lowReadiness && readiness.factors.length <= 2) {
    candidates.push({
      id: 'diagnostic-take',
      title: 'Пройти 8-минутную диагностику',
      rationale: 'Readiness низкий потому что я ещё мало знаю о тебе. Quiz уточнит план.',
      estimatedMin: 8,
      kind: 'diagnostic',
      href: '/diagnostic',
      priority: 0,
      score: 90,
    })
  }

  return candidates
}

/**
 * Pick top 3-5 actions с уважением budget'а. Greedy: сортируем по
 * (priority asc, score desc), берём пока budget не лимитим. Cap 5.
 */
function packIntoPlan(candidates: Candidate[], budgetMin: number): DailyAction[] {
  // Dedup by id (на случай если builder поставил два пути к одной фиче).
  const seen = new Set<string>()
  const unique = candidates.filter((c) => {
    if (seen.has(c.id)) return false
    seen.add(c.id)
    return true
  })

  // Sort: priority 0 first, then score desc.
  unique.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority
    return b.score - a.score
  })

  // Greedy pack — allow over-budget by ≤15% так что юзер не получит
  // disappointingly короткий план если все p0 крупные. Better слегка
  // больше за день чем «вот тебе reflection и подсветка».
  const cap = Math.ceil(budgetMin * 1.15)
  const picked: DailyAction[] = []
  let usedMin = 0
  for (const cand of unique) {
    if (picked.length >= 5) break
    if (usedMin + cand.estimatedMin > cap && picked.length >= 3) break
    picked.push({
      id: cand.id,
      title: cand.title,
      rationale: cand.rationale,
      estimatedMin: cand.estimatedMin,
      kind: cand.kind,
      href: cand.href,
      priority: cand.priority,
    })
    usedMin += cand.estimatedMin
  }
  return picked
}

function buildRationale(goal: UserGoal, readiness: Readiness, _budgetMin: number): string {
  const parts: string[] = []
  if (goal.kind === 'top_tier_co' && goal.targetCompany) {
    parts.push(`Senior @ ${goal.targetCompany}`)
  } else if (goal.kind === 'ml_offer') {
    parts.push('ML offer')
  } else if (goal.kind === 'english_target') {
    parts.push('English target')
  } else {
    parts.push('Senior IT')
  }
  if (readiness.weeksToTarget !== null) {
    parts.push(`${readiness.weeksToTarget} нед. до срока`)
  }
  parts.push(`${readiness.readinessPct}% готовности`)
  return `Подобрали под цель: ${parts.join(' · ')}.`
}

/**
 * computeDailyPlan() — main entrypoint. Detects current goal via lib/goal +
 * computes readiness via lib/readiness + reads F9 answers — все
 * localStorage. Returns deterministic plan для текущего дня.
 *
 * Caller отвечает за reading / cache: можно memoize по date вернёт same plan
 * в течение дня (DailyPlanCard так делает).
 */
export function computeDailyPlan(): DailyPlan | null {
  const goal = getGoal()
  if (!goal) return null
  const readiness = computeReadiness(goal)
  const answers = loadProgress()
  const budgetMin = budgetFromDiagnostic(answers)

  const candidates = buildCandidates(goal, readiness, answers)
  const actions = packIntoPlan(candidates, budgetMin)
  if (actions.length === 0) return null

  return {
    date: todayISO(),
    actions,
    budgetMin: actions.reduce((sum, a) => sum + a.estimatedMin, 0),
    rationale: buildRationale(goal, readiness, budgetMin),
  }
}

// LocalStorage помощник — caching ключ-плана по дате так что reload during
// day не меняет план (даже если включает Math.random — закрепляем за date).
const PLAN_CACHE_KEY = 'druz9.daily_plan.v1'

interface PlanCacheEntry {
  date: string
  plan: DailyPlan
}

export function getCachedDailyPlan(): DailyPlan | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(PLAN_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as PlanCacheEntry
    if (parsed.date !== todayISO()) return null // stale
    return parsed.plan
  } catch {
    return null
  }
}

export function persistDailyPlan(plan: DailyPlan): void {
  if (typeof window === 'undefined') return
  try {
    const entry: PlanCacheEntry = { date: plan.date, plan }
    window.localStorage.setItem(PLAN_CACHE_KEY, JSON.stringify(entry))
  } catch {
    /* private / quota — план просто пересчитается на каждом mount */
  }
}

export function invalidateDailyPlan(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(PLAN_CACHE_KEY)
  } catch {
    /* ignore */
  }
}

/**
 * useDailyPlanForToday — helper для UI. Возвращает cached план если есть на
 * сегодня; иначе computes fresh + persists. Pure side-effect-free для caller'а.
 */
export function getOrComputeDailyPlan(): DailyPlan | null {
  const cached = getCachedDailyPlan()
  if (cached) return cached
  const fresh = computeDailyPlan()
  if (fresh) persistDailyPlan(fresh)
  return fresh
}
