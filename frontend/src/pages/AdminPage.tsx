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
import { useMemo, useState, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { Search, ShieldOff, ShieldCheck, AlertTriangle, Headphones, Trash2, Upload } from 'lucide-react'
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
import {
  usePodcastsQuery,
  usePodcastCategoriesQuery,
  useCreatePodcastMutation,
  useCreateCategoryMutation,
  useDeletePodcastMutation,
  formatDuration,
  type PodcastCategory,
} from '../lib/queries/podcasts'
import {
  useAtlasAdminNodesQuery,
  useAtlasAdminEdgesQuery,
  useCreateAtlasNodeMutation,
  useUpdateAtlasNodeMutation,
  useDeleteAtlasNodeMutation,
  useUpdateAtlasPositionMutation,
  useCreateAtlasEdgeMutation,
  useDeleteAtlasEdgeMutation,
  type AtlasAdminNode,
  type AtlasAdminEdge,
  type UpsertNodePayload,
} from '../lib/queries/atlasAdmin'
import {
  useAIAdminModelsQuery,
  useCreateLLMModelMutation,
  useUpdateLLMModelMutation,
  useToggleLLMModelMutation,
  useDeleteLLMModelMutation,
  type AdminLLMModel,
  type AdminLLMModelUpsertBody,
} from '../lib/queries/ai'

type Tab = 'dashboard' | 'users' | 'reports' | 'podcasts' | 'ai_models' | 'atlas'

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
    { id: 'podcasts', label: 'Подкасты' },
    { id: 'atlas', label: 'Atlas CMS' },
    { id: 'ai_models', label: 'AI Modельки' },
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
              {tab === 'dashboard'
                ? 'Dashboard'
                : tab === 'users'
                  ? 'Users'
                  : tab === 'reports'
                    ? 'Reports'
                    : tab === 'podcasts'
                      ? 'Подкасты'
                      : tab === 'atlas'
                        ? 'Atlas CMS'
                        : 'AI Modельки'}
            </h1>
            <span className="font-mono text-[11px] text-text-muted">Операционная панель druz9</span>
          </div>
        </div>
        {tab === 'dashboard' && <DashboardPanel />}
        {tab === 'users' && <UsersPanel />}
        {tab === 'reports' && <ReportsPanel />}
        {tab === 'podcasts' && <PodcastsPanel />}
        {tab === 'atlas' && <AtlasPanel />}
        {tab === 'ai_models' && <AIModelsPanel />}
      </main>
    </div>
  )
}

// ─── Podcasts CMS panel ─────────────────────────────────────────────────

function PodcastsPanel() {
  const podcasts = usePodcastsQuery()
  const categories = usePodcastCategoriesQuery()
  const createMut = useCreatePodcastMutation()
  const deleteMut = useDeletePodcastMutation()
  const createCatMut = useCreateCategoryMutation()

  const [showCatModal, setShowCatModal] = useState(false)
  const [progress, setProgress] = useState<number | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  // Controlled form state.
  const [title, setTitle] = useState('')
  const [host, setHost] = useState('')
  const [description, setDescription] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [episodeNum, setEpisodeNum] = useState('')
  const [durationSec, setDurationSec] = useState('')
  const [coverUrl, setCoverUrl] = useState('')
  const [isPublished, setIsPublished] = useState(true)
  const [audio, setAudio] = useState<File | null>(null)

  function resetForm() {
    setTitle('')
    setHost('')
    setDescription('')
    setCategoryId('')
    setEpisodeNum('')
    setDurationSec('')
    setCoverUrl('')
    setIsPublished(true)
    setAudio(null)
    setProgress(null)
    setFormError(null)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setFormError(null)
    if (!title.trim()) {
      setFormError('Название обязательно.')
      return
    }
    if (!audio) {
      setFormError('Выберите аудиофайл (mp3, m4a, opus…).')
      return
    }
    setProgress(0)
    try {
      await createMut.mutateAsync({
        title: title.trim(),
        host: host.trim() || undefined,
        description: description.trim() || undefined,
        categoryId: categoryId || undefined,
        episodeNum: episodeNum ? Number(episodeNum) : undefined,
        durationSec: durationSec ? Number(durationSec) : undefined,
        coverUrl: coverUrl.trim() || undefined,
        isPublished,
        audio,
        onProgress: (f) => setProgress(f),
      })
      resetForm()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Не удалось загрузить подкаст.'
      setFormError(msg)
      setProgress(null)
    }
  }

  return (
    <div className="flex flex-col gap-5 px-4 py-5 sm:px-7">
      <section className="rounded-lg border border-border bg-surface-1 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-sm font-bold text-text-primary">Загрузить подкаст</h2>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setShowCatModal(true)}
            icon={<Headphones className="h-3.5 w-3.5" />}
          >
            Категории
          </Button>
        </div>
        <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">Название *</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              className="h-9 rounded-md border border-border bg-surface-2 px-3 text-sm text-text-primary"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">Ведущий</span>
            <input
              value={host}
              onChange={(e) => setHost(e.target.value)}
              className="h-9 rounded-md border border-border bg-surface-2 px-3 text-sm text-text-primary"
            />
          </label>
          <label className="flex flex-col gap-1 md:col-span-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">Описание</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-text-primary"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">Категория</span>
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="h-9 rounded-md border border-border bg-surface-2 px-3 text-sm text-text-primary"
            >
              <option value="">Не выбрана</option>
              {(categories.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">Эпизод #</span>
            <input
              value={episodeNum}
              onChange={(e) => setEpisodeNum(e.target.value)}
              type="number"
              min="1"
              className="h-9 rounded-md border border-border bg-surface-2 px-3 text-sm text-text-primary"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">Длительность (сек)</span>
            <input
              value={durationSec}
              onChange={(e) => setDurationSec(e.target.value)}
              type="number"
              min="0"
              className="h-9 rounded-md border border-border bg-surface-2 px-3 text-sm text-text-primary"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">URL обложки</span>
            <input
              value={coverUrl}
              onChange={(e) => setCoverUrl(e.target.value)}
              type="url"
              className="h-9 rounded-md border border-border bg-surface-2 px-3 text-sm text-text-primary"
            />
          </label>
          <label className="flex items-center gap-2 self-end">
            <input
              type="checkbox"
              checked={isPublished}
              onChange={(e) => setIsPublished(e.target.checked)}
              className="h-4 w-4"
            />
            <span className="text-sm text-text-secondary">Опубликовать сразу</span>
          </label>
          <label className="flex flex-col gap-1 md:col-span-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">Аудиофайл *</span>
            <input
              type="file"
              accept="audio/*"
              onChange={(e) => setAudio(e.target.files?.[0] ?? null)}
              required
              className="text-sm text-text-secondary"
            />
            {audio && (
              <span className="font-mono text-[10px] text-text-muted">
                {audio.name} · {(audio.size / 1024 / 1024).toFixed(1)} MB
              </span>
            )}
          </label>
          {progress !== null && (
            <div className="md:col-span-2">
              <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
                <div
                  className="h-full bg-accent transition-[width] duration-100"
                  style={{ width: `${Math.round(progress * 100)}%` }}
                />
              </div>
              <span className="font-mono text-[10px] text-text-muted">
                Загрузка: {Math.round(progress * 100)}%
              </span>
            </div>
          )}
          {formError && (
            <p className="md:col-span-2 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
              {formError}
            </p>
          )}
          <div className="md:col-span-2 flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={resetForm}
              disabled={createMut.isPending}
            >
              Очистить
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={createMut.isPending}
              icon={<Upload className="h-3.5 w-3.5" />}
            >
              {createMut.isPending ? 'Загружаем…' : 'Загрузить'}
            </Button>
          </div>
        </form>
      </section>

      <section>
        <h2 className="mb-2 font-display text-sm font-bold text-text-secondary">
          Опубликованные эпизоды ({podcasts.data?.length ?? 0})
        </h2>
        {podcasts.isPending && <PanelSkeleton rows={3} />}
        {podcasts.error && <ErrorBox message="Не удалось загрузить список подкастов" />}
        {podcasts.data && podcasts.data.length === 0 && (
          <div className="rounded-lg border border-dashed border-border bg-surface-1 px-4 py-10 text-center font-mono text-[12px] text-text-muted">
            Пока ни одного эпизода. Используйте форму выше.
          </div>
        )}
        {podcasts.data && podcasts.data.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[760px]">
              <thead className="bg-surface-1">
                <tr className="text-left font-mono text-[10px] font-semibold tracking-[0.08em] text-text-muted">
                  <th className="px-3 py-2.5">НАЗВАНИЕ</th>
                  <th className="px-3 py-2.5">КАТЕГОРИЯ</th>
                  <th className="px-3 py-2.5">ВЕДУЩИЙ</th>
                  <th className="px-3 py-2.5">ДЛИТ.</th>
                  <th className="px-3 py-2.5">СТАТУС</th>
                  <th className="px-3 py-2.5 text-right">ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {podcasts.data.map((p) => (
                  <tr key={p.id} className="border-t border-border bg-bg hover:bg-surface-1">
                    <td className="px-3 py-3">
                      <div className="flex flex-col">
                        <span className="text-[13px] font-semibold text-text-primary">{p.title}</span>
                        {p.episode_num !== undefined && (
                          <span className="font-mono text-[10px] text-text-muted">Эпизод #{p.episode_num}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-3 font-mono text-[12px] text-text-secondary">
                      {p.category?.name ?? '—'}
                    </td>
                    <td className="px-3 py-3 font-mono text-[12px] text-text-secondary">{p.host ?? '—'}</td>
                    <td className="px-3 py-3 font-mono text-[12px] text-text-secondary">
                      {formatDuration(p.duration_sec)}
                    </td>
                    <td className="px-3 py-3">
                      {p.is_published ? (
                        <span className="rounded-full bg-success/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-success">
                          PUBLISHED
                        </span>
                      ) : (
                        <span className="rounded-full bg-warn/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-warn">
                          DRAFT
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={deleteMut.isPending}
                        onClick={() => {
                          if (window.confirm(`Удалить «${p.title}»? Файл из MinIO тоже удалится.`)) {
                            deleteMut.mutate(p.id)
                          }
                        }}
                        icon={<Trash2 className="h-3.5 w-3.5" />}
                      >
                        Удалить
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {showCatModal && (
        <CategoryModal
          categories={categories.data ?? []}
          onClose={() => setShowCatModal(false)}
          onCreate={async (input) => {
            await createCatMut.mutateAsync(input)
          }}
          busy={createCatMut.isPending}
        />
      )}
    </div>
  )
}

function CategoryModal({
  categories,
  onClose,
  onCreate,
  busy,
}: {
  categories: PodcastCategory[]
  onClose: () => void
  onCreate: (input: { slug: string; name: string; color?: string; sort_order?: number }) => Promise<void>
  busy: boolean
}) {
  const [slug, setSlug] = useState('')
  const [name, setName] = useState('')
  const [color, setColor] = useState('#6c7af0')
  const [sortOrder, setSortOrder] = useState('100')
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!slug.trim() || !name.trim()) {
      setError('slug и name обязательны.')
      return
    }
    try {
      await onCreate({
        slug: slug.trim(),
        name: name.trim(),
        color: color || undefined,
        sort_order: sortOrder ? Number(sortOrder) : undefined,
      })
      setSlug('')
      setName('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось создать категорию.')
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="w-full max-w-md rounded-lg border border-border bg-surface-1 p-5">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-display text-sm font-bold text-text-primary">Категории подкастов</h3>
          <button
            type="button"
            onClick={onClose}
            className="font-mono text-xs text-text-muted hover:text-text-primary"
          >
            ✕
          </button>
        </div>
        <ul className="mb-4 max-h-[200px] overflow-y-auto rounded-md border border-border bg-surface-2 p-2">
          {categories.length === 0 && (
            <li className="px-2 py-1 font-mono text-[11px] text-text-muted">Категорий пока нет.</li>
          )}
          {categories.map((c) => (
            <li key={c.id} className="flex items-center gap-2 px-2 py-1.5 text-sm">
              <span
                className="h-3 w-3 rounded-full"
                style={{ backgroundColor: c.color }}
                aria-hidden
              />
              <span className="text-text-primary">{c.name}</span>
              <span className="ml-auto font-mono text-[10px] text-text-muted">{c.slug}</span>
            </li>
          ))}
        </ul>
        <form onSubmit={handleSubmit} className="flex flex-col gap-2">
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">Slug *</span>
            <input
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="frontend-prod"
              className="h-9 rounded-md border border-border bg-surface-2 px-3 text-sm text-text-primary"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">Название *</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Frontend в проде"
              className="h-9 rounded-md border border-border bg-surface-2 px-3 text-sm text-text-primary"
            />
          </label>
          <div className="flex gap-2">
            <label className="flex flex-1 flex-col gap-1">
              <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">Цвет</span>
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="h-9 w-full rounded-md border border-border bg-surface-2"
              />
            </label>
            <label className="flex flex-1 flex-col gap-1">
              <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">Sort order</span>
              <input
                type="number"
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value)}
                className="h-9 rounded-md border border-border bg-surface-2 px-3 text-sm text-text-primary"
              />
            </label>
          </div>
          {error && (
            <p className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>
              Закрыть
            </Button>
            <Button type="submit" size="sm" disabled={busy}>
              {busy ? 'Создаём…' : 'Создать категорию'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Atlas CMS panel ────────────────────────────────────────────────────
//
// Manages atlas_nodes / atlas_edges (migration 00031). The user-visible
// Atlas (/atlas) reads from /profile/me/atlas which now returns these
// rows; this panel is the only mutate path.

const ATLAS_KIND_OPTIONS = ['normal', 'keystone', 'ascendant', 'center'] as const
const ATLAS_SECTION_OPTIONS = [
  'algorithms',
  'data_structures',
  'sql',
  'go',
  'system_design',
  'behavioral',
  'concurrency',
] as const

const emptyNodeForm: UpsertNodePayload = {
  id: '',
  title: '',
  section: 'algorithms',
  kind: 'normal',
  description: '',
  total_count: 0,
  pos_x: null,
  pos_y: null,
  sort_order: 0,
  is_active: true,
}

function AtlasPanel() {
  const nodesQ = useAtlasAdminNodesQuery()
  const edgesQ = useAtlasAdminEdgesQuery()
  const createMut = useCreateAtlasNodeMutation()
  const updateMut = useUpdateAtlasNodeMutation()
  const deleteMut = useDeleteAtlasNodeMutation()
  const positionMut = useUpdateAtlasPositionMutation()
  const createEdgeMut = useCreateAtlasEdgeMutation()
  const deleteEdgeMut = useDeleteAtlasEdgeMutation()

  const [editing, setEditing] = useState<AtlasAdminNode | null>(null)
  const [creating, setCreating] = useState(false)
  const [edgeFrom, setEdgeFrom] = useState('')
  const [edgeTo, setEdgeTo] = useState('')
  const [edgeError, setEdgeError] = useState<string | null>(null)

  const nodes = nodesQ.data?.items ?? []
  const edges = edgesQ.data?.items ?? []

  const edgeCountByNode = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of edges) {
      m.set(e.from, (m.get(e.from) ?? 0) + 1)
      m.set(e.to, (m.get(e.to) ?? 0) + 1)
    }
    return m
  }, [edges])

  const handleDelete = async (n: AtlasAdminNode) => {
    const linked = edgeCountByNode.get(n.id) ?? 0
    const msg =
      linked > 0
        ? `Удалить узел «${n.title}»? Это также удалит ${linked} связ${linked === 1 ? 'ь' : linked < 5 ? 'и' : 'ей'} (CASCADE).`
        : `Удалить узел «${n.title}»?`
    // eslint-disable-next-line no-alert
    if (!window.confirm(msg)) return
    await deleteMut.mutateAsync(n.id)
  }

  const handleAddEdge = async (e: FormEvent) => {
    e.preventDefault()
    setEdgeError(null)
    if (!edgeFrom || !edgeTo) {
      setEdgeError('Выбери оба узла.')
      return
    }
    if (edgeFrom === edgeTo) {
      setEdgeError('Нельзя соединить узел сам с собой.')
      return
    }
    try {
      await createEdgeMut.mutateAsync({ from: edgeFrom, to: edgeTo })
      setEdgeFrom('')
      setEdgeTo('')
    } catch (err) {
      setEdgeError(err instanceof Error ? err.message : 'Не удалось добавить связь.')
    }
  }

  const handleDeleteEdge = async (e: AtlasAdminEdge) => {
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Удалить связь ${e.from} → ${e.to}?`)) return
    await deleteEdgeMut.mutateAsync(e.id)
  }

  return (
    <div className="flex flex-col gap-6 px-4 py-5 sm:px-7">
      {nodesQ.isPending ? (
        <PanelSkeleton rows={6} />
      ) : nodesQ.error ? (
        <ErrorBox message="Не удалось загрузить узлы атласа" />
      ) : (
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-sm font-bold text-text-secondary">
              Узлы ({nodes.length})
            </h2>
            <Button size="sm" onClick={() => setCreating(true)}>
              + Новый узел
            </Button>
          </div>
          <div className="overflow-x-auto rounded-lg border border-border bg-surface-1">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-2 text-left font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
                  <th className="px-3 py-2">id</th>
                  <th className="px-3 py-2">title</th>
                  <th className="px-3 py-2">section</th>
                  <th className="px-3 py-2">kind</th>
                  <th className="px-3 py-2">total</th>
                  <th className="px-3 py-2">pos</th>
                  <th className="px-3 py-2">active</th>
                  <th className="px-3 py-2 text-right">actions</th>
                </tr>
              </thead>
              <tbody>
                {nodes.map((n) => (
                  <tr key={n.id} className="border-b border-border last:border-0">
                    <td className="px-3 py-2 font-mono text-[11px] text-text-muted">{n.id}</td>
                    <td className="px-3 py-2 text-text-primary">{n.title}</td>
                    <td className="px-3 py-2 font-mono text-[11px] text-text-secondary">{n.section}</td>
                    <td className="px-3 py-2 font-mono text-[11px] text-text-secondary">{n.kind}</td>
                    <td className="px-3 py-2 font-mono text-[11px] text-text-secondary">{n.total_count}</td>
                    <td className="px-3 py-2 font-mono text-[10px] text-text-muted">
                      {n.pos_x != null && n.pos_y != null ? `${n.pos_x},${n.pos_y}` : 'auto'}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 font-mono text-[9px] ${
                          n.is_active ? 'bg-success/15 text-success' : 'bg-surface-3 text-text-muted'
                        }`}
                      >
                        {n.is_active ? 'on' : 'off'}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex justify-end gap-1.5">
                        <Button size="sm" variant="ghost" onClick={() => setEditing(n)}>
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => void handleDelete(n)}
                          disabled={deleteMut.isPending}
                        >
                          Del
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {nodes.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-3 py-6 text-center font-mono text-[11px] text-text-muted">
                      Узлов пока нет — создай первый.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {edgesQ.isPending ? null : edgesQ.error ? (
        <ErrorBox message="Не удалось загрузить связи" />
      ) : (
        <section className="flex flex-col gap-3">
          <h2 className="font-display text-sm font-bold text-text-secondary">
            Связи ({edges.length})
          </h2>
          <form
            onSubmit={handleAddEdge}
            className="flex flex-wrap items-end gap-2 rounded-lg border border-border bg-surface-1 p-3"
          >
            <label className="flex flex-col gap-1">
              <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">from</span>
              <select
                value={edgeFrom}
                onChange={(e) => setEdgeFrom(e.target.value)}
                className="h-9 rounded-md border border-border bg-surface-2 px-2 text-sm text-text-primary"
              >
                <option value="">— выбери —</option>
                {nodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.id}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">to</span>
              <select
                value={edgeTo}
                onChange={(e) => setEdgeTo(e.target.value)}
                className="h-9 rounded-md border border-border bg-surface-2 px-2 text-sm text-text-primary"
              >
                <option value="">— выбери —</option>
                {nodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.id}
                  </option>
                ))}
              </select>
            </label>
            <Button size="sm" type="submit" disabled={createEdgeMut.isPending}>
              + Добавить связь
            </Button>
            {edgeError && (
              <span className="ml-2 font-mono text-[11px] text-danger">{edgeError}</span>
            )}
          </form>
          <div className="overflow-x-auto rounded-lg border border-border bg-surface-1">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-2 text-left font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
                  <th className="px-3 py-2">id</th>
                  <th className="px-3 py-2">from</th>
                  <th className="px-3 py-2">→</th>
                  <th className="px-3 py-2">to</th>
                  <th className="px-3 py-2 text-right">actions</th>
                </tr>
              </thead>
              <tbody>
                {edges.map((e) => (
                  <tr key={e.id} className="border-b border-border last:border-0">
                    <td className="px-3 py-2 font-mono text-[11px] text-text-muted">{e.id}</td>
                    <td className="px-3 py-2 font-mono text-[11px] text-text-secondary">{e.from}</td>
                    <td className="px-3 py-2 text-text-muted">→</td>
                    <td className="px-3 py-2 font-mono text-[11px] text-text-secondary">{e.to}</td>
                    <td className="px-3 py-2 text-right">
                      <Button size="sm" variant="ghost" onClick={() => void handleDeleteEdge(e)}>
                        Del
                      </Button>
                    </td>
                  </tr>
                ))}
                {edges.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center font-mono text-[11px] text-text-muted">
                      Связей пока нет.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {(creating || editing) && (
        <AtlasNodeModal
          initial={editing ?? emptyNodeForm}
          mode={editing ? 'edit' : 'create'}
          onClose={() => {
            setCreating(false)
            setEditing(null)
          }}
          onSubmit={async (payload) => {
            if (editing) {
              await updateMut.mutateAsync(payload)
            } else {
              await createMut.mutateAsync(payload)
            }
          }}
          onSavePosition={async (id, posX, posY) => {
            await positionMut.mutateAsync({ id, pos_x: posX, pos_y: posY })
          }}
          busy={createMut.isPending || updateMut.isPending || positionMut.isPending}
        />
      )}
    </div>
  )
}

function AtlasNodeModal({
  initial,
  mode,
  onClose,
  onSubmit,
  onSavePosition,
  busy,
}: {
  initial: UpsertNodePayload | AtlasAdminNode
  mode: 'create' | 'edit'
  onClose: () => void
  onSubmit: (payload: UpsertNodePayload) => Promise<void>
  onSavePosition: (id: string, posX: number | null, posY: number | null) => Promise<void>
  busy: boolean
}) {
  const seed: UpsertNodePayload = {
    id: initial.id,
    title: initial.title,
    section: initial.section,
    kind: initial.kind,
    description: initial.description ?? '',
    total_count: initial.total_count,
    pos_x: initial.pos_x ?? null,
    pos_y: initial.pos_y ?? null,
    sort_order: initial.sort_order ?? 0,
    is_active: initial.is_active ?? true,
  }
  const [form, setForm] = useState<UpsertNodePayload>(seed)
  const [error, setError] = useState<string | null>(null)

  const setField = <K extends keyof UpsertNodePayload>(k: K, v: UpsertNodePayload[K]) =>
    setForm((prev) => ({ ...prev, [k]: v }))

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!form.id.trim() || !form.title.trim()) {
      setError('id и title обязательны.')
      return
    }
    try {
      await onSubmit({ ...form, id: form.id.trim(), title: form.title.trim() })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Сохранить не удалось.')
    }
  }

  const savePositionOnly = async () => {
    setError(null)
    try {
      await onSavePosition(form.id.trim(), form.pos_x ?? null, form.pos_y ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить позицию.')
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="w-full max-w-lg rounded-lg border border-border bg-surface-1 p-5">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-display text-sm font-bold text-text-primary">
            {mode === 'edit' ? `Редактирование «${initial.id}»` : 'Новый узел атласа'}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="font-mono text-xs text-text-muted hover:text-text-primary"
          >
            ✕
          </button>
        </div>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">
              <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">id (slug) *</span>
              <input
                value={form.id}
                onChange={(e) => setField('id', e.target.value)}
                disabled={mode === 'edit'}
                placeholder="algo_basics"
                className="h-9 rounded-md border border-border bg-surface-2 px-3 text-sm text-text-primary disabled:opacity-60"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">title *</span>
              <input
                value={form.title}
                onChange={(e) => setField('title', e.target.value)}
                placeholder="Алгоритмы: основы"
                className="h-9 rounded-md border border-border bg-surface-2 px-3 text-sm text-text-primary"
              />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">
              <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">section</span>
              <select
                value={form.section}
                onChange={(e) => setField('section', e.target.value)}
                className="h-9 rounded-md border border-border bg-surface-2 px-2 text-sm text-text-primary"
              >
                {ATLAS_SECTION_OPTIONS.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">kind</span>
              <select
                value={form.kind}
                onChange={(e) => setField('kind', e.target.value)}
                className="h-9 rounded-md border border-border bg-surface-2 px-2 text-sm text-text-primary"
              >
                {ATLAS_KIND_OPTIONS.map((k) => (
                  <option key={k} value={k}>{k}</option>
                ))}
              </select>
            </label>
          </div>

          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">description</span>
            <textarea
              value={form.description ?? ''}
              onChange={(e) => setField('description', e.target.value)}
              rows={2}
              className="rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-text-primary"
            />
          </label>

          <div className="grid grid-cols-3 gap-2">
            <label className="flex flex-col gap-1">
              <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">total_count</span>
              <input
                type="number"
                value={form.total_count}
                onChange={(e) => setField('total_count', Number(e.target.value || 0))}
                className="h-9 rounded-md border border-border bg-surface-2 px-3 text-sm text-text-primary"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">sort_order</span>
              <input
                type="number"
                value={form.sort_order ?? 0}
                onChange={(e) => setField('sort_order', Number(e.target.value || 0))}
                className="h-9 rounded-md border border-border bg-surface-2 px-3 text-sm text-text-primary"
              />
            </label>
            <label className="flex items-center gap-2 pt-5">
              <input
                type="checkbox"
                checked={form.is_active ?? true}
                onChange={(e) => setField('is_active', e.target.checked)}
              />
              <span className="text-sm text-text-primary">is_active</span>
            </label>
          </div>

          <fieldset className="rounded-md border border-border bg-surface-2 p-3">
            <legend className="px-1 font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
              Позиция (viewBox 0..1400, пусто = auto-layout)
            </legend>
            <div className="flex items-center gap-2">
              <label className="flex flex-col gap-1">
                <span className="font-mono text-[10px] text-text-muted">pos_x</span>
                <input
                  type="number"
                  value={form.pos_x ?? ''}
                  onChange={(e) =>
                    setField('pos_x', e.target.value === '' ? null : Number(e.target.value))
                  }
                  className="h-9 w-24 rounded-md border border-border bg-surface-1 px-3 text-sm text-text-primary"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="font-mono text-[10px] text-text-muted">pos_y</span>
                <input
                  type="number"
                  value={form.pos_y ?? ''}
                  onChange={(e) =>
                    setField('pos_y', e.target.value === '' ? null : Number(e.target.value))
                  }
                  className="h-9 w-24 rounded-md border border-border bg-surface-1 px-3 text-sm text-text-primary"
                />
              </label>
              {mode === 'edit' && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => void savePositionOnly()}
                  disabled={busy}
                >
                  Сохранить только позицию
                </Button>
              )}
            </div>
          </fieldset>

          {error && (
            <p className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>
              Отмена
            </Button>
            <Button type="submit" size="sm" disabled={busy}>
              {busy ? 'Сохраняем…' : mode === 'edit' ? 'Сохранить' : 'Создать'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── AI models CMS panel ────────────────────────────────────────────────
//
// Grid + modal for the llm_models registry (migration 00033). Admins add
// a new OpenRouter id here and it appears in the Arena AI-opponent picker
// / Weekly Insight client / Mock LLM without a code deploy.

function AIModelsPanel() {
  const list = useAIAdminModelsQuery()
  const createMut = useCreateLLMModelMutation()
  const updateMut = useUpdateLLMModelMutation()
  const toggleMut = useToggleLLMModelMutation()
  const deleteMut = useDeleteLLMModelMutation()

  const [editing, setEditing] = useState<AdminLLMModel | null>(null)
  const [creating, setCreating] = useState(false)

  if (list.isPending) {
    return <PanelSkeleton rows={5} />
  }
  if (list.error || !list.data) {
    return <ErrorBox message="Не удалось загрузить AI-модельки." />
  }

  const rows = list.data.items

  return (
    <div className="flex flex-col gap-5 px-4 py-5 sm:px-7">
      <section className="rounded-lg border border-border bg-surface-1 p-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="font-display text-sm font-bold text-text-primary">Реестр AI-моделей</h2>
            <p className="mt-1 font-mono text-[11px] text-text-muted">
              Что здесь включено — то и видит фронт в пикере Arena / Insight / Mock.
              Выключай строку, чтобы временно убрать модель, удаляй — чтобы стереть насовсем.
            </p>
          </div>
          <Button size="sm" onClick={() => setCreating(true)}>
            + Добавить нейронку
          </Button>
        </div>

        {rows.length === 0 ? (
          <div className="rounded-md border border-dashed border-border bg-surface-2 px-4 py-6 text-center font-mono text-xs text-text-muted">
            Реестр пуст. Пока ни одна AI-фича не сможет дозваться до OpenRouter — добавь хотя бы одну модель.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
                  <th className="py-2 pr-3 text-left">model_id</th>
                  <th className="py-2 pr-3 text-left">label</th>
                  <th className="py-2 pr-3 text-left">provider</th>
                  <th className="py-2 pr-3 text-left">tier</th>
                  <th className="py-2 pr-3 text-center">enabled</th>
                  <th className="py-2 pr-3 text-left">use for</th>
                  <th className="py-2 pr-3 text-right">sort</th>
                  <th className="py-2 pr-3" />
                </tr>
              </thead>
              <tbody>
                {rows.map((m) => (
                  <tr key={m.id} className="border-b border-border/60 align-top">
                    <td className="py-2 pr-3 font-mono text-[12px] text-text-primary">{m.model_id}</td>
                    <td className="py-2 pr-3 text-text-primary">{m.label}</td>
                    <td className="py-2 pr-3 text-text-secondary">{m.provider}</td>
                    <td className="py-2 pr-3">
                      <span
                        className={`rounded-full px-2 py-0.5 font-mono text-[10px] ${
                          m.tier === 'premium'
                            ? 'bg-accent/20 text-accent'
                            : 'bg-surface-3 text-text-secondary'
                        }`}
                      >
                        {m.tier}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-center">
                      <button
                        type="button"
                        disabled={toggleMut.isPending}
                        onClick={() => toggleMut.mutate(m.model_id)}
                        className={`rounded-full px-2 py-0.5 font-mono text-[10px] ${
                          m.is_enabled
                            ? 'bg-success/20 text-success'
                            : 'bg-danger/20 text-danger'
                        }`}
                      >
                        {m.is_enabled ? 'on' : 'off'}
                      </button>
                    </td>
                    <td className="py-2 pr-3">
                      <div className="flex flex-wrap gap-1">
                        {m.use_for_arena && (
                          <span className="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[10px] text-text-secondary">arena</span>
                        )}
                        {m.use_for_insight && (
                          <span className="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[10px] text-text-secondary">insight</span>
                        )}
                        {m.use_for_mock && (
                          <span className="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[10px] text-text-secondary">mock</span>
                        )}
                      </div>
                    </td>
                    <td className="py-2 pr-3 text-right font-mono text-[12px] text-text-secondary">{m.sort_order}</td>
                    <td className="py-2 pr-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(m)}>
                          Edit
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={deleteMut.isPending}
                          onClick={() => {
                            if (window.confirm(`Удалить ${m.model_id}?`)) {
                              deleteMut.mutate(m.model_id)
                            }
                          }}
                          icon={<Trash2 className="h-3.5 w-3.5" />}
                        >
                          Del
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {(creating || editing) && (
        <LLMModelModal
          initial={editing}
          busy={createMut.isPending || updateMut.isPending}
          onClose={() => {
            setCreating(false)
            setEditing(null)
          }}
          onSave={async (body) => {
            if (editing) {
              await updateMut.mutateAsync({ modelId: editing.model_id, body })
            } else {
              await createMut.mutateAsync(body)
            }
            setCreating(false)
            setEditing(null)
          }}
        />
      )}
    </div>
  )
}

function LLMModelModal({
  initial,
  busy,
  onClose,
  onSave,
}: {
  initial: AdminLLMModel | null
  busy: boolean
  onClose: () => void
  onSave: (body: AdminLLMModelUpsertBody) => Promise<void>
}) {
  const [modelId, setModelId] = useState(initial?.model_id ?? '')
  const [label, setLabel] = useState(initial?.label ?? '')
  const [provider, setProvider] = useState(initial?.provider ?? '')
  const [tier, setTier] = useState<'free' | 'premium'>(initial?.tier ?? 'free')
  const [isEnabled, setIsEnabled] = useState(initial?.is_enabled ?? true)
  const [contextWindow, setContextWindow] = useState(
    initial?.context_window != null ? String(initial.context_window) : '',
  )
  const [costIn, setCostIn] = useState(
    initial?.cost_per_1k_input_usd != null ? String(initial.cost_per_1k_input_usd) : '',
  )
  const [costOut, setCostOut] = useState(
    initial?.cost_per_1k_output_usd != null ? String(initial.cost_per_1k_output_usd) : '',
  )
  const [useArena, setUseArena] = useState(initial?.use_for_arena ?? true)
  const [useInsight, setUseInsight] = useState(initial?.use_for_insight ?? true)
  const [useMock, setUseMock] = useState(initial?.use_for_mock ?? true)
  const [sortOrder, setSortOrder] = useState(String(initial?.sort_order ?? 0))
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!modelId.trim() || !label.trim() || !provider.trim()) {
      setError('model_id, label, provider обязательны.')
      return
    }
    try {
      const body: AdminLLMModelUpsertBody = {
        model_id: modelId.trim(),
        label: label.trim(),
        provider: provider.trim(),
        tier,
        is_enabled: isEnabled,
        context_window: contextWindow ? Number(contextWindow) : null,
        cost_per_1k_input_usd: costIn ? Number(costIn) : null,
        cost_per_1k_output_usd: costOut ? Number(costOut) : null,
        use_for_arena: useArena,
        use_for_insight: useInsight,
        use_for_mock: useMock,
        sort_order: sortOrder ? Number(sortOrder) : 0,
      }
      await onSave(body)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить.')
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="w-full max-w-xl rounded-lg border border-border bg-surface-1 p-5">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-display text-sm font-bold text-text-primary">
            {initial ? 'Редактировать модель' : 'Новая модель'}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="font-mono text-xs text-text-muted hover:text-text-primary"
          >
            ✕
          </button>
        </div>
        <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <label className="flex flex-col gap-1 md:col-span-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">model_id * (OpenRouter id)</span>
            <input
              value={modelId}
              onChange={(e) => setModelId(e.target.value)}
              placeholder="openai/gpt-4o"
              disabled={!!initial}
              className="h-9 rounded-md border border-border bg-surface-2 px-3 font-mono text-sm text-text-primary disabled:opacity-60"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">label *</span>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="h-9 rounded-md border border-border bg-surface-2 px-3 text-sm text-text-primary"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">provider *</span>
            <input
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              placeholder="openai / anthropic / …"
              className="h-9 rounded-md border border-border bg-surface-2 px-3 text-sm text-text-primary"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">tier</span>
            <select
              value={tier}
              onChange={(e) => setTier(e.target.value as 'free' | 'premium')}
              className="h-9 rounded-md border border-border bg-surface-2 px-3 text-sm text-text-primary"
            >
              <option value="free">free</option>
              <option value="premium">premium</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">sort_order</span>
            <input
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value)}
              type="number"
              className="h-9 rounded-md border border-border bg-surface-2 px-3 text-sm text-text-primary"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">context_window</span>
            <input
              value={contextWindow}
              onChange={(e) => setContextWindow(e.target.value)}
              type="number"
              placeholder="128000"
              className="h-9 rounded-md border border-border bg-surface-2 px-3 text-sm text-text-primary"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">cost / 1k in (USD)</span>
            <input
              value={costIn}
              onChange={(e) => setCostIn(e.target.value)}
              type="number"
              step="0.000001"
              className="h-9 rounded-md border border-border bg-surface-2 px-3 text-sm text-text-primary"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">cost / 1k out (USD)</span>
            <input
              value={costOut}
              onChange={(e) => setCostOut(e.target.value)}
              type="number"
              step="0.000001"
              className="h-9 rounded-md border border-border bg-surface-2 px-3 text-sm text-text-primary"
            />
          </label>
          <div className="md:col-span-2 flex flex-wrap gap-4 pt-1">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={isEnabled} onChange={(e) => setIsEnabled(e.target.checked)} className="h-4 w-4" />
              <span className="text-sm text-text-secondary">is_enabled</span>
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={useArena} onChange={(e) => setUseArena(e.target.checked)} className="h-4 w-4" />
              <span className="text-sm text-text-secondary">use_for_arena</span>
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={useInsight} onChange={(e) => setUseInsight(e.target.checked)} className="h-4 w-4" />
              <span className="text-sm text-text-secondary">use_for_insight</span>
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={useMock} onChange={(e) => setUseMock(e.target.checked)} className="h-4 w-4" />
              <span className="text-sm text-text-secondary">use_for_mock</span>
            </label>
          </div>
          {error && (
            <p className="md:col-span-2 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
              {error}
            </p>
          )}
          <div className="md:col-span-2 flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>
              Отмена
            </Button>
            <Button type="submit" size="sm" disabled={busy}>
              {busy ? 'Сохраняем…' : initial ? 'Сохранить' : 'Создать'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
