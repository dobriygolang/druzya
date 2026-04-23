// ============================================================================
// Misc utilities — shared by every Weekly Report sub-component.
// ============================================================================

export const DAYS_RU = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
export const DAYS_RU_FULL = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье']

export const SECTION_NAMES: Record<string, string> = {
  algorithms: 'Algorithms',
  sql: 'SQL',
  go: 'Go',
  system_design: 'System Design',
  behavioral: 'Behavioral',
  graphs: 'Graphs',
}

// Стабильная палитра по секции — одинаковые цвета на heatmap/ELO/bars.
// Не trust-усь на CSS-переменные внутри SVG-stroke (там через
// currentColor лишний геморрой), берём явные hex.
export const SECTION_COLORS: Record<string, string> = {
  algorithms: '#a78bfa',
  sql: '#22d3ee',
  go: '#34d399',
  system_design: '#fb7185',
  behavioral: '#fbbf24',
  graphs: '#f472b6',
}
export const FALLBACK_COLOR = '#94a3b8'

export function sectionLabel(s: string): string {
  return SECTION_NAMES[s] ?? s.charAt(0).toUpperCase() + s.slice(1)
}
export function sectionColor(s: string): string {
  return SECTION_COLORS[s] ?? FALLBACK_COLOR
}

// ISO week — для localStorage-ключа целей. Год+номер недели по ISO-8601
// (понедельник — первый день, неделя 1 — неделя с первым четвергом года).
export function isoWeekKey(d: Date): string {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const dayNum = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

export function relativeFromNow(iso: string): string {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ''
  const diff = Date.now() - t
  const min = Math.floor(diff / 60_000)
  if (min < 1) return 'только что'
  if (min < 60) return `${min} мин назад`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h} ч назад`
  const days = Math.floor(h / 24)
  if (days === 1) return 'вчера'
  if (days < 7) return `${days} дн назад`
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
}
