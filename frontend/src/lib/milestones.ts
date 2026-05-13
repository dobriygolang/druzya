// Цель: цель — это не вершина, а 10-12 weekly чекпоинтов. Deterministic
// генерация на основе goal kind + targetDate + diagnostic weakest area
// (без backend, без LLM — pure heuristic). Когда backend ship'нет
// `GenerateMilestones` RPC через LLM cascade, frontend swap'ит источник
// но keep wire shape.
//
// MVP не learn'ит — это template-driven roadmap. Иначе risk: пустой
// «Coach generates plan» CTA когда LLM offline.

import type { UserGoal } from './goal'

export interface Milestone {
  /** Unique id (stable across reloads — based on goal + week index). */
  id: string
  /** 1-based week index from start. */
  weekIndex: number
  /** ISO yyyy-mm-dd start of week (Monday). */
  weekStart: string
  /** Short noun phrase (≤60 chars). */
  title: string
  /** 1-2 sentence detail — что конкретно делать. */
  detail: string
  /** Category для grouping визуально. */
  category: 'foundation' | 'practice' | 'mock' | 'reflection' | 'final'
  /** Done state — persisted via localStorage by milestone id. */
  done: boolean
}

// ────────────────────────────────────────────────────────────────────────
// Template selection. Each goal kind имеет свой curriculum-arc, weakest
// area refines emphasis. Все templates 10-12 weeks; truncated если до
// targetDate <10 weeks (последние сжимаются в final-push variant).

interface TemplateStep {
  title: string
  detail: string
  category: Milestone['category']
}

const GO_SENIOR_TEMPLATE: TemplateStep[] = [
  { title: 'Week 1 · Fundamentals refresh', detail: 'Go runtime, GC, scheduler. 1 mock-checkpoint в конце недели.', category: 'foundation' },
  { title: 'Week 2 · Concurrency deep-dive', detail: 'Channels, goroutines, sync primitives. Решить 10 LeetCode на concurrency-patterns.', category: 'foundation' },
  { title: 'Week 3 · Algorithms baseline', detail: 'Top-30 LeetCode medium (DP, графы, two pointers). Score себя на DiagnosticPage.', category: 'practice' },
  { title: 'Week 4 · System Design fundamentals', detail: 'Cache, queues, sharding, replication. DDIA Ch 1-5 + 1 design exercise.', category: 'foundation' },
  { title: 'Week 5 · System Design advanced', detail: 'CAP, consensus (Raft/Paxos), HLL/Bloom filters. 2 mock SysDesign.', category: 'practice' },
  { title: 'Week 6 · Databases + transactions', detail: 'Isolation levels, indices, partitioning. 1 практический design (URL shortener).', category: 'practice' },
  { title: 'Week 7 · First full mock-pipeline', detail: 'Полный pipeline (HR → Algo → Coding → SysDesign → Behavioral). Self-grade radar.', category: 'mock' },
  { title: 'Week 8 · Weak-area focus', detail: 'Закрыть top-1 weak area из мока. Daily 1-2h targeted practice.', category: 'practice' },
  { title: 'Week 9 · Behavioral + leadership', detail: 'STAR-формат stories на 6 ключевых scenarios (conflict / leadership / failure / impact).', category: 'practice' },
  { title: 'Week 10 · Second full mock', detail: 'Полный pipeline. Compare radar к Week 7 — что улучшилось / что осталось.', category: 'mock' },
  { title: 'Week 11 · Distributed systems consolidation', detail: 'Распределённый design, eventual consistency, CQRS. 1 design exercise.', category: 'practice' },
  { title: 'Week 12 · Interview readiness · final-push', detail: 'Daily 1 algo + 1 SysDesign warmup. Refresh behavioral stories. Готов.', category: 'final' },
]

const ML_TEMPLATE: TemplateStep[] = [
  { title: 'Week 1 · Math + statistics refresh', detail: 'Probability, linear algebra, gradients. Khan / 3Blue1Brown для refresh.', category: 'foundation' },
  { title: 'Week 2 · Classical ML basics', detail: 'GBM, random forest, regularization. 1 Kaggle notebook end-to-end.', category: 'foundation' },
  { title: 'Week 3 · Deep Learning fundamentals', detail: 'PyTorch basics, backprop math, optimizers. fast.ai lesson 1-3.', category: 'foundation' },
  { title: 'Week 4 · Transformers + attention', detail: 'Self-attention math, BERT/GPT архитектуры. 1 fine-tuning experiment.', category: 'practice' },
  { title: 'Week 5 · MLOps + production', detail: 'Model serving, monitoring, drift detection. 1 deploy mini-project.', category: 'practice' },
  { title: 'Week 6 · ML system design', detail: 'Recsys, ranking, feature store. Chip Huyen ML Systems Design Ch 1-4.', category: 'practice' },
  { title: 'Week 7 · First full mock-pipeline', detail: 'ML-focused pipeline (HR → ML coding → ML design → behavioral). Self-grade.', category: 'mock' },
  { title: 'Week 8 · Weak-area focus', detail: 'Закрыть top-1 weak из mock\'а. Daily targeted practice.', category: 'practice' },
  { title: 'Week 9 · A/B testing + experimentation', detail: 'Power analysis, causal inference, sequential testing.', category: 'practice' },
  { title: 'Week 10 · Second full mock', detail: 'Полный pipeline. Compare к Week 7 — readiness uplift.', category: 'mock' },
  { title: 'Week 11 · Behavioral + leadership', detail: 'ML-specific stories (failed experiments, scope creep, stakeholder mgmt).', category: 'practice' },
  { title: 'Week 12 · Final push', detail: 'Daily mini-mock + recent papers review. Готов к интервью.', category: 'final' },
]

const ENGLISH_TEMPLATE: TemplateStep[] = [
  { title: 'Week 1 · Baseline + speaking habit', detail: 'Daily 15-min speaking (italki / monologue). 5 podcast episodes.', category: 'foundation' },
  { title: 'Week 2 · Pronunciation foundations', detail: 'IPA basics + 30 minimal pairs. Record + self-listen.', category: 'foundation' },
  { title: 'Week 3 · Grammar refresh', detail: 'Tenses, conditionals, passive voice. 1 grammar quiz daily.', category: 'foundation' },
  { title: 'Week 4 · Listening + comprehension', detail: 'Daily 30-min варианты accent (RP / GA / Indian). Transcribe 1 segment.', category: 'practice' },
  { title: 'Week 5 · Vocabulary expansion', detail: 'Anki: 50 cards new per week, retention focus. Read 1 article daily.', category: 'practice' },
  { title: 'Week 6 · Writing fluency', detail: 'Daily 200-word essay (any topic). Get tutor feedback weekly.', category: 'practice' },
  { title: 'Week 7 · Mock TOEFL/IELTS section', detail: 'Полный listening + reading section, score себя. Identify weak area.', category: 'mock' },
  { title: 'Week 8 · Speaking practice intensive', detail: 'Daily 30-min с tutor / italki. Record + review.', category: 'practice' },
  { title: 'Week 9 · Writing practice intensive', detail: 'TOEFL/IELTS essay format, time-pressured. 3 essays + feedback.', category: 'practice' },
  { title: 'Week 10 · Second mock section', detail: 'Compare к Week 7. Final weak-area закрытие.', category: 'mock' },
  { title: 'Week 11 · Test strategy', detail: 'Time management, test format quirks, scoring rubrics deep-dive.', category: 'practice' },
  { title: 'Week 12 · Final push', detail: 'Daily mini-mock. Test day prep — sleep, nutrition, breathing.', category: 'final' },
]

const CUSTOM_TEMPLATE: TemplateStep[] = [
  { title: 'Week 1 · Scope + goal decomposition', detail: 'Свой goal — разбей на 3-5 sub-goals. Записать на /profile cards.', category: 'foundation' },
  { title: 'Week 2 · Foundation', detail: 'Top-1 sub-goal — закрыть основу. Daily 1-2h focused practice.', category: 'foundation' },
  { title: 'Week 3 · Practice + measurement', detail: 'Записывать activity ежедневно. Measure baseline в diagnosticPage.', category: 'practice' },
  { title: 'Week 4 · Sub-goal 2', detail: 'Перейти ко второму sub-goal. Закрыть его 80% за неделю.', category: 'practice' },
  { title: 'Week 5 · Reflection + adjust', detail: 'Coach session: что работает, что нет. Adjust план для остатка.', category: 'reflection' },
  { title: 'Week 6 · Sub-goal 3', detail: 'Третий sub-goal. Focus + measure.', category: 'practice' },
  { title: 'Week 7 · Mock checkpoint', detail: 'Mini-mock или peer-feedback по выбранной theme.', category: 'mock' },
  { title: 'Week 8 · Weak-area focus', detail: 'Закрыть слабую точку из checkpoint\'а. Daily targeted.', category: 'practice' },
  { title: 'Week 9 · Consolidation', detail: 'Connect sub-goals между собой. Big-picture review.', category: 'practice' },
  { title: 'Week 10 · Second mock checkpoint', detail: 'Compare к Week 7. Score uplift.', category: 'mock' },
  { title: 'Week 11 · Final practice', detail: 'Reduce volume → quality. Refresh memory of фундамента.', category: 'final' },
  { title: 'Week 12 · Final push · ready', detail: 'Calm review. Готов к выводу result\'а.', category: 'final' },
]

function templateForGoal(goal: UserGoal): TemplateStep[] {
  switch (goal.kind) {
    case 'top_tier_co':
    case 'any_senior':
      return GO_SENIOR_TEMPLATE
    case 'ml_offer':
      return ML_TEMPLATE
    case 'english_target':
      return ENGLISH_TEMPLATE
    case 'custom':
      return CUSTOM_TEMPLATE
  }
}

// ────────────────────────────────────────────────────────────────────────
// Weekstart / weeks-to-target math.

function startOfIsoWeek(d: Date): Date {
  // ISO week starts Monday. JS Sunday = 0, Monday = 1.
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day // Sunday goes back 6 days, else go to Monday.
  const monday = new Date(d)
  monday.setDate(d.getDate() + diff)
  monday.setHours(0, 0, 0, 0)
  return monday
}

function isoDateString(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const DONE_KEY = 'druz9.milestones.done.v1'

function readDoneSet(): Set<string> {
  if (typeof window === 'undefined') return new Set()
  try {
    const raw = window.localStorage.getItem(DONE_KEY)
    if (!raw) return new Set()
    const arr = JSON.parse(raw) as string[]
    return new Set(Array.isArray(arr) ? arr : [])
  } catch {
    return new Set()
  }
}

function writeDoneSet(s: Set<string>): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(DONE_KEY, JSON.stringify([...s]))
    window.dispatchEvent(new StorageEvent('storage', { key: DONE_KEY }))
  } catch {
    /* quota — silent */
  }
}

export function toggleMilestoneDone(id: string): boolean {
  const s = readDoneSet()
  if (s.has(id)) s.delete(id)
  else s.add(id)
  writeDoneSet(s)
  return s.has(id)
}

export function isMilestoneDone(id: string): boolean {
  return readDoneSet().has(id)
}

/**
 * Generate milestones для текущего goal'а. Возвращает [] если no goal.
 *
 * Length adapts:
 *   - targetDate >= 12 weeks → full 12 milestones
 *   - 8-11 weeks → truncate first foundation milestones (компрессия left-side)
 *   - 4-7 weeks → take last N включая final-push
 *   - <4 weeks → emergency final-push, 4 milestones max (foundation skipped)
 *
 * Diagnostic weakest area boosts emphasis on related milestones (titles
 * остаются templated, но reorder если weakest mismatches early focus).
 */
export function generateMilestones(goal: UserGoal): Milestone[] {
  const template = templateForGoal(goal)
  const today = new Date()
  const start = startOfIsoWeek(today)

  // Determine weeks available.
  let weeksAvailable = 12
  if (goal.targetDate) {
    const target = new Date(goal.targetDate)
    if (!isNaN(target.getTime())) {
      const diffMs = target.getTime() - today.getTime()
      const diffWeeks = Math.max(1, Math.ceil(diffMs / (7 * 24 * 60 * 60 * 1000)))
      weeksAvailable = Math.max(2, Math.min(12, diffWeeks))
    }
  }

  // Slicing: keep последние N if compressed. final-push milestone должен
  // быть последним always.
  let steps: TemplateStep[]
  if (weeksAvailable >= 12) {
    steps = template
  } else if (weeksAvailable >= 8) {
    // Skip earliest foundation, keep tail.
    steps = template.slice(template.length - weeksAvailable)
  } else if (weeksAvailable >= 4) {
    // Emergency mode: keep last few practice + mock + final.
    steps = template.slice(template.length - weeksAvailable)
  } else {
    // <4 weeks — final-push only. Template's final + last mock.
    steps = template.slice(template.length - weeksAvailable).filter((s) => s.category !== 'foundation')
    if (steps.length === 0) steps = template.slice(-1)
  }

  const doneSet = readDoneSet()
  const result: Milestone[] = []
  for (let i = 0; i < steps.length; i++) {
    const weekStart = new Date(start)
    weekStart.setDate(start.getDate() + i * 7)
    const weekIso = isoDateString(weekStart)
    // Stable id из goal.createdAt + kind + week index. createdAt — единичный
    // proxy за «goal version»; новая цель = новые milestone ids.
    const id = `goal-${goal.createdAt}-${goal.kind}-w${i + 1}`
    result.push({
      id,
      weekIndex: i + 1,
      weekStart: weekIso,
      title: steps[i].title,
      detail: steps[i].detail,
      category: steps[i].category,
      done: doneSet.has(id),
    })
  }
  return result
}

/**
 * Subscribe to milestone-done changes (storage event). Multi-tab safe.
 */
export function subscribeMilestonesDone(cb: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const handler = (e: StorageEvent) => {
    if (e.key === DONE_KEY) cb()
  }
  window.addEventListener('storage', handler)
  return () => window.removeEventListener('storage', handler)
}
