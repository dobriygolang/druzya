// ObservabilityDashboard — D9 consolidated admin observability surface.
//
// Replaces 5 разрозненных panels (Tracks / English HR / Mock-block /
// Intelligence / LLM) одной прокручиваемой страницей:
//   1. Top stats grid: 6 KPI-ячеек (users, DAU, briefs, follow-rate,
//      LLM calls, mock-block strict%). Empty data → «—», не fake numbers.
//   2. Collapsible подсекции: LLM Usage / Coach Intelligence /
//      Tracks Adoption / English HR Health / Mock-Block Strictness /
//      Eval Suite.
//
// Все секции используют react-query hooks из lib/queries/observability.ts +
// lib/queries/admin.ts — no new backend RPCs. Каждая секция обёрнута в
// ErrorBoundary (render-time crash containment) + DataLoader (async state).
//
// B/W rule: font-mono uppercase tracking-wide для labels, font-display
// tabular-nums для numbers, hairline borders, no decoration colors.
// #FF3B30 — только indicator-dot/stripe (через ErrorBoundary/DataLoader).
import { useEffect, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'

import { Card } from '../../components/Card'
import { DataLoader } from '../../components/DataLoader'
import { ErrorBoundary } from '../../components/ErrorBoundary'
import { Sparkline } from '../../components/Sparkline'
import { api } from '../../lib/apiClient'
import { useAdminDashboardQuery } from '../../lib/queries/admin'
import {
  useCoachAdminStatsQuery,
  useEnglishHRStatsQuery,
  useMockBlockMetricsQuery,
  useTracksDistributionQuery,
  type CoachAdminStatsResp,
  type EnglishHRStatsResp,
  type MockBlockMetricsResp,
  type TrackDistributionResp,
} from '../../lib/queries/observability'
import { LLMUsagePanel } from './observability/LLMUsagePanel'
import { PanelSkeleton } from './shared'

const COLLAPSE_KEY = 'druz9.admin.obs_dashboard.collapsed'

type SectionId = 'llm_usage' | 'llm_cost' | 'coach' | 'tracks' | 'english_hr' | 'mock_block' | 'eval'

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

function loadCollapsed(): Set<string> {
  try {
    const raw = window.localStorage.getItem(COLLAPSE_KEY)
    if (!raw) return new Set()
    return new Set(JSON.parse(raw) as string[])
  } catch {
    return new Set()
  }
}

function saveCollapsed(s: Set<string>) {
  try {
    window.localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...s]))
  } catch {
    /* ignore */
  }
}

export function ObservabilityDashboard() {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => loadCollapsed())
  const [days, setDays] = useState<number>(7)

  // Top-level admin dashboard counters (users / mock-sessions / reports).
  const dashboard = useAdminDashboardQuery()
  const coach = useCoachAdminStatsQuery(30)
  const mockBlock = useMockBlockMetricsQuery()

  // LLM rollups + eval-runs — direct fetch, ровно как в LLMObservabilityPanel.
  const [rollups, setRollups] = useState<TaskRollup[] | null>(null)
  const [evals, setEvals] = useState<EvalRunSnapshot[] | null>(null)
  const [llmError, setLlmError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLlmError(null)
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
        setLlmError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      cancelled = true
    }
  }, [days])

  const toggle = (id: SectionId) => {
    const next = new Set(collapsed)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setCollapsed(next)
    saveCollapsed(next)
  }

  // ── Top stats — 6 KPI cells ────────────────────────────────────────
  // Anti-fallback: empty data → «—», не fake numbers.
  const dau = dashboard.data?.users_active_today
  const totalUsers = dashboard.data?.users_total
  const activeMocks = dashboard.data?.active_mock_sessions
  const reportsPending = dashboard.data?.reports_pending
  const totalLLMCalls = rollups?.reduce((acc, r) => acc + r.Calls, 0)
  const llmErrRate = rollups && rollups.length > 0
    ? (rollups.reduce((acc, r) => acc + r.ErrorRate * r.Calls, 0) /
        Math.max(1, rollups.reduce((acc, r) => acc + r.Calls, 0))) * 100
    : null
  const briefs = coach.data?.total_briefs
  const followRate = coach.data?.follow_rate_pct
  const strictPct = mockBlock.data?.strict_pct

  return (
    <div className="flex flex-col gap-5 px-4 py-5 sm:px-7">
      {/* ── Top stats grid ─────────────────────────────────────────── */}
      <section>
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
            Top KPIs
          </h2>
          <span className="font-mono text-[10px] text-text-muted">
            {dashboard.data?.generated_at
              ? `snapshot · ${new Date(dashboard.data.generated_at).toLocaleString('ru-RU')}`
              : '—'}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Kpi label="Users total" value={fmtNum(totalUsers)} />
          <Kpi label="Active today" value={fmtNum(dau)} />
          <Kpi label="Briefs 30d" value={fmtNum(briefs)} />
          <Kpi label="Follow rate" value={followRate == null || followRate < 0 ? '—' : `${followRate}%`} />
          <Kpi label="LLM calls" value={fmtNum(totalLLMCalls)} sub={`window ${days}d`} />
          <Kpi
            label="Err rate"
            value={llmErrRate == null ? '—' : `${llmErrRate.toFixed(2)}%`}
            accent={llmErrRate != null && llmErrRate >= 10}
          />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Kpi label="Active mocks" value={fmtNum(activeMocks)} />
          <Kpi label="Reports queue" value={fmtNum(reportsPending)} accent={(reportsPending ?? 0) > 0} />
          <Kpi label="Strict %" value={strictPct == null ? '—' : `${strictPct}%`} sub="mock-block" />
          <Kpi label="Window" value={`${days}d`} sub="LLM rollup" />
          <Kpi label="—" value="—" sub="p95 latency" />
          <Kpi label="—" value="—" sub="queue depth" />
        </div>
      </section>

      {/* ── LLM Usage ──────────────────────────────────────────────── */}
      <Section
        id="llm_usage"
        title="LLM · per-task rollups"
        collapsed={collapsed.has('llm_usage')}
        onToggle={toggle}
        right={
          <label className="flex items-center gap-2 text-[12px]">
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">window</span>
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
        }
      >
        <ErrorBoundary section="LLM rollups">
          {llmError && (
            <Card className="p-3" interactive={false}>
              <span className="font-mono text-[11px] text-danger">{llmError}</span>
            </Card>
          )}
          {rollups === null && !llmError && <PanelSkeleton rows={3} />}
          {rollups !== null && rollups.length === 0 && (
            <Card className="p-4" interactive={false}>
              <span className="text-[12.5px] text-text-secondary">
                Нет данных за окно.
              </span>
            </Card>
          )}
          {rollups !== null && rollups.length > 0 && (
            <Card className="flex-col gap-2 p-4" interactive={false}>
              <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
                tasks · {days}d
              </div>
              <div className="overflow-x-auto">
                <table className="w-full table-fixed text-[12px]">
                  <thead>
                    <tr className="text-left font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
                      <th className="py-1.5">Task</th>
                      <th className="w-[80px] py-1.5 text-right">Calls</th>
                      <th className="w-[100px] py-1.5 text-right">Tok in</th>
                      <th className="w-[100px] py-1.5 text-right">Tok out</th>
                      <th className="w-[80px] py-1.5 text-right">p50 ms</th>
                      <th className="w-[80px] py-1.5 text-right">err rate</th>
                    </tr>
                  </thead>
                  <tbody className="font-mono">
                    {rollups.map((r) => (
                      <tr key={r.Task} className="border-t border-border-soft">
                        <td className="truncate py-1.5">{r.Task}</td>
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
              </div>
            </Card>
          )}
        </ErrorBoundary>
      </Section>

      {/* ── Wave 15: LLM cost / usage breakdown ─────────────────────── */}
      <Section
        id="llm_cost"
        title="Расходы нейросетей"
        collapsed={collapsed.has('llm_cost')}
        onToggle={toggle}
      >
        <LLMUsagePanel />
      </Section>

      {/* ── Coach intelligence ──────────────────────────────────────── */}
      <Section
        id="coach"
        title="Coach intelligence"
        collapsed={collapsed.has('coach')}
        onToggle={toggle}
      >
        <ErrorBoundary section="Coach intelligence">
          <DataLoader<CoachAdminStatsResp>
            state={coach}
            section="Coach intelligence"
            skeleton={<PanelSkeleton rows={3} />}
          >
            {(data) => <CoachBody data={data} />}
          </DataLoader>
        </ErrorBoundary>
      </Section>

      {/* ── Tracks adoption ─────────────────────────────────────────── */}
      <Section
        id="tracks"
        title="Tracks · adoption"
        collapsed={collapsed.has('tracks')}
        onToggle={toggle}
      >
        <ErrorBoundary section="Tracks adoption">
          <TracksBody />
        </ErrorBoundary>
      </Section>

      {/* ── English HR ──────────────────────────────────────────────── */}
      <Section
        id="english_hr"
        title="English HR · health"
        collapsed={collapsed.has('english_hr')}
        onToggle={toggle}
      >
        <ErrorBoundary section="English HR">
          <EnglishHRBody />
        </ErrorBoundary>
      </Section>

      {/* ── Mock-block ──────────────────────────────────────────────── */}
      <Section
        id="mock_block"
        title="Mock-block · strictness"
        collapsed={collapsed.has('mock_block')}
        onToggle={toggle}
      >
        <ErrorBoundary section="Mock-block">
          <DataLoader<MockBlockMetricsResp>
            state={mockBlock}
            section="Mock-block"
            skeleton={<PanelSkeleton rows={2} />}
          >
            {(data) => <MockBlockBody data={data} />}
          </DataLoader>
        </ErrorBoundary>
      </Section>

      {/* ── Eval suite ──────────────────────────────────────────────── */}
      <Section
        id="eval"
        title="Eval suite · latest per dataset"
        collapsed={collapsed.has('eval')}
        onToggle={toggle}
      >
        <ErrorBoundary section="Eval suite">
          {evals === null && !llmError && <PanelSkeleton rows={3} />}
          {evals !== null && evals.length === 0 && (
            <Card className="p-4" interactive={false}>
              <span className="text-[12.5px] text-text-secondary">
                Нет eval-прогонов — запусти <span className="font-mono">make eval-ai</span>.
              </span>
            </Card>
          )}
          {evals !== null && evals.length > 0 && (
            <Card className="flex-col gap-2 p-4" interactive={false}>
              <ul className="space-y-1">
                {evals.map((e) => {
                  const pct = e.Total > 0 ? (e.Passed / e.Total) * 100 : 0
                  return (
                    <li key={e.Dataset} className="flex items-baseline justify-between gap-3 font-mono text-[11px]">
                      <span className="truncate">{e.Dataset}</span>
                      <span className={`tabular-nums ${pct < 100 ? 'text-warn' : ''}`}>
                        {e.Passed}/{e.Total} · {pct.toFixed(0)}%
                      </span>
                      <span className="uppercase tracking-[0.08em] text-text-muted">
                        {e.Regression ? 'regression' : 'ok'}
                      </span>
                      <span className="text-text-muted">{e.RanAt.slice(0, 16).replace('T', ' ')}</span>
                    </li>
                  )
                })}
              </ul>
            </Card>
          )}
        </ErrorBoundary>
      </Section>
    </div>
  )
}

// ── Helpers ────────────────────────────────────────────────────────────

function fmtNum(v: number | undefined | null): string {
  if (v == null) return '—'
  return new Intl.NumberFormat('ru-RU').format(v)
}

function Kpi({
  label,
  value,
  sub,
  accent = false,
}: {
  label: string
  value: string
  sub?: string
  accent?: boolean
}) {
  return (
    <div
      className={`relative flex flex-col gap-1 rounded-lg border bg-surface-1 px-3 py-2.5 ${
        accent ? 'border-border-strong' : 'border-border'
      }`}
    >
      {accent && (
        <span
          aria-hidden
          className="absolute left-0 top-0 h-full w-[1.5px] rounded-l-lg"
          style={{ background: '#FF3B30' }}
        />
      )}
      <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
        {label}
      </span>
      <span className="font-display text-xl font-bold tabular-nums text-text-primary">
        {value}
      </span>
      {sub && <span className="font-mono text-[10px] text-text-muted">{sub}</span>}
    </div>
  )
}

function Section({
  id,
  title,
  right,
  collapsed,
  onToggle,
  children,
}: {
  id: SectionId
  title: string
  right?: ReactNode
  collapsed: boolean
  onToggle: (id: SectionId) => void
  children: ReactNode
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-1.5">
        <button
          type="button"
          onClick={() => onToggle(id)}
          aria-expanded={!collapsed}
          className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted hover:text-text-primary"
        >
          {collapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          <span>{title}</span>
        </button>
        {!collapsed && right}
      </div>
      {!collapsed && children}
    </section>
  )
}

// ── Coach body ─────────────────────────────────────────────────────────

function CoachBody({ data }: { data: CoachAdminStatsResp }) {
  const total =
    data.severity_distribution.cruise +
    data.severity_distribution.nudge +
    data.severity_distribution.warn +
    data.severity_distribution.critical
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      <Card className="flex-col gap-3 p-4" interactive={false}>
        <div className="flex items-baseline justify-between">
          <h3 className="font-display text-sm font-bold text-text-primary">Severity distribution</h3>
          <span className="font-mono text-[10px] text-text-muted">{total} briefs · 30d</span>
        </div>
        {total === 0 ? (
          <p className="text-xs text-text-muted">За окно нет briefs.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {(['critical', 'warn', 'nudge', 'cruise'] as const).map((sev) => {
              const n = data.severity_distribution[sev]
              const pct = total === 0 ? 0 : Math.round((n / total) * 100)
              return (
                <li key={sev} className="flex flex-col gap-1">
                  <div className="flex items-baseline justify-between">
                    <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-secondary">
                      {sev}
                    </span>
                    <span className="font-mono text-[11px] text-text-muted">
                      {n} · {pct}%
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-bg">
                    <div
                      className={sev === 'critical' ? 'h-full bg-danger' : 'h-full bg-text-primary'}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Card>
      <Card className="flex-col gap-3 p-4" interactive={false}>
        <div className="flex items-baseline justify-between">
          <h3 className="font-display text-sm font-bold text-text-primary">Active overlays</h3>
          <span className="font-mono text-[10px] text-text-muted">dynamic_config</span>
        </div>
        <ul className="flex flex-col gap-2 text-sm">
          <ConfigRow label="persona" value={data.persona || '—'} hint="strict / warm / sparring" />
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
      <Card className="flex-col gap-2 p-4 lg:col-span-2" interactive={false}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MiniStat label="briefs" value={data.total_briefs} />
          <MiniStat label="recommendations" value={data.total_recommendations} />
          <MiniStat label="abandoned mocks" value={data.abandoned_mock_count} />
          <MiniStat
            label="follow rate"
            value={data.follow_rate_pct < 0 ? '—' : `${data.follow_rate_pct}%`}
          />
        </div>
      </Card>
    </div>
  )
}

function ConfigRow({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <li className="flex flex-col gap-0.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-muted">{label}</span>
        <span className="font-mono text-[12px] tabular-nums text-text-primary">{value}</span>
      </div>
      <span className="text-[11px] text-text-muted">{hint}</span>
    </li>
  )
}

function MiniStat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">{label}</span>
      <span className="font-display text-xl font-bold tabular-nums text-text-primary">{value}</span>
    </div>
  )
}

// ── Tracks body ────────────────────────────────────────────────────────

const TRACK_LABELS: Record<string, string> = {
  dev: 'Разработчик',
  dev_senior: 'Senior dev',
  sysanalyst: 'Системный аналитик',
  product_analyst: 'Product analyst',
  qa: 'QA',
  english: 'English (cross-cutting)',
}

function TracksBody() {
  const q = useTracksDistributionQuery()
  return (
    <DataLoader<TrackDistributionResp>
      state={q}
      section="Tracks adoption"
      skeleton={<PanelSkeleton rows={3} />}
    >
      {(data) => {
        const grand = data.items.reduce((acc, r) => acc + r.total, 0)
        const sparkValues = data.items.map((r) => r.total)
        return (
          <div className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between">
              <span className="font-mono text-[11px] text-text-muted">
                всего: {grand}
              </span>
              {sparkValues.length > 0 && (
                <Sparkline values={sparkValues} height={20} width={120} />
              )}
            </div>
            <div className="overflow-x-auto rounded-lg border border-border bg-surface-1">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface-2 text-left font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
                    <th className="px-3 py-2">track</th>
                    <th className="px-3 py-2 text-right">total</th>
                    <th className="px-3 py-2 text-right">primary</th>
                    <th className="px-3 py-2 text-right">active 30d</th>
                    <th className="px-3 py-2 text-right">% от total</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((r) => {
                    const pct = grand === 0 ? 0 : Math.round((r.total / grand) * 100)
                    const empty = r.total === 0
                    return (
                      <tr key={r.track} className="border-b border-border last:border-0">
                        <td className="px-3 py-2">
                          <div className="flex flex-col">
                            <span className="font-mono text-[12px] text-text-primary">{r.track}</span>
                            <span className="text-[11px] text-text-muted">
                              {TRACK_LABELS[r.track] ?? '—'}
                            </span>
                          </div>
                        </td>
                        <td
                          className={`px-3 py-2 text-right font-mono text-[13px] tabular-nums ${
                            empty ? 'text-text-muted' : 'text-text-primary'
                          }`}
                        >
                          {r.total}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-[12px] tabular-nums text-text-secondary">
                          {r.primary_count}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-[12px] tabular-nums text-text-secondary">
                          {r.active_30d}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-[12px] tabular-nums text-text-secondary">
                          {pct}%
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )
      }}
    </DataLoader>
  )
}

// ── English HR body ────────────────────────────────────────────────────

function EnglishHRBody() {
  const q = useEnglishHRStatsQuery()
  return (
    <DataLoader<EnglishHRStatsResp>
      state={q}
      section="English HR"
      skeleton={<PanelSkeleton rows={3} />}
    >
      {(d) => (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MiniStat label="sessions" value={d.total_sessions} />
            <MiniStat label="with report" value={`${d.with_report} / ${d.total_sessions}`} />
            <MiniStat label="avg score" value={d.total_sessions === 0 ? '—' : `${d.avg_score}/100`} />
            <MiniStat label="err rate" value={`${d.error_rate}%`} />
          </div>
          {d.error_rate >= 10 && (
            <Card className="relative flex-col gap-1 p-4" interactive={false}>
              <span
                aria-hidden
                className="absolute left-0 top-0 h-full w-[1.5px] rounded-l-xl"
                style={{ background: '#FF3B30' }}
              />
              <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-primary">
                alert · error rate ≥ 10%
              </div>
              <p className="text-[12px] leading-relaxed text-text-secondary">
                Воркер report-generation падает чаще, чем приемлемо. Проверь{' '}
                <span className="font-mono">services/ai_mock/app/worker.go</span> + LLM-провайдер квоты.
              </p>
            </Card>
          )}
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
                      За {d.window_days}d английских mock-сессий нет.
                    </td>
                  </tr>
                )}
                {d.recent.map((r) => (
                  <tr key={r.session_id} className="border-b border-border last:border-0">
                    <td className="px-3 py-2 font-mono text-[11px] text-text-secondary">
                      {r.finished_at ? new Date(r.finished_at).toLocaleString() : '—'}
                    </td>
                    <td className="px-3 py-2 font-mono text-[11px] text-text-muted">{r.user_hash}</td>
                    <td className="px-3 py-2 text-right font-mono text-[12px] tabular-nums text-text-primary">
                      {r.errored ? '—' : r.score}
                    </td>
                    <td className="px-3 py-2">
                      <span className="rounded-full border border-border bg-surface-2 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
                        {r.errored ? 'no report' : 'graded'}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono text-[10px] text-text-muted">
                      {r.session_id.slice(0, 8)}…
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </DataLoader>
  )
}

// ── Mock-block body ────────────────────────────────────────────────────

function MockBlockBody({ data }: { data: MockBlockMetricsResp }) {
  const healthy = data.strict_pct >= 50
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MiniStat label="total" value={data.total_sessions} />
        <MiniStat label="strict" value={data.strict_sessions} />
        <MiniStat label="ai-assist" value={data.ai_assist_sessions} />
        <MiniStat label="strict %" value={`${data.strict_pct}%`} />
      </div>
      <Card className="flex-col gap-1 p-4" interactive={false}>
        <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
          Read me
        </div>
        <p className="text-[12px] leading-relaxed text-text-secondary">
          <span className="font-mono">strict</span> = opt-in честный режим (Cue заблокирован
          через CheckBlock). Ниже 50% по группе = продукт не доверяет watermark'у.
          Engineering-секции только · окно {data.window_days}d.
        </p>
      </Card>
      {!healthy && data.total_sessions > 0 && (
        <Card className="relative flex-col gap-1 p-4" interactive={false}>
          <span
            aria-hidden
            className="absolute left-0 top-0 h-full w-[1.5px] rounded-l-xl"
            style={{ background: '#FF3B30' }}
          />
          <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-primary">
            low strict-share
          </div>
          <p className="text-[12px] leading-relaxed text-text-secondary">
            Меньше половины engineering-сессий в strict-режиме. Проверь default
            toggle и onboarding.
          </p>
        </Card>
      )}
    </div>
  )
}
