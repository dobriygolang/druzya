// WeeklySnapshotCard — R6 (Phase D 2026-05-12) local weekly summary.
//
// Цель: surface краткий рост-of-numbers за прошедшие 7 дней прямо на
// /today, чтобы юзеру не приходилось переходить на /weekly. Frontend-only
// MVP читает activity log, computes top-kind, total minutes, sessions
// count, mini-mock delta.
//
// Когда backend `WeeklyReport` ship'нет — этот card swap'ится на backend
// data, но wire shape совпадает.
//
// Anti-fallback: пустой week → placeholder с CTA «залогировать первое».

import { useEffect, useState } from 'react'
import { CalendarDays } from 'lucide-react'

import {
  computeTrajectory,
  getActivitySummary,
  subscribeActivities,
  type ActivityKind,
  type ActivitySummary,
  type TrajectoryTrend,
} from '../lib/activity'
import { loadResult, type MiniMockResult } from '../lib/miniMock'

const KIND_LABEL: Record<ActivityKind, string> = {
  mock: 'Mock',
  leetcode: 'Задачи',
  reading: 'Чтение',
  coach: 'Coach',
  focus_block: 'Focus',
  reflection: 'Reflection',
  external: 'Другое',
}

interface Snapshot {
  summary: ActivitySummary
  trajectory: TrajectoryTrend
  miniMock: MiniMockResult | null
}

function computeSnapshot(): Snapshot {
  return {
    summary: getActivitySummary(),
    trajectory: computeTrajectory(),
    miniMock: loadResult(),
  }
}

export function WeeklySnapshotCard() {
  const [snap, setSnap] = useState<Snapshot>(() => computeSnapshot())

  useEffect(() => {
    const unsub = subscribeActivities(() => setSnap(computeSnapshot()))
    return () => {
      unsub()
    }
  }, [])

  const { summary, trajectory, miniMock } = snap
  // Empty week → no surfaces.
  if (summary.last7d === 0 && summary.last30d === 0) {
    return null
  }

  // Top kind by 7d count.
  const kinds = Object.entries(summary.byKind7d) as [ActivityKind, number][]
  const topKind = kinds.filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1])[0]
  const topKindLabel = topKind ? `${KIND_LABEL[topKind[0]]} (${topKind[1]})` : '—'

  // Hours formatted.
  const hours7 = summary.minutes7d > 0 ? (summary.minutes7d / 60).toFixed(1) : '—'

  return (
    <section
      id="weekly-snapshot"
      className="flex flex-col gap-4 scroll-mt-24 rounded-xl border border-border bg-surface-1 p-5"
    >
      <header className="flex items-center gap-2">
        <CalendarDays className="h-4 w-4 text-text-secondary" />
        <h2 className="font-display text-base font-bold leading-tight">
          Эта неделя
        </h2>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Cell
          label="Занятий"
          value={String(summary.last7d)}
          hint={trajectory.weekDelta !== 0 ? `${trajectory.weekDelta >= 0 ? '+' : ''}${trajectory.weekDelta} vs пред.` : 'без изменений'}
        />
        <Cell
          label="Часов"
          value={hours7}
          hint={summary.minutes7d > 0 ? 'фиксировал' : 'не фиксировал'}
        />
        <Cell
          label="Топ-формат"
          value={topKindLabel}
          hint="за 7 дней"
        />
        <Cell
          label="Mini-mock"
          value={miniMock ? `${miniMock.overallScore.toFixed(1)}/5` : '—'}
          hint={miniMock ? `track ${miniMock.track}` : 'не пройден'}
        />
      </div>

      <p className="text-[12px] italic text-text-muted">
        Когда подключим backend, этот блок начнёт показывать AI insight за
        неделю (top wins, blockers, recommended pivot). Сейчас — local
        snapshot.
      </p>
    </section>
  )
}

function Cell({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex flex-col rounded-md border border-border bg-surface-2 px-3 py-2.5">
      <span className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-text-muted">
        {label}
      </span>
      <span className="truncate font-display text-lg font-bold tabular-nums text-text-primary">
        {value}
      </span>
      {hint && (
        <span className="font-mono text-[10px] text-text-muted">{hint}</span>
      )}
    </div>
  )
}
