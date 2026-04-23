// NotificationCard — single in-feed notification row.
//
// Discriminated union by `kind` derived from the backend `type` string:
//   - match-invite          → accept / decline inline (challenge type)
//   - achievement-unlocked  → "view" arrow CTA
//   - friend-request        → accept / decline inline (friendship_id payload)
//   - coach-insight-ready   → open arrow (plan_id / insight_id payload)
//   - system-alert          → warn icon + body, optional href
//   - cohort-message        → cohort avatar + first line
//
// Color map per design _rules.md:
//   - g-pc gradient (pink→cyan) for AI / coach insight (territory marker)
//   - success for achievements
//   - warn for system-alert
//   - accent for primary CTAs (accept, view)
//   - danger reserved for the badge dot only — NOT used here
//
// Anti-fallback: if the `type` doesn't map to a known kind we render a
// minimal "system-alert"-style row instead of inventing an action. The
// caller still sees the title/body so nothing is silently dropped.

import { Check, X, Award, ArrowRight, AlertTriangle, Sparkles, Users, Swords } from 'lucide-react'
import { Avatar, type AvatarGradient } from '../Avatar'
import { cn } from '../../lib/cn'
import type { NotificationItem } from '../../lib/queries/notifications'

export type CardKind =
  | 'match-invite'
  | 'achievement-unlocked'
  | 'friend-request'
  | 'coach-insight-ready'
  | 'system-alert'
  | 'cohort-message'

export function kindFromType(t: string): CardKind {
  switch (t) {
    case 'challenge':
    case 'match_invite':
      return 'match-invite'
    case 'achievement_unlocked':
      return 'achievement-unlocked'
    case 'friend_request':
      return 'friend-request'
    case 'plan_ready':
    case 'coach_insight':
    case 'insight_ready':
      return 'coach-insight-ready'
    case 'cohort_message':
      return 'cohort-message'
    default:
      return 'system-alert'
  }
}

function relativeTime(iso: string, now: Date = new Date()): string {
  const d = new Date(iso)
  const diffMs = now.getTime() - d.getTime()
  const min = Math.floor(diffMs / 60_000)
  if (min < 1) return 'сейчас'
  if (min < 60) return `${min} мин`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} ч`
  const days = Math.floor(hr / 24)
  if (days === 1) return 'вчера'
  if (days < 7) return `${days} дн`
  return d.toLocaleDateString()
}

export type NotificationCardProps = {
  item: NotificationItem
  onMarkRead?: (id: number) => void
  onAcceptFriend?: (friendshipID: number) => void
  onDeclineFriend?: (friendshipID: number) => void
  onAcceptMatch?: (matchID: string) => void
  onDeclineMatch?: (matchID: string) => void
  onOpenInsight?: (id: string) => void
  onOpenAchievement?: (id: string) => void
  onOpenCohort?: (id: string) => void
  onOpenSystem?: (href: string) => void
}

export function NotificationCard(props: NotificationCardProps) {
  const { item } = props
  const kind = kindFromType(item.type)
  const unread = item.read_at == null

  const handleAreaClick = () => {
    if (unread) props.onMarkRead?.(item.id)
  }

  return (
    <div
      onMouseEnter={handleAreaClick}
      className={cn(
        'group flex items-start gap-3 px-4 py-3 transition-colors',
        unread ? 'bg-accent/5' : 'bg-transparent',
        'hover:bg-surface-2',
      )}
    >
      <UnreadDot unread={unread} />
      <Glyph item={item} kind={kind} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <Header item={item} kind={kind} />
        <Footer kind={kind} {...props} />
      </div>
    </div>
  )
}

function UnreadDot({ unread }: { unread: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'mt-2 h-1.5 w-1.5 shrink-0 rounded-full',
        unread ? 'bg-accent' : 'bg-transparent',
      )}
    />
  )
}

// Glyph — left-side avatar/icon. Coach insights use the pink→cyan g-pc
// territory marker; achievements use success; system-alert uses warn;
// friend / cohort show a real avatar gradient via gradientForUser.
function Glyph({ item, kind }: { item: NotificationItem; kind: CardKind }) {
  const username = (item.payload?.username as string | undefined) ?? ''
  switch (kind) {
    case 'coach-insight-ready':
      return (
        <span
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full"
          style={{ background: 'linear-gradient(135deg, rgb(244,114,182) 0%, rgb(34,211,238) 100%)' }}
        >
          <Sparkles className="h-4 w-4 text-white" />
        </span>
      )
    case 'achievement-unlocked':
      return (
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-success/20">
          <Award className="h-4 w-4 text-success" />
        </span>
      )
    case 'system-alert':
      return (
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-warn/20">
          <AlertTriangle className="h-4 w-4 text-warn" />
        </span>
      )
    case 'match-invite':
      return (
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent/20">
          <Swords className="h-4 w-4 text-accent-hover" />
        </span>
      )
    case 'friend-request':
      return username ? (
        <Avatar size="lg" gradient={mapGradient(username)} initials={username.slice(0, 1).toUpperCase()} />
      ) : (
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent/20">
          <Users className="h-4 w-4 text-accent-hover" />
        </span>
      )
    case 'cohort-message':
      return (
        <Avatar
          size="lg"
          gradient={mapGradient((item.payload?.cohort_slug as string | undefined) ?? item.title)}
          initials={(item.title || 'C').slice(0, 1).toUpperCase()}
        />
      )
  }
}

// Deterministic preset pick per seed string — same shape as the canonical
// gradientForUser() bucket logic (hash → mod N), but mapped onto the Avatar
// preset names so we don't bypass the shared component's API.
const PRESETS: AvatarGradient[] = ['pink-violet', 'cyan-violet', 'pink-red', 'success-cyan', 'gold']
function mapGradient(seed: string): AvatarGradient {
  if (!seed) return PRESETS[0]
  let sum = 0
  for (let i = 0; i < seed.length; i++) sum += seed.charCodeAt(i)
  return PRESETS[sum % PRESETS.length]
}

function Header({ item }: { item: NotificationItem; kind: CardKind }) {
  return (
    <div className="text-sm text-text-primary">
      <b className="font-semibold">{item.title}</b>
      {item.body ? (
        <>
          {' · '}
          <span className="text-text-secondary">{item.body}</span>
        </>
      ) : null}
      <div className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-text-muted">
        {relativeTime(item.created_at)}
      </div>
    </div>
  )
}

function Footer({ item, kind, ...props }: NotificationCardProps & { kind: CardKind }) {
  // `item` is part of NotificationCardProps; we read it directly. The
  // remaining `props` carries action callbacks only.
  switch (kind) {
    case 'friend-request': {
      const fid = item.payload?.friendship_id as number | undefined
      if (!fid) return null
      return (
        <div className="flex gap-2 pt-1">
          <ActionBtn
            tone="primary"
            icon={<Check className="h-3 w-3" />}
            onClick={() => props.onAcceptFriend?.(fid)}
          >
            Принять
          </ActionBtn>
          <ActionBtn tone="ghost" icon={<X className="h-3 w-3" />} onClick={() => props.onDeclineFriend?.(fid)}>
            Отклонить
          </ActionBtn>
        </div>
      )
    }
    case 'match-invite': {
      const mid = item.payload?.match_id as string | undefined
      return (
        <div className="flex gap-2 pt-1">
          <ActionBtn
            tone="primary"
            icon={<Check className="h-3 w-3" />}
            onClick={() => mid && props.onAcceptMatch?.(mid)}
            disabled={!mid}
          >
            Принять
          </ActionBtn>
          <ActionBtn
            tone="ghost"
            icon={<X className="h-3 w-3" />}
            onClick={() => mid && props.onDeclineMatch?.(mid)}
            disabled={!mid}
          >
            Отклонить
          </ActionBtn>
        </div>
      )
    }
    case 'achievement-unlocked': {
      const aid = (item.payload?.achievement_id as string | undefined) ?? ''
      return (
        <button
          type="button"
          onClick={() => props.onOpenAchievement?.(aid)}
          className="inline-flex items-center gap-1 pt-1 text-left text-xs font-semibold text-success hover:brightness-110"
        >
          Посмотреть <ArrowRight className="h-3 w-3" />
        </button>
      )
    }
    case 'coach-insight-ready': {
      const id = (item.payload?.plan_id as string | undefined) ?? (item.payload?.insight_id as string | undefined) ?? ''
      return (
        <button
          type="button"
          onClick={() => props.onOpenInsight?.(id)}
          className="inline-flex items-center gap-1 pt-1 text-left text-xs font-semibold hover:brightness-110"
          style={{ background: 'linear-gradient(90deg, rgb(244,114,182), rgb(34,211,238))', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}
        >
          Открыть инсайт <ArrowRight className="h-3 w-3 text-cyan" />
        </button>
      )
    }
    case 'cohort-message': {
      const cid = (item.payload?.cohort_id as string | undefined) ?? ''
      return (
        <button
          type="button"
          onClick={() => props.onOpenCohort?.(cid)}
          className="inline-flex items-center gap-1 pt-1 text-left text-xs font-semibold text-accent-hover hover:text-accent"
        >
          Открыть когорту <ArrowRight className="h-3 w-3" />
        </button>
      )
    }
    case 'system-alert': {
      const href = item.payload?.href as string | undefined
      if (!href) return null
      return (
        <button
          type="button"
          onClick={() => props.onOpenSystem?.(href)}
          className="inline-flex items-center gap-1 pt-1 text-left text-xs font-semibold text-warn hover:brightness-110"
        >
          Подробнее <ArrowRight className="h-3 w-3" />
        </button>
      )
    }
  }
}

function ActionBtn({
  children,
  tone,
  icon,
  onClick,
  disabled,
}: {
  children: React.ReactNode
  tone: 'primary' | 'ghost'
  icon?: React.ReactNode
  onClick?: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex h-7 items-center gap-1 rounded-md px-2.5 text-[12px] font-semibold transition-colors disabled:opacity-50',
        tone === 'primary'
          ? 'bg-accent text-white hover:bg-accent-hover'
          : 'border border-border bg-surface-2 text-text-secondary hover:text-text-primary',
      )}
    >
      {icon}
      {children}
    </button>
  )
}
