// SpeakingExercisesPage — Phase K Wave 9 (E4 P1) admin view with TTS
// regen action. 15 baseline rows seeded в migration 00105_speaking.sql;
// audio_url originally NULL (frontend SpeakingPage falls back to
// `window.speechSynthesis`). Admin now triggers Cloudflare MeloTTS
// synthesis per-row OR bulk for all missing — backend persists URL into
// speaking_exercises.audio_url; client cache (audio element) picks
// fresh URL on next List call.

import { useMemo, useState } from 'react'

import { ErrorBox, PanelSkeleton } from '../shared'
import {
  useAdminSpeakingExercisesQuery,
  useGenerateSpeakingTTSMutation,
  type SpeakingExercise,
} from '../../../lib/queries/adminLingua'

type LevelFilter = '' | 'B1' | 'B2' | 'C1'

export function SpeakingExercisesPage() {
  const [level, setLevel] = useState<LevelFilter>('')
  const [bulkRunning, setBulkRunning] = useState(false)
  const [bulkLog, setBulkLog] = useState<string[]>([])
  const [pendingID, setPendingID] = useState<string>('')
  const [errorMsg, setErrorMsg] = useState<string>('')
  const query = useAdminSpeakingExercisesQuery(level)
  const generate = useGenerateSpeakingTTSMutation()

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

  const items = query.data ?? []
  const missingCount = items.filter((ex) => !ex.audio_url).length

  if (query.isPending) return <PanelSkeleton rows={6} />
  if (query.error) return <ErrorBox message={(query.error as Error).message || 'Failed to load'} />

  const counts = {
    B1: grouped.get('B1')?.length ?? 0,
    B2: grouped.get('B2')?.length ?? 0,
    C1: grouped.get('C1')?.length ?? 0,
  }

  const handleGenerateOne = async (id: string, force: boolean) => {
    if (force && !confirm(`Re-generate TTS audio for "${id}"? Existing audio_url will be overwritten.`)) {
      return
    }
    setErrorMsg('')
    setPendingID(id)
    try {
      await generate.mutateAsync({ exercise_id: id, force })
    } catch (e) {
      setErrorMsg(`${id}: ${(e as Error).message || 'failed'}`)
    } finally {
      setPendingID('')
    }
  }

  const handleBulkMissing = async () => {
    if (bulkRunning) return
    const targets = items.filter((ex) => !ex.audio_url)
    if (targets.length === 0) return
    if (!confirm(`Generate TTS for ${targets.length} exercise(s) without audio? This may take ~30s/each.`)) {
      return
    }
    setErrorMsg('')
    setBulkRunning(true)
    setBulkLog([])
    for (let i = 0; i < targets.length; i++) {
      const ex = targets[i]
      setBulkLog((prev) => [...prev, `[${i + 1}/${targets.length}] ${ex.id} — synthesising…`])
      try {
        await generate.mutateAsync({ exercise_id: ex.id, force: false })
        setBulkLog((prev) => [...prev.slice(0, -1), `[${i + 1}/${targets.length}] ${ex.id} — ok`])
      } catch (e) {
        setBulkLog((prev) => [
          ...prev.slice(0, -1),
          `[${i + 1}/${targets.length}] ${ex.id} — ERROR: ${(e as Error).message || 'failed'}`,
        ])
      }
    }
    setBulkRunning(false)
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="font-display text-[14px] font-bold text-text-primary">Speaking exercises</h4>
        <div className="flex flex-wrap items-center gap-1.5">
          <LevelChip current={level} value="" label={`All · ${items.length}`} onChange={setLevel} />
          <LevelChip current={level} value="B1" label={`B1 · ${counts.B1}`} onChange={setLevel} />
          <LevelChip current={level} value="B2" label={`B2 · ${counts.B2}`} onChange={setLevel} />
          <LevelChip current={level} value="C1" label={`C1 · ${counts.C1}`} onChange={setLevel} />
        </div>
      </header>

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-surface-1 px-3 py-2 text-[11px] text-text-secondary">
        <span>
          Add custom exercises via <code className="font-mono">make seed</code>. TTS audio синтезируется через free-tier provider (Cloudflare MeloTTS) и хранится в MinIO bucket{' '}
          <code className="font-mono">tts-audio</code>.
        </span>
        <button
          type="button"
          onClick={handleBulkMissing}
          disabled={bulkRunning || missingCount === 0}
          className="rounded-md border border-text-primary bg-text-primary px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-bg transition-colors hover:bg-text-primary/80 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {bulkRunning
            ? 'Generating…'
            : missingCount === 0
              ? 'All audio set'
              : `Generate missing · ${missingCount}`}
        </button>
      </div>

      {errorMsg && (
        <div className="rounded-md border border-border bg-bg px-3 py-2 font-mono text-[11px] text-text-primary">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#FF3B30]" /> {errorMsg}
        </div>
      )}

      {bulkLog.length > 0 && (
        <div className="max-h-48 overflow-y-auto rounded-md border border-border bg-surface-1 px-3 py-2 font-mono text-[10px] text-text-secondary">
          {bulkLog.map((line, i) => (
            <div key={i} className="leading-snug">
              {line}
            </div>
          ))}
        </div>
      )}

      {items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-border bg-surface-1 px-4 py-10 text-center">
          <span className="font-mono text-[12px] text-text-muted">Empty</span>
          <span className="font-mono text-[10px] text-text-muted">
            Seed: 00105_speaking.sql · 15 baseline rows
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
                <Th>Action</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items.map((ex) => {
                const isPending = pendingID === ex.id
                const hasAudio = Boolean(ex.audio_url)
                return (
                  <tr key={ex.id} className="bg-surface-2 hover:bg-surface-1">
                    <Td className="font-mono text-[10px] text-text-muted">{ex.id}</Td>
                    <Td>
                      <span className="rounded-full border border-border bg-bg px-2 py-0.5 font-mono text-[10px] uppercase text-text-secondary">
                        {ex.level}
                      </span>
                    </Td>
                    <Td className="text-[12px] text-text-secondary">{ex.topic}</Td>
                    <Td className="max-w-[360px] text-[12px] text-text-primary" title={ex.prompt}>
                      <span className="line-clamp-2">{ex.prompt}</span>
                    </Td>
                    <Td>
                      {hasAudio ? (
                        <span className="inline-flex items-center gap-1 font-mono text-[10px] text-text-primary">
                          <span className="h-1.5 w-1.5 rounded-full bg-text-primary" /> yes
                        </span>
                      ) : (
                        <span className="font-mono text-[10px] text-text-muted">—</span>
                      )}
                    </Td>
                    <Td>
                      {hasAudio ? (
                        <button
                          type="button"
                          onClick={() => handleGenerateOne(ex.id, true)}
                          disabled={isPending || bulkRunning}
                          className="rounded-md border border-border bg-surface-1 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.05em] text-text-secondary transition-colors hover:border-border-strong disabled:opacity-50"
                        >
                          {isPending ? 'Working…' : 'Re-generate'}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleGenerateOne(ex.id, false)}
                          disabled={isPending || bulkRunning}
                          className="rounded-md border border-text-primary bg-bg px-2 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.05em] text-text-primary transition-colors hover:bg-text-primary/10 disabled:opacity-50"
                        >
                          {isPending ? 'Working…' : 'Generate'}
                        </button>
                      )}
                    </Td>
                  </tr>
                )
              })}
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
