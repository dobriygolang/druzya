// LobbyListPage — public discovery for Custom Lobbies (WAVE-11).
//
// Mounted at /lobbies. Three things on this page:
//   1) Filter strip (mode + section)
//   2) "Create" CTA + 4-letter code input that resolves a lobby and jumps to it
//   3) Public list of open lobbies (visibility=public, status=open)
//
// Anti-fallback: empty list shows an honest empty-state, never a synthetic
// roster. A bad code surfaces an inline error and does NOT redirect.
import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  useLobbyByCodeQuery,
  useLobbyListQuery,
  type LobbyMode,
} from '../../lib/queries/lobby'
import CreateLobbyDialog from '../../components/lobby/CreateLobbyDialog'

const MODE_OPTIONS: Array<{ value: '' | LobbyMode; label: string }> = [
  { value: '', label: 'Все' },
  { value: '1v1', label: '1 на 1' },
  { value: '2v2', label: '2 на 2' },
]

const SECTION_OPTIONS = [
  { value: '', label: 'Все' },
  { value: 'algorithms', label: 'algorithms' },
  { value: 'sql', label: 'sql' },
  { value: 'go', label: 'go' },
  { value: 'system_design', label: 'system_design' },
  { value: 'behavioral', label: 'behavioral' },
]

export default function LobbyListPage() {
  const navigate = useNavigate()
  const [mode, setMode] = useState<'' | LobbyMode>('')
  const [section, setSection] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [code, setCode] = useState('')

  const filters = useMemo(
    () => ({
      mode: mode || undefined,
      section: section || undefined,
    }),
    [mode, section],
  )
  const list = useLobbyListQuery(filters)
  const codeLookup = useLobbyByCodeQuery(code, code.length === 4)

  const handleJoinByCode = () => {
    const data = codeLookup.data
    if (data && data.lobby) {
      navigate(`/lobby/${data.lobby.id}`)
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-6 flex flex-col gap-2">
        <h1 className="font-display text-3xl font-bold text-text-primary">Custom Lobby</h1>
        <p className="text-sm text-text-secondary">
          Создавай приватные комнаты, зови друзей по коду или ссылке, играй на своих условиях.
        </p>
      </header>

      <div className="mb-6 grid gap-3 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-surface-1 p-4">
          <div className="mb-2 text-xs uppercase tracking-wide text-text-muted">
            Создать своё лобби
          </div>
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="h-10 w-full rounded-md bg-accent text-sm font-semibold text-text-primary hover:bg-accent/90"
          >
            Создать лобби
          </button>
        </div>
        <div className="rounded-lg border border-border bg-surface-1 p-4">
          <div className="mb-2 text-xs uppercase tracking-wide text-text-muted">
            Войти по коду
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 4))}
              placeholder="ABCD"
              maxLength={4}
              className="h-10 flex-1 rounded-md border border-border bg-surface-2 px-3 font-mono text-lg uppercase tracking-widest text-text-primary outline-none focus:border-accent"
            />
            <button
              type="button"
              onClick={handleJoinByCode}
              disabled={code.length !== 4 || !codeLookup.data}
              className="h-10 rounded-md bg-cyan px-4 text-sm font-semibold text-text-primary disabled:opacity-50"
            >
              Войти
            </button>
          </div>
          {code.length === 4 && codeLookup.isFetched && !codeLookup.data && (
            <div className="mt-2 text-xs text-danger">Лобби с таким кодом не найдено.</div>
          )}
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <FilterGroup
          label="Режим"
          value={mode}
          options={MODE_OPTIONS}
          onChange={(v) => setMode(v as '' | LobbyMode)}
        />
        <FilterGroup
          label="Секция"
          value={section}
          options={SECTION_OPTIONS}
          onChange={setSection}
        />
      </div>

      {list.isLoading && (
        <div className="rounded-lg border border-border bg-surface-1 p-6 text-sm text-text-secondary">
          Загрузка списка лобби…
        </div>
      )}
      {list.isError && (
        <div className="rounded-lg border border-danger/40 bg-danger/10 p-6 text-sm text-danger">
          Не удалось загрузить лобби.
        </div>
      )}
      {list.data && list.data.items.length === 0 && (
        <div className="rounded-lg border border-border bg-surface-1 p-6 text-sm text-text-secondary">
          Сейчас открытых лобби нет — создай первое.
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {list.data?.items.map((l) => (
          <Link
            key={l.id}
            to={`/lobby/${l.id}`}
            className="block rounded-lg border border-border bg-surface-1 p-4 hover:border-accent"
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="font-mono text-lg font-bold tracking-widest text-accent">
                {l.code}
              </span>
              <span className="rounded-md border border-border bg-surface-2 px-2 py-0.5 text-xs uppercase tracking-wide text-text-muted">
                {l.mode}
              </span>
            </div>
            <div className="text-sm text-text-primary">
              {l.section} · {l.difficulty}
            </div>
            <div className="mt-2 flex items-center justify-between text-xs text-text-muted">
              <span>
                до {l.max_members} игроков
                {l.ai_allowed ? ' · AI ok' : ''}
              </span>
              <span>{l.time_limit_min} мин</span>
            </div>
          </Link>
        ))}
      </div>

      <CreateLobbyDialog open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  )
}

function FilterGroup({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: Array<{ value: string; label: string }>
  onChange: (v: string) => void
}) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-xs uppercase tracking-wide text-text-muted">{label}:</span>
      {options.map((o) => (
        <button
          key={o.value || 'all'}
          type="button"
          onClick={() => onChange(o.value)}
          className={
            'h-8 rounded-md border px-3 text-xs ' +
            (value === o.value
              ? 'border-accent bg-accent/15 font-semibold text-text-primary'
              : 'border-border bg-surface-2 text-text-secondary hover:bg-surface-1')
          }
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
