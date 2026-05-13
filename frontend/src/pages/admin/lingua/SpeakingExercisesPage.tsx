// SpeakingExercisesPage — read-only admin view для speaking_exercises.
//
// 15 baseline exercises seeded в migration 00105_speaking.sql (Phase J,
// H4). Backend exposes ListSpeakingExercises только — нет Admin Add /
// Update / Delete RPC. Этот page показывает их + filter chips по level.
//
// Для add custom exercises: defer до backend RPC. Inline-note ниже
// объясняет admin'у что есть.

import { useMemo, useState } from 'react'

import { ErrorBox, PanelSkeleton } from '../shared'
import {
  useAdminSpeakingExercisesQuery,
  type SpeakingExercise,
} from '../../../lib/queries/adminLingua'

type LevelFilter = '' | 'B1' | 'B2' | 'C1'

export function SpeakingExercisesPage() {
  const [level, setLevel] = useState<LevelFilter>('')
  const query = useAdminSpeakingExercisesQuery(level)

  const grouped = useMemo(() => {
    if (!query.data) return new Map<string, SpeakingExercise[]>()
    const m = new Map<string, SpeakingExercise[]>()
    for (const ex of query.data) {
      const arr = m.get(ex.level) ?? []
      arr.push(ex)
      m.set(ex.level, arr)
    }
    return m
  }, [query.data])

  if (query.isPending) return <PanelSkeleton rows={6} />
  if (query.error) return <ErrorBox message={(query.error as Error).message || 'Failed to load'} />

  const items = query.data ?? []
  const counts = {
    B1: grouped.get('B1')?.length ?? 0,
    B2: grouped.get('B2')?.length ?? 0,
    C1: grouped.get('C1')?.length ?? 0,
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="font-display text-[14px] font-bold text-text-primary">Speaking exercises</h4>
        <div className="flex flex-wrap items-center gap-1.5">
          <LevelChip current={level} value="" label={`Все · ${items.length}`} onChange={setLevel} />
          <LevelChip current={level} value="B1" label={`B1 · ${counts.B1}`} onChange={setLevel} />
          <LevelChip current={level} value="B2" label={`B2 · ${counts.B2}`} onChange={setLevel} />
          <LevelChip current={level} value="C1" label={`C1 · ${counts.C1}`} onChange={setLevel} />
        </div>
      </header>

      <div className="rounded-md border border-border bg-surface-1 px-3 py-2 text-[11px] text-text-secondary">
        Add custom exercises через <code className="font-mono">make seed</code> сейчас. Admin add UI requires
        backend RPC — defer.
      </div>

      {items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-border bg-surface-1 px-4 py-10 text-center">
          <span className="font-mono text-[12px] text-text-muted">Пусто</span>
          <span className="font-mono text-[10px] text-text-muted">
            Seed данные: 00105_speaking.sql · 15 baseline rows
          </span>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="min-w-full">
            <thead className="bg-surface-1">
              <tr>
                <Th>ID</Th>
                <Th>Level</Th>
                <Th>Topic</Th>
                <Th>Prompt</Th>
                <Th>Audio</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items.map((ex) => (
                <tr key={ex.id} className="bg-surface-2 hover:bg-surface-1">
                  <Td className="font-mono text-[10px] text-text-muted">{ex.id}</Td>
                  <Td>
                    <span className="rounded-full border border-border bg-bg px-2 py-0.5 font-mono text-[10px] uppercase text-text-secondary">
                      {ex.level}
                    </span>
                  </Td>
                  <Td className="text-[12px] text-text-secondary">{ex.topic}</Td>
                  <Td className="max-w-[420px] text-[12px] text-text-primary" title={ex.prompt}>
                    <span className="line-clamp-2">{ex.prompt}</span>
                  </Td>
                  <Td>
                    {ex.audio_url ? (
                      <span className="inline-flex items-center gap-1 font-mono text-[10px] text-text-primary">
                        <span className="h-1.5 w-1.5 rounded-full bg-text-primary" /> yes
                      </span>
                    ) : (
                      <span className="font-mono text-[10px] text-text-muted">—</span>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function LevelChip({
  current,
  value,
  label,
  onChange,
}: {
  current: LevelFilter
  value: LevelFilter
  label: string
  onChange: (v: LevelFilter) => void
}) {
  const active = current === value
  return (
    <button
      type="button"
      onClick={() => onChange(value)}
      className={`rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.05em] transition-colors ${
        active
          ? 'border-text-primary bg-text-primary/10 text-text-primary'
          : 'border-border bg-surface-2 text-text-secondary hover:border-border-strong'
      }`}
    >
      {label}
    </button>
  )
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-3 py-2 text-left font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted">
      {children}
    </th>
  )
}

function Td({
  children,
  className,
  title,
}: {
  children: React.ReactNode
  className?: string
  title?: string
}) {
  return (
    <td className={`px-3 py-2 align-top text-[12px] text-text-primary ${className ?? ''}`} title={title}>
      {children}
    </td>
  )
}
