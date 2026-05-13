// Hidden когда no goal — anti-fallback (нет смысла предлагать roadmap
// без целевой даты).

import { useEffect, useMemo, useState } from 'react'
import { Check, Compass, ChevronDown, ChevronUp } from 'lucide-react'

import { useGoal } from '../lib/useGoal'
import {
  generateMilestones,
  subscribeMilestonesDone,
  toggleMilestoneDone,
  type Milestone,
} from '../lib/milestones'
import { subscribeGoal } from '../lib/goal'

const CATEGORY_LABEL: Record<Milestone['category'], string> = {
  foundation: 'основа',
  practice: 'практика',
  mock: 'mock',
  reflection: 'review',
  final: 'final push',
}

export function MilestonesCard() {
  const goal = useGoal()
  const [tick, setTick] = useState(0)
  const [collapsed, setCollapsed] = useState(true)

  // Re-render on milestone toggle (storage event) AND goal change.
  useEffect(() => {
    const unsubMilestones = subscribeMilestonesDone(() => setTick((t) => t + 1))
    const unsubGoal = subscribeGoal(() => setTick((t) => t + 1))
    return () => {
      unsubMilestones()
      unsubGoal()
    }
  }, [])

  const milestones = useMemo(() => {
    void tick // intentional dep
    if (!goal) return []
    return generateMilestones(goal)
  }, [goal, tick])

  if (!goal || milestones.length === 0) return null

  const doneCount = milestones.filter((m) => m.done).length
  const total = milestones.length
  const pct = total === 0 ? 0 : Math.round((doneCount / total) * 100)

  // Find current week's milestone (first not-done starting from week 1).
  const currentIdx = milestones.findIndex((m) => !m.done)
  const visible = collapsed
    ? milestones.slice(Math.max(0, currentIdx === -1 ? milestones.length - 3 : currentIdx), Math.max(3, currentIdx === -1 ? milestones.length : currentIdx + 3))
    : milestones

  return (
    <section
      id="milestones"
      className="flex flex-col gap-4 scroll-mt-24 rounded-xl border border-border bg-surface-1 p-5"
    >
      <header className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
            Roadmap · {total} {pluralWeeks(total)}
          </span>
          <h2 className="font-display text-base font-bold leading-tight">
            <Compass className="mr-1 inline h-4 w-4 text-text-secondary" />
            {doneCount}/{total} {pluralDone(doneCount)} закрыто · {pct}%
          </h2>
        </div>
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="inline-flex items-center gap-1 rounded-md border border-border bg-surface-2 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-text-secondary transition-colors hover:border-border-strong"
        >
          {collapsed ? (
            <>
              развернуть <ChevronDown className="h-3 w-3" />
            </>
          ) : (
            <>
              свернуть <ChevronUp className="h-3 w-3" />
            </>
          )}
        </button>
      </header>

      {/* Progress bar */}
      <div className="relative h-[6px] w-full overflow-hidden rounded-full bg-surface-2">
        <div
          className="h-full bg-text-primary transition-all duration-[var(--motion-dur-xlarge)] ease-[var(--motion-ease-emphasized)]"
          style={{ width: `${pct}%` }}
        />
      </div>

      <ol className="flex flex-col divide-y divide-border">
        {visible.map((m) => (
          <MilestoneRow
            key={m.id}
            m={m}
            isCurrent={!m.done && milestones.findIndex((x) => !x.done) === m.weekIndex - 1}
          />
        ))}
      </ol>

      {collapsed && milestones.length > 3 && (
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          className="self-start font-mono text-[11px] uppercase tracking-[0.08em] text-text-secondary underline-offset-2 hover:text-text-primary hover:underline"
        >
          Показать все {total} milestones →
        </button>
      )}
    </section>
  )
}

function MilestoneRow({ m, isCurrent }: { m: Milestone; isCurrent: boolean }) {
  const onToggle = () => toggleMilestoneDone(m.id)
  return (
    <li className="flex items-start gap-3 py-2.5">
      <button
        type="button"
        onClick={onToggle}
        aria-label={m.done ? 'Снять отметку' : 'Отметить выполненным'}
        className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-sm border transition-colors ${
          m.done
            ? 'border-border-strong bg-text-primary/10 text-text-primary'
            : isCurrent
              ? 'border-border-strong text-text-primary hover:bg-text-primary/5'
              : 'border-border text-text-muted hover:border-border-strong'
        }`}
      >
        {m.done && <Check className="h-3 w-3" />}
      </button>
      <div className="flex flex-1 flex-col gap-0.5 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className={`text-[13px] font-semibold ${
              m.done
                ? 'text-text-muted line-through decoration-text-muted'
                : isCurrent
                  ? 'text-text-primary'
                  : 'text-text-secondary'
            }`}
          >
            {m.title}
          </span>
          <span className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-text-muted">
            · {CATEGORY_LABEL[m.category]}
          </span>
          {isCurrent && (
            <span className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-text-primary">
              · сейчас
            </span>
          )}
        </div>
        <p
          className={`text-[12px] leading-snug ${
            m.done ? 'text-text-muted line-through decoration-text-muted/60' : 'text-text-muted'
          }`}
        >
          {m.detail}
        </p>
        <span className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-text-muted">
          {m.weekStart}
        </span>
      </div>
    </li>
  )
}

function pluralWeeks(n: number): string {
  if (n === 1) return 'неделя'
  if (n >= 2 && n <= 4) return 'недели'
  return 'недель'
}

function pluralDone(n: number): string {
  if (n === 1) return 'milestone'
  if (n >= 2 && n <= 4) return 'milestones'
  return 'milestones'
}
