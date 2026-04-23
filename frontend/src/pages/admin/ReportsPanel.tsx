import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { useAdminReportsQuery } from '../../lib/queries/admin'
import { ErrorBox, PanelSkeleton } from './shared'

export function ReportsPanel() {
  const [status, setStatus] = useState('')
  const { data, isPending, error } = useAdminReportsQuery(status)
  return (
    <div className="flex flex-col gap-3 px-4 py-5 sm:px-7">
      <div className="flex items-center gap-2">
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="h-9 rounded-md border border-border bg-surface-1 px-3 text-sm text-text-primary"
        >
          <option value="">Pending</option>
          <option value="resolved">Resolved</option>
          <option value="dismissed">Dismissed</option>
          <option value="all">All</option>
        </select>
      </div>
      {isPending && <PanelSkeleton rows={3} />}
      {error && <ErrorBox message="Не удалось загрузить жалобы" />}
      {data && data.items.length === 0 && (
        <div className="rounded-lg border border-dashed border-border bg-surface-1 px-4 py-10 text-center font-mono text-[12px] text-text-muted">
          Очередь пуста
        </div>
      )}
      {data && data.items.length > 0 && (
        <div className="flex flex-col gap-3">
          {data.items.map((r) => (
            <div key={r.id} className="rounded-lg border border-border bg-surface-1 p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-warn" />
                  <span className="font-display text-sm font-bold text-text-primary">{r.reason}</span>
                </div>
                <span
                  className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold ${
                    r.status === 'pending'
                      ? 'bg-warn/15 text-warn'
                      : r.status === 'resolved'
                        ? 'bg-success/15 text-success'
                        : 'bg-surface-3 text-text-muted'
                  }`}
                >
                  {r.status.toUpperCase()}
                </span>
              </div>
              <p className="mt-2 text-xs text-text-secondary">{r.description || 'Без комментария.'}</p>
              <div className="mt-2 flex items-center justify-between font-mono text-[11px] text-text-muted">
                <span>
                  {r.reporter_name || r.reporter_id.slice(0, 8)} → {r.reported_name || r.reported_id.slice(0, 8)}
                </span>
                <span>{new Date(r.created_at).toLocaleString('ru-RU')}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
