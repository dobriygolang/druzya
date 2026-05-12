// RoomsPanel — Phase 12.5 standalone collab rooms moderation.
//
// Reads /admin/rooms (chi-direct REST). Filters: kind / status / user_id.
// Actions: bulk-archive expired rooms (POST /admin/rooms/bulk-archive).
import { useEffect, useMemo, useState } from 'react'

import { Card } from '../../components/Card'
import { api } from '../../lib/apiClient'
import { PanelSkeleton } from './shared'

interface AdminRoomRow {
  ID: string
  OwnerID: string
  OwnerLogin: string
  Kind: string // code | whiteboard
  Title: string
  FreeTier: boolean
  ExpiresAt: string
  ArchivedAt: string | null
  CreatedAt: string
  Status: string // active | expired | archived
}

interface TopCreator {
  UserID: string
  ActiveCount: number
  Tier: string
}

export function RoomsPanel() {
  const [kind, setKind] = useState<string>('')
  const [status, setStatus] = useState<string>('active')
  const [userId, setUserId] = useState<string>('')
  const [rooms, setRooms] = useState<AdminRoomRow[] | null>(null)
  const [topCreators, setTopCreators] = useState<TopCreator[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const queryString = useMemo(() => {
    const p = new URLSearchParams()
    if (kind) p.set('kind', kind)
    if (status) p.set('status', status)
    if (userId.trim()) p.set('user_id', userId.trim())
    p.set('limit', '50')
    return p.toString()
  }, [kind, status, userId])

  async function refresh() {
    setError(null)
    try {
      const [list, creators] = await Promise.all([
        api<AdminRoomRow[]>(`/admin/rooms?${queryString}`),
        api<TopCreator[]>('/admin/rooms/top-creators?limit=10'),
      ])
      setRooms(list ?? [])
      setTopCreators(creators ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function bulkArchive() {
    setBusy(true)
    setError(null)
    try {
      const res = await api<{ archived: number }>('/admin/rooms/bulk-archive', { method: 'POST', body: '{}' })
      void res
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryString])

  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-xl font-semibold">Rooms · moderation</h2>
        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
          path c · low-key collab rooms
        </span>
      </header>

      <Card className="flex-col gap-3 p-4" interactive={false}>
        <div className="flex flex-wrap items-end gap-3">
          <FilterSelect label="Kind" value={kind} onChange={setKind} options={[
            { v: '', l: 'all' },
            { v: 'code', l: 'code' },
            { v: 'whiteboard', l: 'whiteboard' },
          ]} />
          <FilterSelect label="Status" value={status} onChange={setStatus} options={[
            { v: 'active', l: 'active' },
            { v: 'expired', l: 'expired' },
            { v: 'archived', l: 'archived' },
            { v: '', l: 'all' },
          ]} />
          <label className="flex flex-col gap-1 text-[12px]">
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">User ID</span>
            <input
              type="text"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              placeholder="uuid (optional)"
              className="border-0 border-b border-[var(--hair-2)] bg-transparent rounded-none px-0 py-2 text-[12px] min-w-[280px] flex-1 focus:border-[rgb(var(--ink))] focus:border-b-[1.5px] focus:outline-none transition-[border-color] duration-[var(--motion-dur-small)] ease-[var(--motion-ease-decelerate)]"
            />
          </label>
          <button
            type="button"
            onClick={() => void bulkArchive()}
            disabled={busy}
            className="ml-auto rounded border border-border bg-surface-2 px-3 py-1.5 text-[11px] uppercase tracking-[0.08em] hover:border-border-strong"
          >
            {busy ? 'archiving…' : 'bulk-archive expired'}
          </button>
        </div>
        {error && (
          <div className="font-mono text-[11px] text-danger">{error}</div>
        )}
      </Card>

      {topCreators && topCreators.length > 0 && (
        <Card className="flex-col gap-2 p-4" interactive={false}>
          <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">Top creators · free-tier breach detection</div>
          <ul className="space-y-1">
            {topCreators.map((c) => (
              <li key={c.UserID} className="flex items-baseline justify-between gap-3 font-mono text-[11px]">
                <span className="truncate text-text-secondary">{c.UserID}</span>
                <span className="text-text-primary">{c.ActiveCount} active</span>
                <span className="uppercase tracking-[0.08em] text-text-muted">{c.Tier}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="flex-col gap-2 p-4" interactive={false}>
        {rooms === null && <PanelSkeleton rows={6} />}
        {rooms !== null && rooms.length === 0 && (
          <div className="text-[12.5px] text-text-secondary">No rooms match.</div>
        )}
        {rooms !== null && rooms.length > 0 && (
          <table className="w-full table-fixed text-[12px]">
            <thead>
              <tr className="text-left font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
                <th className="py-1.5 w-[80px]">Kind</th>
                <th className="py-1.5 w-[90px]">Status</th>
                <th className="py-1.5 w-[60px]">Tier</th>
                <th className="py-1.5">Title</th>
                <th className="py-1.5 w-[160px]">Owner</th>
                <th className="py-1.5 w-[140px]">Expires</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {rooms.map((r) => (
                <tr key={r.ID} className="border-t border-border-soft">
                  <td className="py-1.5 uppercase tracking-[0.08em] text-text-muted">{r.Kind}</td>
                  <td className="py-1.5">{r.Status}</td>
                  <td className="py-1.5">{r.FreeTier ? 'free' : 'pro'}</td>
                  <td className="py-1.5 truncate">{r.Title || '(untitled)'}</td>
                  <td className="py-1.5 truncate text-text-secondary">{r.OwnerID.slice(0, 8)}…</td>
                  <td className="py-1.5 text-text-muted">{r.ExpiresAt.slice(0, 16).replace('T', ' ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </section>
  )
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: { v: string; l: string }[]
}) {
  return (
    <label className="flex flex-col gap-1 text-[12px]">
      <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded border border-border bg-surface-2 px-2 py-1 text-[12px]"
      >
        {options.map((o) => (
          <option key={o.v} value={o.v}>{o.l}</option>
        ))}
      </select>
    </label>
  )
}
