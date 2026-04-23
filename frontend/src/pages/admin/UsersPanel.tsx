import { useMemo, useState } from 'react'
import { Search, ShieldCheck, ShieldOff } from 'lucide-react'
import { Button } from '../../components/Button'
import {
  useAdminUsersQuery,
  useBanUserMutation,
  useUnbanUserMutation,
  type AdminUserRow,
} from '../../lib/queries/admin'
import { ErrorBox, PanelSkeleton } from './shared'

export function UsersPanel() {
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
