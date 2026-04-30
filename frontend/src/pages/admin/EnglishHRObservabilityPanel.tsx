// EnglishHRObservabilityPanel — Wave 3.5.2 of docs/feature/plan.md.
// Admin-scoped aggregation over English HR mocks. Surfaces error_rate
// (sessions with NULL ai_report) — the canary for «worker silently
// failed to grade», which user-facing pages don't show because they
// just render «—».
import { ErrorBox, PanelSkeleton } from './shared'
import { Card } from '../../components/Card'
import { useEnglishHRStatsQuery, type EnglishHRRecent } from '../../lib/queries/observability'

export function EnglishHRObservabilityPanel() {
  const q = useEnglishHRStatsQuery()
  if (q.isPending) return <PanelSkeleton rows={4} />
  if (q.isError || !q.data) return <ErrorBox message="Не удалось загрузить English HR метрики" />
  const d = q.data
  return (
    <div className="flex flex-col gap-4 px-4 py-5 sm:px-7">
      <div className="flex items-baseline gap-3">
        <h2 className="font-display text-base font-bold text-text-primary">English HR · {d.window_days}d</h2>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Sessions" value={String(d.total_sessions)} />
        <Stat label="With report" value={`${d.with_report} / ${d.total_sessions}`} />
        <Stat label="Avg score" value={d.total_sessions === 0 ? '—' : `${d.avg_score}/100`} />
        <Stat label="Error rate" value={`${d.error_rate}%`} accent={d.error_rate >= 10} />
      </div>

      {d.error_rate >= 10 && (
        <Card className="flex-col gap-1 border-danger/40 bg-danger/5 p-4" interactive={false}>
          <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-danger">⚠ alert</div>
          <p className="text-[12px] leading-relaxed text-text-secondary">
            Error rate ≥ 10%: воркер report-generation падает чаще, чем приемлемо.
            Проверь <span className="font-mono">services/ai_mock/app/worker.go</span>{' '}
            + LLM-провайдер квоты (Groq/Cerebras).
          </p>
        </Card>
      )}

      <h3 className="font-display text-sm font-bold text-text-secondary">Recent (latest {d.recent.length})</h3>
      <div className="overflow-x-auto rounded-lg border border-border bg-surface-1">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-2 text-left font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
              <th className="px-3 py-2">finished</th>
              <th className="px-3 py-2">user</th>
              <th className="px-3 py-2 text-right">score</th>
              <th className="px-3 py-2">status</th>
              <th className="px-3 py-2">session</th>
            </tr>
          </thead>
          <tbody>
            {d.recent.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center font-mono text-[12px] text-text-muted">
                  За последние {d.window_days} дней английских mock-сессий нет.
                </td>
              </tr>
            )}
            {d.recent.map((r) => (
              <Row key={r.session_id} row={r} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Stat({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`rounded-lg border ${accent ? 'border-danger/40 bg-danger/5' : 'border-border bg-surface-2'} px-3 py-2.5`}>
      <div className="font-mono text-[10px] uppercase tracking-wider text-text-muted">{label}</div>
      <div className={`font-display text-lg font-bold tabular-nums ${accent ? 'text-danger' : 'text-text-primary'}`}>{value}</div>
    </div>
  )
}

function Row({ row }: { row: EnglishHRRecent }) {
  const date = row.finished_at ? new Date(row.finished_at).toLocaleString() : '—'
  return (
    <tr className="border-b border-border last:border-0">
      <td className="px-3 py-2 font-mono text-[11px] text-text-secondary">{date}</td>
      <td className="px-3 py-2 font-mono text-[11px] text-text-muted">{row.user_hash}</td>
      <td className="px-3 py-2 text-right font-mono text-[12px] tabular-nums text-text-primary">
        {row.errored ? '—' : row.score}
      </td>
      <td className="px-3 py-2">
        {row.errored ? (
          <span className="rounded-full border border-danger/40 bg-danger/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-danger">
            no report
          </span>
        ) : (
          <span className="rounded-full border border-border bg-surface-2 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-text-muted">
            graded
          </span>
        )}
      </td>
      <td className="px-3 py-2 font-mono text-[10px] text-text-muted">{row.session_id.slice(0, 8)}…</td>
    </tr>
  )
}
