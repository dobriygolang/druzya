// LobbyPage — single-lobby room view at /lobby/:id (WAVE-11).
//
// Shows the 4-letter code prominently, the member slots (filled + empty),
// owner-only Start / Cancel buttons, and a Leave button for non-owners.
// The page polls the lobby every 4s; when status flips to 'live' and a
// match_id is set, every member is auto-redirected to /arena/match/{matchId}.
//
// Anti-fallback: empty slots show a placeholder dash, never a fake user.
// 404 on the id surfaces the dedicated not-found block — we don't fall back
// to a stale cached lobby.
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  useCancelLobby,
  useJoinLobby,
  useLeaveLobby,
  useLobbyQuery,
  useStartLobby,
} from '../../lib/queries/lobby'
import { profileQueryKeys } from '../../lib/queries/profile'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../lib/apiClient'

type Me = { id: string }

function useMyID(): string | undefined {
  // Re-uses the cached /profile/me payload that AppShell warms; fetched
  // lazily here too so the page works outside the shell.
  const q = useQuery({
    queryKey: profileQueryKeys.me(),
    queryFn: () => api<Me>('/profile/me'),
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
    retry: false,
  })
  return q.data?.id
}

export default function LobbyPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const lobbyQ = useLobbyQuery(id)
  const myID = useMyID()
  const join = useJoinLobby()
  const leave = useLeaveLobby()
  const start = useStartLobby()
  const cancel = useCancelLobby()
  const [actionError, setActionError] = useState<string | null>(null)

  const data = lobbyQ.data
  const lobby = data?.lobby
  // Wrap in useMemo so the `?? []` fallback identity is stable across renders.
  const members = useMemo(() => data?.members ?? [], [data])

  const isOwner = !!(lobby && myID && lobby.owner_id === myID)
  const isMember = useMemo(
    () => !!myID && members.some((m) => m.user_id === myID),
    [members, myID],
  )
  const isFull = !!lobby && members.length >= lobby.max_members

  // Auto-redirect every member when the owner starts the match.
  useEffect(() => {
    if (lobby && lobby.status === 'live' && lobby.match_id) {
      navigate(`/arena/match/${lobby.match_id}`, { replace: true })
    }
  }, [lobby, navigate])

  if (lobbyQ.isLoading) {
    return <Wrap>Загрузка лобби…</Wrap>
  }
  if (lobbyQ.isError) {
    return <Wrap><Danger>Не удалось загрузить лобби.</Danger></Wrap>
  }
  if (!lobby) {
    return (
      <Wrap>
        <Danger>Лобби не найдено или уже отменено.</Danger>
        <button
          type="button"
          onClick={() => navigate('/lobbies')}
          className="mt-3 h-9 rounded-md border border-border px-3 text-sm text-text-secondary hover:bg-surface-2"
        >
          К списку лобби
        </button>
      </Wrap>
    )
  }

  const handleAction = async (fn: () => Promise<unknown>, errMsg: string) => {
    setActionError(null)
    try {
      await fn()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : errMsg)
    }
  }

  return (
    <Wrap>
      <header className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-text-primary">Лобби</h1>
          <div className="text-sm text-text-secondary">
            {lobby.mode} · {lobby.section} · {lobby.difficulty}
          </div>
        </div>
        <div className="flex flex-col items-start gap-1 rounded-lg border border-border-strong bg-text-primary/10 px-4 py-2 sm:items-end">
          <span className="text-xs uppercase tracking-wide text-text-primary">Код</span>
          <span className="font-mono text-3xl font-extrabold tracking-[0.4em] text-text-primary">
            {lobby.code}
          </span>
        </div>
      </header>

      <section className="mb-6 grid gap-3 sm:grid-cols-2">
        <Stat label="Видимость" value={lobby.visibility} />
        <Stat label="Лимит времени" value={`${lobby.time_limit_min} мин`} />
        <Stat label="Слоты" value={`${members.length} / ${lobby.max_members}`} />
        <Stat label="AI" value={lobby.ai_allowed ? 'разрешён' : 'запрещён'} />
      </section>

      <section className="mb-6">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-text-muted">
          Участники
        </h2>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {Array.from({ length: lobby.max_members }).map((_, i) => {
            const m = members[i]
            return (
              <div
                key={i}
                className="flex items-center justify-between rounded-md border border-border bg-surface-1 px-3 py-2 text-sm"
              >
                {m ? (
                  <>
                    <span className="font-mono text-text-primary">
                      {m.user_id.slice(0, 8)}…
                    </span>
                    <span className="rounded-md border border-border bg-surface-2 px-2 py-0.5 text-xs uppercase text-text-muted">
                      {m.role}
                    </span>
                  </>
                ) : (
                  <span className="text-text-muted">— пустой слот —</span>
                )}
              </div>
            )
          })}
        </div>
      </section>

      {actionError && (
        <div className="mb-3 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          {actionError}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {!isMember && lobby.status === 'open' && !isFull && (
          <button
            type="button"
            disabled={join.isPending}
            onClick={() => handleAction(() => join.mutateAsync(lobby.id), 'Не удалось войти')}
            className="h-10 rounded-md bg-text-primary px-4 text-sm font-semibold text-text-primary disabled:opacity-60"
          >
            {join.isPending ? 'Входим…' : 'Войти'}
          </button>
        )}
        {isMember && !isOwner && lobby.status === 'open' && (
          <button
            type="button"
            disabled={leave.isPending}
            onClick={() => handleAction(() => leave.mutateAsync(lobby.id), 'Не удалось выйти')}
            className="h-10 rounded-md border border-border px-4 text-sm text-text-secondary hover:bg-surface-2 disabled:opacity-60"
          >
            Покинуть
          </button>
        )}
        {isOwner && lobby.status === 'open' && (
          <>
            <button
              type="button"
              disabled={start.isPending || members.length < 2}
              onClick={() => handleAction(() => start.mutateAsync(lobby.id), 'Не удалось запустить')}
              className="h-10 rounded-md bg-success px-4 text-sm font-semibold text-text-primary disabled:opacity-60"
            >
              {start.isPending ? 'Запускаем…' : 'Старт'}
            </button>
            <button
              type="button"
              disabled={cancel.isPending}
              onClick={() => handleAction(() => cancel.mutateAsync(lobby.id), 'Не удалось отменить')}
              className="h-10 rounded-md border border-danger/40 px-4 text-sm text-danger hover:bg-danger/10 disabled:opacity-60"
            >
              Отменить лобби
            </button>
          </>
        )}
        {lobby.status === 'cancelled' && (
          <div className="rounded-md border border-border bg-surface-1 px-3 py-2 text-sm text-text-muted">
            Лобби отменено.
          </div>
        )}
        {lobby.status === 'live' && (
          <div className="rounded-md border border-success/40 bg-success/10 px-3 py-2 text-sm text-success">
            Матч стартовал — переходим…
          </div>
        )}
      </div>
    </Wrap>
  )
}

function Wrap({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">{children}</div>
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-surface-1 px-3 py-2 text-sm">
      <div className="text-xs uppercase tracking-wide text-text-muted">{label}</div>
      <div className="text-text-primary">{value}</div>
    </div>
  )
}

function Danger({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
      {children}
    </div>
  )
}
