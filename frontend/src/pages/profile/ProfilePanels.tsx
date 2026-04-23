import { Trophy, Shield } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button } from '../../components/Button'
import { Card } from '../../components/Card'
import { Avatar } from '../../components/Avatar'
import { cn } from '../../lib/cn'
import { type Profile } from '../../lib/queries/profile'
import { useRatingMeQuery } from '../../lib/queries/rating'
import { useAchievementsQuery, isUnlocked } from '../../lib/queries/achievements'
import { useArenaHistoryQuery } from '../../lib/queries/matches'
import { useMyGuildQuery } from '../../lib/queries/guild'
import { humanizeSection } from '../../lib/labels'
import { fmtDate, fmtDateTime } from './dateHelpers'

export function MatchesPanel() {
  const { data, isLoading, isError, refetch } = useArenaHistoryQuery({ limit: 10 })
  const items = data?.items ?? []
  if (isLoading) {
    return (
      <Card className="flex-col gap-2 p-5" interactive={false}>
        <div className="h-4 w-1/3 animate-pulse rounded bg-surface-3" />
        <div className="h-4 w-2/3 animate-pulse rounded bg-surface-3" />
      </Card>
    )
  }
  if (isError) {
    return (
      <Card className="flex-col items-start gap-3 p-5" interactive={false}>
        <p className="text-sm text-danger">Не удалось загрузить историю матчей.</p>
        <Button size="sm" onClick={() => refetch()}>Повторить</Button>
      </Card>
    )
  }
  if (items.length === 0) {
    return (
      <Card className="flex-col gap-2 p-5" interactive={false}>
        <p className="text-sm text-text-secondary">Ещё нет завершённых матчей. Сыграй на /arena.</p>
      </Card>
    )
  }
  return (
    <Card className="flex-col gap-0 overflow-hidden p-0" interactive={false}>
      <div className="border-b border-border p-5">
        <h3 className="font-display text-base font-bold text-text-primary">Последние 10 матчей</h3>
      </div>
      <div className="divide-y divide-border">
        {items.map((m) => {
          const positive = m.lp_change > 0
          const resultColor =
            m.result === 'win' ? 'text-success' : m.result === 'loss' ? 'text-danger' : 'text-text-muted'
          return (
            <div key={m.match_id} className="grid grid-cols-[1fr_120px_80px_60px] items-center gap-3 px-5 py-3 text-[13px]">
              <div className="flex min-w-0 items-center gap-3">
                <Avatar size="sm" gradient="violet-cyan" initials={(m.opponent_username || '?').charAt(0).toUpperCase()} />
                <div className="flex min-w-0 flex-col">
                  <span className="truncate font-semibold text-text-primary">@{m.opponent_username || 'unknown'}</span>
                  <span className="font-mono text-[11px] text-text-muted">
                    {humanizeSection(m.section)} · {m.mode}
                  </span>
                </div>
              </div>
              <span className="font-mono text-[11px] text-text-muted">
                {fmtDateTime(m.finished_at)}
              </span>
              <span className={cn('font-mono text-[12px] font-bold uppercase', resultColor)}>{m.result}</span>
              <span className={cn('text-right font-mono text-[12px] font-semibold', positive ? 'text-success' : 'text-danger')}>
                {positive ? '+' : ''}{m.lp_change}
              </span>
            </div>
          )
        })}
      </div>
    </Card>
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
          Ещё ничего не разблокировано. Открой <Link className="text-cyan hover:underline" to="/achievements">все ачивки</Link>, чтобы увидеть условия получения.
        </p>
      </Card>
    )
  }
  return (
    <Card className="flex-col gap-3 p-5" interactive={false}>
      <div className="flex items-center justify-between">
        <h3 className="font-display text-base font-bold text-text-primary">Разблокированные ачивки</h3>
        <Link to="/achievements" className="font-mono text-[11px] text-cyan hover:underline">Все ›</Link>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
        {unlocked.map((a) => (
          <div
            key={a.code}
            className={cn(
              'flex flex-col gap-2 rounded-lg p-3',
              a.tier === 'legendary'
                ? 'bg-gradient-to-br from-warn to-pink'
                : a.tier === 'rare'
                  ? 'bg-gradient-to-br from-cyan to-accent'
                  : 'bg-surface-2',
            )}
          >
            <Trophy className="h-5 w-5 text-white" />
            <span className="font-display text-[13px] font-bold text-white">{a.title}</span>
            <span className="line-clamp-2 font-mono text-[10px] text-white/80">{a.description}</span>
            {a.unlocked_at && (
              <span className="font-mono text-[10px] text-white/60">
                {fmtDate(a.unlocked_at)}
              </span>
            )}
          </div>
        ))}
      </div>
    </Card>
  )
}

export function GuildsPanel() {
  const { data: guild, isLoading, isError, refetch } = useMyGuildQuery()
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
        <p className="text-sm text-danger">Не удалось загрузить гильдию.</p>
        <Button size="sm" onClick={() => refetch()}>Повторить</Button>
      </Card>
    )
  }
  if (!guild) {
    return (
      <Card className="flex-col items-start gap-3 p-5" interactive={false}>
        <p className="text-sm text-text-secondary">Ты пока без гильдии.</p>
        <Link to="/guild"><Button size="sm">Найти гильдию</Button></Link>
      </Card>
    )
  }
  return (
    <Card className="flex-col gap-3 p-5" interactive={false}>
      <div className="flex items-center gap-3">
        <Shield className="h-6 w-6 text-cyan" />
        <div className="flex flex-col">
          <h3 className="font-display text-lg font-bold text-text-primary">{guild.name}</h3>
          <span className="font-mono text-[11px] text-text-muted">
            {(guild.members?.length ?? 0)} участников · ELO {guild.guild_elo}
          </span>
        </div>
      </div>
      <Link to="/guild" className="font-mono text-[12px] text-cyan hover:underline">
        Открыть страницу гильдии ›
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
