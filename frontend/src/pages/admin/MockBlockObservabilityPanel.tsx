// MockBlockObservabilityPanel — Wave 3.5.3 of docs/feature/plan.md.
// Strict vs ai_assist split for engineering mocks. The strict_pct is
// the headline KPI: a healthy product with mock-block protocol working
// runs 50%+ strict. A sudden drop signals either Cue mis-routed or a
// UI bug forcing ai_assist=true by default.
//
// «CheckBlock fired N times» counter is intentionally absent — it
// requires Redis instrumentation in services/copilot which is a
// separate sprint. Documented in plan.md.
import { ErrorBox, PanelSkeleton } from './shared'
import { Card } from '../../components/Card'
import { useMockBlockMetricsQuery } from '../../lib/queries/observability'

export function MockBlockObservabilityPanel() {
  const q = useMockBlockMetricsQuery()
  if (q.isPending) return <PanelSkeleton rows={4} />
  if (q.isError || !q.data) return <ErrorBox message="Не удалось загрузить mock-block метрики" />
  const d = q.data
  // Healthy threshold: 50%+ strict means Cue is being kept honest.
  const healthy = d.strict_pct >= 50
  return (
    <div className="flex flex-col gap-4 px-4 py-5 sm:px-7">
      <div className="flex items-baseline gap-3">
        <h2 className="font-display text-base font-bold text-text-primary">Mock-block · {d.window_days}d</h2>
        <span className="font-mono text-[11px] text-text-muted">
          engineering sections only
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Total sessions" value={String(d.total_sessions)} />
        <Stat label="Strict" value={`${d.strict_sessions}`} sub={`${d.strict_pct}%`} accent={!healthy && d.total_sessions > 0} />
        <Stat label="AI-assist" value={`${d.ai_assist_sessions}`} sub={`${100 - d.strict_pct}%`} />
        <Stat label="Strict %" value={`${d.strict_pct}%`} accent={!healthy && d.total_sessions > 0} />
      </div>

      <Card className="flex-col gap-2 p-4" interactive={false}>
        <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-muted">
          Read me
        </div>
        <p className="text-[12px] leading-relaxed text-text-secondary">
          <span className="font-mono">strict</span> = пользователь явно
          opt-in'нул в честный режим (Cue блокируется через CheckBlock).
          Ниже 50% по группе = продукт не доверяет watermark'у, юзеры
          предпочитают AI-режим. Это тревога если мы продаём
          mock-результаты как «calibrated assessment».
        </p>
        <p className="text-[12px] leading-relaxed text-text-secondary">
          Counter «CheckBlock fired N times» (был ли Cue реально
          заблокирован сервером) — TODO: требует Redis-инструментации в{' '}
          <span className="font-mono">services/copilot/app/check_block.go</span>.
        </p>
      </Card>

      {!healthy && d.total_sessions > 0 && (
        <Card className="flex-col gap-1 border-warn/40 bg-warn/5 p-4" interactive={false}>
          <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-warn">⚠ low strict-share</div>
          <p className="text-[12px] leading-relaxed text-text-secondary">
            Меньше половины engineering-сессий идут в strict-режиме.
            Проверь UI: возможно, default toggle включён в AI-assist;
            или onboarding не объясняет что watermark = ценность результата.
          </p>
        </Card>
      )}
    </div>
  )
}

function Stat({ label, value, sub, accent = false }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className={`rounded-lg border ${accent ? 'border-warn/40 bg-warn/5' : 'border-border bg-surface-2'} px-3 py-2.5`}>
      <div className="font-mono text-[10px] uppercase tracking-wider text-text-muted">{label}</div>
      <div className={`font-display text-lg font-bold tabular-nums ${accent ? 'text-warn' : 'text-text-primary'}`}>
        {value}
      </div>
      {sub && (
        <div className="font-mono text-[10px] text-text-muted">{sub}</div>
      )}
    </div>
  )
}
