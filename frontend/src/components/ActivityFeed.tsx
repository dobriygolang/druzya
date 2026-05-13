
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, BookOpen, MessageSquare, Pencil, Sparkles, Timer, Code2, Globe } from 'lucide-react'

import { QuickLogModal } from './QuickLogModal'
import { StreakChip } from './StreakChip'
import { useActivities, useActivitySummary } from '../lib/useActivity'
import { deleteActivity, type ActivityKind } from '../lib/activity'

// Activity kind labels are resolved via i18n at render — see ActivityFeed below.
const KIND_ICON: Record<ActivityKind, typeof Sparkles> = {
  mock: Sparkles,
  leetcode: Code2,
  reading: BookOpen,
  coach: MessageSquare,
  focus_block: Timer,
  reflection: Pencil,
  external: Globe,
}

const LIMIT_DEFAULT = 12

export function ActivityFeed() {
  const { t, i18n } = useTranslation('activity')
  const items = useActivities()
  const summary = useActivitySummary()
  const [logOpen, setLogOpen] = useState(false)
  const [showAll, setShowAll] = useState(false)

  const visible = useMemo(
    () => (showAll ? items : items.slice(0, LIMIT_DEFAULT)),
    [items, showAll],
  )

  const lang = i18n.language

  return (
    <section
      id="activity"
      className="flex flex-col gap-4 scroll-mt-24 rounded-xl border border-border bg-surface-1 p-5"
    >
      <header className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
            {t('feed.eyebrow')}
          </span>
          <h2 className="font-display text-base font-bold leading-tight">
            {summary.last7d > 0
              ? t('feed.summary_count', { n: summary.last7d, label: pluralActions(summary.last7d, t) })
              : t('feed.empty_title')}
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <StreakChip />
          <button
            type="button"
            onClick={() => setLogOpen(true)}
            className="flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-3 py-1.5 text-[12px] font-semibold text-text-primary transition-colors duration-[var(--motion-dur-small)] ease-[var(--motion-ease-standard)] hover:border-border-strong"
          >
            <Plus className="h-3.5 w-3.5" />
            {t('feed.add')}
          </button>
        </div>
      </header>

      {/* Summary breakdown (только если есть activity) */}
      {summary.last7d > 0 && (
        <div className="flex flex-wrap gap-2">
          {(Object.entries(summary.byKind7d) as [ActivityKind, number][])
            .filter(([, count]) => count > 0)
            .sort((a, b) => b[1] - a[1])
            .map(([kind, count]) => {
              const Icon = KIND_ICON[kind]
              return (
                <span
                  key={kind}
                  className="inline-flex items-center gap-1 rounded-md border border-border bg-surface-2 px-2 py-0.5 font-mono text-[10px] text-text-secondary"
                >
                  <Icon className="h-3 w-3" />
                  {t(`feed.kind.${kind}`)} · {count}
                </span>
              )
            })}
          {summary.minutes7d > 0 && (
            <span className="inline-flex items-center rounded-md border border-border bg-surface-2 px-2 py-0.5 font-mono text-[10px] text-text-secondary">
              {t('feed.minutes_with_emoji', { n: summary.minutes7d })}
            </span>
          )}
        </div>
      )}

      {items.length === 0 ? (
        <p className="text-[13px] italic text-text-muted">{t('feed.empty_body')}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {visible.map((a) => {
            const Icon = KIND_ICON[a.kind]
            return (
              <li key={a.id} className="flex items-start gap-3 py-2.5">
                <Icon className="mt-1 h-3.5 w-3.5 shrink-0 text-text-secondary" />
                <div className="flex flex-1 flex-col gap-0.5 min-w-0">
                  <span className="truncate text-[13px] font-medium text-text-primary">
                    {a.title}
                  </span>
                  <div className="flex flex-wrap items-center gap-1.5 font-mono text-[10px] text-text-muted">
                    <span>{t(`feed.kind.${a.kind}`)}</span>
                    {a.source && (
                      <>
                        <span>·</span>
                        <span>{a.source}</span>
                      </>
                    )}
                    {a.minutes && (
                      <>
                        <span>·</span>
                        <span>{a.minutes} {t('feed.minutes_short')}</span>
                      </>
                    )}
                    <span>·</span>
                    <span>{formatAgo(a.occurredAt, t, lang)}</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => deleteActivity(a.id)}
                  aria-label={t('feed.delete_aria')}
                  title={t('feed.delete_title')}
                  className="self-center font-mono text-[10px] text-text-muted opacity-0 transition-opacity duration-[var(--motion-dur-small)] ease-[var(--motion-ease-standard)] hover:text-text-primary group-hover:opacity-100 focus:opacity-100"
                >
                  ✕
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {items.length > LIMIT_DEFAULT && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="self-start font-mono text-[11px] uppercase tracking-[0.08em] text-text-secondary underline-offset-2 transition-colors duration-[var(--motion-dur-small)] ease-[var(--motion-ease-standard)] hover:text-text-primary hover:underline"
        >
          {showAll
            ? t('feed.collapse', { n: items.length })
            : t('feed.show_all', { n: items.length })}
        </button>
      )}

      {logOpen && <QuickLogModal onClose={() => setLogOpen(false)} />}
    </section>
  )
}

type TFn = (key: string, opts?: Record<string, unknown>) => string

// Russian uses three plural forms; English collapses to one/many. The
// caller picks the form via the dedicated keys (actions_one/few/many).
function pluralActions(n: number, t: TFn): string {
  if (n === 1) return t('feed.plural.actions_one')
  if (n >= 2 && n <= 4) return t('feed.plural.actions_few')
  return t('feed.plural.actions_many')
}

function formatAgo(ms: number, t: TFn, lang: string): string {
  const diff = Date.now() - ms
  const s = Math.round(diff / 1000)
  if (s < 60) return t('feed.ago.just_now')
  const m = Math.round(s / 60)
  if (m < 60) return t('feed.ago.minutes', { n: m })
  const h = Math.round(m / 60)
  if (h < 24) return t('feed.ago.hours', { n: h, label: pluralHours(h, t) })
  const d = Math.round(h / 24)
  if (d <= 6) return t('feed.ago.days', { n: d, label: pluralDays(d, t) })
  // > 6 days — show absolute date
  const date = new Date(ms)
  const tag = lang === 'ru' ? 'ru-RU' : 'en-US'
  return date.toLocaleDateString(tag, { day: 'numeric', month: 'short' })
}

function pluralHours(h: number, t: TFn): string {
  if (h === 1) return t('feed.plural.hours_one')
  if (h >= 2 && h <= 4) return t('feed.plural.hours_few')
  return t('feed.plural.hours_many')
}

function pluralDays(d: number, t: TFn): string {
  if (d === 1) return t('feed.plural.days_one')
  if (d >= 2 && d <= 4) return t('feed.plural.days_few')
  return t('feed.plural.days_many')
}
