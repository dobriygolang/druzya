// dataExport — localStorage MVP data backup/restore.
//
// Этот модуль bundle'ит весь state в один portable JSON file.
//
// Когда backend ship'нет:
//   - Этот модуль остаётся для local-first / offline export
//   - Импорт перестаёт быть единственным способом restore (есть RPC)
//
// Wire shape совпадает с planned `ExportUserData` UC — мигрировать тривиально.

import { clearActivities, type Activity } from './activity'
import { clearCueSessions, type CueSession } from './cueSessions'
import { clearProgress, clearTrack, type AnswerMap } from './diagnostic'
import { clearGoal, type UserGoal } from './goal'
import { clearResult, type MiniMockResult } from './miniMock'

const VERSION = 1

export interface DataBundle {
  /** Schema version — bump при breaking changes. */
  version: number
  /** ms epoch когда экспорт сделан. */
  exportedAt: number
  /** Optional human-readable note (например «before browser cleanup»). */
  note?: string
  /** F2 active goal. */
  goal: UserGoal | null
  /** F5 activity log. */
  activities: Activity[]
  /** F9 diagnostic answers. */
  diagnosticAnswers: AnswerMap
  /** F9 active track ('go' | 'ml' | 'english' | null). */
  diagnosticTrack: string | null
  /** F8 last mini-mock result. */
  miniMockResult: MiniMockResult | null
  /** F10 Cue sessions log. */
  cueSessions: CueSession[]
  /** F7 daily plan «done» action ids per day key (druz9.daily_plan.done.v1.YYYY-MM-DD). */
  dailyPlanDone: Record<string, string[]>
  /** F4 dismissed insights with timestamps. */
  insightsDismissed: Record<string, number>
}

const STORAGE_KEYS = {
  goal: 'druz9.goal.v1',
  activities: 'druz9.activity_log.v1',
  diagnosticAnswers: 'druz9.diagnostic.answers.v1',
  diagnosticTrack: 'druz9.diagnostic.track.v1',
  miniMock: 'druz9.mini_mock.last.v1',
  cueSessions: 'druz9.cue_sessions.v1',
  dailyPlanDonePrefix: 'druz9.daily_plan.done.v1.',
  insightsDismissed: 'druz9.insights.dismissed.v1',
}

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

/**
 * Сериализует весь user state в DataBundle. Каждый slice читается
 * напрямую из localStorage — module-level cache slices (например cache в
 * activity.ts) могут отставать от storage если другой tab пишет, поэтому
 * читаем raw.
 */
export function exportAllData(note?: string): DataBundle {
  if (typeof window === 'undefined') {
    return emptyBundle()
  }
  const ls = window.localStorage
  // Сourier daily-plan done keys — есть префикс с разными датами.
  const dailyPlanDone: Record<string, string[]> = {}
  for (let i = 0; i < ls.length; i++) {
    const key = ls.key(i)
    if (key && key.startsWith(STORAGE_KEYS.dailyPlanDonePrefix)) {
      const date = key.slice(STORAGE_KEYS.dailyPlanDonePrefix.length)
      dailyPlanDone[date] = safeParse<string[]>(ls.getItem(key), [])
    }
  }

  return {
    version: VERSION,
    exportedAt: Date.now(),
    note,
    goal: safeParse<UserGoal | null>(ls.getItem(STORAGE_KEYS.goal), null),
    activities: safeParse<Activity[]>(ls.getItem(STORAGE_KEYS.activities), []),
    diagnosticAnswers: safeParse<AnswerMap>(ls.getItem(STORAGE_KEYS.diagnosticAnswers), {}),
    diagnosticTrack: safeParse<string | null>(ls.getItem(STORAGE_KEYS.diagnosticTrack), null),
    miniMockResult: safeParse<MiniMockResult | null>(ls.getItem(STORAGE_KEYS.miniMock), null),
    cueSessions: safeParse<CueSession[]>(ls.getItem(STORAGE_KEYS.cueSessions), []),
    dailyPlanDone,
    insightsDismissed: safeParse<{ ids: Record<string, number> }>(
      ls.getItem(STORAGE_KEYS.insightsDismissed),
      { ids: {} },
    ).ids,
  }
}

function emptyBundle(): DataBundle {
  return {
    version: VERSION,
    exportedAt: Date.now(),
    goal: null,
    activities: [],
    diagnosticAnswers: {},
    diagnosticTrack: null,
    miniMockResult: null,
    cueSessions: [],
    dailyPlanDone: {},
    insightsDismissed: {},
  }
}

export interface ImportSummary {
  /** Slice counts after import. */
  goal: boolean
  activities: number
  cueSessions: number
  miniMockResult: boolean
  diagnosticAnswers: number
  dailyPlanDoneDays: number
  insightsDismissed: number
}

/**
 * Validate bundle shape. Returns null если ok, error message otherwise.
 */
export function validateBundle(b: unknown): string | null {
  if (typeof b !== 'object' || b === null) return 'не объект'
  const bundle = b as DataBundle
  if (typeof bundle.version !== 'number') return 'нет version'
  if (bundle.version > VERSION) return `новее (v${bundle.version}, текущий v${VERSION}) — обнови app перед import`
  if (!Array.isArray(bundle.activities)) return 'activities не массив'
  if (!Array.isArray(bundle.cueSessions)) return 'cueSessions не массив'
  if (typeof bundle.diagnosticAnswers !== 'object' || bundle.diagnosticAnswers === null) {
    return 'diagnosticAnswers не объект'
  }
  if (typeof bundle.dailyPlanDone !== 'object' || bundle.dailyPlanDone === null) {
    return 'dailyPlanDone не объект'
  }
  return null
}

/**
 * Restore user state из bundle. Replace strategy (не merge):
 *   - goal → overwrite
 *   - activities → overwrite весь массив (не append, чтобы избежать дубликатов
 *     по id)
 *   - diagnostic → overwrite
 *   - и т.д.
 *
 * Side effects: dispatches storage event manually для cross-tab refresh
 * (browser сам не fires native event для same-window setItem).
 */
export function importBundle(bundle: DataBundle): ImportSummary {
  if (typeof window === 'undefined') {
    return {
      goal: false,
      activities: 0,
      cueSessions: 0,
      miniMockResult: false,
      diagnosticAnswers: 0,
      dailyPlanDoneDays: 0,
      insightsDismissed: 0,
    }
  }
  const ls = window.localStorage
  const write = (key: string, value: string) => {
    ls.setItem(key, value)
    // Fire synthetic storage event so subscribed modules pick up changes.
    window.dispatchEvent(new StorageEvent('storage', { key, newValue: value }))
  }
  const remove = (key: string) => {
    ls.removeItem(key)
    window.dispatchEvent(new StorageEvent('storage', { key, newValue: null }))
  }

  if (bundle.goal) {
    write(STORAGE_KEYS.goal, JSON.stringify(bundle.goal))
  } else {
    remove(STORAGE_KEYS.goal)
  }
  write(STORAGE_KEYS.activities, JSON.stringify(bundle.activities))
  write(STORAGE_KEYS.cueSessions, JSON.stringify(bundle.cueSessions))
  if (bundle.miniMockResult) {
    write(STORAGE_KEYS.miniMock, JSON.stringify(bundle.miniMockResult))
  } else {
    remove(STORAGE_KEYS.miniMock)
  }
  write(STORAGE_KEYS.diagnosticAnswers, JSON.stringify(bundle.diagnosticAnswers))
  if (bundle.diagnosticTrack) {
    write(STORAGE_KEYS.diagnosticTrack, JSON.stringify(bundle.diagnosticTrack))
  } else {
    remove(STORAGE_KEYS.diagnosticTrack)
  }
  // Wipe existing daily-plan-done keys, then write new ones.
  const toRemove: string[] = []
  for (let i = 0; i < ls.length; i++) {
    const key = ls.key(i)
    if (key && key.startsWith(STORAGE_KEYS.dailyPlanDonePrefix)) toRemove.push(key)
  }
  toRemove.forEach((k) => remove(k))
  for (const [date, ids] of Object.entries(bundle.dailyPlanDone)) {
    write(`${STORAGE_KEYS.dailyPlanDonePrefix}${date}`, JSON.stringify(ids))
  }
  if (Object.keys(bundle.insightsDismissed).length > 0) {
    write(STORAGE_KEYS.insightsDismissed, JSON.stringify({ ids: bundle.insightsDismissed }))
  } else {
    remove(STORAGE_KEYS.insightsDismissed)
  }

  return {
    goal: bundle.goal !== null,
    activities: bundle.activities.length,
    cueSessions: bundle.cueSessions.length,
    miniMockResult: bundle.miniMockResult !== null,
    diagnosticAnswers: Object.keys(bundle.diagnosticAnswers).length,
    dailyPlanDoneDays: Object.keys(bundle.dailyPlanDone).length,
    insightsDismissed: Object.keys(bundle.insightsDismissed).length,
  }
}

/**
 * Wipe всё. Used by «Reset data» CTA — двойное подтверждение в UI.
 * Каждый clear* fires свой store listener так что подписчики refresh'нутся.
 */
export function wipeAllData(): void {
  clearGoal()
  clearActivities()
  clearCueSessions()
  clearResult()
  clearProgress()
  clearTrack()
  if (typeof window === 'undefined') return
  const ls = window.localStorage
  const toRemove: string[] = []
  for (let i = 0; i < ls.length; i++) {
    const key = ls.key(i)
    if (key && key.startsWith(STORAGE_KEYS.dailyPlanDonePrefix)) toRemove.push(key)
  }
  toRemove.forEach((k) => {
    ls.removeItem(k)
    window.dispatchEvent(new StorageEvent('storage', { key: k, newValue: null }))
  })
  ls.removeItem(STORAGE_KEYS.insightsDismissed)
  window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEYS.insightsDismissed, newValue: null }))
}

/**
 * Build human-readable summary of current state (preview без полного export).
 */
export interface DataSummary {
  hasGoal: boolean
  activitiesCount: number
  cueSessionsCount: number
  hasMiniMock: boolean
  diagnosticDone: boolean
  dailyPlanDoneDays: number
  /** Total bytes used by druz9.* keys в localStorage. */
  storageBytes: number
}

export function summarizeData(): DataSummary {
  if (typeof window === 'undefined') {
    return {
      hasGoal: false,
      activitiesCount: 0,
      cueSessionsCount: 0,
      hasMiniMock: false,
      diagnosticDone: false,
      dailyPlanDoneDays: 0,
      storageBytes: 0,
    }
  }
  const ls = window.localStorage
  let storageBytes = 0
  let dailyPlanDoneDays = 0
  for (let i = 0; i < ls.length; i++) {
    const key = ls.key(i)
    if (!key || !key.startsWith('druz9.')) continue
    const val = ls.getItem(key) ?? ''
    storageBytes += key.length + val.length
    if (key.startsWith(STORAGE_KEYS.dailyPlanDonePrefix)) dailyPlanDoneDays++
  }
  const goal = safeParse<UserGoal | null>(ls.getItem(STORAGE_KEYS.goal), null)
  const activities = safeParse<Activity[]>(ls.getItem(STORAGE_KEYS.activities), [])
  const cueSessions = safeParse<CueSession[]>(ls.getItem(STORAGE_KEYS.cueSessions), [])
  const miniMock = safeParse<MiniMockResult | null>(ls.getItem(STORAGE_KEYS.miniMock), null)
  const diagnostic = safeParse<AnswerMap>(ls.getItem(STORAGE_KEYS.diagnosticAnswers), {})
  return {
    hasGoal: goal !== null,
    activitiesCount: activities.length,
    cueSessionsCount: cueSessions.length,
    hasMiniMock: miniMock !== null,
    diagnosticDone: Object.keys(diagnostic).length > 0,
    dailyPlanDoneDays,
    storageBytes,
  }
}

/**
 * Trigger browser download of bundle as JSON file. Browser-only.
 */
export function downloadBundle(bundle: DataBundle): void {
  if (typeof window === 'undefined') return
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  const today = new Date()
  const stamp = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  a.download = `druz9-backup-${stamp}.json`
  document.body.appendChild(a)
  a.click()
  setTimeout(() => {
    URL.revokeObjectURL(url)
    a.remove()
  }, 100)
}
