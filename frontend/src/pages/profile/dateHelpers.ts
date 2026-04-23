// Date helpers — anti-fallback policy: never render "Invalid Date" or
// "1 января 1970". Backend returns ISO timestamps, but a fresh user has
// no finished matches / unlocked achievements yet, in which case the
// server may emit an empty string or a zero-Timestamp. Show an em-dash.
export function fmtDateTime(iso?: string | null): string {
  if (!iso || iso.startsWith('1970-')) return '—'
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t) || t === 0) return '—'
  return new Date(t).toLocaleString('ru-RU')
}
export function fmtDate(iso?: string | null): string {
  if (!iso || iso.startsWith('1970-')) return '—'
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t) || t === 0) return '—'
  return new Date(t).toLocaleDateString('ru-RU')
}
