import { useState } from 'react'
import { Copy, UserPlus, Swords, MessageSquare, Check, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { AppShellV2 } from '../components/AppShell'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { Avatar } from '../components/Avatar'
import { Tabs } from '../components/Tabs'
import { useFriendsQuery } from '../lib/queries/friends'

function ErrorChip() {
  const { t } = useTranslation('pages')
  return (
    <span className="rounded-full bg-danger/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-danger">
      {t('common.load_failed')}
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

function FriendCard({ name, tier, status, g, online, wins, losses, winRate }: { name: string; tier: string; status: string; g: Gradient; online: boolean; wins: number; losses: number; winRate: number }) {
  const { t } = useTranslation('pages')
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
        <span>W/L {wins}-{losses}</span>
        <span>·</span>
        <span>WR {winRate}%</span>
      </div>
      <div className="flex gap-2">
        <Button size="sm" variant="primary" icon={<Swords className="h-3.5 w-3.5" />} className="flex-1">{t('friends.challenge')}</Button>
        <Button size="sm" variant="ghost" icon={<MessageSquare className="h-3.5 w-3.5" />} className="flex-1">{t('friends.chat')}</Button>
      </div>
    </Card>
  )
}

export default function FriendsPage() {
  const { t } = useTranslation('pages')
  const [tab, setTab] = useState('all')
  const { data, isError } = useFriendsQuery()
  const counts = data?.counts ?? { online: 47, total: 124, requests: 3, guild: 32 }
  const friendCode = data?.friend_code ?? 'DRUZ9-K7M2-X9P'
  const onlineList = data?.online ?? ONLINE.map((f, i) => ({ id: `o${i}`, name: f.name, tier: f.tier, status: f.status, online: true, gradient: f.g, wins: 41, losses: 23, win_rate: 64 }))
  const offlineList = data?.offline ?? OFFLINE.map((f, i) => ({ id: `f${i}`, name: f.name, tier: f.tier, status: f.last, online: false, gradient: f.g, wins: 41, losses: 23, win_rate: 64 }))
  const requestList = data?.requests ?? REQUESTS.map((r, i) => ({ id: `r${i}`, name: r.name, subtitle: r.sub, gradient: r.g }))
  const suggestionList = data?.suggestions ?? SUGGESTIONS.map((s, i) => ({ id: `s${i}`, name: s.name, subtitle: s.sub, gradient: s.g }))
  return (
    <AppShellV2>
      <div className="flex flex-col gap-6 px-4 py-6 sm:px-8 lg:px-20 lg:py-8">
        <div className="flex flex-col items-start gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex flex-col gap-1.5">
            <h1 className="font-display text-2xl lg:text-[32px] font-bold text-text-primary">{t('friends.title')}</h1>
            <p className="text-sm text-text-secondary">{t('friends.summary', { online: counts.online, total: counts.total, requests: counts.requests })}</p>
            {isError && <ErrorChip />}
          </div>
          <div className="flex flex-wrap gap-3">
            <Button variant="ghost" icon={<Copy className="h-4 w-4" />}>
              <span className="font-mono text-xs">{friendCode}</span>
            </Button>
            <Button variant="primary" icon={<UserPlus className="h-4 w-4" />}>{t('friends.find')}</Button>
          </div>
        </div>

        <Tabs variant="pills" value={tab} onChange={setTab}>
          <Tabs.List>
            <Tabs.Tab id="all">{t('friends.all')} {counts.total}</Tabs.Tab>
            <Tabs.Tab id="online">{t('friends.online')} {counts.online}</Tabs.Tab>
            <Tabs.Tab id="requests">
              <span className="inline-flex items-center gap-1.5">
                {t('friends.requests')} {counts.requests} <span className="h-1.5 w-1.5 rounded-full bg-danger" />
              </span>
            </Tabs.Tab>
            <Tabs.Tab id="guild">{t('friends.guild')} {counts.guild}</Tabs.Tab>
            <Tabs.Tab id="blocked">{t('friends.blocked')}</Tabs.Tab>
          </Tabs.List>
        </Tabs>

        <div className="flex flex-col gap-4 lg:flex-row lg:gap-6">
          <div className="flex flex-1 flex-col gap-6">
            <div className="flex flex-col gap-3">
              <h2 className="font-display text-lg font-bold text-text-primary">{t('friends.online_now', { n: onlineList.length })}</h2>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {onlineList.map((f) => <FriendCard key={f.id} name={f.name} tier={f.tier} status={f.status} g={f.gradient as Gradient} online wins={f.wins} losses={f.losses} winRate={f.win_rate} />)}
              </div>
            </div>
            <div className="flex flex-col gap-3">
              <h2 className="font-display text-lg font-bold text-text-primary">{t('friends.recent')}</h2>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {offlineList.map((f) => <FriendCard key={f.id} name={f.name} tier={f.tier} status={f.status} g={f.gradient as Gradient} online={false} wins={f.wins} losses={f.losses} winRate={f.win_rate} />)}
              </div>
            </div>
          </div>

          <div className="flex w-full flex-col gap-4 lg:w-[380px]">
            <Card className="flex-col gap-3 border-accent/40 p-5">
              <h3 className="font-display text-base font-bold text-text-primary">{t('friends.incoming')}</h3>
              {requestList.map((r) => (
                <div key={r.id} className="flex items-center gap-3">
                  <Avatar size="md" gradient={r.gradient as Gradient} initials={r.name[0].toUpperCase()} />
                  <div className="flex flex-1 flex-col gap-0.5">
                    <span className="text-sm font-semibold text-text-primary">@{r.name}</span>
                    <span className="text-[11px] text-text-muted">{r.subtitle}</span>
                  </div>
                  <button className="grid h-8 w-8 place-items-center rounded-md bg-success/15 text-success hover:bg-success/25"><Check className="h-4 w-4" /></button>
                  <button className="grid h-8 w-8 place-items-center rounded-md bg-danger/15 text-danger hover:bg-danger/25"><X className="h-4 w-4" /></button>
                </div>
              ))}
            </Card>

            <Card className="flex-col gap-3 p-5">
              <h3 className="font-display text-base font-bold text-text-primary">{t('friends.suggestions')}</h3>
              {suggestionList.map((s) => (
                <div key={s.id} className="flex items-center gap-3">
                  <Avatar size="sm" gradient={s.gradient as Gradient} initials={s.name[0].toUpperCase()} />
                  <div className="flex flex-1 flex-col">
                    <span className="text-sm font-semibold text-text-primary">@{s.name}</span>
                    <span className="font-mono text-[10px] text-text-muted">{s.subtitle}</span>
                  </div>
                  <button className="text-xs font-semibold text-accent-hover hover:text-accent">{t('friends.add')}</button>
                </div>
              ))}
            </Card>

            <Card className="flex-col gap-3 p-5">
              <h3 className="font-display text-base font-bold text-text-primary">{t('friends.find_by_code')}</h3>
              <div className="flex gap-2">
                <input
                  className="h-9 flex-1 rounded-md border border-border bg-surface-2 px-3 font-mono text-[13px] text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
                  placeholder="DRUZ9-XXXX-XXX"
                />
                <Button size="sm" variant="primary">{t('friends.find_btn')}</Button>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </AppShellV2>
  )
}
