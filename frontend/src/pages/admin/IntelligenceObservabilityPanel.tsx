// IntelligenceObservabilityPanel — Phase 5 admin dashboard.
//
// Visible to admins via /admin → Observability → Intelligence · coach.
// Read-only aggregated view над coach surface'ом:
//   - severity_distribution (4 buckets) — bar widths show share.
//   - follow / dismiss counts + follow_rate_pct.
//   - persona / prompt_variant / reflective_enabled — current
//     dynamic_config flags. NOT mutable from this panel — admin меняет
//     их через LLM Chain или прямой SQL update в dynamic_config.
//   - abandoned_mock_count — fleet-wide consistency-break sanity check.
//
// Window picker 7/14/30/60d — clamped backend-side to ≤90.
import { useState } from 'react'
import { ErrorBox, PanelSkeleton } from './shared'
import { Card } from '../../components/Card'
import {
  useCoachAdminStatsQuery,
  type CoachAdminStatsResp,
} from '../../lib/queries/observability'

const WINDOW_OPTIONS = [7, 14, 30, 60] as const

const SEVERITY_COLOR: Record<keyof CoachAdminStatsResp['severity_distribution'], string> = {
  critical: 'bg-danger',
  warn: 'bg-warn',
  nudge: 'bg-blue-500',
  cruise: 'bg-text-muted',
}

const SEVERITY_LABEL: Record<keyof CoachAdminStatsResp['severity_distribution'], string> = {
  critical: 'critical',
  warn: 'warn',
  nudge: 'nudge',
  cruise: 'cruise',
}

export function IntelligenceObservabilityPanel() {
  const [days, setDays] = useState<number>(30)
  const q = useCoachAdminStatsQuery(days)

  return (
    <div className="flex flex-col gap-4 px-4 py-5 sm:px-7">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between">
        <div className="flex flex-col gap-1">
          <h2 className="font-display text-base font-bold text-text-primary">
            Coach intelligence
          </h2>
          <span className="font-mono text-[11px] text-text-muted">
            Daily-brief surface: severity, ack-rate, current overlays.
          </span>
        </div>
        <div className="flex items-center gap-1 self-start">
          {WINDOW_OPTIONS.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setDays(n)}
              className={[
                'rounded-md border px-2 py-1 font-mono text-[10px] uppercase tracking-wider',
                days === n
                  ? 'border-border-strong bg-text-primary/10 text-text-primary'
                  : 'border-border bg-surface-1 text-text-muted hover:text-text-primary',
              ].join(' ')}
            >
              {n}d
            </button>
          ))}
        </div>
      </div>

      {q.isPending && <PanelSkeleton rows={4} />}
      {q.isError && !q.data && (
        <ErrorBox message="Не удалось загрузить статистику coach'а" />
      )}
      {q.data && <Body data={q.data} />}
    </div>
  )
}

function Body({ data }: { data: CoachAdminStatsResp }) {
  const totalSeverity =
    data.severity_distribution.cruise +
    data.severity_distribution.nudge +
    data.severity_distribution.warn +
    data.severity_distribution.critical
  const ackTotal = data.follow_count + data.dismiss_count
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {/* Top counters row */}
      <Card className="flex-col gap-3 p-4 lg:col-span-2" interactive={false}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <CounterCell label="briefs" value={data.total_briefs} />
          <CounterCell label="recommendations" value={data.total_recommendations} />
          <CounterCell label="abandoned mocks" value={data.abandoned_mock_count} />
          <CounterCell
            label="follow rate"
            value={data.follow_rate_pct < 0 ? '—' : `${data.follow_rate_pct}%`}
            sub={ackTotal > 0 ? `${ackTotal} ack'ов` : 'нет ack'}
          />
        </div>
      </Card>

      {/* Severity distribution */}
      <Card className="flex-col gap-3 p-4" interactive={false}>
        <div className="flex items-baseline justify-between">
          <h3 className="font-display text-sm font-bold text-text-primary">
            Severity distribution
          </h3>
          <span className="font-mono text-[10px] text-text-muted">
            {totalSeverity} briefs
          </span>
        </div>
        {totalSeverity === 0 ? (
          <p className="text-xs text-text-muted">За окно нет briefs.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {(['critical', 'warn', 'nudge', 'cruise'] as const).map((sev) => {
              const n = data.severity_distribution[sev]
              const pct = totalSeverity === 0 ? 0 : Math.round((n / totalSeverity) * 100)
              return (
                <li key={sev} className="flex flex-col gap-1">
                  <div className="flex items-baseline justify-between">
                    <span className="font-mono text-[11px] uppercase tracking-wider text-text-secondary">
                      {SEVERITY_LABEL[sev]}
                    </span>
                    <span className="font-mono text-[11px] text-text-muted">
                      {n} · {pct}%
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-bg">
                    <div
                      className={`h-full ${SEVERITY_COLOR[sev]}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      {/* Active overlays / config */}
      <Card className="flex-col gap-3 p-4" interactive={false}>
        <div className="flex items-baseline justify-between">
          <h3 className="font-display text-sm font-bold text-text-primary">
            Active overlays
          </h3>
          <span className="font-mono text-[10px] text-text-muted">dynamic_config</span>
        </div>
        <ul className="flex flex-col gap-2 text-sm">
          <ConfigRow label="persona" value={data.persona || '—'} hint="strict / warm / sparring; пусто = default tone" />
          <ConfigRow label="prompt_variant" value={data.prompt_variant || 'default'} hint="default / terse / sharp" />
          <ConfigRow
            label="reflective"
            value={data.reflective_enabled ? 'on' : 'off'}
            hint="warn/critical → second-stage critique"
          />
        </ul>
        <p className="font-mono text-[10px] text-text-muted">
          Меняй через LLM Chain панель или SQL update в dynamic_config.
        </p>
      </Card>

      {/* Read-me */}
      <Card className="flex-col gap-2 p-4 lg:col-span-2" interactive={false}>
        <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-muted">
          Read me
        </div>
        <p className="text-[12px] leading-relaxed text-text-secondary">
          Окно — последние N дней. <span className="font-mono">severity</span>{' '}
          считается по <span className="font-mono">payload-&gt;&gt;severity</span> в
          hone_daily_briefs (legacy rows без поля = cruise).{' '}
          <span className="font-mono">follow rate</span> = follow_count / (follow_count + dismiss_count) ×
          100. Высокий <span className="font-mono">cruise</span>{' '}
          share — всё спокойно. Сильный сдвиг к <span className="font-mono">critical</span>{' '}
          без сопутствующего роста ack-rate'а — сигнал что severity grader
          переоценивает stake'ы. Растущее <span className="font-mono">abandoned mocks</span>{' '}
          обычно идёт вместе с warn-spike'ом (Phase 4.7 wiring).
        </p>
      </Card>
    </div>
  )
}

function CounterCell({
  label,
  value,
  sub,
}: {
  label: string
  value: number | string
  sub?: string
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="font-mono text-[10px] uppercase tracking-wider text-text-muted">
        {label}
      </span>
      <span className="font-display text-xl font-bold text-text-primary">
        {value}
      </span>
      {sub && <span className="font-mono text-[10px] text-text-muted">{sub}</span>}
    </div>
  )
}

function ConfigRow({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <li className="flex flex-col gap-0.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-mono text-[11px] uppercase tracking-wider text-text-muted">
          {label}
        </span>
        <span className="font-mono text-[12px] tabular-nums text-text-primary">
          {value}
        </span>
      </div>
      <span className="text-[11px] text-text-muted">{hint}</span>
    </li>
  )
}
