// /guild — Phase 4-B guild page.
//
// Three layout modes driven by the route + query state:
//
//   1. /guild and the user IS in a guild  → detail view of MY guild
//   2. /guild and the user is NOT in any  → top-guilds leaderboard
//   3. /guild/:guildId                    → public detail of THAT guild
//
// Reads:
//   - useMyGuildQuery()    /api/v1/guild/my   (returns null on 404)
//   - useGuildQuery(id)    /api/v1/guild/{id}
//   - useGuildWarQuery(id) /api/v1/guild/{id}/war
//   - useTopGuildsQuery(n) /api/v1/guilds/top?limit=n
//
// Loading/empty/error states mirror the bible defaults — skeleton sections,
// friendly empty copy, and a retry button on hard errors.
// TODO i18n

import { useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Shield, Trophy, Users, Crown, RefreshCw, ArrowRight } from 'lucide-react'
import { AppShellV2 } from '../components/AppShell'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { Avatar } from '../components/Avatar'
import {
  useMyGuildQuery,
  useGuildQuery,
  useGuildWarQuery,
  useTopGuildsQuery,
  type Guild,
  type TopGuildSummary,
} from '../lib/queries/guild'

// ── helpers ───────────────────────────────────────────────────────────────

function tierFor(elo: number): string {
  if (elo >= 2200) return 'Master'
  if (elo >= 1900) return 'Diamond'
  if (elo >= 1600) return 'Platinum'
  if (elo >= 1300) return 'Gold'
  return 'Silver'
}

function roleLabel(role: string): string {
  if (role === 'captain') return 'Лидер'
  if (role === 'officer') return 'Офицер'
  return 'Игрок'
}

function roleChip(role: string) {
  if (role === 'captain') return 'bg-warn/15 text-warn'
  if (role === 'officer') return 'bg-cyan/15 text-cyan'
  return 'bg-border-strong text-text-muted'
}

// ── shared sub-views ──────────────────────────────────────────────────────

function GuildBanner({ guild, rank }: { guild: Guild; rank?: number }) {
  return (
    <div
      className="flex h-auto flex-col items-start justify-between gap-4 px-4 py-6 sm:px-8 lg:h-[200px] lg:flex-row lg:items-center lg:gap-0 lg:px-20 lg:py-0"
      style={{ background: 'linear-gradient(135deg, #2D1B4D 0%, #582CFF 100%)' }}
    >
      <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:gap-6">
        <div
          className="grid h-24 w-24 place-items-center"
          style={{
            borderRadius: 18,
            background: 'linear-gradient(135deg, #22D3EE 0%, #582CFF 100%)',
          }}
        >
          <Shield className="h-12 w-12 text-text-primary" />
        </div>
        <div className="flex flex-col gap-1.5">
          {rank ? (
            <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-warn/20 px-2.5 py-1 font-mono text-[11px] font-semibold tracking-[0.08em] text-warn">
              {tierFor(guild.guild_elo).toUpperCase()} TIER · #{rank} GLOBAL
            </span>
          ) : null}
          <h1 className="font-display text-3xl font-extrabold leading-[1.05] text-text-primary sm:text-4xl lg:text-[36px]">
            {guild.name}
          </h1>
          <p className="text-sm text-text-secondary">
            {(guild.members?.length ?? 0)} участников · guild ELO {guild.guild_elo}
          </p>
          <div className="mt-2 flex gap-6">
            <div className="flex flex-col">
              <span className="font-display text-lg font-bold text-text-primary">{guild.guild_elo}</span>
              <span className="text-[11px] text-text-muted">guild ELO</span>
            </div>
            <div className="flex flex-col">
              <span className="font-display text-lg font-bold text-cyan">
                {guild.members?.length ?? 0}
              </span>
              <span className="text-[11px] text-text-muted">участников</span>
            </div>
            <div className="flex flex-col">
              <span className="font-display text-lg font-bold text-warn">
                {guild.current_war_id ? '1' : '0'}
              </span>
              <span className="text-[11px] text-text-muted">активных войн</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function MembersList({ members }: { members: Guild['members'] }) {
  if (!members || members.length === 0) {
    return (
      <Card className="flex-col gap-2 p-5">
        <h3 className="font-display text-base font-bold text-text-primary">Участники</h3>
        <p className="text-sm text-text-secondary">Пока никого нет.</p>
      </Card>
    )
  }
  return (
    <Card className="flex-1 flex-col p-0">
      <div className="flex items-center justify-between border-b border-border p-5">
        <h3 className="font-display text-base font-bold text-text-primary">
          Участники ({members.length})
        </h3>
      </div>
      <div className="hidden grid-cols-[2fr_1fr_1fr_40px] gap-4 border-b border-border px-5 py-3 font-mono text-[11px] font-semibold tracking-[0.08em] text-text-muted lg:grid">
        <span>ИГРОК</span>
        <span>РОЛЬ</span>
        <span>СЕКЦИЯ</span>
        <span />
      </div>
      {members.map((m) => (
        <div
          key={m.user_id}
          className="flex flex-col gap-3 border-b border-border px-5 py-3 lg:grid lg:grid-cols-[2fr_1fr_1fr_40px] lg:items-center lg:gap-4"
        >
          <div className="flex items-center gap-3">
            <Avatar size="md" gradient="violet-cyan" initials={m.username[0]?.toUpperCase()} />
            <div className="flex flex-col">
              <span className="text-sm font-semibold text-text-primary">@{m.username}</span>
              <span className="font-mono text-[11px] text-text-muted">
                {m.role === 'captain' ? <Crown className="inline h-3 w-3 text-warn" /> : null}
                {' '}
                с{' '}
                {m.joined_at
                  ? new Date(m.joined_at).toLocaleDateString('ru-RU', {
                      day: '2-digit',
                      month: 'short',
                      year: 'numeric',
                    })
                  : '—'}
              </span>
            </div>
          </div>
          <div>
            <span
              className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${roleChip(m.role)}`}
            >
              {roleLabel(m.role)}
            </span>
          </div>
          <span className="text-sm text-text-secondary">
            {m.assigned_section ? m.assigned_section : '—'}
          </span>
          <span />
        </div>
      ))}
    </Card>
  )
}

function WarPanel({ guildId }: { guildId: string | undefined }) {
  const { data: war, isLoading } = useGuildWarQuery(guildId)
  if (isLoading) {
    return (
      <Card className="flex-col gap-3 p-5">
        <div className="h-4 w-1/3 animate-pulse rounded bg-surface-3" />
        <div className="h-2 w-full animate-pulse rounded-full bg-surface-3" />
      </Card>
    )
  }
  if (!war) {
    return (
      <Card className="flex-col gap-2 p-5">
        <h3 className="font-display text-base font-bold text-text-primary">Война недели</h3>
        <p className="text-sm text-text-secondary">Активной войны нет.</p>
      </Card>
    )
  }
  const scoreA = war.lines?.reduce((acc, l) => acc + l.score_a, 0) ?? 0
  const scoreB = war.lines?.reduce((acc, l) => acc + l.score_b, 0) ?? 0
  const total = scoreA + scoreB
  const pctA = total > 0 ? Math.round((scoreA / total) * 100) : 50
  return (
    <Card
      className="flex-col gap-3 border-accent/40 bg-gradient-to-br from-surface-3 to-accent p-5 shadow-glow"
      interactive={false}
    >
      <div className="flex items-center justify-between">
        <span className="font-mono text-[11px] font-semibold tracking-[0.08em] text-danger">
          АКТИВНАЯ ВОЙНА
        </span>
        <span className="font-mono text-[11px] text-text-secondary">
          {war.week_start} → {war.week_end}
        </span>
      </div>
      <h3 className="font-display text-lg font-bold text-text-primary">
        {war.guild_a?.name ?? '—'} vs {war.guild_b?.name ?? '—'}
      </h3>
      <div className="flex items-center gap-3">
        <span className="font-display text-[22px] font-bold text-success">{scoreA}</span>
        <div className="flex h-2 flex-1 overflow-hidden rounded-full bg-black/30">
          <div className="h-full bg-success" style={{ width: `${pctA}%` }} />
          <div className="h-full bg-danger" style={{ width: `${100 - pctA}%` }} />
        </div>
        <span className="font-display text-[22px] font-bold text-danger">{scoreB}</span>
      </div>
    </Card>
  )
}

// ── per-mode views ────────────────────────────────────────────────────────

function GuildDetail({ guild, isMine }: { guild: Guild; isMine: boolean }) {
  return (
    <>
      <GuildBanner guild={guild} />
      <div className="flex flex-col gap-4 px-4 pb-6 pt-6 sm:px-8 lg:flex-row lg:gap-6 lg:px-20 lg:pb-7">
        <div className="flex w-full flex-col gap-5 lg:w-[380px]">
          <WarPanel guildId={guild.id} />
          {!isMine ? (
            <Card className="flex-col gap-2 p-5">
              <h3 className="font-display text-base font-bold text-text-primary">Действия</h3>
              {/* TODO: join RPC not yet exposed — disabled placeholder */}
              <Button disabled>Запросить вход</Button>
              <p className="text-[11px] text-text-muted">Появится в следующей фазе.</p>
            </Card>
          ) : null}
        </div>
        <MembersList members={guild.members} />
      </div>
    </>
  )
}

function TopGuildsView() {
  const navigate = useNavigate()
  const { data, isLoading, isError, refetch } = useTopGuildsQuery(20)
  const items: TopGuildSummary[] = data?.items ?? []

  return (
    <>
      <div
        className="flex h-auto flex-col items-start justify-between gap-3 px-4 py-6 sm:px-8 lg:h-[160px] lg:flex-row lg:items-center lg:px-20 lg:py-0"
        style={{ background: 'linear-gradient(135deg, #2D1B4D 0%, #582CFF 100%)' }}
      >
        <div className="flex items-center gap-4">
          <Trophy className="h-10 w-10 text-warn" />
          <div className="flex flex-col">
            <h1 className="font-display text-3xl font-extrabold text-text-primary sm:text-4xl">
              Топ гильдий
            </h1>
            <p className="text-sm text-text-secondary">
              Глобальный рейтинг по очкам guild ELO.
            </p>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-4 px-4 pb-6 pt-6 sm:px-8 lg:px-20 lg:pb-7">
        {isLoading ? (
          <Card className="flex-col gap-3 p-5">
            <div className="h-4 w-2/3 animate-pulse rounded bg-surface-3" />
            <div className="h-4 w-1/2 animate-pulse rounded bg-surface-3" />
            <div className="h-4 w-1/3 animate-pulse rounded bg-surface-3" />
          </Card>
        ) : isError ? (
          <Card className="flex-col items-start gap-3 p-5">
            <p className="text-sm text-danger">Не удалось загрузить рейтинг.</p>
            <Button size="sm" onClick={() => refetch()}>
              <RefreshCw className="mr-2 h-3.5 w-3.5" /> Повторить
            </Button>
          </Card>
        ) : items.length === 0 ? (
          <Card className="flex-col gap-2 p-5">
            <Users className="h-5 w-5 text-text-muted" />
            <p className="text-sm text-text-secondary">Пока нет гильдий.</p>
          </Card>
        ) : (
          <Card className="flex-col p-0">
            <div className="hidden grid-cols-[60px_1fr_120px_120px_60px] gap-4 border-b border-border px-5 py-3 font-mono text-[11px] font-semibold tracking-[0.08em] text-text-muted lg:grid">
              <span>RANK</span>
              <span>ГИЛЬДИЯ</span>
              <span>УЧАСТНИКИ</span>
              <span>ELO</span>
              <span>WIN</span>
            </div>
            {items.map((g) => (
              <button
                key={g.guild_id}
                type="button"
                onClick={() => navigate(`/guild/${g.guild_id}`)}
                className="flex w-full flex-col gap-2 border-b border-border px-5 py-3 text-left transition-colors hover:bg-surface-2 lg:grid lg:grid-cols-[60px_1fr_120px_120px_60px] lg:items-center lg:gap-4"
              >
                <span className="font-display text-base font-bold text-warn">#{g.rank}</span>
                <div className="flex items-center gap-3">
                  <Shield className="h-5 w-5 text-cyan" />
                  <div className="flex flex-col">
                    <span className="text-sm font-semibold text-text-primary">{g.name}</span>
                    <span className="font-mono text-[11px] text-text-muted">{tierFor(g.elo_total)}</span>
                  </div>
                </div>
                <span className="text-sm text-text-secondary">{g.members_count}</span>
                <span className="font-mono text-sm font-semibold text-text-primary">{g.elo_total}</span>
                <span className="text-sm text-success">{g.wars_won}</span>
                <span className="hidden lg:block">
                  <ArrowRight className="h-4 w-4 text-text-muted" />
                </span>
              </button>
            ))}
          </Card>
        )}
      </div>
    </>
  )
}

// ── page ──────────────────────────────────────────────────────────────────

export default function GuildPage() {
  const { guildId } = useParams<{ guildId: string }>()
  const myGuildQuery = useMyGuildQuery()
  const explicitQuery = useGuildQuery(guildId)

  // The "active" guild — what we render in the detail layout — depends on
  // whether the URL pinned a specific guildId or not.
  const detailGuild = useMemo<Guild | null | undefined>(() => {
    if (guildId) return explicitQuery.data
    return myGuildQuery.data
  }, [guildId, explicitQuery.data, myGuildQuery.data])

  const isMine = !!myGuildQuery.data && detailGuild?.id === myGuildQuery.data.id
  const loading = guildId ? explicitQuery.isLoading : myGuildQuery.isLoading
  const errored = guildId ? explicitQuery.isError : myGuildQuery.isError

  if (loading) {
    return (
      <AppShellV2>
        <div className="px-4 pt-6 sm:px-8 lg:px-20">
          <Card className="flex-col gap-3 p-5">
            <div className="h-6 w-1/3 animate-pulse rounded bg-surface-3" />
            <div className="h-4 w-1/2 animate-pulse rounded bg-surface-3" />
            <div className="h-4 w-1/4 animate-pulse rounded bg-surface-3" />
          </Card>
        </div>
      </AppShellV2>
    )
  }

  if (errored) {
    return (
      <AppShellV2>
        <div className="px-4 pt-6 sm:px-8 lg:px-20">
          <Card className="flex-col items-start gap-3 p-5">
            <p className="text-sm text-danger">Не удалось загрузить гильдию.</p>
            <Button
              size="sm"
              onClick={() => (guildId ? explicitQuery.refetch() : myGuildQuery.refetch())}
            >
              <RefreshCw className="mr-2 h-3.5 w-3.5" /> Повторить
            </Button>
          </Card>
        </div>
      </AppShellV2>
    )
  }

  // /guild/:guildId — explicit lookup that returned no row → friendly empty.
  if (guildId && !detailGuild) {
    return (
      <AppShellV2>
        <div className="px-4 pt-6 sm:px-8 lg:px-20">
          <Card className="flex-col gap-2 p-5">
            <Shield className="h-5 w-5 text-text-muted" />
            <p className="text-sm text-text-secondary">Гильдия не найдена.</p>
          </Card>
        </div>
      </AppShellV2>
    )
  }

  // /guild without an id and the user has no guild → top-list.
  if (!guildId && !detailGuild) {
    return (
      <AppShellV2>
        <TopGuildsView />
      </AppShellV2>
    )
  }

  // detail view (mine or public)
  return (
    <AppShellV2>
      <GuildDetail guild={detailGuild!} isMine={isMine} />
    </AppShellV2>
  )
}
