// CohortPage — single cohort detail at /c/:slug.
//
// Designed against /Users/sedorofeevd/Downloads/Design Review v2.html
// § cohorts (lines 1903-1927):
//   Hero with gradient mark + name + status pill + members/capacity +
//   countdown + progress bar.
//   Segment-control "Участники / Streak / Invite" — three tabs.
//
// Anti-fallback:
//   - 404 → dedicated NotFound state, never invent a cohort
//   - empty leaderboard / members → EmptyState, never fake rows
//   - Streak tab is a placeholder card (the underlying daily/streak
//     aggregation by cohort isn't on the backend yet — honest about it)
import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Check, Copy, LogOut, Share2, Users, Zap } from 'lucide-react'
import { AppShellV2 } from '../components/AppShell'
import { Card } from '../components/Card'
import { Button } from '../components/Button'
import { EmptyState } from '../components/EmptyState'
import { cn } from '../lib/cn'
import { readAccessToken } from '../lib/apiClient'
import {
  useCohortLeaderboardQuery,
  useCohortQuery,
  useJoinCohortMutation,
  useLeaveCohortMutation,
} from '../lib/queries/cohort'
import { useProfileQuery } from '../lib/queries/profile'

type Tab = 'members' | 'streak' | 'invite'

const COHORT_CAPACITY_FALLBACK = 50

const TABS: { key: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: 'members', label: 'Участники', icon: Users },
  { key: 'streak', label: 'Streak', icon: Zap },
  { key: 'invite', label: 'Invite', icon: Share2 },
]

// Hash a string into one of N preset gradients (stable per cohort.id).
const GRADIENTS = [
  'linear-gradient(135deg,#582CFF,#22D3EE)',
  'linear-gradient(135deg,#EF4444,#FBBF24)',
  'linear-gradient(135deg,#10B981,#22D3EE)',
  'linear-gradient(135deg,#F472B6,#582CFF)',
  'linear-gradient(135deg,#FBBF24,#F472B6)',
] as const
function pickGradient(seed: string): string {
  let hash = 0
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0
  return GRADIENTS[hash % GRADIENTS.length]
}
function initialsOf(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return '?'
  const parts = trimmed.split(/\s+/)
  if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase()
  return trimmed.slice(0, 2).toUpperCase()
}
function daysUntil(iso: string): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000))
}
function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function CohortPage() {
  const { slug } = useParams<{ slug: string }>()
  const navigate = useNavigate()
  const detail = useCohortQuery(slug)
  const cohortID = detail.data?.cohort.id
  const leaderboard = useCohortLeaderboardQuery(cohortID)
  const profile = useProfileQuery()
  const isAuthed = !!readAccessToken()

  const [tab, setTab] = useState<Tab>('members')
  const [confirmingLeave, setConfirmingLeave] = useState(false)

  const join = useJoinCohortMutation()
  const leave = useLeaveCohortMutation()

  if (detail.isLoading) {
    return (
      <AppShellV2>
        <div className="px-4 py-8 sm:px-8 lg:px-20">
          <EmptyState variant="loading" skeletonLayout="single-card" />
        </div>
      </AppShellV2>
    )
  }
  if (!detail.data) {
    return (
      <AppShellV2>
        <div className="px-4 py-12 sm:px-8 lg:px-20">
          <EmptyState
            variant="404-not-found"
            title="Когорта не найдена"
            body="Ссылка устарела или когорта была расформирована."
            cta={{ label: '← К каталогу', onClick: () => navigate('/cohorts') }}
          />
        </div>
      </AppShellV2>
    )
  }

  const { cohort, members } = detail.data
  const isOwner = !!profile.data && cohort.owner_id === profile.data.id
  const isMember = isOwner || members.some((m) => m.user_id === profile.data?.id)
  const capacity = COHORT_CAPACITY_FALLBACK
  const progress = Math.min(100, Math.round((members.length / capacity) * 100))
  const days = daysUntil(cohort.ends_at)

  return (
    <AppShellV2>
      <div className="flex flex-col gap-6 px-4 pb-6 pt-6 sm:px-8 lg:px-20">
        <Link to="/cohorts" className="inline-flex items-center gap-1.5 text-[12px] text-text-secondary hover:text-text-primary">
          <ArrowLeft className="h-3.5 w-3.5" /> К каталогу когорт
        </Link>

        {/* Hero */}
        <Card
          className={cn(
            'flex-col items-stretch gap-4 p-5 sm:p-6',
            isMember && 'border-accent/40 bg-gradient-to-br from-surface-3/60 to-surface-1',
          )}
        >
          <div className="flex items-start gap-4">
            <div
              className="grid h-14 w-14 shrink-0 place-items-center rounded-lg font-display text-lg font-bold text-white"
              style={{ background: pickGradient(cohort.id) }}
              aria-hidden="true"
            >
              {initialsOf(cohort.name)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="font-display text-xl font-bold text-text-primary sm:text-2xl">{cohort.name}</h1>
                <span
                  className={cn(
                    'shrink-0 rounded-full px-2 py-0.5 font-mono text-[10px] font-bold uppercase',
                    cohort.status === 'active'
                      ? 'bg-success/20 text-success'
                      : cohort.status === 'graduated'
                        ? 'bg-cyan/20 text-cyan'
                        : 'bg-surface-2 text-text-muted',
                  )}
                >
                  ● {cohort.status === 'active' ? 'active' : cohort.status === 'graduated' ? 'finished' : 'cancelled'}
                </span>
                {isMember && (
                  <span className="shrink-0 rounded-md bg-accent/20 px-2 py-0.5 font-mono text-[10px] font-semibold text-accent-hover">
                    ТЫ {isOwner && '· OWNER'}
                  </span>
                )}
              </div>
              <p className="mt-1 font-mono text-[11px] text-text-muted">/c/{cohort.slug}</p>
              <p className="mt-2 text-sm text-text-secondary">
                {fmtDate(cohort.starts_at)} → {fmtDate(cohort.ends_at)}
                {cohort.status === 'active' && days > 0 && ` · осталось ${days}d`}
              </p>
            </div>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Участников" value={`${members.length}/${capacity}`} />
            <Stat label="Видимость" value={cohort.visibility === 'public' ? 'Публичная' : 'По приглашению'} />
            <Stat label="Статус" value={cohort.status === 'active' ? 'Идёт' : 'Завершена'} />
          </div>

          {/* Progress bar */}
          <div>
            <div className="mb-1 flex items-center justify-between text-[10px] text-text-muted">
              <span>Заполненность</span>
              <span className="font-mono">{progress}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
              <div
                className={cn('h-full', progress >= 80 ? 'bg-accent' : 'bg-gradient-to-r from-accent to-cyan')}
                style={{ width: `${Math.max(4, progress)}%` }}
              />
            </div>
          </div>

          {/* CTAs */}
          {isAuthed && cohort.status === 'active' && (
            <div className="flex flex-wrap gap-2">
              {!isMember && members.length < capacity && (
                <Button
                  onClick={() => join.mutate(cohort.id)}
                  disabled={join.isPending}
                >
                  {join.isPending ? 'Присоединяемся…' : '+ Присоединиться'}
                </Button>
              )}
              {!isMember && members.length >= capacity && (
                <Button disabled>Когорта заполнена</Button>
              )}
            </div>
          )}
        </Card>

        {/* Tabs */}
        <div className="flex gap-1 rounded-md border border-border bg-surface-2 p-0.5 font-mono text-[11px] uppercase">
          {TABS.map((t) => {
            const Icon = t.icon
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={cn(
                  'flex flex-1 items-center justify-center gap-1.5 rounded-sm px-2.5 py-1.5 transition-colors',
                  tab === t.key
                    ? 'bg-accent font-bold text-white'
                    : 'text-text-muted hover:text-text-secondary',
                )}
              >
                <Icon className="h-3 w-3" /> {t.label}
              </button>
            )
          })}
        </div>

        {/* Tab content */}
        {tab === 'members' && (
          <MembersTab
            members={members}
            leaderboard={leaderboard.data?.items ?? []}
            leaderboardLoading={leaderboard.isLoading}
            selfID={profile.data?.id}
          />
        )}
        {tab === 'streak' && <StreakTab />}
        {tab === 'invite' && (
          <InviteTab cohort={cohort} canShare={isMember} visibility={cohort.visibility} />
        )}

        {/* Danger zone */}
        {isMember && cohort.status === 'active' && (
          <DangerZone
            isOwner={isOwner}
            confirming={confirmingLeave}
            onAsk={() => setConfirmingLeave(true)}
            onCancel={() => setConfirmingLeave(false)}
            onConfirm={() => {
              leave.mutate(cohort.id, {
                onSuccess: (res) => {
                  setConfirmingLeave(false)
                  if (res.status === 'disbanded') {
                    navigate('/cohorts')
                  }
                },
              })
            }}
            pending={leave.isPending}
          />
        )}
      </div>
    </AppShellV2>
  )
}

// ── primitives ────────────────────────────────────────────────────────────

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-surface-2/50 px-2 py-1.5">
      <div className="font-mono text-[9px] uppercase tracking-wide text-text-muted">{label}</div>
      <div className="mt-0.5 truncate text-sm font-semibold text-text-primary">{value}</div>
    </div>
  )
}

// ── tabs ──────────────────────────────────────────────────────────────────

type Member = { user_id: string; role: string; joined_at: string; display_name?: string }
type LBRow = { user_id: string; display_name: string; overall_elo: number; weekly_xp: number }

function MembersTab({
  members,
  leaderboard,
  leaderboardLoading,
  selfID,
}: {
  members: Member[]
  leaderboard: LBRow[]
  leaderboardLoading: boolean
  selfID?: string
}) {
  // Merge leaderboard ELO into the members list (by user_id) so each row
  // can show «GOLD II · +42» style stats per the v2 design.
  const merged = useMemo(() => {
    const byID = new Map(leaderboard.map((r) => [r.user_id, r]))
    return members
      .map((m) => ({
        ...m,
        elo: byID.get(m.user_id)?.overall_elo ?? null,
        weekly_xp: byID.get(m.user_id)?.weekly_xp ?? null,
      }))
      .sort((a, b) => (b.elo ?? -1) - (a.elo ?? -1))
  }, [members, leaderboard])

  if (members.length === 0) {
    return (
      <EmptyState
        variant="no-data"
        title="В когорте пока никого нет"
        body="Когда люди присоединятся, они окажутся здесь."
      />
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {leaderboardLoading && (
        <p className="font-mono text-[10px] text-text-muted">Загружаем рейтинг…</p>
      )}
      {merged.map((m, i) => {
        const isSelf = m.user_id === selfID
        const isPodium = i < 3 && m.elo !== null
        return (
          <div
            key={m.user_id}
            className={cn(
              'flex items-center gap-3 rounded-lg border px-3 py-2',
              isSelf ? 'border-accent/40 bg-accent/10' : 'border-transparent bg-surface-2/50',
            )}
          >
            <span
              className={cn(
                'w-6 text-center font-display text-[13px] font-bold',
                isPodium && i === 0 ? 'text-warn' : isPodium ? 'text-text-secondary' : 'text-text-muted',
              )}
            >
              {i + 1}
            </span>
            <div
              className="grid h-7 w-7 place-items-center rounded-full font-display text-[10px] font-bold text-white"
              style={{ background: pickGradient(m.user_id) }}
            >
              {(m.display_name?.[0] ?? '?').toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-sm font-semibold text-text-primary">
                <span className="truncate">{isSelf ? 'ты' : m.display_name || m.user_id.slice(0, 8)}</span>
                {m.role !== 'member' && (
                  <span className="rounded bg-cyan/15 px-1 font-mono text-[9px] uppercase text-cyan">
                    {m.role}
                  </span>
                )}
              </div>
              <div className="font-mono text-[10px] text-text-muted">
                {m.elo !== null ? `${m.elo} ELO` : 'нет рейтинга'}
                {m.weekly_xp !== null && ` · +${m.weekly_xp} xp/нед`}
              </div>
            </div>
            {m.elo !== null && (
              <span className="font-display text-[14px] font-bold text-warn">{m.elo}</span>
            )}
          </div>
        )
      })}
    </div>
  )
}

function StreakTab() {
  // Honest placeholder — backend doesn't yet aggregate daily streaks per
  // cohort. Surface the gap rather than fake a heatmap.
  return (
    <EmptyState
      variant="coming-soon"
      title="Streak-трекер скоро"
      body="Здесь будет недельный heatmap: кто решал каждый день, кто ронял streak. Пока готовим агрегат на бэкенде."
    />
  )
}

function InviteTab({
  cohort,
  canShare,
  visibility,
}: {
  cohort: { slug: string; name: string }
  canShare: boolean
  visibility: string
}) {
  const [copied, setCopied] = useState(false)
  const url = typeof window !== 'undefined' ? `${window.location.origin}/c/${cohort.slug}` : `/c/${cohort.slug}`

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* user can copy manually from the readonly input */
    }
  }

  if (!canShare) {
    return (
      <EmptyState
        variant="no-data"
        title="Только для участников"
        body="Чтобы пригласить друга, сначала присоединись к когорте."
      />
    )
  }

  return (
    <Card className="flex-col items-stretch gap-4 p-5">
      <div>
        <div className="font-mono text-[10px] uppercase tracking-wide text-text-muted">
          публичная ссылка
        </div>
        <div className="mt-2 flex gap-2">
          <input
            readOnly
            value={url}
            className="h-9 flex-1 rounded-md border border-border bg-surface-2 px-2 font-mono text-[12px] text-text-primary"
            onFocus={(e) => e.currentTarget.select()}
          />
          <button
            type="button"
            onClick={onCopy}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-3 text-[12px] text-text-secondary hover:text-text-primary"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? 'Скопировано' : 'Копировать'}
          </button>
        </div>
      </div>

      {visibility === 'invite' ? (
        <div className="rounded-md border border-cyan/30 bg-cyan/5 p-3 text-xs text-cyan">
          Когорта по приглашению — ссылка пускает только тех, кто получил её от тебя или
          другого участника. Публикация в каналах не сработает.
        </div>
      ) : (
        <div className="rounded-md border border-border bg-surface-2 p-3 text-xs text-text-secondary">
          Когорта публичная: любой по ссылке зайдёт в каталог и увидит «Присоединиться».
        </div>
      )}

      <div>
        <div className="mb-2 font-mono text-[10px] uppercase tracking-wide text-text-muted">
          одноразовый invite-токен
        </div>
        <div className="rounded-md border border-warn/30 bg-warn/5 px-3 py-2 text-xs text-warn">
          В разработке: API IssueInvite (cohort.app.IssueInvite) сейчас Phase-2 stub.
          Скоро добавим генерацию ссылок на N приглашений с истекающим сроком.
        </div>
      </div>
    </Card>
  )
}

function DangerZone({
  isOwner,
  confirming,
  onAsk,
  onCancel,
  onConfirm,
  pending,
}: {
  isOwner: boolean
  confirming: boolean
  onAsk: () => void
  onCancel: () => void
  onConfirm: () => void
  pending: boolean
}) {
  const verb = isOwner ? 'Распустить когорту' : 'Покинуть когорту'
  const note = isOwner
    ? 'Если ты — последний участник, когорта будет распущена и удалена.'
    : 'Если ты — последний участник, когорта будет распущена.'
  return (
    <Card className="flex-col items-stretch gap-3 border-danger/30 p-4">
      <div className="flex items-center gap-2">
        <LogOut className="h-4 w-4 text-danger" />
        <h3 className="font-display text-sm font-bold text-text-primary">Опасная зона</h3>
      </div>
      <p className="text-xs text-text-secondary">{note}</p>
      {confirming ? (
        <div className="flex flex-wrap gap-2">
          <Button onClick={onConfirm} disabled={pending}>
            {pending ? 'Уходим…' : `Подтвердить · ${verb.toLowerCase()}`}
          </Button>
          <Button variant="ghost" onClick={onCancel} disabled={pending}>
            Назад
          </Button>
        </div>
      ) : (
        <button
          type="button"
          onClick={onAsk}
          className="inline-flex w-fit items-center gap-1.5 rounded-md border border-danger/40 bg-danger/10 px-3 py-1.5 text-xs font-semibold text-danger hover:bg-danger/20"
        >
          {verb}
        </button>
      )}
    </Card>
  )
}
