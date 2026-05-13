// SpeakingSparkline — 14-session pronunciation trend (Phase K W8).
//
// B/W only. Simple bar-chart sparkline, no SVG library. Used by Overview
// + Speaking page.
import type { SpeakingSession } from '../../api/lingua/speaking'

interface Props {
  history: SpeakingSession[]
  /** Show numeric avg + session count caption. */
  withCaption?: boolean
}

export function SpeakingSparkline({ history, withCaption = false }: Props) {
  if (history.length === 0) {
    return (
      <div className="rounded-md border border-border bg-surface-1 px-3 py-3 text-xs text-text-muted">
        No speaking sessions yet.
      </div>
    )
  }
  const max = 100
  const recent = history.slice(0, 14).slice().reverse()
  const avg = Math.round(history.reduce((acc, s) => acc + s.pronunciationScore, 0) / history.length || 0)
  return (
    <div className="flex flex-col gap-2">
      {withCaption && (
        <div className="flex items-baseline justify-between">
          <div className="font-mono text-[9px] uppercase tracking-[0.08em] text-text-muted">
            Last {history.length} sessions
          </div>
          <div className="font-mono text-[11px] text-text-muted">
            avg pronunciation <span className="text-text-primary">{avg}/100</span>
          </div>
        </div>
      )}
      <div className="flex h-11 items-end gap-[3px] rounded-md border border-border bg-surface-1 p-2">
        {recent.map((s) => {
          const v = Math.max(0, Math.min(max, s.pronunciationScore))
          const pct = v / max
          return (
            <div
              key={s.id}
              title={`${s.pronunciationScore}/100 — ${s.coachFeedback || s.prompt}`}
              className="min-w-[4px] flex-1 rounded-[1px] bg-text-secondary/70"
              style={{ height: `${Math.max(8, pct * 100)}%` }}
            />
          )
        })}
      </div>
    </div>
  )
}
