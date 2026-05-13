// LLMUsagePanel.tsx — Wave 15 admin LLM cost / usage panel.
//
// Mounted inside ObservabilityDashboard as a new "Расходы нейросетей"
// section. Group-by dropdown (Task / User / Day / Provider), period
// dropdown (1d / 7d / 30d), sortable table by total_cost DESC, footer
// totals row, red accent on the most expensive row when cost > $1/day.
//
// Backend: POST /api/v1/admin/llm-usage (proto: AdminService.GetLLMUsageStats).
//
// B/W design: tabular-nums for numbers, font-mono uppercase for column
// labels, hairline borders. Single #FF3B30 stripe accent on the costliest
// row meeting the threshold.
import { useEffect, useState } from 'react'

import { Card } from '../../../components/Card'
import { ErrorBoundary } from '../../../components/ErrorBoundary'
import { api } from '../../../lib/apiClient'
import { PanelSkeleton } from '../shared'

type Period = '1d' | '7d' | '30d'
type GroupBy = 'task' | 'user' | 'day' | 'provider'

// Wire shape mirrors druz9.v1.LLMUsageRow. Backend serialises proto
// enums as their string values via the standard JSON marshaller, but
// numbers stay numbers. The DimensionKey field is a string in all
// group-by modes (user_id is rendered as UUID, day as YYYY-MM-DD).
interface LLMUsageRow {
  dimension_key: string
  total_calls: number
  total_input_tokens: number
  total_output_tokens: number
  total_cost_cents: number
  avg_latency_ms: number
}

interface LLMUsageResponse {
  rows: LLMUsageRow[] | null
  total_cost_cents: number
  total_calls: number
}

const COST_RED_THRESHOLD_CENTS_PER_DAY = 100 // $1/day

function periodToProtoEnum(p: Period): string {
  switch (p) {
    case '1d':
      return 'LLM_USAGE_PERIOD_1D'
    case '30d':
      return 'LLM_USAGE_PERIOD_30D'
  }
  return 'LLM_USAGE_PERIOD_7D'
}

function groupToProtoEnum(g: GroupBy): string {
  switch (g) {
    case 'user':
      return 'LLM_USAGE_GROUP_USER'
    case 'day':
      return 'LLM_USAGE_GROUP_DAY'
    case 'provider':
      return 'LLM_USAGE_GROUP_PROVIDER'
  }
  return 'LLM_USAGE_GROUP_TASK'
}

function fmtCents(c: number): string {
  if (c === 0) return '$0.00'
  const dollars = c / 100
  if (dollars < 0.01) return `<$0.01`
  return `$${dollars.toFixed(2)}`
}

function fmtNum(n: number): string {
  return new Intl.NumberFormat('ru-RU').format(n)
}

// Truncate a dimension key for table display — UUIDs are long; keep
// first 8 chars + ellipsis to fit in the column.
function fmtDimension(key: string, group: GroupBy): string {
  if (group === 'user' && key.length > 12) {
    return `${key.slice(0, 8)}…`
  }
  return key
}

export function LLMUsagePanel() {
  const [period, setPeriod] = useState<Period>('7d')
  const [group, setGroup] = useState<GroupBy>('task')
  const [data, setData] = useState<LLMUsageResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setData(null)
    setError(null)
    api<LLMUsageResponse>('/admin/llm-usage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        period: periodToProtoEnum(period),
        group_by: groupToProtoEnum(group),
      }),
    })
      .then((resp) => {
        if (!cancelled) setData(resp)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : 'unknown error')
      })
    return () => {
      cancelled = true
    }
  }, [period, group])

  // Identify the costliest row that crosses the red threshold. Rows
  // already arrive sorted by cost DESC server-side, so we test row[0].
  const periodDays = period === '1d' ? 1 : period === '7d' ? 7 : 30
  const dailyAvg = (cents: number) => cents / Math.max(periodDays, 1)
  const rows = data?.rows ?? []
  const topRowFlagged = rows.length > 0 && dailyAvg(rows[0].total_cost_cents) > COST_RED_THRESHOLD_CENTS_PER_DAY

  return (
    <ErrorBoundary section="LLM usage panel">
      <Card className="flex-col gap-3 p-4" interactive={false}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
            Расходы нейросетей · {period}
          </div>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 text-[12px]">
              <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
                group
              </span>
              <select
                value={group}
                onChange={(e) => setGroup(e.target.value as GroupBy)}
                className="rounded border border-border bg-surface-2 px-2 py-1 text-[12px]"
              >
                <option value="task">Task</option>
                <option value="user">User</option>
                <option value="day">Day</option>
                <option value="provider">Provider</option>
              </select>
            </label>
            <label className="flex items-center gap-2 text-[12px]">
              <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
                period
              </span>
              <select
                value={period}
                onChange={(e) => setPeriod(e.target.value as Period)}
                className="rounded border border-border bg-surface-2 px-2 py-1 text-[12px]"
              >
                <option value="1d">1d</option>
                <option value="7d">7d</option>
                <option value="30d">30d</option>
              </select>
            </label>
          </div>
        </div>

        {error && (
          <div className="font-mono text-[11px] text-danger">{error}</div>
        )}
        {data === null && !error && <PanelSkeleton rows={3} />}
        {data !== null && rows.length === 0 && (
          <div className="text-[12.5px] text-text-secondary">
            Нет данных за окно.
          </div>
        )}
        {data !== null && rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full table-fixed text-[12px]">
              <thead>
                <tr className="text-left font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
                  <th className="py-1.5">{group}</th>
                  <th className="w-[80px] py-1.5 text-right">calls</th>
                  <th className="w-[100px] py-1.5 text-right">tok in</th>
                  <th className="w-[100px] py-1.5 text-right">tok out</th>
                  <th className="w-[90px] py-1.5 text-right">cost</th>
                  <th className="w-[80px] py-1.5 text-right">avg ms</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {rows.map((r, idx) => {
                  const flagged = idx === 0 && topRowFlagged
                  return (
                    <tr
                      key={r.dimension_key}
                      className="relative border-t border-border-soft"
                    >
                      <td className="truncate py-1.5" title={r.dimension_key}>
                        {flagged && (
                          <span
                            aria-hidden
                            className="mr-1 inline-block h-[1.5px] w-2 align-middle"
                            style={{ background: '#FF3B30' }}
                          />
                        )}
                        {fmtDimension(r.dimension_key, group)}
                      </td>
                      <td className="py-1.5 text-right tabular-nums">{fmtNum(r.total_calls)}</td>
                      <td className="py-1.5 text-right tabular-nums text-text-secondary">
                        {fmtNum(r.total_input_tokens)}
                      </td>
                      <td className="py-1.5 text-right tabular-nums text-text-secondary">
                        {fmtNum(r.total_output_tokens)}
                      </td>
                      <td className="py-1.5 text-right tabular-nums">
                        {fmtCents(r.total_cost_cents)}
                      </td>
                      <td className="py-1.5 text-right tabular-nums text-text-secondary">
                        {r.avg_latency_ms}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-border font-mono text-[11px] uppercase tracking-[0.08em] text-text-muted">
                  <td className="py-1.5">total · {period}</td>
                  <td className="py-1.5 text-right tabular-nums text-text-primary">
                    {fmtNum(data.total_calls)}
                  </td>
                  <td />
                  <td />
                  <td className="py-1.5 text-right tabular-nums text-text-primary">
                    {fmtCents(data.total_cost_cents)}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>
    </ErrorBoundary>
  )
}
