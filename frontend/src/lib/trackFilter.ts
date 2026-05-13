// trackFilter.ts — shared types and helpers for the «3 equal tracks»
// Tracks parallel the Postgres `track_kind` enum but collapse the
// dev/dev_senior/sysanalyst/product_analyst/qa group into a single
// «go» bucket (engineering track shipped in 3-equal-track identity);
// ML is identified via `cluster='ml'` (track_kind остался
// dev_senior после migration 00046, см. backend/migrations/00033).
//
// `cross_cutting` — узлы которые покрывают behavioral + system-design
// верстальные навыки applicable across all tracks (например,
// «communication clarity», «STAR storytelling»).
//
// Persistence: localStorage stores Set<TrackKey> as JSON array. Empty
// array means «show All» — the «All» chip is the union, not the empty set.

export type TrackKey = 'go' | 'ml' | 'english' | 'cross_cutting'

export const TRACK_KEYS: TrackKey[] = ['go', 'ml', 'english', 'cross_cutting']

export const TRACK_LABEL: Record<TrackKey, string> = {
  go: 'Go',
  ml: 'ML',
  english: 'English',
  cross_cutting: 'Cross-cutting',
}

export const TRACK_SHORT_LABEL: Record<TrackKey, string> = {
  go: 'Go',
  ml: 'ML',
  english: 'EN',
  cross_cutting: 'Cross',
}

// Optional one-liner shown as chip tooltip / a11y title.
export const TRACK_DESCRIPTION: Record<TrackKey, string> = {
  go: 'Backend / algorithms / SQL / system design',
  ml: 'Classical ML, deep learning, transformers, ML system design',
  english: 'Reading / writing / listening / speaking',
  cross_cutting: 'Behavioural, communication, learning meta-skills',
}

// ────────────────────────────────────────────────────────────────────
// classification helpers
// ────────────────────────────────────────────────────────────────────

// Atlas node → TrackKey. Used for filtering /atlas list+canvas.
// Inputs are nullable strings to tolerate the loose AtlasNode contract.
export function classifyAtlasNode(input: {
  cluster?: string | null
  section?: string | null
  trackKind?: string | null
}): TrackKey {
  const cluster = (input.cluster ?? '').toLowerCase()
  const section = (input.section ?? '').toLowerCase()
  const tk = (input.trackKind ?? '').toLowerCase()

  if (tk === 'english' || section === 'english_hr' || section.startsWith('english')) {
    return 'english'
  }
  // ML cluster covers all 00033 seed nodes (ml_root, ml_classical, …).
  // After mig 00046 their track_kind was retagged to dev_senior, so
  // cluster is the authoritative signal here.
  if (cluster === 'ml' || cluster === 'ml_platform') return 'ml'
  // Behavioural / communication = cross-cutting. Helps the user keep
  // soft-skill content visible when they're filtering за hard «Go».
  if (section === 'behavioral' || section === 'section_behavioral') {
    return 'cross_cutting'
  }
  return 'go'
}

// Codex article category → TrackKey. Categories are free-form text
// (algorithms, system_design, sql, go, ml, ml_systems, english, behavioral, …).
export function classifyCodexCategory(category: string | null | undefined): TrackKey {
  const c = (category ?? '').toLowerCase()
  if (c.startsWith('english') || c === 'english') return 'english'
  if (c.startsWith('ml') || c === 'machine_learning' || c === 'deep_learning') return 'ml'
  if (c === 'behavioral' || c === 'soft_skills' || c === 'career') {
    return 'cross_cutting'
  }
  return 'go'
}

// Mock company sections → set of TrackKeys (a company can span
// multiple tracks, e.g. «hr+algo+sysdesign» = go + cross_cutting).
export function classifyMockCompanySections(sections: string[]): Set<TrackKey> {
  const out = new Set<TrackKey>()
  for (const raw of sections) {
    const s = raw.toLowerCase()
    if (s.startsWith('english') || s === 'english_hr') {
      out.add('english')
    } else if (s.startsWith('ml_') || s === 'ml' || s === 'ml_coding' || s === 'ml_system_design' || s === 'ml_theory') {
      out.add('ml')
    } else if (s === 'behavioral' || s === 'hr') {
      // HR + behavioural are cross-cutting (English-track users still
      // need them, ML-track users too).
      out.add('cross_cutting')
    } else {
      out.add('go')
    }
  }
  if (out.size === 0) {
    // Defensive: companies without sections probably full pipeline → go.
    out.add('go')
  }
  return out
}

// PrimaryGoal → default TrackKey for surfaces that pre-select. Returns
// null when the goal doesn't map cleanly (CUSTOM, ANY_SENIOR без company).
export function primaryGoalToTrackKey(kind: string | null | undefined): TrackKey | null {
  switch (kind) {
    case 'GOAL_KIND_ML_OFFER':
      return 'ml'
    case 'GOAL_KIND_ENGLISH_TARGET':
      return 'english'
    case 'GOAL_KIND_TOP_TIER_CO':
    case 'GOAL_KIND_ANY_SENIOR':
      return 'go'
    default:
      return null
  }
}

// ────────────────────────────────────────────────────────────────────
// localStorage persistence
// ────────────────────────────────────────────────────────────────────

const STORAGE_PREFIX = 'druz9.track-filter:'

export function readTrackFilterFromStorage(key: string): Set<TrackKey> | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return null
    const valid = new Set<TrackKey>()
    for (const v of parsed) {
      if (typeof v === 'string' && (TRACK_KEYS as string[]).includes(v)) {
        valid.add(v as TrackKey)
      }
    }
    return valid
  } catch {
    return null
  }
}

export function writeTrackFilterToStorage(key: string, set: Set<TrackKey>): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(
      STORAGE_PREFIX + key,
      JSON.stringify(Array.from(set)),
    )
  } catch {
    /* quota exceeded / disabled — silently noop */
  }
}

// ────────────────────────────────────────────────────────────────────
// URL state — `?tracks=go,ml` for shareable filtered views.
// LocalStorage holds «last used», URL is explicit override. Useful for
// «look at this ML insight» links.
// ────────────────────────────────────────────────────────────────────

export function parseTracksFromUrl(value: string | null): Set<TrackKey> | null {
  if (!value) return null
  const parts = value.split(',').map((p) => p.trim().toLowerCase())
  const out = new Set<TrackKey>()
  for (const p of parts) {
    if ((TRACK_KEYS as string[]).includes(p)) out.add(p as TrackKey)
  }
  return out.size > 0 ? out : null
}

export function serializeTracksForUrl(set: Set<TrackKey>): string {
  // Canonical order so the URL string is stable (no jitter on re-render).
  return TRACK_KEYS.filter((k) => set.has(k)).join(',')
}

// ────────────────────────────────────────────────────────────────────
// Filtering primitives — the chips themselves drive the filter; this
// helper turns the selected set + per-item track tag into a boolean.
//
// `selected` empty == «no filter» (show all). When the user explicitly
// toggles every chip OFF we treat that as «show all» rather than «hide
// everything» — the empty state is unhelpful UX.
// ────────────────────────────────────────────────────────────────────

export function itemMatchesFilter(
  itemTracks: TrackKey | Set<TrackKey> | TrackKey[],
  selected: Set<TrackKey>,
): boolean {
  if (selected.size === 0) return true
  if (typeof itemTracks === 'string') return selected.has(itemTracks)
  const iter = itemTracks instanceof Set ? itemTracks : new Set(itemTracks)
  for (const t of iter) if (selected.has(t)) return true
  return false
}
