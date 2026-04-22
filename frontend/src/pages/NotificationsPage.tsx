// TODO i18n
import { useState } from 'react'
import { Check, Settings, Swords, Trophy, Sparkles, Shield, Award, Bell, Users, Server, Mail, Send, MessageCircle, Code as GithubIcon } from 'lucide-react'

const Github = GithubIcon
import { AppShellV2 } from '../components/AppShell'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { Tabs } from '../components/Tabs'
import { useNotificationsQuery } from '../lib/queries/notifications'

function ErrorChip() {
  return (
    <span className="rounded-full bg-danger/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-danger">
      Не удалось загрузить
    </span>
  )
}

type Notif = {
  unread?: boolean
  icon: JSX.Element
  bg: string
  body: JSX.Element
  sub: string
  time: string
  actions?: JSX.Element
}

function Row({ n }: { n: Notif }) {
  return (
    <div className="flex items-start gap-3 px-[14px] py-3">
      <span className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${n.unread ? 'bg-accent' : 'bg-transparent'}`} />
      <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ${n.bg}`}>{n.icon}</span>
      <div className="flex flex-1 flex-col gap-1">
        <div className="text-sm text-text-primary">{n.body}</div>
        <div className="flex items-center gap-2 text-[11px] text-text-muted">
          <span>{n.sub}</span>
          <span>·</span>
          <span className="font-mono">{n.time}</span>
        </div>
        {n.actions}
      </div>
    </div>
  )
}

const TODAY: Notif[] = [
  {
    unread: true,
    icon: <Swords className="h-4 w-4 text-accent-hover" />, bg: 'bg-accent/15',
    body: <><b className="font-semibold">@kirill_dev</b> бросил вызов · Ranked 1v1</>,
    sub: 'Diamond I · принять до 18:30', time: '5 мин',
    actions: (
      <div className="flex gap-2 pt-1">
        <Button size="sm" variant="primary">Принять</Button>
        <Button size="sm" variant="ghost">Отклонить</Button>
      </div>
    ),
  },
  {
    unread: true,
    icon: <Trophy className="h-4 w-4 text-success" />, bg: 'bg-success/15',
    body: <>Победа vs <b className="font-semibold">@vasya_rs</b> · +18 LP</>,
    sub: 'Median of Two Sorted Arrays · O(log n)', time: '1 ч',
    actions: <button className="pt-1 text-left text-xs font-semibold text-accent-hover hover:text-accent">Посмотреть replay →</button>,
  },
  {
    unread: true,
    icon: <Sparkles className="h-4 w-4 text-pink" />, bg: 'bg-pink/15',
    body: <>AI наставник: <b className="font-semibold">новый план на неделю</b> готов</>,
    sub: 'Фокус: dynamic programming · 5 шагов', time: '3 ч',
    actions: <button className="pt-1 text-left text-xs font-semibold text-accent-hover hover:text-accent">Открыть план →</button>,
  },
  {
    unread: true,
    icon: <Shield className="h-4 w-4 text-cyan" />, bg: 'bg-cyan/15',
    body: <>Война гильдий: <b className="font-semibold">Ironclad</b> ведёт 2 140 — 1 670</>,
    sub: 'твой вклад: 240 очков · финал через 2д 4ч', time: '5 ч',
  },
  {
    unread: true,
    icon: <Award className="h-4 w-4 text-warn" />, bg: 'bg-warn/15',
    body: <>Получен ачивмент <b className="font-semibold">Speed Demon</b> · +500 XP</>,
    sub: '10 задач под 5 минут подряд', time: '8 ч',
  },
]

const YESTERDAY: Notif[] = [
  { icon: <Users className="h-4 w-4 text-accent-hover" />, bg: 'bg-accent/15', body: <><b>@nastya_codes</b> добавила тебя в друзья</>, sub: '12 общих друзей', time: 'вчера 21:14' },
  { icon: <Trophy className="h-4 w-4 text-warn" />, bg: 'bg-warn/15', body: <>Поднялся в рейтинге: <b>Diamond III</b></>, sub: '+124 LP за день · топ-12 друзей', time: 'вчера 19:02' },
  { icon: <Bell className="h-4 w-4 text-pink" />, bg: 'bg-pink/15', body: <>Streak Freeze активирован автоматически</>, sub: 'у тебя 2 заморозки осталось', time: 'вчера 04:00' },
  { icon: <Server className="h-4 w-4 text-text-secondary" />, bg: 'bg-surface-3', body: <>Релиз v2.4 · новые AI-модели</>, sub: 'Sonnet 4.5 теперь по умолчанию', time: 'вчера 12:30' },
]

export default function NotificationsPage() {
  const [tab, setTab] = useState('all')
  const { data, isError } = useNotificationsQuery()
  const unread = data?.unread ?? 12
  const tabs = data?.tabs ?? { all: 47, unread: 12, social: 8, match: 18, guild: 9, system: 12 }
  return (
    <AppShellV2>
      <div className="flex flex-col gap-6 px-4 py-6 sm:px-8 lg:px-20 lg:py-8">
        <div className="flex flex-col items-start gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex flex-col gap-1.5">
            <h1 className="font-display text-2xl lg:text-[32px] font-bold text-text-primary">Уведомления</h1>
            <p className="text-sm text-text-secondary">{unread} непрочитанных</p>
            {isError && <ErrorChip />}
          </div>
          <div className="flex flex-wrap gap-3">
            <Button variant="ghost" icon={<Check className="h-4 w-4" />}>Прочитать все</Button>
            <Button variant="ghost" icon={<Settings className="h-4 w-4" />}>Настройки нотификаций</Button>
          </div>
        </div>

        <Tabs variant="pills" value={tab} onChange={setTab}>
          <Tabs.List>
            <Tabs.Tab id="all">Все {tabs.all}</Tabs.Tab>
            <Tabs.Tab id="unread">Непрочитанные {tabs.unread}</Tabs.Tab>
            <Tabs.Tab id="social">Соц {tabs.social}</Tabs.Tab>
            <Tabs.Tab id="match">Матчи {tabs.match}</Tabs.Tab>
            <Tabs.Tab id="guild">Гильдия {tabs.guild}</Tabs.Tab>
            <Tabs.Tab id="sys">Система {tabs.system}</Tabs.Tab>
          </Tabs.List>
        </Tabs>

        <div className="flex flex-col gap-4 lg:flex-row lg:gap-6">
          <Card className="flex-1 flex-col gap-2 p-4">
            <div className="px-2 pt-2">
              <span className="font-mono text-[11px] font-semibold tracking-[0.08em] text-text-muted">СЕГОДНЯ</span>
            </div>
            <div className="flex flex-col divide-y divide-border">
              {TODAY.map((n, i) => <Row key={i} n={n} />)}
            </div>
            <div className="px-2 pt-4">
              <span className="font-mono text-[11px] font-semibold tracking-[0.08em] text-text-muted">ВЧЕРА</span>
            </div>
            <div className="flex flex-col divide-y divide-border">
              {YESTERDAY.map((n, i) => <Row key={i} n={n} />)}
            </div>
            <div className="flex items-center justify-between px-3 pt-5">
              <span className="font-mono text-[11px] font-semibold tracking-[0.08em] text-text-muted">НА ЭТОЙ НЕДЕЛЕ · 3 свёрнуто</span>
              <button className="text-xs font-semibold text-accent-hover hover:text-accent">Развернуть</button>
            </div>
          </Card>

          <div className="flex w-full flex-col gap-4 lg:w-[320px]">
            <Card className="flex-col gap-2 p-5">
              <h3 className="font-display text-sm font-bold text-text-primary">Быстрые фильтры</h3>
              {[
                { icon: <Swords className="h-3.5 w-3.5 text-accent-hover" />, l: 'Вызовы', c: 4 },
                { icon: <Trophy className="h-3.5 w-3.5 text-success" />, l: 'Победы', c: 9 },
                { icon: <Users className="h-3.5 w-3.5 text-pink" />, l: 'Заявки', c: 3 },
                { icon: <Shield className="h-3.5 w-3.5 text-cyan" />, l: 'Гильдия', c: 9 },
                { icon: <Server className="h-3.5 w-3.5 text-text-secondary" />, l: 'Система', c: 12 },
              ].map((r) => (
                <div key={r.l} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-surface-2">
                  <span className="grid h-6 w-6 place-items-center rounded-md bg-surface-2">{r.icon}</span>
                  <span className="flex-1 text-[13px] text-text-secondary">{r.l}</span>
                  <span className="font-mono text-[11px] text-text-muted">{r.c}</span>
                </div>
              ))}
            </Card>

            <Card className="flex-col gap-3 p-5">
              <h3 className="font-display text-sm font-bold text-text-primary">Тишина</h3>
              {[{ l: 'DND до 09:00', on: true }, { l: 'Выкл. на матчах', on: false }].map((t) => (
                <div key={t.l} className="flex items-center justify-between">
                  <span className="text-[13px] text-text-secondary">{t.l}</span>
                  <span className={`flex h-5 w-9 items-center rounded-full ${t.on ? 'bg-accent justify-end' : 'bg-surface-3 justify-start'} px-0.5`}>
                    <span className="h-4 w-4 rounded-full bg-text-primary" />
                  </span>
                </div>
              ))}
            </Card>

            <Card className="flex-col gap-3 p-5">
              <h3 className="font-display text-sm font-bold text-text-primary">Каналы</h3>
              {[
                { icon: <Mail className="h-3.5 w-3.5" />, l: 'Email', on: true },
                { icon: <Bell className="h-3.5 w-3.5" />, l: 'Push', on: true },
                { icon: <Send className="h-3.5 w-3.5" />, l: 'Telegram', on: true },
                { icon: <MessageCircle className="h-3.5 w-3.5" />, l: 'Discord', on: false },
              ].map((c) => (
                <div key={c.l} className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-[13px] text-text-secondary">{c.icon} {c.l}</span>
                  <span className={`flex h-5 w-9 items-center rounded-full ${c.on ? 'bg-accent justify-end' : 'bg-surface-3 justify-start'} px-0.5`}>
                    <span className="h-4 w-4 rounded-full bg-text-primary" />
                  </span>
                </div>
              ))}
              <div className="hidden">
                <Github className="h-3 w-3" />
              </div>
            </Card>
          </div>
        </div>
      </div>
    </AppShellV2>
  )
}
