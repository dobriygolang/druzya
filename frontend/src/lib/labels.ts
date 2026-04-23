// Centralised proto-enum → human label maps.
//
// Backend serialises proto enums as their full UPPER_SNAKE name
// (e.g. "DIFFICULTY_EASY", "SECTION_ALGORITHMS"). We never want to render
// those strings verbatim in the UI. The maps below cover both shapes:
//   - the canonical proto name (DIFFICULTY_EASY, SECTION_SQL, ...)
//   - the legacy short shape some endpoints still emit (easy, sql, ...)
//
// `humanizeDifficulty` / `humanizeSection` always return *something* so the
// UI never shows undefined; an unknown enum falls back to the original raw
// value (better than blanking the cell).

export const DIFFICULTY_LABELS_RU: Record<string, string> = {
  DIFFICULTY_UNSPECIFIED: '—',
  DIFFICULTY_EASY: 'Лёгко',
  DIFFICULTY_MEDIUM: 'Средне',
  DIFFICULTY_HARD: 'Сложно',
  EASY: 'Лёгко',
  MEDIUM: 'Средне',
  HARD: 'Сложно',
  easy: 'Лёгко',
  medium: 'Средне',
  hard: 'Сложно',
}

export const SECTION_LABELS_RU: Record<string, string> = {
  SECTION_UNSPECIFIED: '—',
  SECTION_ALGORITHMS: 'Алгоритмы',
  SECTION_SQL: 'SQL',
  SECTION_GO: 'Go',
  SECTION_SYSTEM_DESIGN: 'System Design',
  SECTION_BEHAVIORAL: 'Behavioral',
  ALGORITHMS: 'Алгоритмы',
  SQL: 'SQL',
  GO: 'Go',
  SYSTEM_DESIGN: 'System Design',
  BEHAVIORAL: 'Behavioral',
  algorithms: 'Алгоритмы',
  sql: 'SQL',
  go: 'Go',
  system_design: 'System Design',
  behavioral: 'Behavioral',
}

export function humanizeDifficulty(d: string | null | undefined): string {
  if (!d) return '—'
  return DIFFICULTY_LABELS_RU[d] ?? d
}

export function humanizeSection(s: string | null | undefined): string {
  if (!s) return '—'
  return SECTION_LABELS_RU[s] ?? s
}
