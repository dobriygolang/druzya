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
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { AppShellV2 } from '../components/AppShell'
import { ArenaSegmented } from '../components/ArenaSegmented'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { Avatar } from '../components/Avatar'
import type { ReactNode } from 'react'
import { useRatingMeQuery, useLeaderboardQuery } from '../lib/queries/rating'
import {
  useCancelSearchMutation,
  useFindMatchMutation,
  type ArenaModeKey,
  type SectionKey,
} from '../lib/queries/arena'
// Wave-13 cross-page matchmaking — store is the single source of truth.
// AppShell mounts <MatchmakingPoller/> + <MatchmakingDock/> globally, so
// the page only needs to read inQueue and call store.start() on enqueue.
// Polling, auto-navigate-when-paired, and timeout-cancel all happen in
// the poller — the page no longer owns that lifecycle.
import { useMatchmakingStore, type MatchmakingMode } from '../lib/store/matchmaking'
import { useAIModelsQuery, type AIModel } from '../lib/queries/ai'
import { useProfileQuery } from '../lib/queries/profile'

// Queue-wait timeout (seconds) — after this many seconds without a match we
// show the user a clear "никого нет в очереди" message and auto-cancel, so the
// UI никогда не висит молча. Bible §11 — no silent fallback.
// QUEUE_TIMEOUT_SEC moved to MatchmakingPoller (single source of truth
// for the cross-page queue lifetime).

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
              ? 'bg-text-primary text-bg'
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
              ? 'bg-text-primary text-bg'
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
    <div className="flex w-full flex-col items-start justify-between gap-4 rounded-xl border border-border-strong bg-surface-2 p-5 sm:p-7 lg:flex-row lg:items-center">
      <div className="flex min-w-0 flex-col gap-3">
        <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-text-primary/10 px-2.5 py-1 font-mono text-[11px] font-medium tracking-[0.08em] text-text-primary">
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
                  ? 'bg-text-primary text-bg'
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
          className="px-6 py-3.5 text-sm"
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
          ? 'border-text-primary bg-text-primary/5'
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
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-text-primary/15">
            <Check className="h-3.5 w-3.5 text-text-primary" />
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
            <Sparkles className="h-4 w-4 text-text-secondary" />
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
  key: 'ranked_1v1' | 'casual_1v1' | 'ranked_2v2' | 'mock'
  name: string
  desc: string
  count: number | string
  time: string
  icon: ReactNode
  gradient: string
  /** Which arena queue to enqueue into. Ignored for non-queue modes
   *  (mock) which navigate instead of enqueue. */
  arenaMode: ArenaModeKey
  /** True if this card needs the user to be in Party mode (2v2). */
  requiresParty: boolean
  /** True for the AI cards — selected neural model is shown / used. */
  aiPowered: boolean
}

// Live queue counts/ETA are not exposed by the matchmaking service yet — we
// show "—" instead of fake hardcoded numbers (e.g. "286 в очереди · ~8с").
// Once the queue stats endpoint ships, replace these with the live values.
const MODES: Mode[] = [
  {
    key: 'ranked_1v1',
    name: 'Ranked 1v1',
    desc: 'Классика. Алгоритмы, рейтинг, LP.',
    count: '—',
    time: '—',
    icon: <Swords className="h-7 w-7 text-text-primary" />,
    // Phase-4: mode badges collapsed to monochrome ink-tints. Differentiation
    // is by name + icon, not hue — same rule as Atlas clusters.
    gradient: 'bg-text-primary/15',
    arenaMode: 'ranked',
    requiresParty: false,
    aiPowered: false,
  },
  {
    key: 'casual_1v1',
    name: 'Casual 1v1',
    desc: 'Без рейтинга, для практики.',
    count: '—',
    time: '—',
    icon: <Zap className="h-7 w-7 text-text-primary" />,
    gradient: 'bg-text-primary/10',
    arenaMode: 'solo_1v1',
    requiresParty: false,
    aiPowered: false,
  },
  {
    key: 'ranked_2v2',
    name: 'Ranked 2v2',
    desc: 'Командный режим, парный код.',
    count: '—',
    time: '—',
    icon: <Users className="h-7 w-7 text-text-primary" />,
    gradient: 'bg-text-primary/12',
    arenaMode: 'duo_2v2',
    requiresParty: true,
    aiPowered: false,
  },
  {
    key: 'mock',
    name: 'Mock Interview',
    desc: 'Симуляция собеса с компанией, многоэтапный (screening → algo → sys-design → behavioral). AI-помощник опционально.',
    count: '—',
    time: '—',
    icon: <Video className="h-7 w-7 text-text-primary" />,
    gradient: 'bg-text-primary/8',
    arenaMode: 'hardcore',
    requiresParty: false,
    aiPowered: true,
  },
]
// pair_code + custom_lobby cards removed:
//   - pair_code targeted /pair which was deleted (live-coding moved to Hone
//     desktop, "E" hotkey).
//   - custom_lobby targeted /lobbies which is a separate top-level surface;
//     a dedicated card on Arena duplicated nav. Users get to lobbies via
//     the full /lobbies page (linked from elsewhere) or restored later as a
//     conscious entry point, not a 404 trap.

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
  const inQueue = useMatchmakingStore((s) => s.inQueue)
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
        className="absolute inset-0 z-10 cursor-pointer rounded-xl focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-text-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:cursor-wait"
      />
      <div
        className={`grid h-16 w-16 place-items-center rounded-xl border border-border ${m.gradient}`}
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
          <span className="inline-flex items-center gap-1 rounded-full bg-text-primary/8 px-2 py-0.5 font-mono text-[10px] font-medium text-text-secondary">
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
        {inQueue ? 'Поиск идёт…' : t('enter')}
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
        className="inline-flex items-center gap-2 rounded-full border border-border-strong bg-text-primary/5 px-4 py-2 font-sans text-[13px] font-medium text-text-primary hover:bg-text-primary/10"
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
  // Wave-13: queue state lives in the global Zustand store so it survives
  // route changes (FaceIt-style cross-page search). The page only reads
  // it; <MatchmakingPoller/> in AppShell drives the polling + auto-navigate.
  const inQueue = useMatchmakingStore((s) => s.inQueue)
  const storeError = useMatchmakingStore((s) => s.error)
  const startQueue = useMatchmakingStore((s) => s.start)
  const resetQueue = useMatchmakingStore((s) => s.reset)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [pendingMode, setPendingMode] = useState<string | null>(null)

  // The store-level error (timeout, cancel-failed) wins over local
  // mutation errors — surface either, prefer store.
  const visibleError = storeError ?? errorMsg
  // waitSeconds — derived from the store's startedAt so the HeroQueue
  // countdown matches the dock pill (single source of truth across the
  // page + global). Tick locally so the UI advances every second.
  const startedAt = useMatchmakingStore((s) => s.startedAt)
  const [, setNowTick] = useState(0)
  useEffect(() => {
    if (!inQueue || !startedAt) return
    const id = window.setInterval(() => setNowTick((n) => n + 1), 1000)
    return () => window.clearInterval(id)
  }, [inQueue, startedAt])
  const waitSec = startedAt ? Math.max(0, Math.floor((Date.now() - startedAt) / 1000)) : 0

  const enqueue = (mode: ArenaModeKey, modeKey: string) => {
    setErrorMsg(null)
    setPendingMode(modeKey)
    findMatch.mutate(
      { section, mode, neuralModel: neuralModel || 'random' },
      {
        onSuccess: (resp) => {
          setPendingMode(null)
          // Backend may pair us up immediately if a partner was already
          // waiting. In that case skip the queue UI and jump straight in.
          // Both clients hit the same code path so they navigate together.
          if (resp.match_id) {
            const path =
              mode === 'duo_2v2'
                ? `/arena/2v2/${resp.match_id}`
                : `/arena/match/${resp.match_id}`
            navigate(path)
            return
          }
          // No instant match — push the search into the global store.
          // The dock + poller take over from here. The user is free to
          // navigate elsewhere; the search ticks on regardless.
          startQueue({ mode: mode as MatchmakingMode, section, neuralModel: neuralModel || 'random' })
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
        // Clear the store regardless of network success — backend ticket
        // expires server-side after QUEUE_TIMEOUT_SEC anyway.
        resetQueue()
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
          errorMessage={visibleError}
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
                // While a search is running, every mode card disables — the
                // matchmaking dock at the bottom owns the cancel/queue UX
                // and re-enqueueing while still in queue silently no-ops.
                isPending={pendingMode === m.key || inQueue}
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
