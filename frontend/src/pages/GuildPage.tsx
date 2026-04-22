// TODO i18n
import { Shield, Search, MoreHorizontal, Calendar, Trophy, Crown } from 'lucide-react'
import { AppShellV2 } from '../components/AppShell'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { Avatar } from '../components/Avatar'
import { useMyGuildQuery, useGuildWarQuery } from '../lib/queries/guild'

function Banner() {
  const { data: guild, isError } = useMyGuildQuery()
  const name = guild?.name ?? 'Ironclad'
  const memberCount = guild?.members?.length ?? 32
  const elo = guild?.guild_elo ?? 0
  return (
    <div
      className="flex h-auto flex-col items-start justify-between gap-4 px-4 py-6 sm:px-8 lg:h-[240px] lg:flex-row lg:items-center lg:gap-0 lg:px-20 lg:py-0"
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
          <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-warn/20 px-2.5 py-1 font-mono text-[11px] font-semibold tracking-[0.08em] text-warn">
            DIAMOND TIER · #3 GLOBAL
          </span>
          <h1 className="font-display text-3xl sm:text-4xl lg:text-[38px] font-extrabold leading-[1.05] text-text-primary">{name}</h1>
          <p className="text-sm text-text-secondary">
            {isError
              ? 'Не удалось загрузить'
              : `${memberCount} участников · основана 12 марта 2025 · @${guild?.members?.[0]?.username ?? 'alexey'}, лидер`}
          </p>
          <div className="mt-2 flex gap-6">
            <div className="flex flex-col">
              <span className="font-display text-lg font-bold text-text-primary">{elo}</span>
              <span className="text-[11px] text-text-muted">guild ELO</span>
            </div>
            <div className="flex flex-col">
              <span className="font-display text-lg font-bold text-cyan">78%</span>
              <span className="text-[11px] text-text-muted">winrate</span>
            </div>
            <div className="flex flex-col">
              <span className="font-display text-lg font-bold text-warn">2 410</span>
              <span className="text-[11px] text-text-muted">очков сезона</span>
            </div>
          </div>
        </div>
      </div>
      <div className="flex flex-col items-end gap-2">
        <Button className="bg-success text-bg shadow-none hover:bg-success hover:brightness-110">
          Уже в гильдии ✓
        </Button>
        <Button variant="ghost">Покинуть</Button>
      </div>
    </div>
  )
}

function TabStrip() {
  const tabs = [
    { name: 'Обзор', active: true },
    { name: 'Участники', active: false },
    { name: 'Война', active: false },
    { name: 'История', active: false },
    { name: 'Настройки', active: false },
  ]
  return (
    <div className="flex h-14 items-center gap-1 overflow-x-auto border-b border-border bg-bg px-4 sm:px-8 lg:px-20">
      {tabs.map((t) => (
        <button
          key={t.name}
          className={`rounded-md px-4 py-2 text-sm transition-colors ${
            t.active
              ? 'bg-surface-2 font-semibold text-text-primary'
              : 'font-medium text-text-secondary hover:bg-surface-2 hover:text-text-primary'
          }`}
        >
          {t.name}
        </button>
      ))}
    </div>
  )
}

function LiveWarCard() {
  const { data: guild } = useMyGuildQuery()
  const { data: war } = useGuildWarQuery(guild?.id)
  const scoreA = war?.lines?.reduce((acc, l) => acc + l.score_a, 0) ?? 2140
  const scoreB = war?.lines?.reduce((acc, l) => acc + l.score_b, 0) ?? 1670
  const total = scoreA + scoreB
  const pctA = total > 0 ? Math.round((scoreA / total) * 100) : 50
  const titleA = war?.guild_a?.name ?? 'Ironclad'
  const titleB = war?.guild_b?.name ?? 'Nightfall'
  return (
    <Card className="flex-col gap-3 border-accent/40 bg-gradient-to-br from-surface-3 to-accent p-5 shadow-glow" interactive={false}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-danger opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-danger" />
          </span>
          <span className="font-mono text-[11px] font-semibold tracking-[0.08em] text-danger">АКТИВНАЯ ВОЙНА</span>
        </div>
        <span className="font-mono text-[11px] text-text-secondary">Финал через 2д 4ч</span>
      </div>
      <h3 className="font-display text-lg font-bold text-text-primary">{titleA} vs {titleB}</h3>
      <div className="flex items-center gap-3">
        <span className="font-display text-[22px] font-bold text-success">{scoreA}</span>
        <div className="flex h-2 flex-1 overflow-hidden rounded-full bg-black/30">
          <div className="h-full bg-success" style={{ width: `${pctA}%` }} />
          <div className="h-full bg-danger" style={{ width: `${100 - pctA}%` }} />
        </div>
        <span className="font-display text-[22px] font-bold text-danger">{scoreB}</span>
      </div>
      <p className="text-xs text-text-secondary">Твой вклад: 240 очков (#3 в гильдии)</p>
    </Card>
  )
}

function TopContributors() {
  const rows = [
    { rank: 1, name: '@alexey', score: '+420', medal: 'warn' },
    { rank: 2, name: '@kirill_dev', score: '+380', medal: 'silver' },
    { rank: 3, name: '@you', score: '+240', medal: 'accent', you: true },
    { rank: 4, name: '@nastya', score: '+180', medal: 'plain' },
    { rank: 5, name: '@misha', score: '+140', medal: 'plain' },
  ]
  const medalBg = (m: string) =>
    m === 'warn' ? 'bg-warn text-bg' : m === 'silver' ? 'bg-border-strong text-text-secondary' : m === 'accent' ? 'bg-accent text-text-primary' : 'bg-border-strong text-text-secondary'
  return (
    <Card className="flex-col gap-2 p-5">
      <h3 className="mb-1 font-display text-base font-bold text-text-primary">Топ контрибьюторов</h3>
      {rows.map((r) => (
        <div key={r.rank} className={`flex items-center gap-3 rounded-lg px-2 py-1.5 ${r.you ? 'bg-surface-3' : ''}`}>
          <span className={`grid h-6 w-6 place-items-center rounded-full font-display text-[12px] font-bold ${medalBg(r.medal)}`}>
            {r.rank}
          </span>
          <Avatar size="sm" gradient="violet-cyan" initials={r.name[1]?.toUpperCase()} />
          <span className={`flex-1 text-sm ${r.you ? 'font-bold text-text-primary' : 'font-semibold text-text-primary'}`}>
            {r.name}
          </span>
          <span className="font-mono text-sm font-semibold text-success">{r.score}</span>
        </div>
      ))}
    </Card>
  )
}

function ScheduleCard() {
  const events = [
    { color: 'bg-accent', title: 'Тренировка DP', time: 'Ср · 19:00' },
    { color: 'bg-warn', title: 'Война · 1/8 финала', time: 'Пт · 20:00' },
    { color: 'bg-cyan', title: 'Code review session', time: 'Вс · 18:00' },
  ]
  return (
    <Card className="flex-col gap-3 p-5">
      <div className="flex items-center gap-2">
        <Calendar className="h-4 w-4 text-cyan" />
        <h3 className="font-display text-base font-bold text-text-primary">События недели</h3>
      </div>
      {events.map((e, i) => (
        <div key={i} className="flex items-center gap-3 py-1.5">
          <span className={`h-2.5 w-2.5 rounded-full ${e.color}`} />
          <span className="flex-1 text-sm text-text-primary">{e.title}</span>
          <span className="font-mono text-[11px] text-text-muted">{e.time}</span>
        </div>
      ))}
    </Card>
  )
}

type Member = {
  name: string
  tier: string
  role: 'Лидер' | 'Офицер' | 'Игрок'
  contrib: string
  wr: string
  activity: number
  you?: boolean
}

const MEMBERS: Member[] = [
  { name: '@alexey', tier: 'Grandmaster', role: 'Лидер', contrib: '+420', wr: '82%', activity: 95 },
  { name: '@kirill_dev', tier: 'Diamond I', role: 'Офицер', contrib: '+380', wr: '76%', activity: 88 },
  { name: '@you', tier: 'Diamond III', role: 'Игрок', contrib: '+240', wr: '64%', activity: 72, you: true },
  { name: '@nastya', tier: 'Diamond IV', role: 'Игрок', contrib: '+180', wr: '68%', activity: 60 },
  { name: '@misha', tier: 'Platinum I', role: 'Офицер', contrib: '+140', wr: '71%', activity: 55 },
  { name: '@vasya', tier: 'Platinum II', role: 'Игрок', contrib: '+120', wr: '58%', activity: 48 },
  { name: '@olga', tier: 'Diamond IV', role: 'Игрок', contrib: '+96', wr: '62%', activity: 40 },
  { name: '@petr', tier: 'Platinum III', role: 'Игрок', contrib: '+72', wr: '54%', activity: 30 },
  { name: '@anna', tier: 'Gold I', role: 'Игрок', contrib: '+45', wr: '49%', activity: 22 },
]

function roleChip(role: Member['role']) {
  if (role === 'Лидер') return 'bg-warn/15 text-warn'
  if (role === 'Офицер') return 'bg-cyan/15 text-cyan'
  return 'bg-border-strong text-text-muted'
}

function MembersTable() {
  const { data: guild } = useMyGuildQuery()
  const members: Member[] = guild?.members?.length
    ? guild.members.map((m) => ({
        name: `@${m.username}`,
        tier: m.assigned_section,
        role: m.role === 'captain' ? 'Лидер' : m.role === 'officer' ? 'Офицер' : 'Игрок',
        contrib: '+0',
        wr: '—',
        activity: 50,
      }))
    : MEMBERS
  return (
    <Card className="flex-1 flex-col p-0">
      <div className="flex items-center justify-between border-b border-border p-5">
        <h3 className="font-display text-base font-bold text-text-primary">Участники ({members.length})</h3>
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-[200px] items-center gap-2 rounded-md border border-border bg-surface-2 px-3">
            <Search className="h-4 w-4 text-text-muted" />
            <span className="text-[13px] text-text-muted">Поиск…</span>
          </div>
          <Button size="sm">Пригласить</Button>
        </div>
      </div>
      <div className="hidden grid-cols-[2fr_1fr_1fr_0.6fr_1fr_40px] gap-4 border-b border-border px-5 py-3 font-mono text-[11px] font-semibold tracking-[0.08em] text-text-muted lg:grid">
        <span>ИГРОК</span>
        <span>РОЛЬ</span>
        <span>ВКЛАД</span>
        <span>WR</span>
        <span>АКТИВ</span>
        <span />
      </div>
      {MEMBERS.map((m) => (
        <div
          key={m.name}
          className={`flex flex-col gap-3 border-b border-border px-5 py-3 lg:grid lg:grid-cols-[2fr_1fr_1fr_0.6fr_1fr_40px] lg:items-center lg:gap-4 ${
            m.you ? 'bg-surface-3' : ''
          }`}
        >
          <div className="flex items-center gap-3">
            <Avatar size="md" gradient="violet-cyan" initials={m.name[1]?.toUpperCase()} />
            <div className="flex flex-col">
              <span className={`text-sm ${m.you ? 'font-bold text-text-primary' : 'font-semibold text-text-primary'}`}>{m.name}</span>
              <span className="font-mono text-[11px] text-text-muted">{m.tier}</span>
            </div>
          </div>
          <div>
            <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${roleChip(m.role)}`}>{m.role}</span>
          </div>
          <span className="font-mono text-sm font-semibold text-success">{m.contrib}</span>
          <span className="text-sm text-text-secondary">{m.wr}</span>
          <div className="h-1.5 overflow-hidden rounded-full bg-black/30">
            <div className="h-full rounded-full bg-gradient-to-r from-cyan to-accent" style={{ width: `${m.activity}%` }} />
          </div>
          <button className="grid h-8 w-8 place-items-center rounded-md text-text-muted hover:bg-surface-2 hover:text-text-primary">
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </div>
      ))}
    </Card>
  )
}

export default function GuildPage() {
  return (
    <AppShellV2>
      <Banner />
      <TabStrip />
      <div className="flex flex-col gap-4 px-4 pb-6 pt-6 sm:px-8 lg:flex-row lg:gap-6 lg:px-20 lg:pb-7">
        <div className="flex w-full flex-col gap-5 lg:w-[380px]">
          <LiveWarCard />
          <TopContributors />
          <ScheduleCard />
        </div>
        <MembersTable />
      </div>
      {/* avoid unused */}
      <span className="hidden">
        <Trophy />
        <Crown />
      </span>
    </AppShellV2>
  )
}
