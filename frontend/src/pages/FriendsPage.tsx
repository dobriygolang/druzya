// TODO i18n
import { useState } from 'react'
import { Copy, UserPlus, Swords, MessageSquare, Check, X } from 'lucide-react'
import { AppShellV2 } from '../components/AppShell'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { Avatar } from '../components/Avatar'
import { Tabs } from '../components/Tabs'
import { useFriendsQuery } from '../lib/queries/friends'

function ErrorChip() {
  return (
    <span className="rounded-full bg-danger/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-danger">
      Не удалось загрузить
    </span>
  )
}

type Gradient = 'violet-cyan' | 'pink-violet' | 'cyan-violet' | 'pink-red' | 'success-cyan' | 'gold'

const ONLINE = [
  { name: 'kirill_dev', tier: 'Diamond I · 2 980 LP', status: 'В матче', g: 'violet-cyan' as Gradient },
  { name: 'nastya_codes', tier: 'Diamond III · 2 720 LP', status: 'В лобби', g: 'pink-violet' as Gradient },
  { name: 'alexey_go', tier: 'Grandmaster · 3 420 LP', status: 'Решает Daily', g: 'cyan-violet' as Gradient },
  { name: 'maks_py', tier: 'Platinum II · 2 140 LP', status: 'Свободен', g: 'success-cyan' as Gradient },
]

const OFFLINE = [
  { name: 'vasya_rs', tier: 'Diamond IV · 2 510 LP', last: '2 ч назад', g: 'pink-red' as Gradient },
  { name: 'lena_ts', tier: 'Platinum I · 2 220 LP', last: '5 ч назад', g: 'gold' as Gradient },
  { name: 'ivan_arch', tier: 'Master · 3 100 LP', last: 'вчера', g: 'violet-cyan' as Gradient },
  { name: 'olya_ml', tier: 'Diamond II · 2 880 LP', last: '2 дня назад', g: 'cyan-violet' as Gradient },
]

const REQUESTS = [
  { name: 'sergey_kt', sub: '12 общих друзей', g: 'violet-cyan' as Gradient },
  { name: 'tanya_dev', sub: 'играли вместе в гильдии', g: 'pink-violet' as Gradient },
  { name: 'anton_be', sub: '6 общих друзей', g: 'success-cyan' as Gradient },
]

const SUGGESTIONS = [
  { name: 'mikhail_qa', sub: 'Diamond III', g: 'cyan-violet' as Gradient },
  { name: 'katya_fe', sub: 'Platinum II', g: 'pink-red' as Gradient },
  { name: 'pavel_sec', sub: 'Master', g: 'gold' as Gradient },
  { name: 'dasha_ds', sub: 'Diamond I', g: 'violet-cyan' as Gradient },
]

function FriendCard({ name, tier, status, g, online }: { name: string; tier: string; status: string; g: Gradient; online: boolean }) {
  return (
    <Card className={`flex-col gap-3 p-5 ${online ? '' : 'opacity-60'}`}>
      <div className="flex items-center gap-3">
        <Avatar size="lg" gradient={g} initials={name[0].toUpperCase()} status={online ? 'online' : 'offline'} />
        <div className="flex flex-1 flex-col gap-0.5">
          <span className="font-display text-sm font-bold text-text-primary">@{name}</span>
          <span className="font-mono text-[11px] text-text-muted">{tier}</span>
        </div>
      </div>
      <span className={`inline-flex w-fit items-center rounded-full px-2.5 py-1 font-mono text-[10px] font-semibold ${online ? 'bg-accent/15 text-accent-hover' : 'bg-surface-2 text-text-muted'}`}>
        {status}
      </span>
      <div className="flex gap-1.5 text-[11px] text-text-muted">
        <span>W/L 41-23</span>
        <span>·</span>
        <span>WR 64%</span>
      </div>
      <div className="flex gap-2">
        <Button size="sm" variant="primary" icon={<Swords className="h-3.5 w-3.5" />} className="flex-1">Вызов</Button>
        <Button size="sm" variant="ghost" icon={<MessageSquare className="h-3.5 w-3.5" />} className="flex-1">Чат</Button>
      </div>
    </Card>
  )
}

export default function FriendsPage() {
  const [tab, setTab] = useState('all')
  const { data, isError } = useFriendsQuery()
  const counts = data?.counts ?? { online: 47, total: 124, requests: 3, guild: 32 }
  const friendCode = data?.friend_code ?? 'DRUZ9-K7M2-X9P'
  return (
    <AppShellV2>
      <div className="flex flex-col gap-6 px-4 py-6 sm:px-8 lg:px-20 lg:py-8">
        <div className="flex flex-col items-start gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex flex-col gap-1.5">
            <h1 className="font-display text-2xl lg:text-[32px] font-bold text-text-primary">Друзья</h1>
            <p className="text-sm text-text-secondary">{counts.online} онлайн · {counts.total} всего · {counts.requests} заявки</p>
            {isError && <ErrorChip />}
          </div>
          <div className="flex flex-wrap gap-3">
            <Button variant="ghost" icon={<Copy className="h-4 w-4" />}>
              <span className="font-mono text-xs">{friendCode}</span>
            </Button>
            <Button variant="primary" icon={<UserPlus className="h-4 w-4" />}>Найти друзей</Button>
          </div>
        </div>

        <Tabs variant="pills" value={tab} onChange={setTab}>
          <Tabs.List>
            <Tabs.Tab id="all">Все {counts.total}</Tabs.Tab>
            <Tabs.Tab id="online">Онлайн {counts.online}</Tabs.Tab>
            <Tabs.Tab id="requests">
              <span className="inline-flex items-center gap-1.5">
                Заявки {counts.requests} <span className="h-1.5 w-1.5 rounded-full bg-danger" />
              </span>
            </Tabs.Tab>
            <Tabs.Tab id="guild">Гильдия {counts.guild}</Tabs.Tab>
            <Tabs.Tab id="blocked">Заблокированные</Tabs.Tab>
          </Tabs.List>
        </Tabs>

        <div className="flex flex-col gap-4 lg:flex-row lg:gap-6">
          <div className="flex flex-1 flex-col gap-6">
            <div className="flex flex-col gap-3">
              <h2 className="font-display text-lg font-bold text-text-primary">Онлайн сейчас (4)</h2>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {ONLINE.map((f) => <FriendCard key={f.name} {...f} online />)}
              </div>
            </div>
            <div className="flex flex-col gap-3">
              <h2 className="font-display text-lg font-bold text-text-primary">Недавние</h2>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {OFFLINE.map((f) => <FriendCard key={f.name} name={f.name} tier={f.tier} status={f.last} g={f.g} online={false} />)}
              </div>
            </div>
          </div>

          <div className="flex w-full flex-col gap-4 lg:w-[380px]">
            <Card className="flex-col gap-3 border-accent/40 p-5">
              <h3 className="font-display text-base font-bold text-text-primary">Заявки в друзья</h3>
              {REQUESTS.map((r) => (
                <div key={r.name} className="flex items-center gap-3">
                  <Avatar size="md" gradient={r.g} initials={r.name[0].toUpperCase()} />
                  <div className="flex flex-1 flex-col gap-0.5">
                    <span className="text-sm font-semibold text-text-primary">@{r.name}</span>
                    <span className="text-[11px] text-text-muted">{r.sub}</span>
                  </div>
                  <button className="grid h-8 w-8 place-items-center rounded-md bg-success/15 text-success hover:bg-success/25"><Check className="h-4 w-4" /></button>
                  <button className="grid h-8 w-8 place-items-center rounded-md bg-danger/15 text-danger hover:bg-danger/25"><X className="h-4 w-4" /></button>
                </div>
              ))}
            </Card>

            <Card className="flex-col gap-3 p-5">
              <h3 className="font-display text-base font-bold text-text-primary">Может, добавить?</h3>
              {SUGGESTIONS.map((s) => (
                <div key={s.name} className="flex items-center gap-3">
                  <Avatar size="sm" gradient={s.g} initials={s.name[0].toUpperCase()} />
                  <div className="flex flex-1 flex-col">
                    <span className="text-sm font-semibold text-text-primary">@{s.name}</span>
                    <span className="font-mono text-[10px] text-text-muted">{s.sub}</span>
                  </div>
                  <button className="text-xs font-semibold text-accent-hover hover:text-accent">+ Добавить</button>
                </div>
              ))}
            </Card>

            <Card className="flex-col gap-3 p-5">
              <h3 className="font-display text-base font-bold text-text-primary">Найти по коду</h3>
              <div className="flex gap-2">
                <input
                  className="h-9 flex-1 rounded-md border border-border bg-surface-2 px-3 font-mono text-[13px] text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
                  placeholder="DRUZ9-XXXX-XXX"
                />
                <Button size="sm" variant="primary">Найти</Button>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </AppShellV2>
  )
}
