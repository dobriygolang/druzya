// EmptyState — single canonical component for every "нет данных" surface
// (Wave-10, design-review v3 B.2).
//
// Rule of thumb: NEVER render "—" or empty string from a query result.
// Either there's data, or there's an <EmptyState />. The lint rule that
// enforces this is documented in design-snapshots/_rules.md.
//
// 7 variants cover the matrix of "why is this empty":
//   no-data       — query succeeded, list is empty (legitimate). CTA →
//                   first-action ("Сыграть", "Создать когорту").
//   first-time    — first visit to a feature. CTA → tutorial / inline
//                   onboarding hint.
//   error         — query failed. CTA → retry. Trace id (optional) shown
//                   below for support tickets.
//   loading       — in-flight. Renders <EmptySkeleton> (layout-aware,
//                   not a generic spinner — avoids CLS).
//   coming-soon   — feature not shipped. Optional email-subscribe CTA.
//   404-not-found — entity by id was deleted / invalid. Auto secondary
//                   "back" wired through useNavigate.
//   throttled     — backend rate-limited (typically 429 from /vacancies/
//                   sync). Live countdown driven by retryAfterSec prop.
//
// Anti-fallback recap: this component never invents data. If body is
// missing it shows just the kicker + title. If CTA is missing it shows
// only what was given. The variant DEFAULTS map provides honest copy
// when caller omits.

import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { cn } from '../lib/cn'
import { EmptyIllustration } from './EmptyIllustration'
import { EmptySkeleton, type SkeletonLayout } from './EmptySkeleton'

export type EmptyVariant =
  | 'no-data'
  | 'first-time'
  | 'error'
  | 'loading'
  | 'coming-soon'
  | '404-not-found'
  | 'throttled'

export type EmptyCta = {
  label: string
  onClick?: () => void
  href?: string
}

export type EmptyStateProps = {
  variant: EmptyVariant
  /** Override default title. Use for context-specific copy. */
  title?: string
  /** Override default body. Set to null to suppress body entirely. */
  body?: string | null
  cta?: EmptyCta
  secondaryCta?: EmptyCta
  /** For variant=throttled: seconds until retry; drives the countdown. */
  retryAfterSec?: number
  /** For variant=loading: layout of the skeleton; defaults to card-grid. */
  skeletonLayout?: SkeletonLayout
  /** Compact mode reduces vertical padding — for inline empties inside
   *  cards rather than full-page placeholders. */
  compact?: boolean
  /** Optional trace id shown for variant=error to help support. */
  traceId?: string
  /** Custom node injected below the title (e.g. <input> for coming-soon). */
  extra?: ReactNode
}

// Tones are presentation, not copy — kept here. Kicker/title/body live in
// `wave10:emptyState.*` so KZ/UA can override without touching this file.
const TONE: Record<EmptyVariant, string> = {
  'no-data': 'text-text-muted',
  'first-time': 'text-text-muted',
  error: 'text-danger',
  loading: 'text-text-muted',
  'coming-soon': 'text-pink',
  '404-not-found': 'text-warn',
  throttled: 'text-warn',
}

const I18N_KEY: Record<EmptyVariant, string> = {
  'no-data': 'noData',
  'first-time': 'firstTime',
  error: 'error',
  loading: 'loading',
  'coming-soon': 'comingSoon',
  '404-not-found': 'notFound',
  throttled: 'throttled',
}

function useDefaults(variant: EmptyVariant): {
  kicker: string
  title: string
  body?: string
  tone: string
} {
  const { t } = useTranslation('wave10')
  const k = I18N_KEY[variant]
  // i18next returns the key itself on a true miss; treat the absence of
  // an explicit body translation as "no body" for variants where RU has none.
  const bodyRaw = t(`emptyState.${k}.body`, { defaultValue: '' })
  return {
    kicker: t(`emptyState.${k}.kicker`),
    title: t(`emptyState.${k}.title`),
    body: bodyRaw ? bodyRaw : undefined,
    tone: TONE[variant],
  }
}

function CtaButton({ cta, primary, disabled }: { cta: EmptyCta; primary: boolean; disabled?: boolean }) {
  const cls = primary
    ? 'rounded-md bg-accent hover:bg-accent/90 text-white font-semibold text-sm px-4 py-2 disabled:opacity-60 disabled:cursor-not-allowed'
    : 'rounded-md border border-border bg-surface-1 text-text-secondary font-medium text-sm px-4 py-2 hover:bg-surface-2'
  if (cta.href) {
    return (
      <a href={cta.href} className={cls}>
        {cta.label}
      </a>
    )
  }
  return (
    <button type="button" onClick={cta.onClick} disabled={disabled} className={cls}>
      {cta.label}
    </button>
  )
}

export function EmptyState(props: EmptyStateProps) {
  const navigate = useNavigate()
  const { t } = useTranslation('wave10')
  const def = useDefaults(props.variant)
  const title = props.title ?? def.title
  const body = props.body === null ? undefined : (props.body ?? def.body)

  // Throttle countdown — driven by parent-supplied retryAfterSec. Local
  // state ticks down once per second; resets if parent passes a new value.
  const [remaining, setRemaining] = useState(props.retryAfterSec ?? 0)
  useEffect(() => {
    if (props.variant !== 'throttled' || !props.retryAfterSec) return
    setRemaining(props.retryAfterSec)
    const id = setInterval(() => setRemaining((s) => Math.max(0, s - 1)), 1000)
    return () => clearInterval(id)
  }, [props.retryAfterSec, props.variant])

  // loading — own render path, no titles/CTAs (skeleton speaks for itself)
  if (props.variant === 'loading') {
    return <EmptySkeleton layout={props.skeletonLayout ?? 'card-grid'} />
  }

  // 404 → auto-secondary "назад" via router history
  const secondary =
    props.secondaryCta ??
    (props.variant === '404-not-found' ? { label: t('emptyState.back'), onClick: () => navigate(-1) } : undefined)

  const ctaDisabled = props.variant === 'throttled' && remaining > 0
  const kicker =
    props.variant === 'throttled' && props.retryAfterSec
      ? `${def.kicker} · retry in ${String(Math.floor(remaining / 60)).padStart(2, '0')}:${String(
          remaining % 60,
        ).padStart(2, '0')}`
      : def.kicker

  return (
    <div
      className={cn('text-center', props.compact ? 'py-6' : 'py-14')}
      role="status"
      aria-live={props.variant === 'error' ? 'assertive' : 'polite'}
    >
      {!props.compact && <EmptyIllustration variant={props.variant} />}
      <div className={cn('font-mono text-[10px] uppercase tracking-wider mb-2', def.tone)}>{kicker}</div>
      <h3 className="font-display text-lg font-bold mb-1.5 text-text-primary">{title}</h3>
      {body && (
        <p className="text-[13px] text-text-secondary mb-5 max-w-[380px] mx-auto leading-relaxed">{body}</p>
      )}
      {props.extra && <div className="mb-4">{props.extra}</div>}
      {(props.cta || secondary) && (
        <div className="flex items-center justify-center gap-2 flex-wrap">
          {props.cta && (
            <CtaButton
              cta={
                props.variant === 'throttled' && remaining > 0
                  ? { ...props.cta, label: `${props.cta.label} · ${remaining}с` }
                  : props.cta
              }
              primary
              disabled={ctaDisabled}
            />
          )}
          {secondary && <CtaButton cta={secondary} primary={false} />}
        </div>
      )}
      {props.variant === 'error' && props.traceId && (
        <div className="mt-4 font-mono text-[10px] text-text-muted">trace · {props.traceId}</div>
      )}
    </div>
  )
}
