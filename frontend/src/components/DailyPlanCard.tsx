
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Sparkles,
  BookOpen,
  MessageSquare,
  Pencil,
  Timer,
  CheckCircle,
  Brain,
  RefreshCw,
  ArrowRight,
  Check,
} from 'lucide-react'

import {
  getOrComputeDailyPlan,
  invalidateDailyPlan,
  type ActionKind,
  type DailyAction,
} from '../lib/dailyPlan'
import { logActivity, type ActivityKind } from '../lib/activity'
import { useGoal } from '../lib/useGoal'
import { openHoneFocusSession, isHoneDeepLinkSupported } from '../lib/hone-handoff'

const KIND_ICON: Record<ActionKind, typeof Sparkles> = {
  mock: Sparkles,
  reading: BookOpen,
  coach: MessageSquare,
  reflection: Pencil,
  focus_block: Timer,
  log: CheckCircle,
  diagnostic: Brain,
}

const PRIORITY_LABEL: Record<0 | 1 | 2, string> = {
  0: 'Сейчас',
  1: 'Сегодня',
  2: 'Если есть время',
}

// Map F7 plan ActionKind → F5 activity ActionKind. Some F7 kinds (log /
// diagnostic) don't make sense to auto-log as activity (they ARE log
// flows, not actions yielding activity); skip ✓ button for those.
const ACTION_TO_ACTIVITY_KIND: Partial<Record<ActionKind, ActivityKind>> = {
  mock: 'mock',
  reading: 'reading',
  coach: 'coach',
  reflection: 'reflection',
  focus_block: 'focus_block',
  // log: omitted — кнопка ✓ не имеет смысла
  // diagnostic: omitted — это redirect, не done-able activity
}

// Persist per-day «marked done» action ids чтобы UI знала какие уже
// залогированы (sustains across reload / day change). Кросс-сутки UI
// показывает «✓ done» только для today's plan; завтра кеш plan
// сбросится, action ids тоже.
const DONE_KEY_PREFIX = 'druz9.daily_plan.done.v1.'

function todayKey(): string {
  const d = new Date()
  return `${DONE_KEY_PREFIX}${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function readDone(): Set<string> {
  if (typeof window === 'undefined') return new Set()
  try {
    const raw = window.localStorage.getItem(todayKey())
    if (!raw) return new Set()
    const arr = JSON.parse(raw) as string[]
    return new Set(Array.isArray(arr) ? arr : [])
  } catch {
    return new Set()
  }
}

function writeDone(ids: Set<string>): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(todayKey(), JSON.stringify([...ids]))
  } catch {
    /* ignore */
  }
}

export function DailyPlanCard() {
  const goal = useGoal()
  // Tick для force-recompute when user clicks refresh. Cache invalidates →
  // getOrComputeDailyPlan заново посчитает.
  const [reloadTick, setReloadTick] = useState(0)
  const plan = useMemo(() => {
    void reloadTick // intentional dep
    void goal // intentional: re-run when user updates goal (engine reads localStorage internally)
    return getOrComputeDailyPlan()
  }, [reloadTick, goal])

  // Done-set state — отслеживаем какие action ids залогированы сегодня.
  const [doneIds, setDoneIds] = useState<Set<string>>(() => readDone())

  // Refresh done-set on storage event (cross-tab sync).
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key && e.key.startsWith(DONE_KEY_PREFIX)) {
        setDoneIds(readDone())
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  if (!goal) {
    return (
      <section className="flex flex-col gap-3 rounded-xl border border-border bg-surface-1 p-5">
        <header className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-text-secondary" />
          <h2 className="font-display text-base font-bold leading-tight">План на сегодня</h2>
        </header>
        <p className="text-[13px] leading-relaxed text-text-muted">
          Поставь цель — получишь 3-5 actions adapted под твою readiness и weak area.
        </p>
        <Link
          to="/diagnostic"
          className="self-start font-mono text-[11px] uppercase tracking-[0.08em] text-text-secondary underline-offset-2 transition-colors duration-[var(--motion-dur-small)] ease-[var(--motion-ease-standard)] hover:text-text-primary hover:underline"
        >
          Начать с 8-минутной диагностики →
        </Link>
      </section>
    )
  }

  if (!plan) {
    return null
  }

  const onRefresh = () => {
    invalidateDailyPlan()
    setReloadTick((t) => t + 1)
  }

  const onMarkDone = (action: DailyAction) => {
    const activityKind = ACTION_TO_ACTIVITY_KIND[action.kind]
    if (!activityKind) return
    if (doneIds.has(action.id)) return // idempotent — клик второй раз не логирует
    logActivity({
      kind: activityKind,
      title: action.title,
      minutes: action.estimatedMin,
      source: 'daily plan',
    })
    const next = new Set(doneIds)
    next.add(action.id)
    setDoneIds(next)
    writeDone(next)
  }

  const doneCount = plan.actions.filter((a) => doneIds.has(a.id)).length

  return (
    <section
      id="plan"
      className="flex flex-col gap-4 scroll-mt-24 rounded-xl border border-border bg-surface-1 p-5"
    >
      <header className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
            План на сегодня · {plan.budgetMin} мин
            {doneCount > 0 && ` · ✓ ${doneCount}/${plan.actions.length}`}
          </span>
          <h2 className="font-display text-base font-bold leading-tight">
            {plan.actions.length} {pluralActions(plan.actions.length)}
          </h2>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          aria-label="Пересчитать план"
          title="Пересчитать"
          className="grid h-8 w-8 place-items-center rounded-md text-text-muted transition-colors duration-[var(--motion-dur-small)] ease-[var(--motion-ease-standard)] hover:bg-surface-2 hover:text-text-primary"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </header>

      <p className="text-[12px] text-text-muted">{plan.rationale}</p>

      <ol className="flex flex-col gap-2">
        {plan.actions.map((action, i) => (
          <ActionRow
            key={action.id}
            index={i + 1}
            action={action}
            done={doneIds.has(action.id)}
            onMarkDone={() => onMarkDone(action)}
          />
        ))}
      </ol>

      {/* X5 (Phase J P2 2026-05-12) — Hone handoff. Single CTA at the
          bottom of the plan, only on desktop browsers (Hone is desktop).
          Picks the first non-done action's title as the focus goal so the
          user lands in Hone with a pre-filled pomodoro target. */}
      {isHoneDeepLinkSupported() && plan.actions.length > 0 && (
        <HoneFocusCTA
          firstUndone={plan.actions.find((a) => !doneIds.has(a.id))?.title ?? plan.actions[0]?.title ?? ''}
        />
      )}
    </section>
  )
}

// HoneFocusCTA — discrete «open in Hone» action. Hairline border, B/W per
// CLAUDE.md design rule. No red unless we want to signal urgency.
function HoneFocusCTA({ firstUndone }: { firstUndone: string }) {
  const onClick = () => {
    openHoneFocusSession({
      goal: firstUndone,
      mode: 'pomodoro',
      duration: 25,
      source: 'today_plan',
    })
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className="self-start font-mono text-[10px] uppercase tracking-[0.08em] text-text-secondary underline-offset-2 transition-colors duration-[var(--motion-dur-small)] ease-[var(--motion-ease-standard)] hover:text-text-primary hover:underline"
      title="Открыть Hone и стартануть pomodoro на этот action"
    >
      Поставить 25 мин в Hone →
    </button>
  )
}

function pluralActions(n: number): string {
  // ru plural: 1 действие / 2-4 действия / 5+ действий
  if (n === 1) return 'действие'
  if (n >= 2 && n <= 4) return 'действия'
  return 'действий'
}

function ActionRow({
  index,
  action,
  done,
  onMarkDone,
}: {
  index: number
  action: DailyAction
  done: boolean
  onMarkDone: () => void
}) {
  const Icon = KIND_ICON[action.kind]
  const isP0 = action.priority === 0
  const canMarkDone = ACTION_TO_ACTIVITY_KIND[action.kind] !== undefined

  const body = (
    <div className="relative flex w-full items-start gap-3">
      {/* P0 active-selection stripe — 1.5×24px red vertical bar (hero-treatment
        2026-05-12). Encodes urgency without bg/fill — single accent. */}
      {isP0 && !done && (
        <span
          aria-hidden
          className="absolute -left-3 top-1/2 h-6 w-[1.5px] -translate-y-1/2 rounded-sm"
          style={{ background: 'var(--red)' }}
        />
      )}
      <span
        className={`grid h-8 w-8 shrink-0 place-items-center rounded-md font-mono text-[11px] font-bold ${
          done
            ? 'border border-border bg-surface-2 text-text-muted'
            : isP0
              ? 'border border-border-strong bg-text-primary/10 text-text-primary'
              : 'border border-border bg-surface-2 text-text-secondary'
        }`}
      >
        {done ? <Check className="h-3.5 w-3.5" /> : index}
      </span>
      <div className="flex flex-1 flex-col gap-1 min-w-0">
        <div className="flex items-center gap-2">
          <Icon className="h-3.5 w-3.5 shrink-0 text-text-secondary" />
          <span
            className={`truncate text-[13px] font-semibold ${
              done ? 'text-text-muted line-through decoration-text-muted' : 'text-text-primary'
            }`}
          >
            {action.title}
          </span>
          <span className="ml-auto shrink-0 font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
            {action.estimatedMin}м
          </span>
        </div>
        <p className="text-[11.5px] leading-snug text-text-muted">{action.rationale}</p>
        <span className="mt-0.5 font-mono text-[9.5px] uppercase tracking-[0.08em] text-text-muted">
          {PRIORITY_LABEL[action.priority]}
        </span>
      </div>
    </div>
  )

  // Inline buttons: ✓ mark-done (only if mappable) + → navigate (if href).
  // ✓ uses stopPropagation так что click не triggers Link navigation.
  const trailing = (
    <div className="flex shrink-0 items-center gap-1">
      {canMarkDone && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onMarkDone()
          }}
          aria-label={done ? 'Уже залогировано сегодня' : 'Залогировать как занятие'}
          title={done ? 'Залогировано · F5 store' : 'Залогировать как занятие (✓)'}
          disabled={done}
          className={`grid h-9 w-9 place-items-center rounded-md transition-colors duration-[var(--motion-dur-small)] ease-[var(--motion-ease-standard)] ${
            done
              ? 'cursor-default text-text-primary'
              : 'text-text-muted hover:bg-surface-1 hover:text-text-primary'
          }`}
        >
          <Check className="h-3.5 w-3.5" />
        </button>
      )}
      {action.href && <ArrowRight className="h-3.5 w-3.5 text-text-muted" />}
    </div>
  )

  const cardClasses = `flex items-start gap-2 rounded-lg border bg-surface-2 p-3 transition-colors duration-[var(--motion-dur-small)] ease-[var(--motion-ease-standard)] ${
    done
      ? 'border-border opacity-60'
      : 'border-border hover:border-border-strong'
  }`

  if (!action.href) {
    return (
      <li className={cardClasses}>
        {body}
        {trailing}
      </li>
    )
  }

  if (action.href.startsWith('http')) {
    return (
      <li>
        <a
          href={action.href}
          target="_blank"
          rel="noopener noreferrer"
          className={`flex items-start gap-2 rounded-lg border bg-surface-2 p-3 transition-colors duration-[var(--motion-dur-small)] ease-[var(--motion-ease-standard)] ${
            done ? 'border-border opacity-60' : 'border-border hover:border-border-strong'
          }`}
        >
          {body}
          {trailing}
        </a>
      </li>
    )
  }

  return (
    <li>
      <Link
        to={action.href}
        className={`flex items-start gap-2 rounded-lg border bg-surface-2 p-3 transition-colors ${
          done ? 'border-border opacity-60' : 'border-border hover:border-border-strong'
        }`}
      >
        {body}
        {trailing}
      </Link>
    </li>
  )
}
