// activity.ts — F5 (Phase C) MVP activity log.
//
// Цель: localStorage-backed журнал того что юзер сделал — solved LeetCode,
// прочитал главу DDIA, сыграл mock, etc. Это foundation для:
//   - F3 readiness boost (activity count за последние 7d → +up to 20%)
//   - F4 proactive coach (триггеры user_inactive_4d, etc.)
//   - F7 daily plan tweaks (если юзер сделал mock сегодня — снижаем
//     приоритет next mock на завтра)
//
// MVP storage: один localStorage key с array of Activity. Cap 200 entries
// чтобы quota не вылетела. Когда Phase C ship'нет `LogResource` UC через
// existing intelligence service (DB v65 user_resource_log table уже есть!),
// wire shape намеренно совпадает с planned proto.
//
// Wire mapping → backend `user_resource_log`:
//   kind 'leetcode' / 'reading' → log.kind = 'finished'
//   kind 'mock' / 'reflection'  → log.kind = 'reflection_submitted'
//   title → log.resource_url (если URL) или log.note
//   source → log.payload->>source

export type ActivityKind =
  | 'mock'         // Сыграл mock pipeline / mini-mock
  | 'leetcode'     // Решил задачу (LeetCode / Codewars / NeetCode)
  | 'reading'      // Прочитал главу / paper / Codex статью / DDIA
  | 'coach'        // Coach session (AI-tutor chat)
  | 'focus_block'  // Hone focus session
  | 'reflection'   // Reflection EOD entry
  | 'external'     // Generic external activity (Coursera lecture / podcast / etc)

export interface Activity {
  id: string                  // crypto.randomUUID() в browser
  kind: ActivityKind
  title: string               // human-readable («LeetCode #239 Sliding Window Max»)
  source?: string             // «LeetCode» / «DDIA» / «Coursera» / «Sysdesign primer»
  minutes?: number            // optional time spent
  occurredAt: number          // ms epoch
}

const KEY = 'druz9.activity_log.v1'
const MAX_ENTRIES = 200

function readActivities(): Activity[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as Activity[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeActivities(items: Activity[]): void {
  if (typeof window === 'undefined') return
  try {
    // Cap to MAX_ENTRIES (LRU by occurredAt) чтобы локалшторадж quota не
    // упёрся при долгой использовании.
    const capped =
      items.length > MAX_ENTRIES
        ? [...items].sort((a, b) => b.occurredAt - a.occurredAt).slice(0, MAX_ENTRIES)
        : items
    window.localStorage.setItem(KEY, JSON.stringify(capped))
  } catch {
    /* quota — silent drop, не fatal */
  }
}

type Listener = (items: Activity[]) => void
const listeners = new Set<Listener>()
let cache: Activity[] = readActivities()

if (typeof window !== 'undefined') {
  // Cross-tab sync — storage event fires в других tab'ах
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY) return
    cache = readActivities()
    listeners.forEach((l) => l(cache))
  })
}

function notify() {
  listeners.forEach((l) => l(cache))
}

/** Add a new activity entry. Generated id + сейчас-timestamp если не передан. */
export function logActivity(input: Omit<Activity, 'id' | 'occurredAt'> & {
  id?: string
  occurredAt?: number
}): Activity {
  const id =
    input.id ??
    (typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `act-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  const occurredAt = input.occurredAt ?? Date.now()
  const entry: Activity = {
    id,
    kind: input.kind,
    title: input.title.trim(),
    source: input.source?.trim() || undefined,
    minutes: input.minutes,
    occurredAt,
  }
  cache = [entry, ...cache]
  writeActivities(cache)
  notify()
  return entry
}

export function listActivities(): Activity[] {
  // Возвращаем по убыванию occurredAt (newest first).
  return [...cache].sort((a, b) => b.occurredAt - a.occurredAt)
}

export function deleteActivity(id: string): void {
  cache = cache.filter((a) => a.id !== id)
  writeActivities(cache)
  notify()
}

export function clearActivities(): void {
  cache = []
  try {
    window.localStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
  notify()
}

export function subscribeActivities(l: Listener): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}

// ── Aggregations для readiness boost / dashboard ────────────────────────

export interface ActivitySummary {
  /** Total activities last N days. */
  last7d: number
  last30d: number
  /** Breakdown by kind, last 7d. */
  byKind7d: Record<ActivityKind, number>
  /** Last activity date — ms epoch, или null если пусто. */
  lastActivityAt: number | null
  /** Total minutes последний 7d (если фиксировали). */
  minutes7d: number
}

function emptyKindCounts(): Record<ActivityKind, number> {
  return {
    mock: 0,
    leetcode: 0,
    reading: 0,
    coach: 0,
    focus_block: 0,
    reflection: 0,
    external: 0,
  }
}

export function getActivitySummary(): ActivitySummary {
  const items = cache
  const now = Date.now()
  const cutoff7d = now - 7 * 24 * 60 * 60 * 1000
  const cutoff30d = now - 30 * 24 * 60 * 60 * 1000

  let last7d = 0
  let last30d = 0
  let minutes7d = 0
  let lastActivityAt: number | null = null
  const byKind7d = emptyKindCounts()

  for (const a of items) {
    if (a.occurredAt >= cutoff30d) last30d++
    if (a.occurredAt >= cutoff7d) {
      last7d++
      byKind7d[a.kind] = (byKind7d[a.kind] ?? 0) + 1
      if (a.minutes) minutes7d += a.minutes
    }
    if (lastActivityAt === null || a.occurredAt > lastActivityAt) {
      lastActivityAt = a.occurredAt
    }
  }

  return { last7d, last30d, byKind7d, lastActivityAt, minutes7d }
}

/**
 * computeActivityBoost — used by F3 readiness engine. Возвращает +дельту %
 * на основе аккумулированной активности за 7d. MVP rules:
 *
 *   - per activity в last 7d: +1%, cap +15
 *   - per mock в last 7d: +2 дополнительно (mocks хорошо мерят readiness),
 *     cap +5 (поверх +15 baseline)
 *
 *   Total max = +20%
 *
 * Если weak area matched (например, weakest=algos + lots of leetcode logged),
 * можем додать +5 ещё. Это в Phase C iteration.
 */
export function computeActivityBoost(): { delta: number; reason: string | null } {
  const s = getActivitySummary()
  if (s.last7d === 0) return { delta: 0, reason: null }

  const base = Math.min(15, s.last7d)
  const mockBonus = Math.min(5, s.byKind7d.mock * 2)
  const total = base + mockBonus

  const detail =
    mockBonus > 0
      ? `${s.last7d} activities + ${s.byKind7d.mock} mock(s) за 7 дней`
      : `${s.last7d} activities за 7 дней`
  return { delta: total, reason: detail }
}

// ── Trajectory (Progress twin) ──────────────────────────────────────────

export interface DailyBucket {
  /** YYYY-M-D local date key. */
  dayKey: string
  /** Activity count. */
  count: number
  /** Sum of minutes (если фиксировались), 0 если все activities без minutes. */
  minutes: number
}

/**
 * getDailyActivityCounts — возвращает массив N последних дней (oldest first
 * → newest last) с counts + minutes. Подходит для Sparkline + week-vs-week
 * сравнений. Пустые дни имеют count=0 — это деталь UI визуализации, не
 * fallback.
 */
export function getDailyActivityCounts(days: number): DailyBucket[] {
  const now = new Date()
  const buckets = new Map<string, DailyBucket>()
  // Pre-populate с пустыми днями
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now)
    d.setDate(d.getDate() - i)
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
    buckets.set(key, { dayKey: key, count: 0, minutes: 0 })
  }
  // Fill from cache
  for (const a of cache) {
    const d = new Date(a.occurredAt)
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
    const bucket = buckets.get(key)
    if (!bucket) continue // outside window
    bucket.count++
    if (a.minutes) bucket.minutes += a.minutes
  }
  return Array.from(buckets.values())
}

export interface TrajectoryTrend {
  /** Counts последние 30 дней (для sparkline). */
  daily30: DailyBucket[]
  /** Count last 7 days. */
  thisWeek: number
  /** Count days 14d ago to 7d ago. */
  lastWeek: number
  /** Delta thisWeek - lastWeek. */
  weekDelta: number
  /** Total minutes last 30d. */
  minutes30: number
  /** Total minutes last 7d. */
  minutes7: number
  /** Days with activity in last 30d. */
  activeDays30: number
  /** Verdict label. */
  verdict: 'строит привычку' | 'на подъёме' | 'ровно' | 'просел' | 'тишина'
}

export function computeTrajectory(): TrajectoryTrend {
  const daily30 = getDailyActivityCounts(30)
  // daily30 oldest-first; index 23..29 → last 7 days; 16..22 → previous 7.
  let thisWeek = 0
  let lastWeek = 0
  let minutes7 = 0
  let minutes30 = 0
  let activeDays30 = 0
  for (let i = 0; i < daily30.length; i++) {
    const b = daily30[i]
    minutes30 += b.minutes
    if (b.count > 0) activeDays30++
    if (i >= daily30.length - 7) {
      thisWeek += b.count
      minutes7 += b.minutes
    } else if (i >= daily30.length - 14 && i < daily30.length - 7) {
      lastWeek += b.count
    }
  }
  const weekDelta = thisWeek - lastWeek

  let verdict: TrajectoryTrend['verdict']
  if (thisWeek === 0 && lastWeek === 0) verdict = 'тишина'
  else if (thisWeek > lastWeek + 2) verdict = 'на подъёме'
  else if (thisWeek < lastWeek - 2) verdict = 'просел'
  else if (activeDays30 >= 21) verdict = 'строит привычку'
  else verdict = 'ровно'

  return { daily30, thisWeek, lastWeek, weekDelta, minutes30, minutes7, activeDays30, verdict }
}

// ── Streak detection ─────────────────────────────────────────────────────

export interface StreakInfo {
  /** Current consecutive days ending today. 0 если не log'ал today. */
  days: number
  /** Longest streak за всю историю (включая прошлые). */
  longestDays: number
  /** Today already has at least 1 activity. */
  includesToday: boolean
}

function dayKey(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

/**
 * computeStreak — passes through activity log, returns current streak
 * (consecutive days ending today) + longestDays history. «Day» = local
 * calendar day; одно activity достаточно чтобы день засчитался.
 *
 * Algorithm: build set of unique day keys → walk backward от today, counting
 * consecutive. Также tracks longest run.
 */
export function computeStreak(): StreakInfo {
  const items = cache
  if (items.length === 0) return { days: 0, longestDays: 0, includesToday: false }

  const dayKeys = new Set<string>()
  for (const a of items) dayKeys.add(dayKey(a.occurredAt))

  const todayKey = dayKey(Date.now())
  const includesToday = dayKeys.has(todayKey)

  // Current streak walk — назад от today.
  let current = 0
  const cursor = new Date()
  for (let i = 0; i < 365; i++) {
    const key = dayKey(cursor.getTime())
    if (dayKeys.has(key)) {
      current++
      cursor.setDate(cursor.getDate() - 1)
    } else {
      // If today is NOT in set and i === 0, streak still может включать
      // вчера — let's check yesterday separately so юзер не теряет streak
      // утром пока не log'ал сегодня. UX: streak показывается даже если
      // сегодня пусто, но «надо log'нуть до конца дня».
      if (i === 0 && !includesToday) {
        cursor.setDate(cursor.getDate() - 1)
        continue
      }
      break
    }
  }

  // Longest streak — full pass over sorted days. Day boundary checked
  // in 0.9-1.5d range для DST tolerance (spring-forward = 23h, fall-back = 25h).
  const sortedDays = [...dayKeys].map((key) => {
    const [y, m, d] = key.split('-').map(Number)
    return new Date(y, m, d).getTime()
  }).sort((a, b) => a - b)

  const DAY_MS = 86400000
  let longest = 0
  let run = 0
  let prevMs: number | null = null
  for (const ms of sortedDays) {
    if (prevMs === null) {
      run = 1
    } else {
      const gap = ms - prevMs
      run = gap >= DAY_MS * 0.9 && gap <= DAY_MS * 1.5 ? run + 1 : 1
    }
    if (run > longest) longest = run
    prevMs = ms
  }

  return { days: current, longestDays: Math.max(longest, current), includesToday }
}

/**
 * computeStreakBonus — used by F3 readiness engine как дополнительный
 * factor поверх activity boost. Tiered:
 *
 *   3 дня:  +3%
 *   7 дней: +5%
 *   14 дн:  +10%
 *   30+ дн: +15%
 *
 * Streak important даёт даже больше «habit signal» чем pure activity count —
 * consistency сигналит дисциплину, что core для senior interview prep.
 */
export function computeStreakBonus(): { delta: number; reason: string | null } {
  const s = computeStreak()
  if (s.days < 3) return { delta: 0, reason: null }
  let delta = 3
  let label = `${s.days}-day streak`
  if (s.days >= 30) {
    delta = 15
    label = `${s.days}-day streak (habit locked in)`
  } else if (s.days >= 14) {
    delta = 10
    label = `${s.days}-day streak (consistent)`
  } else if (s.days >= 7) {
    delta = 5
    label = `${s.days}-day streak`
  }
  return { delta, reason: label }
}
