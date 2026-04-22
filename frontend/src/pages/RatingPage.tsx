// /rating — Phase 2 leaderboard page.
//
// Reads:
//   - useMyRatingsQuery → /api/v1/rating/me  (rank/lp/league for current user)
//   - useLeaderboardQuery({section, mode}) → /api/v1/rating/leaderboard
//
// Filter chips drive URL search params (`?section=...&mode=...`) so the
// view is shareable and back-button friendly. Loading/empty/error states
// mirror the bible's defaults — skeleton table, friendly empty text, and
// a retry-on-error chip.

import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Trophy, RefreshCw } from 'lucide-react'
import { AppShellV2 } from '../components/AppShell'
import { Card } from '../components/Card'
import { Button } from '../components/Button'
import { cn } from '../lib/cn'
import {
  useLeaderboardQuery,
  useMyRatingsQuery,
  type SectionKey,
  type ModeKey,
} from '../lib/queries/rating'

const SECTIONS: { key: SectionKey; label: string }[] = [
  { key: 'algorithms', label: 'Алгоритмы' },
  { key: 'sql', label: 'SQL' },
  { key: 'go', label: 'Go' },
  { key: 'system_design', label: 'System Design' },
  { key: 'behavioral', label: 'Behavioral' },
]

const MODES: { key: ModeKey; label: string }[] = [
  { key: 'all', label: 'Все' },
  { key: 'solo_1v1', label: 'Solo 1v1' },
  { key: 'ranked', label: 'Ranked' },
  { key: 'hardcore', label: 'Hardcore' },
  { key: 'cursed', label: 'Cursed' },
]

function deriveLeague(elo: number): string {
  if (elo >= 2200) return 'Master'
  if (elo >= 1900) return 'Diamond'
  if (elo >= 1600) return 'Platinum'
  if (elo >= 1300) return 'Gold'
  if (elo >= 1000) return 'Silver'
  return 'Bronze'
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-full border px-3 py-1.5 text-[12px] font-semibold transition-colors',
        active
          ? 'border-accent bg-accent/20 text-text-primary shadow-glow'
          : 'border-border bg-surface-2 text-text-muted hover:border-border-strong hover:text-text-secondary',
      )}
    >
      {children}
    </button>
  )
}

function MeHeader({ section }: { section: SectionKey }) {
  const meQ = useMyRatingsQuery()
  const me = meQ.data
  const sectionRating = me?.ratings.find((r) => r.section === section)
  const elo = sectionRating?.elo ?? 0
  const matches = sectionRating?.matches_count ?? 0
  const decaying = sectionRating?.decaying ?? false

  return (
    <Card className="flex-col gap-3 p-5" interactive={false}>
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-1">
          <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-text-muted">
            Твой рейтинг
          </span>
          <h2 className="font-display text-2xl font-bold text-text-primary">
            {meQ.isLoading ? '—' : `${elo} LP`}
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-warn/15 px-3 py-1 font-mono text-[11px] font-bold uppercase text-warn">
            {deriveLeague(elo)}
          </span>
          {decaying && (
            <span className="rounded-full bg-danger/15 px-3 py-1 font-mono text-[11px] font-bold uppercase text-danger">
              decaying
            </span>
          )}
        </div>
      </div>
      <div className="flex flex-wrap gap-4 text-[12px] text-text-muted">
        <span>
          Матчей: <strong className="text-text-secondary">{matches}</strong>
        </span>
        <span>
          Global Score:{' '}
          <strong className="text-text-secondary">
            {meQ.isLoading ? '—' : me?.global_power_score ?? 0}
          </strong>
        </span>
      </div>
    </Card>
  )
}

function SkeletonRow({ i }: { i: number }) {
  return (
    <tr className="border-b border-border">
      <td className="px-3 py-3">
        <div className="h-4 w-6 animate-pulse rounded bg-surface-2" />
      </td>
      <td className="px-3 py-3">
        <div className="h-4 w-32 animate-pulse rounded bg-surface-2" />
      </td>
      <td className="px-3 py-3">
        <div className="h-4 w-12 animate-pulse rounded bg-surface-2" />
      </td>
      <td className="px-3 py-3">
        <div className="h-4 w-16 animate-pulse rounded bg-surface-2" />
      </td>
      <td className="hidden px-3 py-3 sm:table-cell">
        <div className="h-4 w-12 animate-pulse rounded bg-surface-2" />
      </td>
      {/* useless ref to i for stable key */}
      <td className="hidden">{i}</td>
    </tr>
  )
}

function LeaderboardTable({
  section,
  mode,
}: {
  section: SectionKey
  mode: ModeKey
}) {
  const lbQ = useLeaderboardQuery({ section, mode, limit: 100 })

  if (lbQ.isError) {
    return (
      <Card className="flex-col items-center gap-3 p-8 text-center" interactive={false}>
        <span className="text-[14px] text-danger">Не удалось загрузить рейтинг.</span>
        <Button
          variant="ghost"
          size="sm"
          icon={<RefreshCw className="h-3.5 w-3.5" />}
          onClick={() => lbQ.refetch()}
        >
          Повторить
        </Button>
      </Card>
    )
  }

  const entries = lbQ.data?.entries ?? []

  if (!lbQ.isLoading && entries.length === 0) {
    return (
      <Card className="flex-col items-center gap-2 p-10 text-center" interactive={false}>
        <Trophy className="h-10 w-10 text-text-muted" />
        <h3 className="font-display text-lg font-bold text-text-primary">
          Сезон только начался
        </h3>
        <p className="max-w-[420px] text-[13px] text-text-muted">
          Рейтинг копится — возвращайся через час, или сыграй матч сам, чтобы
          попасть в таблицу первым.
        </p>
      </Card>
    )
  }

  return (
    <Card className="flex-col gap-0 overflow-hidden p-0" interactive={false}>
      <table className="w-full text-left text-[13px]">
        <thead className="border-b border-border bg-surface-2 font-mono text-[11px] uppercase tracking-[0.08em] text-text-muted">
          <tr>
            <th className="px-3 py-3">#</th>
            <th className="px-3 py-3">Игрок</th>
            <th className="px-3 py-3">LP</th>
            <th className="px-3 py-3">Лига</th>
            <th className="hidden px-3 py-3 sm:table-cell">Титул</th>
          </tr>
        </thead>
        <tbody>
          {lbQ.isLoading
            ? Array.from({ length: 10 }).map((_, i) => <SkeletonRow key={i} i={i} />)
            : entries.map((e) => (
                <tr key={e.user_id} className="border-b border-border last:border-b-0 hover:bg-surface-2/40">
                  <td className="px-3 py-3 font-mono text-[12px] font-bold text-text-secondary">
                    {e.rank}
                  </td>
                  <td className="px-3 py-3 font-semibold text-text-primary">{e.username}</td>
                  <td className="px-3 py-3 font-mono text-text-primary">{e.elo}</td>
                  <td className="px-3 py-3">
                    <span className="rounded-full bg-warn/15 px-2 py-0.5 font-mono text-[10px] font-bold uppercase text-warn">
                      {deriveLeague(e.elo)}
                    </span>
                  </td>
                  <td className="hidden px-3 py-3 text-[12px] text-text-muted sm:table-cell">
                    {e.title || '—'}
                  </td>
                </tr>
              ))}
        </tbody>
      </table>
    </Card>
  )
}

export default function RatingPage() {
  const [params, setParams] = useSearchParams()

  const section = useMemo<SectionKey>(() => {
    const s = params.get('section') as SectionKey | null
    return s && SECTIONS.some((x) => x.key === s) ? s : 'algorithms'
  }, [params])

  const mode = useMemo<ModeKey>(() => {
    const m = params.get('mode') as ModeKey | null
    return m && MODES.some((x) => x.key === m) ? m : 'all'
  }, [params])

  const setFilter = (key: 'section' | 'mode', value: string) => {
    const next = new URLSearchParams(params)
    next.set(key, value)
    setParams(next, { replace: false })
  }

  return (
    <AppShellV2>
      <div className="flex flex-col gap-6 px-4 py-6 sm:px-8 lg:px-10 lg:py-8">
        <div className="flex items-center gap-3">
          <Trophy className="h-6 w-6 text-warn" />
          <h1 className="font-display text-2xl font-extrabold text-text-primary sm:text-3xl">
            Рейтинг
          </h1>
        </div>

        <MeHeader section={section} />

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-muted">
              Секция
            </span>
            <div className="flex flex-wrap gap-2">
              {SECTIONS.map((s) => (
                <Chip
                  key={s.key}
                  active={section === s.key}
                  onClick={() => setFilter('section', s.key)}
                >
                  {s.label}
                </Chip>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-muted">
              Режим
            </span>
            <div className="flex flex-wrap gap-2">
              {MODES.map((m) => (
                <Chip key={m.key} active={mode === m.key} onClick={() => setFilter('mode', m.key)}>
                  {m.label}
                </Chip>
              ))}
            </div>
          </div>
        </div>

        <LeaderboardTable section={section} mode={mode} />
      </div>
    </AppShellV2>
  )
}
