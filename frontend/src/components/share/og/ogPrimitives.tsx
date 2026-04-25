// OG-card primitives — chrome shared by all 3 layouts (XP / Streak / Achievement).
// Designer source: /Users/sedorofeevd/Downloads/og-cards.jsx.
//
// Anti-fallback: эти компоненты — только presentational; никаких числовых
// fallback'ов внутри. Если данные отсутствуют — caller передаёт пустую строку
// и место остаётся пустым (см. EmptyState policy в WeeklyShareView).

import type { ReactNode } from 'react'

/* CardFrame — 1200×630 outer card with texture, glow, hairline, padding. */
export function CardFrame({
  children,
  texture = 'grid',
}: {
  children: ReactNode
  texture?: 'grid' | 'dots'
}) {
  return (
    <div
      className="relative overflow-hidden text-text-primary"
      style={{
        width: 1200,
        height: 630,
        background: 'rgb(var(--color-bg))',
        borderRadius: 0,
      }}
    >
      <div className={`absolute inset-0 ${texture === 'grid' ? 'tex-grid' : 'tex-dots'}`} />
      <div
        className="absolute pointer-events-none"
        style={{
          top: -180,
          right: -180,
          width: 520,
          height: 520,
          borderRadius: '50%',
          background:
            'radial-gradient(circle, rgba(244,114,182,0.18) 0%, rgba(34,211,238,0.08) 45%, transparent 70%)',
          filter: 'blur(20px)',
        }}
      />
      <div className="absolute hairline" style={{ left: 72, right: 72, bottom: 76 }} />
      <div className="relative h-full flex flex-col" style={{ padding: '48px 72px' }}>
        {children}
      </div>
    </div>
  )
}

/* Eyebrow — mono uppercase tag used above headlines. */
export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-muted">
      {children}
    </div>
  )
}

/* LogoMark — tiny gradient «9» square. */
export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <span
      className="grid place-items-center font-display font-extrabold text-white"
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size / 4),
        background: 'linear-gradient(135deg, rgb(var(--color-pink)), rgb(var(--color-cyan)))',
        fontSize: Math.round(size * 0.55),
        lineHeight: 1,
      }}
    >
      9
    </span>
  )
}

/* Avatar — letter-disc fallback. */
export function Avatar({
  letter,
  size = 40,
}: {
  name?: string
  letter: string
  size?: number
}) {
  return (
    <span
      className="grid place-items-center rounded-full font-display font-bold text-white"
      style={{
        width: size,
        height: size,
        background: 'linear-gradient(135deg, rgb(var(--color-pink)), rgb(var(--color-accent)))',
        fontSize: Math.round(size * 0.45),
      }}
    >
      {letter || '·'}
    </span>
  )
}

/* UserBadge — avatar + handle + week label, used in OG TopBar. */
export function UserBadge({
  name,
  letter,
  week,
  range,
  size = 56,
}: {
  name: string
  letter: string
  week: number | string
  range?: string
  size?: number
}) {
  return (
    <div className="flex items-center gap-3">
      <Avatar letter={letter} name={name} size={size} />
      <div>
        <div className="flex items-baseline gap-1 leading-none">
          <span className="font-mono text-text-muted text-[12px]">@</span>
          <span className="font-display font-bold" style={{ fontSize: 18 }}>
            {name}
          </span>
        </div>
        <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.16em] text-text-muted">
          week {week}{range ? ` · ${range}` : ''}
        </div>
      </div>
    </div>
  )
}

/* ShareRow — visual row of share-target dots. Decorative on OG image. */
export function ShareRow({ size = 'md' }: { size?: 'sm' | 'md' }) {
  const dot = size === 'sm' ? 22 : 28
  const items = ['T', 'X', 'TG', 'IN', 'GH']
  return (
    <div className="flex items-center gap-2">
      {items.map((label) => (
        <span
          key={label}
          className="grid place-items-center rounded-md border border-border bg-surface-1 font-mono font-semibold text-text-muted"
          style={{
            width: dot,
            height: dot,
            fontSize: size === 'sm' ? 9 : 10,
          }}
        >
          {label}
        </span>
      ))}
    </div>
  )
}

/* MicroPitch — short product pitch in OG top-right. */
export function MicroPitch() {
  return (
    <div className="text-right max-w-[220px]">
      <div className="font-display font-bold text-text-primary text-[13px] leading-tight">
        druz9
      </div>
      <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-text-muted mt-1">
        ranked-практика для разработчиков
      </div>
    </div>
  )
}

/* Mini — compact metric tile used in BottomStrip. */
export type MiniProps = {
  label: string
  value: string | number
  tone?: 'default' | 'success' | 'warn' | 'cyan' | 'pink' | 'danger'
  foot?: string
}

const TONE: Record<NonNullable<MiniProps['tone']>, string> = {
  default: 'text-text-primary',
  success: 'text-success',
  warn: 'text-warn',
  cyan: 'text-text-secondary',
  pink: 'text-text-secondary',
  danger: 'text-danger',
}

export function Mini({ label, value, tone = 'default', foot }: MiniProps) {
  return (
    <div>
      <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-muted">
        {label}
      </div>
      <div className={`mt-1 font-display font-extrabold ${TONE[tone]}`} style={{ fontSize: 28, lineHeight: 1 }}>
        {value}
      </div>
      {foot && <div className="mt-1.5 font-mono text-[10px] text-text-muted">{foot}</div>}
    </div>
  )
}

/* PullQuote — italic-feeling pull-quote line (AI coach narrative). */
export function PullQuote({ children }: { children: ReactNode }) {
  return (
    <blockquote className="font-display text-text-primary" style={{ fontSize: 17, lineHeight: 1.35 }}>
      <span className="g-pc">«</span>
      {children}
      <span className="g-pc">»</span>
    </blockquote>
  )
}

/* TopBar — UserBadge + ShareRow + MicroPitch. */
export function TopBar({
  name,
  letter,
  week,
  range,
}: {
  name: string
  letter: string
  week: number | string
  range?: string
}) {
  return (
    <div className="flex items-start justify-between">
      <UserBadge name={name} letter={letter} week={week} range={range} size={56} />
      <div className="flex items-start gap-8">
        <ShareRow />
        <MicroPitch />
      </div>
    </div>
  )
}

/* BottomStrip — 4 mini metrics + optional CTA. */
export function BottomStrip({
  metrics,
  showCta = true,
}: {
  metrics: MiniProps[]
  showCta?: boolean
}) {
  return (
    <div className="mt-auto pt-6 flex items-end justify-between">
      <div className="grid grid-cols-4 gap-10" style={{ minWidth: 560 }}>
        {metrics.map((m, i) => (
          <Mini key={`${m.label}-${i}`} {...m} />
        ))}
      </div>
      {showCta && (
        <span className="inline-flex items-center gap-2.5 rounded-md border border-border-strong bg-text-primary/15 px-4 py-2.5">
          <span className="font-display font-semibold text-white text-[13px]">Хочу так же</span>
          <span className="font-mono text-text-secondary text-[13px]">→</span>
        </span>
      )}
    </div>
  )
}
