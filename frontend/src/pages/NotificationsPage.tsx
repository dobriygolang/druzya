import { useMemo, useState } from 'react'
import {
  Check,
  Settings,
  Swords,
  Trophy,
  Sparkles,
  Shield,
  Award,
  Bell,
  Users,
  Server,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { AppShellV2 } from '../components/AppShell'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { Tabs } from '../components/Tabs'
import {
  useNotificationsQuery,
  useMarkRead,
  useMarkAllRead,
  useNotificationPrefsQuery,
  useUpdatePrefs,
  groupByBucket,
  type NotificationItem,
  type NotificationFilter,
} from '../lib/queries/notifications'
import { useAcceptFriend, useDeclineFriend } from '../lib/queries/friends'

function ErrorChip() {
  const { t } = useTranslation('pages')
  return (
    <span className="rounded-full bg-danger/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-danger">
      {t('common.load_failed')}
    </span>
  )
}

// Маппинг channel/type → визуал. Channel — broad bucket, type — конкретное событие.
function visualFor(n: NotificationItem): { icon: JSX.Element; bg: string } {
  switch (n.type) {
    case 'win':
      return { icon: <Trophy className="h-4 w-4 text-success" />, bg: 'bg-success/15' }
    case 'loss':
      return { icon: <Swords className="h-4 w-4 text-danger" />, bg: 'bg-danger/15' }
    case 'challenge':
      return { icon: <Swords className="h-4 w-4 text-accent-hover" />, bg: 'bg-accent/15' }
    case 'friend_request':
      return { icon: <Users className="h-4 w-4 text-accent-hover" />, bg: 'bg-accent/15' }
    case 'friend_added':
      return { icon: <Users className="h-4 w-4 text-success" />, bg: 'bg-success/15' }
    case 'achievement_unlocked':
      return { icon: <Award className="h-4 w-4 text-warn" />, bg: 'bg-warn/15' }
    case 'streak_at_risk':
      return { icon: <Bell className="h-4 w-4 text-pink" />, bg: 'bg-pink/15' }
    case 'guild_war_started':
    case 'guild_war_ended':
      return { icon: <Shield className="h-4 w-4 text-cyan" />, bg: 'bg-cyan/15' }
    case 'plan_ready':
      return { icon: <Sparkles className="h-4 w-4 text-pink" />, bg: 'bg-pink/15' }
    default:
      // Channel-fallback.
      switch (n.channel) {
        case 'wins':
          return { icon: <Trophy className="h-4 w-4 text-warn" />, bg: 'bg-warn/15' }
        case 'social':
          return { icon: <Users className="h-4 w-4 text-accent-hover" />, bg: 'bg-accent/15' }
        case 'guild':
          return { icon: <Shield className="h-4 w-4 text-cyan" />, bg: 'bg-cyan/15' }
        case 'system':
          return { icon: <Server className="h-4 w-4 text-text-secondary" />, bg: 'bg-surface-3' }
        default:
          return { icon: <Bell className="h-4 w-4 text-text-secondary" />, bg: 'bg-surface-3' }
      }
  }
}

function relativeTime(iso: string, now: Date = new Date()): string {
  const d = new Date(iso)
  const diffMs = now.getTime() - d.getTime()
  const min = Math.floor(diffMs / 60_000)
  if (min < 1) return 'только что'
  if (min < 60) return `${min} мин`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} ч`
  const days = Math.floor(hr / 24)
  if (days === 1) return 'вчера'
  if (days < 7) return `${days} дн`
  return d.toLocaleDateString()
}

type Tab = 'all' | 'unread_tab' | 'social' | 'match' | 'guild' | 'system'

const TAB_TO_FILTER: Record<Tab, NotificationFilter> = {
  all: {},
  unread_tab: { unread: true },
  social: { channel: 'social' },
  match: { channel: 'match' },
  guild: { channel: 'guild' },
  system: { channel: 'system' },
}

function Row({
  n,
  onMarkRead,
  onAcceptFriend,
  onDeclineFriend,
  onOpenReplay,
  onOpenPlan,
}: {
  n: NotificationItem
  onMarkRead: () => void
  onAcceptFriend?: (friendshipID: number) => void
  onDeclineFriend?: (friendshipID: number) => void
  onOpenReplay?: (matchID: string) => void
  onOpenPlan?: (planID: string) => void
}) {
  const v = visualFor(n)
  const unread = n.read_at == null
  const friendshipID = (n.payload?.friendship_id as number | undefined) ?? undefined
  const matchID = (n.payload?.match_id as string | undefined) ?? undefined
  const planID = (n.payload?.plan_id as string | undefined) ?? undefined

  return (
    <div className="group flex items-start gap-3 px-[14px] py-3" onMouseEnter={() => unread && onMarkRead()}>
      <span className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${unread ? 'bg-accent' : 'bg-transparent'}`} />
      <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ${v.bg}`}>{v.icon}</span>
      <div className="flex flex-1 flex-col gap-1">
        <div className="text-sm text-text-primary">
          <b className="font-semibold">{n.title}</b>
          {n.body ? <> · <span className="text-text-secondary">{n.body}</span></> : null}
        </div>
        <div className="flex items-center gap-2 text-[11px] text-text-muted">
          <span className="font-mono">{relativeTime(n.created_at)}</span>
        </div>
        {/* quick actions */}
        {n.type === 'friend_request' && friendshipID != null && (
          <div className="flex gap-2 pt-1">
            <Button size="sm" variant="primary" onClick={() => onAcceptFriend?.(friendshipID)}>Принять</Button>
            <Button size="sm" variant="ghost" onClick={() => onDeclineFriend?.(friendshipID)}>Отклонить</Button>
          </div>
        )}
        {(n.type === 'win' || n.type === 'loss') && matchID && (
          <button
            type="button"
            className="pt-1 text-left text-xs font-semibold text-accent-hover hover:text-accent"
            onClick={() => onOpenReplay?.(matchID)}
          >
            Посмотреть replay →
          </button>
        )}
        {n.type === 'plan_ready' && planID && (
          <button
            type="button"
            className="pt-1 text-left text-xs font-semibold text-accent-hover hover:text-accent"
            onClick={() => onOpenPlan?.(planID)}
          >
            Открыть план →
          </button>
        )}
        {n.type === 'challenge' && (
          <div className="flex gap-2 pt-1">
            <Button size="sm" variant="primary" disabled title="WIP">Принять</Button>
            <Button size="sm" variant="ghost" disabled title="WIP">Отклонить</Button>
          </div>
        )}
      </div>
    </div>
  )
}

function Group({ label, items, render }: { label: string; items: NotificationItem[]; render: (n: NotificationItem) => JSX.Element }) {
  if (items.length === 0) return null
  return (
    <>
      <div className="px-2 pt-2">
        <span className="font-mono text-[11px] font-semibold tracking-[0.08em] text-text-muted">{label}</span>
      </div>
      <div className="flex flex-col divide-y divide-border">{items.map(render)}</div>
    </>
  )
}

function SettingsPanel() {
  const { t } = useTranslation('pages')
  const prefs = useNotificationPrefsQuery()
  const update = useUpdatePrefs()
  const enabled = prefs.data?.channel_enabled ?? {}
  const silenceUntil = prefs.data?.silence_until ?? null

  const channels: { id: string; label: string; icon: JSX.Element }[] = [
    { id: 'wins', label: 'Победы', icon: <Trophy className="h-3.5 w-3.5" /> },
    { id: 'match', label: 'Матчи', icon: <Swords className="h-3.5 w-3.5" /> },
    { id: 'social', label: 'Соц', icon: <Users className="h-3.5 w-3.5" /> },
    { id: 'guild', label: 'Гильдия', icon: <Shield className="h-3.5 w-3.5" /> },
    { id: 'system', label: 'Система', icon: <Server className="h-3.5 w-3.5" /> },
  ]

  const toggle = (id: string) => {
    const next = { ...enabled, [id]: !(enabled[id] ?? true) }
    update.mutate({ channel_enabled: next, silence_until: silenceUntil })
  }

  const setSilence = (hours: number | null) => {
    let s: string | null = null
    if (hours != null) {
      const t = new Date(Date.now() + hours * 60 * 60_000)
      s = t.toISOString()
    }
    update.mutate({ channel_enabled: enabled, silence_until: s })
  }

  return (
    <>
      <Card className="flex-col gap-2 p-5">
        <h3 className="font-display text-sm font-bold text-text-primary">{t('notifications.silence')}</h3>
        <div className="flex flex-wrap gap-2">
          {[
            { l: '1ч', h: 1 },
            { l: '8ч', h: 8 },
            { l: '24ч', h: 24 },
          ].map((opt) => (
            <button
              key={opt.l}
              onClick={() => setSilence(opt.h)}
              className="rounded-md border border-border bg-surface-2 px-3 py-1 text-[12px] text-text-secondary hover:border-accent hover:text-text-primary"
            >
              {opt.l}
            </button>
          ))}
          <button
            onClick={() => setSilence(null)}
            className="rounded-md border border-border bg-surface-2 px-3 py-1 text-[12px] text-text-muted hover:text-text-primary"
          >
            {t('notifications.silence_off', 'Выкл')}
          </button>
        </div>
        {silenceUntil && (
          <span className="text-[11px] text-text-muted">
            До {new Date(silenceUntil).toLocaleString()}
          </span>
        )}
      </Card>
      <Card className="flex-col gap-2 p-5">
        <h3 className="font-display text-sm font-bold text-text-primary">{t('notifications.channels')}</h3>
        {channels.map((c) => {
          const on = enabled[c.id] ?? true
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => toggle(c.id)}
              className="flex items-center justify-between rounded-md px-1 py-1.5 hover:bg-surface-2"
            >
              <span className="flex items-center gap-2 text-[13px] text-text-secondary">{c.icon} {c.label}</span>
              <span className={`flex h-5 w-9 items-center rounded-full px-0.5 ${on ? 'bg-accent justify-end' : 'bg-surface-3 justify-start'}`}>
                <span className="h-4 w-4 rounded-full bg-text-primary" />
              </span>
            </button>
          )
        })}
      </Card>
    </>
  )
}

export default function NotificationsPage() {
  const { t } = useTranslation('pages')
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('all')

  const filter = TAB_TO_FILTER[tab]
  const list = useNotificationsQuery(filter)

  const markRead = useMarkRead()
  const markAll = useMarkAllRead()
  const acceptFriend = useAcceptFriend()
  const declineFriend = useDeclineFriend()

  // Stabilise the items array reference: `list.data?.items ?? []` would
  // create a fresh `[]` on every render when data is undefined and break
  // memoisation of the dependent useMemo hooks below.
  const items = useMemo(() => list.data?.items ?? [], [list.data?.items])
  const grouped = useMemo(() => groupByBucket(items), [items])

  // counters per tab. Используем общий `all` фетч для аккуратных counts,
  // но чтобы не жечь сеть — поднимем это из самих items только когда tab=='all'.
  const counts = useMemo(() => {
    const all = items.length
    let unread = 0
    let social = 0
    let match = 0
    let guild = 0
    let system = 0
    for (const n of items) {
      if (n.read_at == null) unread++
      if (n.channel === 'social') social++
      if (n.channel === 'match') match++
      if (n.channel === 'guild') guild++
      if (n.channel === 'system') system++
    }
    return { all, unread, social, match, guild, system }
  }, [items])

  const renderRow = (n: NotificationItem) => (
    <Row
      key={n.id}
      n={n}
      onMarkRead={() => markRead.mutate(n.id)}
      onAcceptFriend={(id) => acceptFriend.mutate(id)}
      onDeclineFriend={(id) => declineFriend.mutate(id)}
      // ArenaMatchPage at /arena/match/:matchId reads `?replay=1` to enter
      // replay mode (see MatchEndPage). The bare /…/replay segment is not
      // a registered route — fall through to NotFoundPage in production.
      onOpenReplay={(matchID) => navigate(`/arena/match/${matchID}?replay=1`)}
      onOpenPlan={() => navigate('/weekly')}
    />
  )

  return (
    <AppShellV2>
      <div className="flex flex-col gap-6 px-4 py-6 sm:px-8 lg:px-20 lg:py-8">
        <div className="flex flex-col items-start gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex flex-col gap-1.5">
            <h1 className="font-display text-2xl lg:text-[32px] font-bold text-text-primary">{t('notifications.title')}</h1>
            <p className="text-sm text-text-secondary">{t('notifications.unread', { n: counts.unread })}</p>
            {list.isError && <ErrorChip />}
          </div>
          <div className="flex flex-wrap gap-3">
            <Button
              variant="ghost"
              icon={<Check className="h-4 w-4" />}
              disabled={markAll.isPending || counts.unread === 0}
              onClick={() => markAll.mutate()}
            >
              {t('notifications.mark_all')}
            </Button>
            <Button variant="ghost" icon={<Settings className="h-4 w-4" />}>
              {t('notifications.settings')}
            </Button>
          </div>
        </div>

        <Tabs variant="pills" value={tab} onChange={(v) => setTab(v as Tab)}>
          <Tabs.List>
            <Tabs.Tab id="all">{t('notifications.all')} {counts.all}</Tabs.Tab>
            <Tabs.Tab id="unread_tab">{t('notifications.unread_tab')} {counts.unread}</Tabs.Tab>
            <Tabs.Tab id="social">{t('notifications.social')} {counts.social}</Tabs.Tab>
            <Tabs.Tab id="match">{t('notifications.match')} {counts.match}</Tabs.Tab>
            <Tabs.Tab id="guild">{t('notifications.guild')} {counts.guild}</Tabs.Tab>
            <Tabs.Tab id="system">{t('notifications.system')} {counts.system}</Tabs.Tab>
          </Tabs.List>
        </Tabs>

        <div className="flex flex-col gap-4 lg:flex-row lg:gap-6">
          <Card className="flex-1 flex-col gap-2 p-4">
            {list.isLoading ? (
              <div className="flex flex-col gap-3 p-4">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="h-16 animate-pulse rounded bg-surface-2" />
                ))}
              </div>
            ) : items.length === 0 ? (
              <div className="p-8 text-center text-sm text-text-secondary">
                {t('notifications.empty', 'Пока тихо — никаких уведомлений.')}
              </div>
            ) : (
              <>
                <Group label={t('notifications.today')} items={grouped.today} render={renderRow} />
                <Group label={t('notifications.yesterday')} items={grouped.yesterday} render={renderRow} />
                <Group label={t('notifications.this_week')} items={grouped.this_week} render={renderRow} />
                <Group label={t('notifications.older', 'РАНЬШЕ')} items={grouped.older} render={renderRow} />
              </>
            )}
          </Card>

          <div className="flex w-full flex-col gap-4 lg:w-[320px]">
            <SettingsPanel />
          </div>
        </div>
      </div>
    </AppShellV2>
  )
}
