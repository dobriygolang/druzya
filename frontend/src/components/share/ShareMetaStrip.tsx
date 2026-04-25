// ShareMetaStrip — 4 compact secondary tiles below the hero. Same shape on
// every variant (XP/Achievement/Streak), only the dominant tile differs in
// the hero — keeps the OG-card 1200×630 from looking lopsided when one
// variant has fewer numbers to brag about.
//
// Mobile (320): collapses to 2x2 grid. Desktop: 4 across.

export type ShareMetaTile = {
  label: string
  value: string
  sub?: string
  tone?: 'default' | 'success' | 'warn' | 'danger' | 'cyan' | 'pink'
}

const TONE: Record<NonNullable<ShareMetaTile['tone']>, string> = {
  default: 'text-text-primary',
  success: 'text-success',
  warn: 'text-warn',
  danger: 'text-danger',
  cyan: 'text-text-secondary',
  pink: 'text-text-secondary',
}

export function ShareMetaStrip({ tiles }: { tiles: ShareMetaTile[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
      {tiles.map((t) => (
        <div
          key={t.label}
          className="flex flex-col gap-1.5 rounded-xl bg-surface-2 p-4 sm:p-5"
        >
          <span className="font-mono text-[9px] sm:text-[10px] font-semibold uppercase tracking-[0.12em] text-text-muted">
            {t.label}
          </span>
          <span
            className={`font-display text-2xl sm:text-3xl font-extrabold leading-none ${TONE[t.tone ?? 'default']}`}
          >
            {t.value}
          </span>
          {t.sub && (
            <span className="font-mono text-[10px] text-text-muted">{t.sub}</span>
          )}
        </div>
      ))}
    </div>
  )
}

export default ShareMetaStrip
