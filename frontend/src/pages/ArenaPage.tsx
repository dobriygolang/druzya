import {
  ArrowRight,
  Check,
  Loader2,
  Sparkles,
  Swords,
  Users,
  Video,
  X,
  Zap,
  Bot,
  FileCode,
  DoorOpen,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { AppShellV2 } from '../components/AppShell'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { Avatar } from '../components/Avatar'
import type { ReactNode } from 'react'
import { useRatingMeQuery, useLeaderboardQuery } from '../lib/queries/rating'
import {
  useCancelSearchMutation,
  useCurrentMatchQuery,
  useFindMatchMutation,
  type ArenaModeKey,
  type SectionKey,
} from '../lib/queries/arena'
import { useAIModelsQuery, type AIModel } from '../lib/queries/ai'
import { useProfileQuery } from '../lib/queries/profile'

// Queue-wait timeout (seconds) — after this many seconds without a match we
// show the user a clear "никого нет в очереди" message and auto-cancel, so the
// UI никогда не висит молча. Bible §11 — no silent fallback.
const QUEUE_TIMEOUT_SEC = 60

type PartyMode = 'solo' | 'party'

const SECTIONS: SectionKey[] = ['algorithms', 'sql', 'go', 'system_design', 'behavioral']

function HeaderRow({
  partyMode,
  onTogglePartyMode,
}: {
  partyMode: PartyMode
  onTogglePartyMode: (next: PartyMode) => void
}) {
  const { t } = useTranslation('arena')
  const { data: rating, isError } = useRatingMeQuery()
  const totalMatches = rating?.ratings?.reduce((acc, r) => acc + r.matches_count, 0) ?? 0
  return (
    <div className="flex flex-col items-start gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div className="flex flex-col gap-1.5">
        <h1 className="font-display text-2xl font-bold leading-[1.1] text-text-primary lg:text-[32px]">
          {t('title')}
        </h1>
        <p className="text-sm text-text-secondary">
          {isError
            ? t('subtitle_error')
            : t('subtitle_played', { count: totalMatches })}
        </p>
      </div>
      <div
        role="tablist"
        aria-label="Party / Solo"
        className="flex items-center gap-1 rounded-xl border border-border bg-surface-1 p-1"
      >
        <button
          type="button"
          role="tab"
          aria-selected={partyMode === 'solo'}
          onClick={() => onTogglePartyMode('solo')}
          className={[
            'inline-flex items-center gap-2 rounded-lg px-3 py-1.5 font-mono text-[11px] font-semibold tracking-[0.08em] transition-colors',
            partyMode === 'solo'
              ? 'bg-accent text-text-primary shadow-glow'
              : 'text-text-muted hover:text-text-primary',
          ].join(' ')}
        >
          <Avatar size="sm" gradient="violet-cyan" initials="Я" />
          {t('solo')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={partyMode === 'party'}
          onClick={() => onTogglePartyMode('party')}
          className={[
            'inline-flex items-center gap-2 rounded-lg px-3 py-1.5 font-mono text-[11px] font-semibold tracking-[0.08em] transition-colors',
            partyMode === 'party'
              ? 'bg-accent text-text-primary shadow-glow'
              : 'text-text-muted hover:text-text-primary',
          ].join(' ')}
        >
          <Users className="h-3.5 w-3.5" />
          {t('party')}
        </button>
      </div>
    </div>
  )
}

type HeroQueueProps = {
  inQueue: boolean
  waitSeconds: number
  isSubmitting: boolean
  errorMessage: string | null
  selectedSection: SectionKey
  onSelectSection: (s: SectionKey) => void
  onFind: () => void
  onCancel: () => void
}

function HeroQueue({
  inQueue,
  waitSeconds,
  isSubmitting,
  errorMessage,
  selectedSection,
  onSelectSection,
  onFind,
  onCancel,
}: HeroQueueProps) {
  const { t } = useTranslation('arena')
  return (
    <div className="flex w-full flex-col items-start justify-between gap-4 rounded-xl border border-border-strong bg-gradient-to-br from-surface-2 to-surface-3 p-5 shadow-card sm:p-7 lg:flex-row lg:items-center">
      <div className="flex min-w-0 flex-col gap-3">
        <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-accent/15 px-2.5 py-1 font-mono text-[11px] font-semibold tracking-[0.08em] text-accent-hover">
          <Swords className="h-3 w-3" /> {t('ranked_1v1_tag')}
        </span>
        <h2 className="font-display text-[28px] font-bold text-text-primary">
          {inQueue
            ? t('searching_for_opponent', {
                sec: waitSeconds,
              })
            : t('ready_for_match')}
        </h2>
        <div className="flex flex-wrap gap-1.5">
          {SECTIONS.map((s) => (
            <button
              key={s}
              type="button"
              disabled={inQueue || isSubmitting}
              onClick={() => onSelectSection(s)}
              className={[
                'rounded-full px-3 py-1 font-mono text-[11px] font-semibold uppercase tracking-wider transition-colors',
                selectedSection === s
                  ? 'bg-accent text-bg'
                  : 'border border-border bg-surface-1 text-text-secondary hover:bg-surface-2',
                inQueue || isSubmitting ? 'cursor-not-allowed opacity-60' : '',
              ].join(' ')}
            >
              {s}
            </button>
          ))}
        </div>
        {errorMessage && (
          <p className="font-mono text-xs text-danger">{errorMessage}</p>
        )}
      </div>
      {inQueue ? (
        <Button
          variant="ghost"
          icon={<X className="h-[18px] w-[18px]" />}
          className="px-6 py-3.5 text-sm"
          onClick={onCancel}
          disabled={isSubmitting}
        >
          {t('cancel_search')}
        </Button>
      ) : (
        <Button
          variant="primary"
          icon={
            isSubmitting ? (
              <Loader2 className="h-[18px] w-[18px] animate-spin" />
            ) : (
              <Swords className="h-[18px] w-[18px]" />
            )
          }
          iconRight={<ArrowRight className="h-4 w-4" />}
          className="px-6 py-3.5 text-sm shadow-glow"
          onClick={onFind}
          disabled={isSubmitting}
        >
          {t('find_opponent')}
        </Button>
      )}
    </div>
  )
}

// DynamicModelTile renders an AI model from the live backend catalogue.
// Premium models are rendered with a 💎 badge. If the current user isn't
// premium, the tile is locked (visually + click ignored) with a tooltip.
function DynamicModelTile({
  m,
  selected,
  locked,
  onSelect,
}: {
  m: AIModel
  selected: boolean
  locked: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={locked}
      aria-pressed={selected}
      title={locked ? 'Доступно с подпиской premium/pro' : undefined}
      className={[
        'flex h-full min-w-0 flex-col justify-between gap-2 rounded-lg border p-3.5 text-left transition-colors',
        selected
          ? 'border-accent bg-accent/10 shadow-glow'
          : locked
            ? 'cursor-not-allowed border-border bg-surface-1 opacity-60'
            : 'border-border bg-surface-1 hover:border-border-strong',
      ].join(' ')}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate font-display text-sm font-bold text-text-primary">
            {m.label}
          </span>
          <span className="truncate font-mono text-[10px] text-text-muted">{m.provider}</span>
        </div>
        {selected ? (
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent/30">
            <Check className="h-3.5 w-3.5 text-accent-hover" />
          </span>
        ) : (
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-surface-3">
            <Bot className="h-3.5 w-3.5 text-text-muted" />
          </span>
        )}
      </div>
      <div className="flex items-center justify-between gap-2">
        {m.tier === 'free' ? (
          <span className="rounded-full bg-success/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-success">
            FREE
          </span>
        ) : (
          <span className="rounded-full bg-warn/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-warn">
            💎 PREMIUM
          </span>
        )}
      </div>
    </button>
  )
}

function AiPanel({
  selectedModel,
  onSelectModel,
}: {
  selectedModel: string
  onSelectModel: (key: string) => void
}) {
  const { t } = useTranslation('arena')
  // Real backend catalogue. When OPENROUTER_API_KEY is missing → items=[],
  // available=false → entire panel hidden (no fake models, anti-fallback).
  const ai = useAIModelsQuery()
  const profile = useProfileQuery()
  const userTier = profile.data?.tier ?? 'free'
  const isPremiumUser = userTier === 'premium' || userTier === 'pro'

  if (ai.isLoading) {
    return (
      <Card className="flex-col gap-4 p-5" interactive={false}>
        <div className="h-24 animate-pulse rounded-lg bg-surface-2" />
      </Card>
    )
  }
  // No models available (key missing or backend unhealthy) — hide silently.
  if (ai.isError || !ai.data?.available || ai.data.items.length === 0) {
    return null
  }

  const items = ai.data.items
  const selectedItem = items.find((m) => m.id === selectedModel) ?? items[0]
  return (
    <Card className="flex-col gap-4 p-5" interactive={false}>
      <div className="flex flex-col items-start justify-between gap-2 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-col gap-1">
          <h3 className="flex items-center gap-2 font-display text-lg font-bold text-text-primary">
            <Sparkles className="h-4 w-4 text-pink" />
            {t('ai_opponent_title')}
          </h3>
          <p className="text-xs text-text-secondary">
            {t('ai_opponent_desc', {
            })}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 font-mono text-[11px] text-text-muted">
          {t('current_model', {
            name: selectedItem?.label ?? '—',
          })}
        </span>
      </div>
      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {items.map((m) => {
          const locked = m.tier === 'premium' && !isPremiumUser
          return (
            <DynamicModelTile
              key={m.id}
              m={m}
              selected={selectedModel === m.id}
              locked={locked}
              onSelect={() => {
                if (locked) return
                onSelectModel(m.id)
              }}
            />
          )
        })}
      </div>
    </Card>
  )
}

type Mode = {
  key:
    | 'ranked_1v1'
    | 'casual_1v1'
    | 'ranked_2v2'
    | 'mock'
    | 'pair_code'
    | 'custom_lobby'
  name: string
  desc: string
  count: number | string
  time: string
  icon: ReactNode
  gradient: string
  /** Which arena queue to enqueue into. Ignored for non-queue modes
   *  (mock, pair_code) which navigate instead of enqueue. */
  arenaMode: ArenaModeKey
  /** True if this card needs the user to be in Party mode (2v2). */
  requiresParty: boolean
  /** True for the AI cards — selected neural model is shown / used. */
  aiPowered: boolean
}

const MODES: Mode[] = [
  {
    key: 'ranked_1v1',
    name: 'Ranked 1v1',
    desc: 'Классика. Алгоритмы, рейтинг, LP.',
    count: 412,
    time: '~12с',
    icon: <Swords className="h-7 w-7 text-text-primary" />,
    gradient: 'from-accent to-pink',
    arenaMode: 'ranked',
    requiresParty: false,
    aiPowered: false,
  },
  {
    key: 'casual_1v1',
    name: 'Casual 1v1',
    desc: 'Без рейтинга, для практики.',
    count: 286,
    time: '~8с',
    icon: <Zap className="h-7 w-7 text-text-primary" />,
    gradient: 'from-cyan to-accent',
    arenaMode: 'solo_1v1',
    requiresParty: false,
    aiPowered: false,
  },
  {
    key: 'ranked_2v2',
    name: 'Ranked 2v2',
    desc: 'Командный режим, парный код.',
    count: 168,
    time: '~24с',
    icon: <Users className="h-7 w-7 text-text-primary" />,
    gradient: 'from-pink to-warn',
    arenaMode: 'duo_2v2',
    requiresParty: true,
    aiPowered: false,
  },
  {
    key: 'mock',
    name: 'Mock Interview',
    desc: 'Симуляция собеса с компанией, многоэтапный (screening → algo → sys-design → behavioral). AI-помощник опционально.',
    count: 94,
    time: '~45с',
    icon: <Video className="h-7 w-7 text-text-primary" />,
    gradient: 'from-success to-cyan',
    arenaMode: 'hardcore',
    requiresParty: false,
    aiPowered: true,
  },
  {
    key: 'pair_code',
    name: 'Pair Code',
    desc: 'Совместный редактор кода — live-кодинг как yandex-code / code-interview.',
    count: '—',
    time: '—',
    icon: <FileCode className="h-7 w-7 text-text-primary" />,
    gradient: 'from-cyan to-pink',
    // arenaMode не используется — карточка ведёт на /pair (см. handleModeClick).
    arenaMode: 'ranked',
    requiresParty: false,
    aiPowered: false,
  },
  {
    key: 'custom_lobby',
    name: 'Custom Lobby',
    desc: 'Создай приватную комнату, позови друзей по коду или ссылке.',
    count: '—',
    time: '—',
    icon: <DoorOpen className="h-7 w-7 text-text-primary" />,
    gradient: 'from-cyan to-success',
    // arenaMode не используется — карточка ведёт на /lobbies (см. handleModeClick).
    arenaMode: 'ranked',
    requiresParty: false,
    aiPowered: false,
  },
]
// WAVE-11: Custom Lobby ВОССТАНОВЛЕН после Wave-4 удаления — теперь у фичи
// есть реальный backend (services/lobby + 8 REST-endpoints в /api/v1/lobby/*),
// 4-буквенные коды для приглашений и единая страница /lobby/{id} с
// auto-redirect в /arena/match/{matchId} на старте. Practice vs AI остаётся
// удалённым (Wave-4 bugfix): бот решал быстрее человека и матч не
// синхронизировался с WS-хабом — Mock-interview покрывает AI-практику лучше.

function ModeCard({
  m,
  onClick,
  isPending,
  selectedModel,
}: {
  m: Mode
  onClick: () => void
  isPending: boolean
  selectedModel: string
}) {
  const { t } = useTranslation('arena')
  const ai = useAIModelsQuery()
  const modelName = useMemo(
    () => ai.data?.items.find((mm) => mm.id === selectedModel)?.label ?? '—',
    [selectedModel, ai.data],
  )
  return (
    <Card className="flex-col gap-4 p-5" interactive>
      <button
        type="button"
        onClick={onClick}
        disabled={isPending}
        aria-label={`${t('enter')} — ${m.name}`}
        className="absolute inset-0 z-10 cursor-pointer rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:cursor-wait"
      />
      <div
        className={`grid h-16 w-16 place-items-center rounded-xl bg-gradient-to-br ${m.gradient} shadow-card`}
      >
        {m.icon}
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <h3 className="font-display text-lg font-bold text-text-primary">{m.name}</h3>
        <p className="text-xs text-text-secondary">{m.desc}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
        </span>
        <span className="font-mono text-[11px] text-text-muted">
          {typeof m.count === 'number'
            ? t('in_queue', { count: m.count, time: m.time })
            : `${m.count} · ${m.time}`}
        </span>
        {m.aiPowered && (
          <span className="inline-flex items-center gap-1 rounded-full bg-pink/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-pink">
            <Bot className="h-3 w-3" />
            {modelName}
          </span>
        )}
      </div>
      <span className="mt-auto inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-border bg-surface-1 py-2 font-sans text-[13px] font-semibold text-text-primary">
        {isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <ArrowRight className="h-4 w-4" />
        )}
        {t('enter')}
      </span>
    </Card>
  )
}

function FriendsStrip({ onCreateParty }: { onCreateParty: () => void }) {
  const { t } = useTranslation('arena')
  const { data: lb } = useLeaderboardQuery('algorithms')
  const gradients = ['violet-cyan', 'pink-violet', 'cyan-violet', 'success-cyan'] as const
  const top = lb?.entries?.slice(0, 4) ?? []
  // Anti-fallback: ранее тут был hardcode @alexey/@kirill_dev/@nastya/@misha,
  // который вводил пользователя в заблуждение (фейковые "онлайн друзья").
  // Если бэк не отдал лидерборд — показываем пустую панель с CTA, а не
  // придуманные имена.
  const friends = top.map((e, i) => ({
    initials: (e.username || '?').charAt(0).toUpperCase(),
    username: `@${e.username || 'unknown'}`,
    gradient: gradients[i % gradients.length],
  }))
  return (
    <Card
      className="flex-col items-start justify-between gap-4 p-4 lg:flex-row lg:items-center"
      interactive={false}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-4">
        <span className="font-display text-sm font-bold text-text-primary">
          {t('friends_online', { count: friends.length })}
        </span>
        {friends.length > 0 ? (
          <>
            <div className="flex -space-x-2">
              {friends.map((f, i) => (
                <Avatar key={i} size="md" gradient={f.gradient} initials={f.initials} status="online" />
              ))}
            </div>
            <span className="min-w-0 break-words font-mono text-[11px] text-text-muted">
              {friends.map((f) => f.username).join(' · ')}
            </span>
          </>
        ) : (
          <span className="font-mono text-[11px] text-text-muted">Никого онлайн</span>
        )}
      </div>
      <button
        type="button"
        onClick={onCreateParty}
        className="inline-flex items-center gap-2 rounded-full border border-accent/40 bg-accent/10 px-4 py-2 font-sans text-[13px] font-semibold text-accent-hover hover:bg-accent/20"
      >
        <Users className="h-3.5 w-3.5" />
        {t('create_party')}
      </button>
    </Card>
  )
}

export default function ArenaPage() {
  const { t } = useTranslation('arena')
  const navigate = useNavigate()
  const findMatch = useFindMatchMutation()
  const cancelSearch = useCancelSearchMutation()
  const [section, setSection] = useState<SectionKey>('algorithms')
  const [partyMode, setPartyMode] = useState<PartyMode>('solo')
  // Neural model id is now a free-form string (the backend's model id, e.g.
  // "openai/gpt-4o-mini"). Persisted to localStorage so the choice survives
  // reloads — no enum guard needed because the backend rejects unknown ids.
  const [neuralModel, setNeuralModelState] = useState<string>(() => {
    try {
      return window.localStorage.getItem('druz9.arena.neural_model') ?? ''
    } catch {
      return ''
    }
  })
  const setNeuralModel = (id: string) => {
    setNeuralModelState(id)
    try {
      window.localStorage.setItem('druz9.arena.neural_model', id)
    } catch {
      /* localStorage may be disabled — ignore, choice falls back to default next visit */
    }
  }
  const [inQueue, setInQueue] = useState(false)
  const [waitSec, setWaitSec] = useState(0)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [pendingMode, setPendingMode] = useState<string | null>(null)

  // Poll backend every 2s while in queue — when matchmaker pairs us up,
  // /arena/match/current returns 200 with the match id and we navigate
  // straight to the match page. Without this the UI sat silently with
  // "queued: 1" forever (production bug #5-8).
  const currentMatch = useCurrentMatchQuery(inQueue)
  useEffect(() => {
    if (!inQueue) return
    const m = currentMatch.data
    if (!m?.match_id) return
    const path =
      m.mode === 'duo_2v2' ? `/arena/2v2/${m.match_id}` : `/arena/match/${m.match_id}`
    setInQueue(false)
    setPendingMode(null)
    navigate(path)
  }, [inQueue, currentMatch.data, navigate])

  // Tick the wait counter while we are queued. When QUEUE_TIMEOUT_SEC elapses
  // without the backend matchmaker pairing us up, auto-cancel the search and
  // surface a clear "никого нет в очереди" message (bible §11 — no silent
  // waits). The user can click "Найти матч" again to re-enqueue.
  useEffect(() => {
    if (!inQueue) {
      setWaitSec(0)
      return
    }
    const id = window.setInterval(() => {
      setWaitSec((s) => {
        const next = s + 1
        if (next >= QUEUE_TIMEOUT_SEC) {
          // Auto-cancel on the backend so we don't leave a stale ticket.
          cancelSearch.mutate(undefined, {
            onSettled: () => {
              setInQueue(false)
              setPendingMode(null)
              setErrorMsg(
                'В очереди сейчас никого нет. Попробуй другой раздел или повтори позже.',
              )
            },
          })
        }
        return next
      })
    }, 1000)
    return () => window.clearInterval(id)
    // cancelSearch is a stable mutation object; intentional single-deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inQueue])

  const enqueue = (mode: ArenaModeKey, modeKey: string) => {
    setErrorMsg(null)
    setPendingMode(modeKey)
    findMatch.mutate(
      { section, mode, neuralModel: neuralModel || 'random' },
      {
        onSuccess: (resp) => {
          setPendingMode(null)
          if (resp.match_id) {
            const path =
              mode === 'duo_2v2'
                ? `/arena/2v2/${resp.match_id}`
                : `/arena/match/${resp.match_id}`
            navigate(path)
            return
          }
          setInQueue(true)
        },
        onError: (e: unknown) => {
          setPendingMode(null)
          setErrorMsg((e as Error).message ?? 'failed to enqueue')
        },
      },
    )
  }

  const handleFind = () => {
    enqueue('ranked', 'hero')
  }

  const handleCancel = () => {
    cancelSearch.mutate(undefined, {
      onSettled: () => {
        setInQueue(false)
        setPendingMode(null)
      },
    })
  }

  const handleModeClick = (m: Mode) => {
    // Wave-11: `mock` card no longer enqueues a single "hardcore" arena
    // match — it routes to the multi-stage pipeline picker (/mock), which
    // then walks the user through screening → go+sql → algo → sys_design
    // → behavioral. Original single-shot /voice-mock is still reachable
    // from the coming-soon empty-state on /mock.
    if (m.key === 'mock') {
      navigate('/mock')
      return
    }
    if (m.key === 'custom_lobby') {
      navigate('/lobbies')
      return
    }
    if (m.key === 'pair_code') {
      navigate('/pair')
      return
    }
    if (m.requiresParty && partyMode !== 'party') {
      setPartyMode('party')
    }
    if (!m.requiresParty && partyMode === 'party') {
      setPartyMode('solo')
    }
    enqueue(m.arenaMode, m.key)
  }

  const handleCreateParty = () => {
    setPartyMode('party')
  }

  const visibleModes = useMemo(() => {
    if (partyMode === 'party') {
      // Party mode emphasises 2v2 modes; solo modes hidden so the user is not
      // tempted to enqueue a single-player ladder while a partner is waiting.
      return MODES.filter((m) => m.requiresParty)
    }
    return MODES.filter((m) => !m.requiresParty)
  }, [partyMode])

  return (
    <AppShellV2>
      {/* WAVE-13 — segmented "Поединки · Daily kata" tabs at the very top
          of /arena. Switches between this page (modes) and /arena/kata
          (today's daily problem, was /daily). */}
      <ArenaSegmented active="modes" />
      <div className="flex flex-col gap-6 px-4 py-6 sm:px-8 lg:px-20 lg:py-8">
        <HeaderRow partyMode={partyMode} onTogglePartyMode={setPartyMode} />
        <HeroQueue
          inQueue={inQueue}
          waitSeconds={waitSec}
          isSubmitting={findMatch.isPending || cancelSearch.isPending}
          errorMessage={errorMsg}
          selectedSection={section}
          onSelectSection={setSection}
          onFind={handleFind}
          onCancel={handleCancel}
        />
        <AiPanel selectedModel={neuralModel} onSelectModel={setNeuralModel} />
        <div className="flex flex-col gap-4">
          <div className="flex items-end justify-between">
            <h2 className="font-display text-xl font-bold text-text-primary">
              {partyMode === 'party'
                ? t('party_modes')
                : t('all_modes')}
            </h2>
            <span className="font-mono text-[11px] text-text-muted">
              {t('modes_available_count', {
                count: visibleModes.length,
              })}
            </span>
          </div>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {visibleModes.map((m) => (
              <ModeCard
                key={m.key}
                m={m}
                isPending={pendingMode === m.key}
                selectedModel={neuralModel}
                onClick={() => handleModeClick(m)}
              />
            ))}
          </div>
        </div>
        <FriendsStrip onCreateParty={handleCreateParty} />
      </div>
    </AppShellV2>
  )
}
