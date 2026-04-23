import { DAYS_RU, DAYS_RU_FULL } from './utils'

// ============================================================================
// 2. <HourlyHeatmap data={hourly} /> — 7×24 SVG
// ============================================================================

export function HourlyHeatmap({ data }: { data: number[] }) {
  const cells = data.length === 168 ? data : []
  const max = Math.max(0, ...cells)
  const isEmpty = max === 0

  // 5 уровней: 0, 25%, 50%, 75%, 100% от max (percentile-ish bucketing).
  // CSS-классы вместо SVG-fill — так Tailwind сам тянет --color-accent
  // через bg-accent/N с alpha-каналом.
  const LEVELS = ['bg-surface-1', 'bg-accent/20', 'bg-accent/40', 'bg-accent/70', 'bg-accent-hover']
  function levelOf(v: number): number {
    if (v <= 0 || max <= 0) return 0
    const p = v / max
    if (p > 0.75) return 4
    if (p > 0.5) return 3
    if (p > 0.25) return 2
    return 1
  }

  const HOUR_LABELS = [0, 4, 8, 12, 16, 20]

  return (
    <section className="flex flex-col gap-5 rounded-2xl bg-surface-2 p-5 sm:p-7">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg font-bold text-text-primary">Когда ты учишься</h2>
        <span className="font-mono text-[11px] text-text-muted">7 дней × 24 часа</span>
      </div>
      {isEmpty ? (
        <div className="grid place-items-center rounded-xl bg-surface-1 py-12 text-center">
          <span className="text-sm text-text-muted">Нет активности на этой неделе</span>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex">
            <div className="w-8" />
            <div
              className="grid flex-1 gap-[2px] font-mono text-[10px] text-text-muted"
              style={{ gridTemplateColumns: 'repeat(24, minmax(0, 1fr))' }}
            >
              {Array.from({ length: 24 }).map((_, h) => (
                <div key={h} className="text-center">
                  {HOUR_LABELS.includes(h) ? String(h).padStart(2, '0') : ''}
                </div>
              ))}
            </div>
          </div>
          {DAYS_RU.map((d, dow) => (
            <div key={d} className="flex items-center">
              <div className="w-8 font-mono text-[11px] text-text-muted">{d}</div>
              <div
                className="grid flex-1 gap-[2px]"
                style={{ gridTemplateColumns: 'repeat(24, minmax(0, 1fr))' }}
              >
                {Array.from({ length: 24 }).map((_, h) => {
                  const v = cells[dow * 24 + h] ?? 0
                  const lvl = levelOf(v)
                  return (
                    <div
                      key={h}
                      className={`h-5 rounded-[3px] ${LEVELS[lvl]} transition-colors`}
                      title={`${DAYS_RU_FULL[dow]} ${String(h).padStart(2, '0')}:00 — ${v} ${v === 1 ? 'матч' : 'матчей'}`}
                    />
                  )
                })}
              </div>
            </div>
          ))}
          <div className="mt-2 flex items-center gap-2 text-[10px] text-text-muted">
            <span>меньше</span>
            {LEVELS.map((cls, i) => (
              <span key={i} className={`h-3 w-3 rounded-[3px] ${cls}`} />
            ))}
            <span>больше</span>
          </div>
        </div>
      )}
    </section>
  )
}
