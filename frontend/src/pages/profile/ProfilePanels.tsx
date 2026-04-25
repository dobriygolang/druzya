import { useState, useMemo } from 'react'
import { Trophy, Shield } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { Button } from '../../components/Button'
import { Card } from '../../components/Card'
import { Avatar } from '../../components/Avatar'
import { cn } from '../../lib/cn'
import { type Profile } from '../../lib/queries/profile'
import { useRatingMeQuery } from '../../lib/queries/rating'
import { useAchievementsQuery, isUnlocked } from '../../lib/queries/achievements'
import { useArenaHistoryQuery } from '../../lib/queries/matches'
import { useMyCohortQuery } from '../../lib/queries/cohort'
import { humanizeSection } from '../../lib/labels'
import { fmtDate } from './dateHelpers'

// Phase-4 ADR-001: standalone /history page deleted; its filters +
// pagination + full UX moved here so all match history lives inside the
// profile shell. The previous "last 10" preview is replaced with the
// full filterable list — single canonical surface.
const HISTORY_MODES: { value: string; label: string }[] = [
  { value: '', label: 'Все режимы' },
  { value: 'solo_1v1', label: '1v1' },
  { value: 'duo_2v2', label: '2v2' },
  { value: 'ranked', label: 'Ranked' },
  { value: 'hardcore', label: 'Hardcore' },
  { value: 'cursed', label: 'Cursed' },
]
const HISTORY_SECTIONS: { value: string; label: string }[] = [
  { value: '', label: 'Все секции' },
  { value: 'algorithms', label: 'Algorithms' },
  { value: 'sql', label: 'SQL' },
  { value: 'go', label: 'Go' },
  { value: 'system_design', label: 'System Design' },
  { value: 'behavioral', label: 'Behavioral' },
]
const HISTORY_PAGE_SIZES = [10, 20, 50]

function HistoryFilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={
        active
          ? 'rounded-full border border-text-primary bg-text-primary/10 px-3 py-1.5 text-xs font-medium text-text-primary'
          : 'rounded-full border border-border bg-surface-2 px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary'
      }
    >
      {children}
    </button>
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

export function MatchesPanel() {
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

  function applyFilter<T>(setter: (v: T) => void) {
    return (v: T) => {
      setter(v)
      setPage(0)
    }
  }

  const wins = items.filter((i) => i.result === 'win').length
  const losses = items.filter((i) => i.result === 'loss').length

  if (isError) {
    return (
      <Card className="flex-col items-start gap-3 p-5" interactive={false}>
        <p className="text-sm text-danger">Не удалось загрузить историю матчей.</p>
        <Button size="sm" onClick={() => refetch()}>Повторить</Button>
      </Card>
    )
  }
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm text-text-secondary">
          Всего: <span className="font-semibold text-text-primary">{total}</span>
          {items.length > 0 && (
            <span> · на странице: {wins} побед / {losses} поражений</span>
          )}
        </p>
        {isFetching && !isLoading && (
          <span className="font-mono text-[11px] text-text-muted">обновление…</span>
        )}
      </div>

      <Card className="flex-col gap-3 p-4" interactive={false}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-muted">Mode</span>
          {HISTORY_MODES.map((m) => (
            <HistoryFilterChip key={m.value || 'all'} active={mode === m.value} onClick={() => applyFilter(setMode)(m.value)}>
              {m.label}
            </HistoryFilterChip>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-muted">Section</span>
          {HISTORY_SECTIONS.map((s) => (
            <HistoryFilterChip key={s.value || 'all'} active={section === s.value} onClick={() => applyFilter(setSection)(s.value)}>
              {s.label}
            </HistoryFilterChip>
          ))}
        </div>
      </Card>

      <Card className="flex-col gap-0 overflow-hidden p-0" interactive={false}>
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h3 className="font-display text-base font-bold text-text-primary">Матчи</h3>
          <span className="font-mono text-[11px] text-text-muted">
            {totalPages === 0 ? 'нет матчей' : `страница ${page + 1} из ${totalPages}`}
          </span>
        </div>

        {isLoading ? (
          <div className="flex flex-col">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex animate-pulse items-center gap-3 border-b border-border px-5 py-3 last:border-b-0">
                <span className="h-9 w-1 rounded-full bg-surface-3" />
                <div className="h-9 w-9 rounded-full bg-surface-3" />
                <div className="flex flex-1 flex-col gap-2">
                  <div className="h-3 w-32 rounded bg-surface-3" />
                  <div className="h-2 w-20 rounded bg-surface-3" />
                </div>
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-4 py-12 text-center">
            <p className="text-sm text-text-secondary">Ещё не было матчей под этим фильтром.</p>
            <Link to="/arena">
              <Button size="sm">В арену</Button>
            </Link>
          </div>
        ) : (
          <div className="flex flex-col">
            {items.map((m) => {
              const positive = m.lp_change > 0
              const resultColor =
                m.result === 'win'
                  ? 'text-success'
                  : m.result === 'loss'
                    ? 'text-danger'
                    : 'text-text-muted'
              const initial = (m.opponent_username || '?').charAt(0).toUpperCase()
              const sign = positive ? '+' : ''
              return (
                <button
                  key={m.match_id}
                  onClick={() => navigate(`/arena/match/${m.match_id}`)}
                  className="flex w-full items-center gap-3 border-b border-border px-5 py-3 text-left transition-colors last:border-b-0 hover:bg-surface-2"
                >
                  <span
                    className={cn(
                      'h-9 w-1 shrink-0 rounded-full',
                      m.result === 'win' ? 'bg-success' : m.result === 'loss' ? 'bg-danger' : 'bg-text-muted',
                    )}
                  />
                  <Avatar size="sm" gradient="violet-cyan" initials={initial} />
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="max-w-full truncate text-sm font-semibold text-text-primary">
                        @{m.opponent_username || 'unknown'}
                      </span>
                      <span className="rounded-full border border-border bg-surface-2 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-text-secondary">
                        {m.mode || '—'}
                      </span>
                      <span className="font-mono text-[10px] uppercase text-text-muted">
                        {humanizeSection(m.section)}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 font-mono text-[11px] text-text-muted">
                      <span>{formatTimeAgo(m.finished_at)}</span>
                      <span>•</span>
                      <span>{formatDuration(m.duration_seconds)}</span>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className={cn('font-mono text-[10px] font-bold uppercase', resultColor)}>
                      {m.result}
                    </span>
                    <span className={cn('font-mono text-[11px] font-semibold', positive ? 'text-success' : 'text-danger')}>
                      {sign}{m.lp_change} LP
                    </span>
                  </div>
                </button>
              )
            })}
          </div>
        )}

        <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-3">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-muted">на странице</span>
            {HISTORY_PAGE_SIZES.map((sz) => (
              <HistoryFilterChip key={sz} active={limit === sz} onClick={() => { setLimit(sz); setPage(0) }}>
                {sz}
              </HistoryFilterChip>
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
      </Card>
    </div>
  )
}

export function AchievementsPanel() {
  const { data, isLoading, isError, refetch } = useAchievementsQuery()
  const unlocked = (data ?? []).filter(isUnlocked)
  if (isLoading) {
    return (
      <Card className="flex-col gap-2 p-5" interactive={false}>
        <div className="h-4 w-1/3 animate-pulse rounded bg-surface-3" />
      </Card>
    )
  }
  if (isError) {
    return (
      <Card className="flex-col items-start gap-3 p-5" interactive={false}>
        <p className="text-sm text-danger">Не удалось загрузить ачивки.</p>
        <Button size="sm" onClick={() => refetch()}>Повторить</Button>
      </Card>
    )
  }
  if (unlocked.length === 0) {
    return (
      <Card className="flex-col gap-2 p-5" interactive={false}>
        <p className="text-sm text-text-secondary">
          Ещё ничего не разблокировано. Открой <Link className="text-text-primary hover:underline" to="/achievements">все ачивки</Link>, чтобы увидеть условия получения.
        </p>
      </Card>
    )
  }
  return (
    <Card className="flex-col gap-3 p-5" interactive={false}>
      <div className="flex items-center justify-between">
        <h3 className="font-display text-base font-bold text-text-primary">Разблокированные ачивки</h3>
        <Link to="/achievements" className="font-mono text-[11px] text-text-primary hover:underline">Все ›</Link>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
        {unlocked.map((a) => (
          <div
            key={a.code}
            className={cn(
              'flex flex-col gap-2 rounded-lg p-3',
              a.tier === 'legendary'
                ? 'bg-surface-2 border border-text-primary'
                : a.tier === 'rare'
                  ? 'bg-surface-2 border border-border-strong'
                  : 'bg-surface-2 border border-border',
            )}
          >
            <Trophy className="h-5 w-5 text-text-primary" />
            <span className="font-display text-[13px] font-bold text-text-primary">{a.title}</span>
            <span className="line-clamp-2 font-mono text-[10px] text-text-secondary">{a.description}</span>
            {a.unlocked_at && (
              <span className="font-mono text-[10px] text-text-muted">
                {fmtDate(a.unlocked_at)}
              </span>
            )}
          </div>
        ))}
      </div>
    </Card>
  )
}

export function CohortsPanel() {
  const { data: cohort, isLoading, isError, refetch } = useMyCohortQuery()
  if (isLoading) {
    return (
      <Card className="flex-col gap-2 p-5" interactive={false}>
        <div className="h-4 w-1/3 animate-pulse rounded bg-surface-3" />
      </Card>
    )
  }
  if (isError) {
    return (
      <Card className="flex-col items-start gap-3 p-5" interactive={false}>
        <p className="text-sm text-danger">Не удалось загрузить circle.</p>
        <Button size="sm" onClick={() => refetch()}>Повторить</Button>
      </Card>
    )
  }
  if (!cohort) {
    return (
      <Card className="flex-col items-start gap-3 p-5" interactive={false}>
        <p className="text-sm text-text-secondary">Ты пока без circle.</p>
        <Link to="/cohort"><Button size="sm">Найти circle</Button></Link>
      </Card>
    )
  }
  return (
    <Card className="flex-col gap-3 p-5" interactive={false}>
      <div className="flex items-center gap-3">
        <Shield className="h-6 w-6 text-text-primary" />
        <div className="flex flex-col">
          <h3 className="font-display text-lg font-bold text-text-primary">{cohort.name}</h3>
          <span className="font-mono text-[11px] text-text-muted">
            {(cohort.members?.length ?? 0)} участников · ELO {cohort.cohort_elo}
          </span>
        </div>
      </div>
      <Link to="/cohort" className="font-mono text-[12px] text-text-primary hover:underline">
        Открыть страницу circle ›
      </Link>
    </Card>
  )
}

export function StatsPanel({ ownProfile }: { ownProfile?: Profile }) {
  const { data: rating, isLoading } = useRatingMeQuery()
  if (isLoading) {
    return (
      <Card className="flex-col gap-2 p-5" interactive={false}>
        <div className="h-4 w-1/3 animate-pulse rounded bg-surface-3" />
      </Card>
    )
  }
  const ratings = rating?.ratings ?? []
  return (
    <div className="flex flex-col gap-4">
      <Card className="flex-col gap-3 p-5" interactive={false}>
        <h3 className="font-display text-base font-bold text-text-primary">Сводка</h3>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCell label="Global Score" value={String(rating?.global_power_score ?? 0)} />
          <StatCell label="Уровень" value={String(ownProfile?.level ?? 0)} />
          <StatCell label="XP" value={String(ownProfile?.xp ?? 0)} />
          <StatCell label="AI кредиты" value={String(ownProfile?.ai_credits ?? 0)} />
        </div>
      </Card>
      <Card className="flex-col gap-3 p-5" interactive={false}>
        <h3 className="font-display text-base font-bold text-text-primary">Рейтинг по секциям</h3>
        {ratings.length === 0 ? (
          <p className="text-[12px] text-text-muted">Ещё не сыграл ни одного матча.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            {ratings.map((r) => (
              <div key={r.section} className="flex flex-col gap-1 rounded-lg bg-surface-2 p-3">
                <span className="font-mono text-[10px] uppercase text-text-muted">{humanizeSection(r.section)}</span>
                <span className="font-display text-lg font-bold text-text-primary">{r.elo}</span>
                <span className="font-mono text-[11px] text-text-muted">{r.matches_count} матчей</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg bg-surface-2 p-3">
      <span className="font-mono text-[10px] uppercase text-text-muted">{label}</span>
      <span className="font-display text-xl font-bold text-text-primary">{value}</span>
    </div>
  )
}
