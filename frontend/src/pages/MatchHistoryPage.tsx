// TODO i18n
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AppShellV2 } from '../components/AppShell'
import { Avatar } from '../components/Avatar'
import { useArenaHistoryQuery, type ArenaHistoryEntry } from '../lib/queries/matches'

// Filter dictionaries for the chip rows. Keep these in lock-step with
// shared/enums.* on the backend — the wire layer rejects unknown values.
const MODES: { value: string; label: string }[] = [
  { value: '', label: 'Все режимы' },
  { value: 'solo_1v1', label: '1v1' },
  { value: 'duo_2v2', label: '2v2' },
  { value: 'ranked', label: 'Ranked' },
  { value: 'hardcore', label: 'Hardcore' },
  { value: 'cursed', label: 'Cursed' },
]

const SECTIONS: { value: string; label: string }[] = [
  { value: '', label: 'Все секции' },
  { value: 'algorithms', label: 'Algorithms' },
  { value: 'sql', label: 'SQL' },
  { value: 'go', label: 'Go' },
  { value: 'system_design', label: 'System Design' },
  { value: 'behavioral', label: 'Behavioral' },
]

const PAGE_SIZES = [10, 20, 50]

function ErrorChip({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
      <span>Не удалось загрузить историю.</span>
      <button onClick={onRetry} className="font-semibold underline hover:text-danger-hover">
        Повторить
      </button>
    </div>
  )
}

function ResultPill({ result, lp }: { result: ArenaHistoryEntry['result']; lp: number }) {
  const map: Record<ArenaHistoryEntry['result'], { bg: string; text: string; label: string }> = {
    win: { bg: 'bg-success/15', text: 'text-success', label: 'WIN' },
    loss: { bg: 'bg-danger/15', text: 'text-danger', label: 'LOSS' },
    draw: { bg: 'bg-text-muted/15', text: 'text-text-muted', label: 'DRAW' },
    abandoned: { bg: 'bg-text-muted/15', text: 'text-text-muted', label: 'ABND' },
  }
  const style = map[result]
  const sign = lp > 0 ? '+' : ''
  return (
    <div className="flex flex-col items-end gap-1">
      <span className={`rounded-md px-2 py-0.5 font-mono text-[10px] font-bold ${style.bg} ${style.text}`}>{style.label}</span>
      <span className={`font-mono text-[11px] font-semibold ${style.text}`}>{sign}{lp} LP</span>
    </div>
  )
}

function ModeBadge({ mode }: { mode: string }) {
  return (
    <span className="rounded-full border border-border bg-surface-2 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-text-secondary">
      {mode || '—'}
    </span>
  )
}

function formatDuration(sec: number): string {
  if (!sec || sec <= 0) return '—'
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function formatTimeAgo(iso: string): string {
  if (!iso) return '—'
  const ts = Date.parse(iso)
  if (Number.isNaN(ts)) return '—'
  const diffMs = Date.now() - ts
  const min = Math.floor(diffMs / 60_000)
  if (min < 1) return 'только что'
  if (min < 60) return `${min} мин назад`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h} ч назад`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d} д назад`
  return new Date(ts).toLocaleDateString('ru-RU')
}

function HistoryRow({ entry, onClick }: { entry: ArenaHistoryEntry; onClick: () => void }) {
  const initial = (entry.opponent_username || '?').charAt(0).toUpperCase()
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-3 border-b border-border px-4 py-3 text-left transition hover:bg-surface-3/40 last:border-b-0"
    >
      <span className={`h-10 w-1 shrink-0 rounded-full ${entry.result === 'win' ? 'bg-success' : entry.result === 'loss' ? 'bg-danger' : 'bg-text-muted'}`} />
      <Avatar
        size="md"
        gradient={entry.result === 'win' ? 'success-cyan' : 'pink-red'}
        initials={initial}
        className="!w-9 !h-9"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="max-w-full truncate text-sm font-semibold text-text-primary">@{entry.opponent_username || 'unknown'}</span>
          <ModeBadge mode={entry.mode} />
          <span className="font-mono text-[10px] uppercase text-text-muted">{entry.section}</span>
        </div>
        <div className="flex items-center gap-3 font-mono text-[11px] text-text-muted">
          <span>{formatTimeAgo(entry.finished_at)}</span>
          <span>•</span>
          <span>{formatDuration(entry.duration_seconds)}</span>
        </div>
      </div>
      <ResultPill result={entry.result} lp={entry.lp_change} />
    </button>
  )
}

function SkeletonRow() {
  return (
    <div className="flex animate-pulse items-center gap-3 border-b border-border px-4 py-3 last:border-b-0">
      <span className="h-10 w-1 rounded-full bg-surface-3" />
      <div className="h-9 w-9 rounded-full bg-surface-3" />
      <div className="flex flex-1 flex-col gap-2">
        <div className="h-3 w-32 rounded bg-surface-3" />
        <div className="h-2 w-20 rounded bg-surface-3" />
      </div>
      <div className="h-8 w-12 rounded bg-surface-3" />
    </div>
  )
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={
        active
          ? 'rounded-full border border-accent bg-accent/15 px-3 py-1.5 text-xs font-semibold text-accent-hover'
          : 'rounded-full border border-border bg-surface-2 px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary'
      }
    >
      {children}
    </button>
  )
}

export default function MatchHistoryPage() {
  const navigate = useNavigate()
  const [mode, setMode] = useState<string>('')
  const [section, setSection] = useState<string>('')
  const [limit, setLimit] = useState<number>(20)
  const [page, setPage] = useState<number>(0)

  const offset = page * limit
  const { data, isLoading, isError, refetch, isFetching } = useArenaHistoryQuery({ mode, section, limit, offset })

  const items = data?.items ?? []
  const total = data?.total ?? 0
  const totalPages = useMemo(() => (total > 0 ? Math.ceil(total / limit) : 0), [total, limit])

  // Reset offset when filters change so the user doesn't end up on a page
  // that doesn't exist under the new filter.
  function applyFilter<T>(setter: (v: T) => void) {
    return (v: T) => {
      setter(v)
      setPage(0)
    }
  }

  const wins = items.filter((i) => i.result === 'win').length
  const losses = items.filter((i) => i.result === 'loss').length

  return (
    <AppShellV2>
      <div className="flex flex-col gap-6 px-4 py-6 sm:px-8 lg:px-20 lg:py-8">
        <div className="flex flex-col gap-3">
          <h1 className="font-display text-2xl lg:text-[32px] font-bold leading-[1.1] text-text-primary">История матчей</h1>
          <p className="text-sm text-text-secondary">
            Всего: <span className="font-semibold text-text-primary">{total}</span>
            {items.length > 0 && (
              <span> · на странице: {wins} побед / {losses} поражений</span>
            )}
          </p>
          {isError && <ErrorChip onRetry={() => refetch()} />}
        </div>

        <div className="flex flex-col gap-3 rounded-2xl border border-border bg-surface-2 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[10px] uppercase text-text-muted">Mode</span>
            {MODES.map((m) => (
              <FilterChip key={m.value || 'all'} active={mode === m.value} onClick={() => applyFilter(setMode)(m.value)}>
                {m.label}
              </FilterChip>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[10px] uppercase text-text-muted">Section</span>
            {SECTIONS.map((s) => (
              <FilterChip key={s.value || 'all'} active={section === s.value} onClick={() => applyFilter(setSection)(s.value)}>
                {s.label}
              </FilterChip>
            ))}
          </div>
        </div>

        <div className="flex flex-col overflow-hidden rounded-2xl border border-border bg-surface-2">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <span className="font-display text-sm font-bold text-text-primary">Матчи</span>
            <span className="font-mono text-[11px] text-text-muted">
              {isFetching ? 'обновление…' : `страница ${totalPages === 0 ? 0 : page + 1} из ${totalPages || 1}`}
            </span>
          </div>

          {isLoading ? (
            <div className="flex flex-col">
              {Array.from({ length: 6 }).map((_, i) => <SkeletonRow key={i} />)}
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center gap-3 px-4 py-12 text-center">
              <p className="text-sm text-text-secondary">Ещё не было матчей под этим фильтром.</p>
              <button
                onClick={() => navigate('/arena')}
                className="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-hover"
              >
                В арену
              </button>
            </div>
          ) : (
            <div className="flex flex-col">
              {items.map((entry) => (
                <HistoryRow
                  key={entry.match_id}
                  entry={entry}
                  onClick={() => navigate(`/arena/match/${entry.match_id}`)}
                />
              ))}
            </div>
          )}

          <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] uppercase text-text-muted">на странице</span>
              {PAGE_SIZES.map((sz) => (
                <FilterChip key={sz} active={limit === sz} onClick={() => { setLimit(sz); setPage(0) }}>
                  {sz}
                </FilterChip>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0 || isFetching}
                className="rounded-md border border-border bg-surface-1 px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary disabled:opacity-40"
              >
                ← Назад
              </button>
              <button
                onClick={() => setPage((p) => p + 1)}
                disabled={(page + 1) * limit >= total || isFetching}
                className="rounded-md border border-border bg-surface-1 px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary disabled:opacity-40"
              >
                Вперёд →
              </button>
            </div>
          </div>
        </div>
      </div>
    </AppShellV2>
  )
}
