// cueSessions.ts — F10 (Phase C) frontend stub для cross-product Cue
// session ingestion. Cue (stealth tray-copilot) end-of-session должен
// flow transcript + metadata в web Coach memory чтобы AI знал «вчера на
// Google interview struggled with sharding».
//
// MVP storage: localStorage `druz9.cue_sessions.v1`. Когда Phase C ship'нет
// real backend `IngestSessionTranscript` UC + Connect-RPC, replacement —
// migrate localStorage → POST на mount, keep frontend API стабильным.
//
// Wire shape намеренно совпадает с planned backend message: persona /
// company / sections[] / transcript_url / completed_at.
//
// Manual entry — для testing flow + interim use case (юзер может вручную
// «log Cue session» если real Cue ingestion ещё не подключен).

export type CueSessionStage = 'hr' | 'algo' | 'sysdesign' | 'coding' | 'behavioral' | 'other'

export interface CueSessionStageEntry {
  stage: CueSessionStage
  /** Briefный лог: что обсуждалось, какой вопрос, какой результат. */
  notes: string
  /** Optional: subjective rating сам-юзер 1-5 (5 = nailed it). */
  selfRating?: 1 | 2 | 3 | 4 | 5
}

export interface CueSession {
  id: string
  /** Display name компании или контекста. */
  company: string
  /** Persona which was active in Cue (algo coach / sysdesign guru / etc). */
  persona?: string
  /** Stages — entries по каждой секции собеса. */
  stages: CueSessionStageEntry[]
  /** Full transcript URL (или текст inline) — для будущей RAG. */
  transcriptUrl?: string
  /** Аутосаммари (1-3 строки) — что AI вынес из транскрипта. Pre-filled
   * при manual log; будет авто-генериться в Phase C backend. */
  aiSummary?: string
  startedAt: number
  completedAt: number
}

const KEY = 'druz9.cue_sessions.v1'
const MAX_ENTRIES = 50

function read(): CueSession[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as CueSession[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function write(items: CueSession[]): void {
  if (typeof window === 'undefined') return
  try {
    const capped =
      items.length > MAX_ENTRIES
        ? [...items].sort((a, b) => b.completedAt - a.completedAt).slice(0, MAX_ENTRIES)
        : items
    window.localStorage.setItem(KEY, JSON.stringify(capped))
  } catch {
    /* quota — silent drop */
  }
}

type Listener = (items: CueSession[]) => void
const listeners = new Set<Listener>()
let cache: CueSession[] = read()

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY) return
    cache = read()
    listeners.forEach((l) => l(cache))
  })
}

export function logCueSession(input: Omit<CueSession, 'id' | 'completedAt'> & {
  id?: string
  completedAt?: number
}): CueSession {
  const id =
    input.id ??
    (typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `cue-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  const completedAt = input.completedAt ?? Date.now()
  const entry: CueSession = {
    id,
    company: input.company.trim(),
    persona: input.persona?.trim() || undefined,
    stages: input.stages,
    transcriptUrl: input.transcriptUrl?.trim() || undefined,
    aiSummary: input.aiSummary?.trim() || undefined,
    startedAt: input.startedAt,
    completedAt,
  }
  cache = [entry, ...cache]
  write(cache)
  listeners.forEach((l) => l(cache))
  return entry
}

export function listCueSessions(): CueSession[] {
  return [...cache].sort((a, b) => b.completedAt - a.completedAt)
}

export function deleteCueSession(id: string): void {
  cache = cache.filter((s) => s.id !== id)
  write(cache)
  listeners.forEach((l) => l(cache))
}

export function clearCueSessions(): void {
  cache = []
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.removeItem('druz9.cue_sessions.v1')
    } catch {
      /* ignore */
    }
  }
  listeners.forEach((l) => l(cache))
}

export function getLatestCueSession(): CueSession | null {
  return cache.length > 0 ? cache.reduce((a, b) => (a.completedAt > b.completedAt ? a : b)) : null
}

export function subscribeCueSessions(l: Listener): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}

// Aggregations для F4 insight detection + F1 memory rendering.

export interface CueSessionsSummary {
  total: number
  /** Last 30 days. */
  last30d: number
  /** Mean self-rating across all stages, last 30d. null если нет ratings. */
  avgRating30d: number | null
  lastSessionAt: number | null
  /** Sections where юзер consistently rated <=2 (struggling). */
  strugglingStages: CueSessionStage[]
}

export function getCueSessionsSummary(): CueSessionsSummary {
  const all = cache
  const now = Date.now()
  const cutoff30d = now - 30 * 24 * 60 * 60 * 1000
  const recent = all.filter((s) => s.completedAt >= cutoff30d)

  let lastSessionAt: number | null = null
  let ratingsSum = 0
  let ratingsCount = 0
  const stageRatings = new Map<CueSessionStage, number[]>()

  for (const s of all) {
    if (lastSessionAt === null || s.completedAt > lastSessionAt) lastSessionAt = s.completedAt
  }
  for (const s of recent) {
    for (const stage of s.stages) {
      if (stage.selfRating !== undefined) {
        ratingsSum += stage.selfRating
        ratingsCount++
        const arr = stageRatings.get(stage.stage) ?? []
        arr.push(stage.selfRating)
        stageRatings.set(stage.stage, arr)
      }
    }
  }

  const avgRating30d = ratingsCount > 0 ? ratingsSum / ratingsCount : null
  const strugglingStages: CueSessionStage[] = []
  for (const [stage, ratings] of stageRatings.entries()) {
    if (ratings.length < 2) continue // need at least 2 datapoints
    const avg = ratings.reduce((a, b) => a + b, 0) / ratings.length
    if (avg <= 2) strugglingStages.push(stage)
  }

  return {
    total: all.length,
    last30d: recent.length,
    avgRating30d,
    lastSessionAt,
    strugglingStages,
  }
}
