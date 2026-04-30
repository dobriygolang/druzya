// TracksObservabilityPanel — Wave 3.5.1 of docs/feature/plan.md.
// Read-only view over user_persona_tracks: distribution per track-kind
// + 30-day activity. Surfaces «adoption» signal — tracks with zero
// users render anyway so the dashboard flags them as not-started.
import { ErrorBox, PanelSkeleton } from './shared'
import { Card } from '../../components/Card'
import { useTracksDistributionQuery, type TrackDistributionRow } from '../../lib/queries/observability'

const TRACK_LABELS: Record<string, string> = {
  dev: 'Разработчик',
  dev_senior: 'Senior dev',
  sysanalyst: 'Системный аналитик',
  product_analyst: 'Product analyst',
  qa: 'QA',
  english: 'English (cross-cutting)',
}

export function TracksObservabilityPanel() {
  const q = useTracksDistributionQuery()
  if (q.isPending) return <PanelSkeleton rows={4} />
  if (q.isError || !q.data) return <ErrorBox message="Не удалось загрузить распределение треков" />
  const items = q.data.items
  const grandTotal = items.reduce((acc, r) => acc + r.total, 0)
  return (
    <div className="flex flex-col gap-4 px-4 py-5 sm:px-7">
      <div className="flex items-baseline gap-3">
        <h2 className="font-display text-base font-bold text-text-primary">Распределение треков</h2>
        <span className="font-mono text-[11px] text-text-muted">
          всего пользователей с трек-записями: {grandTotal}
        </span>
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
            {items.map((r) => (
              <Row key={r.track} row={r} grandTotal={grandTotal} />
            ))}
          </tbody>
        </table>
      </div>
      <Card className="flex-col gap-2 p-4" interactive={false}>
        <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-muted">
          Read me
        </div>
        <p className="text-[12px] leading-relaxed text-text-secondary">
          Треки с total=0 — это персоны, которые мы добавили в enum, но юзеры
          их ещё не выбрали. Сравнивай <span className="font-mono">primary</span>{' '}
          (главный трек) с <span className="font-mono">total</span> — гэп
          означает, что трек используется как secondary, не как driver.
          <span className="font-mono">active_30d</span> ниже primary'я
          сигнализирует об усыхании трека.
        </p>
      </Card>
    </div>
  )
}

function Row({ row, grandTotal }: { row: TrackDistributionRow; grandTotal: number }) {
  const pct = grandTotal === 0 ? 0 : Math.round((row.total / grandTotal) * 100)
  const empty = row.total === 0
  return (
    <tr className="border-b border-border last:border-0">
      <td className="px-3 py-2">
        <div className="flex flex-col">
          <span className="font-mono text-[12px] text-text-primary">{row.track}</span>
          <span className="text-[11px] text-text-muted">{TRACK_LABELS[row.track] ?? '—'}</span>
        </div>
      </td>
      <td className={`px-3 py-2 text-right font-mono text-[13px] tabular-nums ${empty ? 'text-text-muted' : 'text-text-primary'}`}>
        {row.total}
      </td>
      <td className="px-3 py-2 text-right font-mono text-[12px] tabular-nums text-text-secondary">
        {row.primary_count}
      </td>
      <td className="px-3 py-2 text-right font-mono text-[12px] tabular-nums text-text-secondary">
        {row.active_30d}
      </td>
      <td className="px-3 py-2 text-right font-mono text-[12px] tabular-nums text-text-secondary">
        {pct}%
      </td>
    </tr>
  )
}
