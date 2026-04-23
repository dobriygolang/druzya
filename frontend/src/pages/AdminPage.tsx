// AdminPage — operator console.
//
// Replaces the apigen-era hard-coded counters / task table with live data
// from the backend admin module:
//   - useAdminDashboardQuery — live counters (60s Redis cache server-side).
//   - useAdminUsersQuery     — paged user listing with active-ban metadata.
//   - useAdminReportsQuery   — moderation queue.
//
// Auth gate: useProfileQuery resolves the current viewer; users without
// role='admin' are redirected to /sanctum. The backend enforces the same
// gate, this is purely UX so non-admins don't see a blank 403 shell.
// TODO i18n
import { useMemo, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { Search, ShieldOff, ShieldCheck, AlertTriangle } from 'lucide-react'
import { Button } from '../components/Button'
import { Avatar } from '../components/Avatar'
import { useProfileQuery } from '../lib/queries/profile'
import {
  useAdminDashboardQuery,
  useAdminUsersQuery,
  useAdminReportsQuery,
  useBanUserMutation,
  useUnbanUserMutation,
  type AdminUserRow,
} from '../lib/queries/admin'

type Tab = 'dashboard' | 'users' | 'reports'

function Sidebar({ tab, setTab, pendingReports }: { tab: Tab; setTab: (t: Tab) => void; pendingReports: number }) {
  const items: Array<{ id: Tab; label: string; chip?: string; chipColor?: string }> = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'users', label: 'Users' },
    {
      id: 'reports',
      label: 'Reports',
      chip: pendingReports > 0 ? String(pendingReports) : undefined,
      chipColor: 'bg-danger/20 text-danger',
    },
  ]
  return (
    <aside className="flex w-full flex-col border-b border-border bg-surface-1 lg:w-60 lg:border-b-0 lg:border-r">
      <div className="flex items-center gap-2.5 border-b border-border px-5 py-4">
        <span className="grid h-7 w-7 place-items-center rounded-md bg-gradient-to-br from-accent to-cyan font-display text-sm font-extrabold text-text-primary">
          9
        </span>
        <span className="font-display text-sm font-bold text-text-primary">druz9 ADMIN</span>
        <span className="ml-auto rounded-full bg-surface-3 px-1.5 py-0.5 font-mono text-[9px] text-text-muted">
          v3.2
        </span>
      </div>
      <nav className="flex flex-1 flex-row gap-2 overflow-x-auto px-3 py-4 lg:flex-col lg:gap-1">
        {items.map((it) => (
          <button
            key={it.id}
            onClick={() => setTab(it.id)}
            className={`flex items-center justify-between rounded-md px-3 py-1.5 text-[13px] ${
              it.id === tab
                ? 'border-l-2 border-accent bg-accent/10 text-text-primary'
                : 'text-text-secondary hover:bg-surface-2'
            }`}
          >
            <span>{it.label}</span>
            {it.chip && (
              <span className={`rounded-full px-1.5 py-0.5 font-mono text-[9px] font-semibold ${it.chipColor ?? 'bg-surface-3 text-text-secondary'}`}>
                {it.chip}
              </span>
            )}
          </button>
        ))}
        <Link
          to="/status"
          className="mt-1 flex items-center justify-between rounded-md px-3 py-1.5 text-[13px] text-text-secondary hover:bg-surface-2"
        >
          <span>Public status</span>
          <span className="font-mono text-[9px] text-text-muted">↗</span>
        </Link>
      </nav>
      <div className="flex items-center gap-2.5 border-t border-border px-4 py-3">
        <Avatar size="sm" gradient="pink-violet" initials="A" />
        <div className="flex flex-1 flex-col">
          <span className="text-[12px] font-semibold text-text-primary">admin</span>
          <span className="font-mono text-[10px] text-text-muted">root</span>
        </div>
      </div>
    </aside>
  )
}

function StatCard({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div className="flex flex-col rounded-lg border border-border bg-surface-1 px-4 py-2">
      <span className="font-mono text-[10px] font-semibold tracking-[0.08em] text-text-muted">{label}</span>
      <span className={`font-display text-xl font-extrabold ${color ?? 'text-text-primary'}`}>{value}</span>
    </div>
  )
}

function DashboardPanel() {
  const { data, isPending, error } = useAdminDashboardQuery()
  if (isPending) {
    return <PanelSkeleton rows={4} />
  }
  if (error || !data) {
    return <ErrorBox message="Не удалось загрузить статистику" />
  }
  return (
    <div className="flex flex-col gap-5 px-4 py-5 sm:px-7">
      <section>
        <h2 className="mb-2 font-display text-sm font-bold text-text-secondary">Пользователи</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <StatCard label="Всего" value={fmt(data.users_total)} />
          <StatCard label="Активных сегодня" value={fmt(data.users_active_today)} color="text-success" />
          <StatCard label="За неделю" value={fmt(data.users_active_week)} />
          <StatCard label="За месяц" value={fmt(data.users_active_month)} />
          <StatCard label="Забанено" value={fmt(data.users_banned)} color={data.users_banned > 0 ? 'text-danger' : 'text-text-muted'} />
        </div>
      </section>
      <section>
        <h2 className="mb-2 font-display text-sm font-bold text-text-secondary">Активность</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <StatCard label="Матчей сегодня" value={fmt(data.matches_today)} />
          <StatCard label="Матчей за неделю" value={fmt(data.matches_week)} />
          <StatCard label="Kata сегодня" value={fmt(data.katas_today)} />
          <StatCard label="Kata за неделю" value={fmt(data.katas_week)} />
        </div>
      </section>
      <section>
        <h2 className="mb-2 font-display text-sm font-bold text-text-secondary">Сейчас идут</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatCard label="Mock-сессий" value={fmt(data.active_mock_sessions)} color="text-cyan" />
          <StatCard label="Активных матчей" value={fmt(data.active_arena_matches)} color="text-cyan" />
          <StatCard label="Anti-cheat сигналов 24ч" value={fmt(data.anticheat_signals_24h)} color={data.anticheat_signals_24h > 0 ? 'text-warn' : 'text-text-muted'} />
        </div>
      </section>
      <section>
        <h2 className="mb-2 font-display text-sm font-bold text-text-secondary">Очередь модерации</h2>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <StatCard
            label="Жалоб на рассмотрении"
            value={fmt(data.reports_pending)}
            color={data.reports_pending > 0 ? 'text-warn' : 'text-text-muted'}
          />
        </div>
      </section>
      <p className="mt-1 font-mono text-[10px] text-text-muted">
        Снимок от {new Date(data.generated_at).toLocaleString('ru-RU')}
      </p>
    </div>
  )
}

function UsersPanel() {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<'' | 'all' | 'banned' | 'active'>('')
  const [page, setPage] = useState(1)

  const params = useMemo(() => ({ query, status, page, limit: 25 }), [query, status, page])
  const { data, isPending, error } = useAdminUsersQuery(params)
  const banMut = useBanUserMutation()
  const unbanMut = useUnbanUserMutation()

  return (
    <div className="flex flex-col gap-3 px-4 py-5 sm:px-7">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="flex h-9 flex-1 items-center gap-2 rounded-md border border-border bg-surface-1 px-3">
          <Search className="h-3.5 w-3.5 text-text-muted" />
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setPage(1)
            }}
            placeholder="Поиск по username / email"
            className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-muted focus:outline-none"
          />
        </div>
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as typeof status)
            setPage(1)
          }}
          className="h-9 rounded-md border border-border bg-surface-1 px-3 text-sm text-text-primary"
        >
          <option value="">Все</option>
          <option value="active">Только активные</option>
          <option value="banned">Только забаненные</option>
        </select>
      </div>

      {isPending && <PanelSkeleton rows={6} />}
      {error && <ErrorBox message="Не удалось загрузить пользователей" />}

      {data && (
        <>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[760px]">
              <thead className="bg-surface-1">
                <tr className="text-left font-mono text-[10px] font-semibold tracking-[0.08em] text-text-muted">
                  <th className="px-3 py-2.5">USERNAME</th>
                  <th className="px-3 py-2.5">EMAIL</th>
                  <th className="px-3 py-2.5">ROLE</th>
                  <th className="px-3 py-2.5">STATUS</th>
                  <th className="px-3 py-2.5">CREATED</th>
                  <th className="px-3 py-2.5 text-right">ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {data.items.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center font-mono text-[12px] text-text-muted">
                      Ничего не найдено
                    </td>
                  </tr>
                )}
                {data.items.map((u) => (
                  <UserRow
                    key={u.id}
                    user={u}
                    onBan={(reason) => banMut.mutate({ user_id: u.id, reason })}
                    onUnban={() => unbanMut.mutate(u.id)}
                    busy={banMut.isPending || unbanMut.isPending}
                  />
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between">
            <span className="font-mono text-[11px] text-text-muted">
              Страница {data.page} · всего {data.total}
            </span>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                ← Назад
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={data.items.length < 25}
                onClick={() => setPage((p) => p + 1)}
              >
                Вперёд →
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function UserRow({
  user,
  onBan,
  onUnban,
  busy,
}: {
  user: AdminUserRow
  onBan: (reason: string) => void
  onUnban: () => void
  busy: boolean
}) {
  return (
    <tr className="border-t border-border bg-bg hover:bg-surface-1">
      <td className="px-3 py-3">
        <div className="flex flex-col">
          <span className="text-[13px] font-semibold text-text-primary">{user.username}</span>
          {user.display_name && (
            <span className="font-mono text-[10px] text-text-muted">{user.display_name}</span>
          )}
        </div>
      </td>
      <td className="px-3 py-3 font-mono text-[12px] text-text-secondary">{user.email || '—'}</td>
      <td className="px-3 py-3">
        <span className="rounded-full bg-cyan/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-cyan">
          {user.role}
        </span>
      </td>
      <td className="px-3 py-3">
        {user.is_banned ? (
          <span className="rounded-full bg-danger/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-danger">
            BANNED
          </span>
        ) : (
          <span className="rounded-full bg-success/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-success">
            ACTIVE
          </span>
        )}
      </td>
      <td className="px-3 py-3 font-mono text-[11px] text-text-muted">
        {new Date(user.created_at).toLocaleDateString('ru-RU')}
      </td>
      <td className="px-3 py-3 text-right">
        {user.is_banned ? (
          <Button variant="ghost" size="sm" disabled={busy} onClick={onUnban} icon={<ShieldCheck className="h-3.5 w-3.5" />}>
            Разбанить
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => {
              const reason = window.prompt('Причина бана?')
              if (reason && reason.trim()) onBan(reason.trim())
            }}
            icon={<ShieldOff className="h-3.5 w-3.5" />}
          >
            Забанить
          </Button>
        )}
      </td>
    </tr>
  )
}

function ReportsPanel() {
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

function PanelSkeleton({ rows }: { rows: number }) {
  return (
    <div className="flex flex-col gap-3 px-4 py-5 sm:px-7">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-12 animate-pulse rounded-lg bg-surface-1" />
      ))}
    </div>
  )
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="mx-4 my-5 rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger sm:mx-7">
      {message}
    </div>
  )
}

function fmt(n: number): string {
  return new Intl.NumberFormat('ru-RU').format(n)
}

export default function AdminPage() {
  const profile = useProfileQuery()
  const dashboard = useAdminDashboardQuery()
  const [tab, setTab] = useState<Tab>('dashboard')

  // Auth gate — the backend returns 403 for non-admins; we mirror the
  // outcome here so a non-admin user lands on /sanctum instead of an empty
  // shell. /profile/me must return successfully (a logged-in user); if
  // it 401s the apiClient already redirects to /welcome.
  if (profile.isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg text-text-muted">
        Загрузка…
      </div>
    )
  }
  // Surface server-side admin gate failure as a redirect. The dashboard
  // hook is the canonical "am I admin?" probe — if the role check fails,
  // the apiClient throws ApiError with status 403.
  const dashErrStatus = (dashboard.error as { status?: number } | null)?.status
  if (dashErrStatus === 403) {
    return <Navigate to="/sanctum" replace />
  }

  const pending = dashboard.data?.reports_pending ?? 0
  // profile is referenced solely to ensure the bearer is valid before we
  // try to render the admin shell — its body isn't read.
  void profile
  return (
    <div className="flex min-h-screen flex-col bg-bg text-text-primary lg:flex-row">
      <Sidebar tab={tab} setTab={setTab} pendingReports={pending} />
      <main className="flex flex-1 flex-col">
        <div className="flex h-auto flex-col gap-1 border-b border-border bg-bg px-4 py-3 sm:px-7 lg:h-14 lg:flex-row lg:items-center lg:justify-between lg:py-0">
          <div>
            <h1 className="font-display text-lg font-bold text-text-primary">
              {tab === 'dashboard' ? 'Dashboard' : tab === 'users' ? 'Users' : 'Reports'}
            </h1>
            <span className="font-mono text-[11px] text-text-muted">Операционная панель druz9</span>
          </div>
        </div>
        {tab === 'dashboard' && <DashboardPanel />}
        {tab === 'users' && <UsersPanel />}
        {tab === 'reports' && <ReportsPanel />}
      </main>
    </div>
  )
}
