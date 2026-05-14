// Centralised proto-enum → human label maps.
//
// Backend serialises proto enums as their full UPPER_SNAKE name
// (e.g. "DIFFICULTY_EASY", "SECTION_ALGORITHMS"). We never want to render
// those strings verbatim in the UI. The functions below normalise both
// shapes:
//   - the canonical proto name (DIFFICULTY_EASY, SECTION_SQL, ...)
//   - the legacy short shape some endpoints still emit (easy, sql, ...)
//
// `humanizeDifficulty` / `humanizeSection` resolve to translations via i18n.
// An unknown enum falls back to the original raw value (better than
// blanking the cell).

import i18n from './i18n'

function difficultyKey(d: string): string | null {
  const upper = d.toUpperCase()
  if (upper === 'EASY' || upper === 'DIFFICULTY_EASY') return 'easy'
  if (upper === 'MEDIUM' || upper === 'DIFFICULTY_MEDIUM') return 'medium'
  if (upper === 'HARD' || upper === 'DIFFICULTY_HARD') return 'hard'
  return null
}

function sectionKey(s: string): string | null {
  const upper = s.toUpperCase()
  if (upper === 'ALGORITHMS' || upper === 'SECTION_ALGORITHMS') return 'algorithms'
  if (upper === 'SQL' || upper === 'SECTION_SQL') return 'sql'
  if (upper === 'GO' || upper === 'SECTION_GO') return 'go'
  if (upper === 'SYSTEM_DESIGN' || upper === 'SECTION_SYSTEM_DESIGN') return 'system_design'
  if (upper === 'BEHAVIORAL' || upper === 'SECTION_BEHAVIORAL') return 'behavioral'
  return null
}

export function humanizeDifficulty(d: string | null | undefined): string {
  if (!d) return '—'
  if (d === 'DIFFICULTY_UNSPECIFIED') return '—'
  const k = difficultyKey(d)
  if (!k) return d
  return i18n.t(`common:labels.difficulty.${k}`)
}

export function humanizeSection(s: string | null | undefined): string {
  if (!s) return '—'
  if (s === 'SECTION_UNSPECIFIED') return '—'
  const k = sectionKey(s)
  if (!k) return s
  return i18n.t(`common:labels.section.${k}`)
}
