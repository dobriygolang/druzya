// goal.ts — F2 (Phase B) MVP store для user goal'а.
//
// Зачем localStorage (а не Connect-RPC + backend table):
// - F2 full design (plan §F2): `user_goals` + `goal_milestones` tables +
//   backend service. 10 дней работы; не блокеры для F1/F3 prototyping.
// - MVP здесь — localStorage. Когда backend ship'нется (Phase C W6-7), key
//   станет cache layer over RPC (миграция: read localStorage → POST CreateGoal
//   → drop key). Wire shape намеренно совпадает с planned proto:
//
//     UserGoal {
//       kind: GoalKind                    // 5 предефиниций per plan
//       target_company?: string           // только для top_tier_co
//       target_level?: string             // backend resolves later (L4/L5/Senior)
//       target_text?: string              // только для custom (parsed by AI later)
//       target_date?: string              // ISO yyyy-mm-dd
//       created_at: number                // ms epoch
//       updated_at: number
//     }
//
// Subscribe pattern: callers (CoachMemoryCard, Coach.tsx) register listeners
// → store fires on update. Cross-tab sync via storage event — bonus.

const KEY = 'druz9.goal.v1'

// Plan §F2: 5 goal categories.
export type GoalKind =
  | 'top_tier_co'      // Senior at specific top-tier company
  | 'any_senior'       // Senior at any company
  | 'ml_offer'         // ML Engineer offer (any company)
  | 'english_target'   // TOEFL 100+ / IELTS 7+ / CEFR-B2+
  | 'custom'           // free-text, AI parses later

// Backend proto enum string (proto3 JSON). Wire when backend Phase C
// CreateGoal RPC available.
export type BackendGoalKind =
  | 'GOAL_KIND_TOP_TIER_CO'
  | 'GOAL_KIND_ANY_SENIOR'
  | 'GOAL_KIND_ML_OFFER'
  | 'GOAL_KIND_ENGLISH_TARGET'
  | 'GOAL_KIND_CUSTOM'

const FRONTEND_TO_BACKEND: Record<GoalKind, BackendGoalKind> = {
  top_tier_co:    'GOAL_KIND_TOP_TIER_CO',
  any_senior:     'GOAL_KIND_ANY_SENIOR',
  ml_offer:       'GOAL_KIND_ML_OFFER',
  english_target: 'GOAL_KIND_ENGLISH_TARGET',
  custom:         'GOAL_KIND_CUSTOM',
}

const BACKEND_TO_FRONTEND: Record<BackendGoalKind, GoalKind> = {
  GOAL_KIND_TOP_TIER_CO:    'top_tier_co',
  GOAL_KIND_ANY_SENIOR:     'any_senior',
  GOAL_KIND_ML_OFFER:       'ml_offer',
  GOAL_KIND_ENGLISH_TARGET: 'english_target',
  GOAL_KIND_CUSTOM:         'custom',
}

export function goalKindToBackend(k: GoalKind): BackendGoalKind {
  return FRONTEND_TO_BACKEND[k]
}

export function goalKindFromBackend(k: BackendGoalKind): GoalKind {
  return BACKEND_TO_FRONTEND[k]
}

// Top-tier companies whitelist — pickable in GoalWizard для kind=top_tier_co.
// Жёсткий список так что юзер не вводит «Google» / «google» / «GOOGLE» как
// разные. При backend wire — этот же массив seed'ит admin's companies table
// (plan §Admin rework: per-company configurable mock pipelines).
export const TOP_TIER_COMPANIES = [
  'Google',
  'Yandex',
  'Wildberries',
  'Ozon',
  'Tinkoff',
  'VK',
  'Meta',
  'Amazon',
] as const
export type TopTierCompany = (typeof TOP_TIER_COMPANIES)[number]

// English targets — пинимаемые wire-формы; LLM context уже знает что есть что.
export const ENGLISH_TARGETS = [
  'TOEFL 100+',
  'IELTS 7+',
  'CEFR B2+',
  'CEFR C1+',
] as const
export type EnglishTarget = (typeof ENGLISH_TARGETS)[number]

export interface UserGoal {
  kind: GoalKind
  targetCompany?: TopTierCompany
  targetLevel?: string
  targetText?: string
  targetDate?: string // ISO yyyy-mm-dd
  createdAt: number
  updatedAt: number
}

function readGoalFromStorage(): UserGoal | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as UserGoal
    // Light validation — drop corrupted rows rather than throw upstream.
    if (
      parsed &&
      typeof parsed.kind === 'string' &&
      typeof parsed.createdAt === 'number' &&
      typeof parsed.updatedAt === 'number'
    ) {
      return parsed
    }
    return null
  } catch {
    return null
  }
}

type Listener = (goal: UserGoal | null) => void
const listeners = new Set<Listener>()
let current: UserGoal | null = readGoalFromStorage()

// Cross-tab sync — storage event fires only в других tab'ах, не в текущем
// (whoever wrote the value не получает свой же event обратно). Тот wholе
// который changed value напрямую читает new value через current update.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY) return
    current = readGoalFromStorage()
    listeners.forEach((l) => l(current))
  })
}

export function getGoal(): UserGoal | null {
  return current
}

export function setGoal(goal: UserGoal): void {
  current = goal
  try {
    window.localStorage.setItem(KEY, JSON.stringify(goal))
  } catch {
    /* private mode / quota — keep in-memory only */
  }
  listeners.forEach((l) => l(current))
}

export function clearGoal(): void {
  current = null
  try {
    window.localStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l(current))
}

export function subscribeGoal(l: Listener): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}

// Human-readable рендеринг title для chip / card в UI. Возвращает напр.
// «Senior @ Yandex · до ноябрь 2026» или «ML Engineer offer».
export function formatGoal(g: UserGoal | null): string {
  if (!g) return ''
  let title = ''
  switch (g.kind) {
    case 'top_tier_co':
      title = `Senior @ ${g.targetCompany ?? '?'}`
      break
    case 'any_senior':
      title = 'Senior IT'
      break
    case 'ml_offer':
      title = 'ML Engineer offer'
      break
    case 'english_target':
      title = g.targetText ?? 'English fluency'
      break
    case 'custom':
      title = g.targetText ?? 'Custom goal'
      break
  }
  if (g.targetDate) {
    const d = new Date(g.targetDate)
    if (!isNaN(d.getTime())) {
      const month = d.toLocaleDateString('ru', { month: 'long' })
      title += ` · до ${month} ${d.getFullYear()}`
    }
  }
  return title
}
