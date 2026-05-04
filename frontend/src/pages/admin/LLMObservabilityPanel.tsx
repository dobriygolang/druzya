// LLMObservabilityPanel — Phase 12.5 per-task LLM rollups + eval-runs.
//
// Reads:
//   GET /admin/observability/llm?days=7
//   GET /admin/observability/eval-runs
//
// Read-only — нет write actions. Display: tasks table + last eval suite.
import { useEffect, useState } from 'react'

import { Card } from '../../components/Card'
import { api } from '../../lib/apiClient'
import { PanelSkeleton } from './shared'

interface TaskRollup {
  Task: string
  Calls: number
  TokensIn: number
  TokensOut: number
  AvgLatencyMs: number
  ErrorRate: number
  EstCostCents: number
  LastBucketDay: string
}

interface EvalRunSnapshot {
  Dataset: string
  Passed: number
  Total: number
  RanAt: string
  Regression: boolean
}

export function LLMObservabilityPanel() {
  const [days, setDays] = useState(7)
  const [rollups, setRollups] = useState<TaskRollup[] | null>(null)
  const [evals, setEvals] = useState<EvalRunSnapshot[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setError(null)
    Promise.all([
      api<TaskRollup[]>(`/admin/observability/llm?days=${days}`),
      api<EvalRunSnapshot[]>('/admin/observability/eval-runs'),
    ])
      .then(([r, e]) => {
        if (cancelled) return
        setRollups(r ?? [])
        setEvals(e ?? [])
      })
      .catch((e) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      cancelled = true
    }
  }, [days])

  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-xl font-semibold">LLM · per-task rollups</h2>
        <label className="flex items-center gap-2 text-[12px]">
          <span className="font-mono text-[10px] uppercase tracking-wider text-text-muted">window</span>
          <select
            value={days}
            onChange={(e) => setDays(parseInt(e.target.value, 10))}
            className="rounded border border-border bg-surface-2 px-2 py-1 text-[12px]"
          >
            <option value={1}>1d</option>
            <option value={7}>7d</option>
            <option value={30}>30d</option>
          </select>
        </label>
      </header>

      {error && <Card className="p-3" interactive={false}><span className="font-mono text-[11px] text-danger">{error}</span></Card>}

      <Card className="flex-col gap-2 p-4" interactive={false}>
        <div className="font-mono text-[10px] uppercase tracking-wider text-text-muted">tasks · {days}d</div>
        {rollups === null && <PanelSkeleton rows={4} />}
        {rollups !== null && rollups.length === 0 && (
          <div className="text-[12.5px] text-text-secondary">No LLM activity in window.</div>
        )}
        {rollups !== null && rollups.length > 0 && (
          <table className="w-full table-fixed text-[12px]">
            <thead>
              <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-text-muted">
                <th className="py-1.5">Task</th>
                <th className="py-1.5 w-[80px] text-right">Calls</th>
                <th className="py-1.5 w-[100px] text-right">Tok in</th>
                <th className="py-1.5 w-[100px] text-right">Tok out</th>
                <th className="py-1.5 w-[80px] text-right">p50 ms</th>
                <th className="py-1.5 w-[80px] text-right">err rate</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {rollups.map((r) => (
                <tr key={r.Task} className="border-t border-border-soft">
                  <td className="py-1.5 truncate">{r.Task}</td>
                  <td className="py-1.5 text-right tabular-nums">{r.Calls}</td>
                  <td className="py-1.5 text-right tabular-nums text-text-secondary">{r.TokensIn}</td>
                  <td className="py-1.5 text-right tabular-nums text-text-secondary">{r.TokensOut}</td>
                  <td className="py-1.5 text-right tabular-nums">{r.AvgLatencyMs}</td>
                  <td className={`py-1.5 text-right tabular-nums ${r.ErrorRate > 0.1 ? 'text-danger' : ''}`}>
                    {(r.ErrorRate * 100).toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card className="flex-col gap-2 p-4" interactive={false}>
        <div className="font-mono text-[10px] uppercase tracking-wider text-text-muted">eval suite · latest per dataset</div>
        {evals === null && <PanelSkeleton rows={3} />}
        {evals !== null && evals.length === 0 && (
          <div className="text-[12.5px] text-text-secondary">No eval runs recorded yet — run <span className="font-mono">make eval-ai</span>.</div>
        )}
        {evals !== null && evals.length > 0 && (
          <ul className="space-y-1">
            {evals.map((e) => {
              const pct = e.Total > 0 ? (e.Passed / e.Total) * 100 : 0
              return (
                <li key={e.Dataset} className="flex items-baseline justify-between gap-3 font-mono text-[11px]">
                  <span className="truncate">{e.Dataset}</span>
                  <span className={`tabular-nums ${pct < 100 ? 'text-warn' : ''}`}>
                    {e.Passed}/{e.Total} · {pct.toFixed(0)}%
                  </span>
                  <span className="uppercase tracking-wider text-text-muted">
                    {e.Regression ? 'regression' : 'ok'}
                  </span>
                  <span className="text-text-muted">{e.RanAt.slice(0, 16).replace('T', ' ')}</span>
                </li>
              )
            })}
          </ul>
        )}
      </Card>
    </section>
  )
}
