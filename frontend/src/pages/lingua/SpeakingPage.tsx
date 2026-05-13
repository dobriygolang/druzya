// SpeakingPage — Phase K W8 port of Hone Speaking.
//
// Catalog (B1/B2/C1 filter) + MicRecorder + AI grading (pronunciation +
// fluency) + word-diff visualisation. 14-session sparkline history.
import { useCallback, useState } from 'react'

import { AudioPlayer, BlobPlayer } from '../../components/lingua/AudioPlayer'
import { MicRecorder } from '../../components/lingua/MicRecorder'
import { SpeakingSparkline } from '../../components/lingua/SpeakingSparkline'
import { WordDiffView } from '../../components/lingua/WordDiff'
import {
  useGradeSpeakingMutation,
  useSpeakingExercisesQuery,
  useSpeakingHistoryQuery,
} from '../../lib/queries/lingua'
import type { SpeakingExercise, SpeakingGradeResult, SpeakingLevel } from '../../api/lingua/speaking'
import { cn } from '../../lib/cn'

type Mode =
  | { kind: 'welcome' }
  | { kind: 'exercise'; exercise: SpeakingExercise }

type Grading =
  | { kind: 'idle' }
  | { kind: 'recorded'; blob: Blob; durationMs: number }
  | { kind: 'graded'; blob: Blob; result: SpeakingGradeResult }

const LEVELS: readonly (SpeakingLevel | 'ALL')[] = ['ALL', 'B1', 'B2', 'C1']

export default function SpeakingPage() {
  const [levelFilter, setLevelFilter] = useState<SpeakingLevel | 'ALL'>('ALL')
  const [mode, setMode] = useState<Mode>({ kind: 'welcome' })
  const [grading, setGrading] = useState<Grading>({ kind: 'idle' })
  const exercisesQuery = useSpeakingExercisesQuery(levelFilter === 'ALL' ? undefined : levelFilter)
  const historyQuery = useSpeakingHistoryQuery()
  const gradeMut = useGradeSpeakingMutation()

  const exercises = exercisesQuery.data ?? []
  const history = historyQuery.data ?? []

  const handleSelectExercise = useCallback((ex: SpeakingExercise) => {
    setMode({ kind: 'exercise', exercise: ex })
    setGrading({ kind: 'idle' })
    gradeMut.reset()
  }, [gradeMut])

  const handleRecorded = useCallback((blob: Blob, durationMs: number) => {
    setGrading({ kind: 'recorded', blob, durationMs })
  }, [])

  const handleGrade = useCallback(async () => {
    if (grading.kind !== 'recorded' || mode.kind !== 'exercise') return
    const { blob, durationMs } = grading
    try {
      const clientSessionId = crypto.randomUUID()
      const result = await gradeMut.mutateAsync({
        exerciseId: mode.exercise.id,
        clientSessionId,
        audioBlob: blob,
        durationMs,
      })
      setGrading({ kind: 'graded', blob, result })
    } catch {
      // gradeMut.error covers UI surface; keep blob so user can retry.
    }
  }, [grading, mode, gradeMut])

  const handleRetry = useCallback(() => {
    setGrading({ kind: 'idle' })
    gradeMut.reset()
  }, [gradeMut])

  return (
    <div className="flex min-h-[calc(100vh-180px)] w-full flex-col gap-0 md:flex-row">
      <aside className="flex w-full shrink-0 flex-col border-b border-border md:w-[280px] md:border-b-0 md:border-r">
        <div className="flex flex-col gap-2.5 border-b border-border px-4 py-3.5">
          <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">Level</div>
          <div className="flex flex-wrap gap-1">
            {LEVELS.map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setLevelFilter(l)}
                className={cn(
                  'rounded-full border px-2.5 py-1 font-mono text-[10px] font-medium uppercase tracking-[0.08em] transition-colors',
                  levelFilter === l
                    ? 'border-border-strong bg-surface-2 text-text-primary'
                    : 'border-border bg-transparent text-text-secondary hover:bg-surface-2',
                )}
              >
                {l === 'ALL' ? 'All' : l}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-2 py-2">
          {exercisesQuery.isLoading && exercises.length === 0 && (
            <div className="px-3 py-2.5 text-xs text-text-muted">Loading exercises…</div>
          )}
          {exercisesQuery.error && (
            <div className="px-3 py-2.5 text-xs text-text-muted">
              Failed to load: {exercisesQuery.error.message}
            </div>
          )}
          {!exercisesQuery.isLoading && exercises.length === 0 && (
            <div className="px-3 py-2.5 text-xs text-text-muted">No prompts at this level.</div>
          )}
          <ul className="flex list-none flex-col gap-1">
            {exercises.map((ex) => {
              const active = mode.kind === 'exercise' && mode.exercise.id === ex.id
              return (
                <li key={ex.id}>
                  <button
                    type="button"
                    onClick={() => handleSelectExercise(ex)}
                    className={cn(
                      'block w-full rounded-md border px-3 py-2.5 text-left transition-colors',
                      active
                        ? 'border-border-strong bg-surface-2'
                        : 'border-transparent bg-transparent hover:bg-surface-2',
                    )}
                  >
                    <div className={cn(
                      'mb-1 font-mono text-[10px] uppercase tracking-[0.08em]',
                      active ? 'text-text-primary' : 'text-text-muted',
                    )}>
                      {ex.level} · {ex.topic || 'general'}
                    </div>
                    <div className={cn(
                      'text-[13px] leading-snug',
                      active ? 'text-text-primary' : 'text-text-secondary',
                    )}>
                      {ex.prompt}
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 lg:px-8">
          {mode.kind === 'welcome' ? (
            <WelcomePanel />
          ) : (
            <ActiveExercise
              exercise={mode.exercise}
              grading={grading}
              isGrading={gradeMut.isPending}
              errMsg={gradeMut.error?.message}
              onRecorded={handleRecorded}
              onGrade={handleGrade}
              onRetry={handleRetry}
            />
          )}

          {history.length > 0 && (
            <section className="mt-8">
              <SpeakingSparkline history={history} withCaption />
            </section>
          )}
        </div>
      </main>
    </div>
  )
}

function WelcomePanel() {
  return (
    <div>
      <header className="mb-6">
        <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">Speaking</div>
        <h1 className="font-display text-[28px] font-bold leading-tight tracking-tight text-text-primary">
          Shadow English aloud.
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-text-secondary">
          Pick a prompt, hear how it sounds, then record yourself. AI scores pronunciation + fluency and flags the words that need work.
        </p>
      </header>
      <ol className="list-decimal pl-5 text-sm leading-relaxed text-text-secondary">
        <li>Pick a prompt on the left — start at B2 for senior-interview phrasing.</li>
        <li>Press Listen to hear the reference.</li>
        <li>Press Record and shadow it back (5-15 seconds).</li>
        <li>Press Stop. We transcribe and grade.</li>
      </ol>
    </div>
  )
}

function ActiveExercise({
  exercise,
  grading,
  isGrading,
  errMsg,
  onRecorded,
  onGrade,
  onRetry,
}: {
  exercise: SpeakingExercise
  grading: Grading
  isGrading: boolean
  errMsg: string | undefined
  onRecorded: (blob: Blob, durationMs: number) => void
  onGrade: () => void
  onRetry: () => void
}) {
  const gradedResult = grading.kind === 'graded' ? grading.result : null
  const recordedBlob = grading.kind === 'recorded' || grading.kind === 'graded' ? grading.blob : null

  return (
    <div className="flex flex-col gap-6">
      <header>
        <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
          {exercise.level} · {exercise.topic || 'general'}
        </div>
        <p className="text-[20px] font-medium leading-snug text-text-primary">{exercise.prompt}</p>
      </header>

      <section className="flex flex-col gap-3.5 rounded-md border border-border p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">Reference</div>
          <AudioPlayer src={exercise.audioUrl} prompt={exercise.prompt} disabled={isGrading} />
        </div>
        <div className="flex flex-col gap-3 border-t border-border pt-3.5">
          <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">Your recording</div>
          <MicRecorder maxSeconds={15} onRecorded={onRecorded} disabled={isGrading} />
        </div>

        {recordedBlob && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3.5">
            <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">Playback</div>
            <BlobPlayer blob={recordedBlob} disabled={isGrading} />
          </div>
        )}

        {grading.kind === 'recorded' && (
          <div className="border-t border-border pt-3.5">
            <button
              type="button"
              onClick={onGrade}
              disabled={isGrading}
              className="rounded-full bg-text-primary px-5 py-2 text-[13px] font-medium text-bg disabled:cursor-not-allowed disabled:opacity-50"
            >
              Grade my speaking
            </button>
          </div>
        )}
        {isGrading && (
          <div className="border-t border-border pt-3.5 text-xs text-text-secondary">
            Grading… Whisper transcribes, then the coach scores it. ~5-12s.
          </div>
        )}
        {errMsg && (
          <div role="alert" className="flex flex-col gap-2 border-t border-border pt-3.5 text-xs text-text-secondary">
            <span>Grading failed: {errMsg}</span>
            <button
              type="button"
              onClick={onRetry}
              className="self-start rounded-full border border-border bg-transparent px-3.5 py-1.5 text-xs text-text-primary hover:bg-surface-2"
            >
              Try again
            </button>
          </div>
        )}
      </section>

      {gradedResult && (
        <section className="flex flex-col gap-3.5 rounded-md border border-border-strong p-4">
          <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">Feedback</div>
          <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
            <ScoreTile label="Pronunciation" value={gradedResult.pronunciationScore} />
            <ScoreTile label="Fluency" value={gradedResult.fluencyScore} />
          </div>
          <div className="text-sm leading-relaxed text-text-primary">{gradedResult.coachFeedback}</div>
          {gradedResult.userTranscript && (
            <div className="flex flex-col gap-1.5">
              <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">Heard</div>
              <div className="rounded-md border border-border bg-transparent px-3 py-2 font-mono text-xs leading-relaxed text-text-secondary">
                {gradedResult.userTranscript}
              </div>
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">Word-level</div>
            <WordDiffView diffs={gradedResult.wordDiffs} />
          </div>
          <button
            type="button"
            onClick={onRetry}
            className="self-start rounded-full border border-border bg-transparent px-3.5 py-1.5 text-xs text-text-primary hover:bg-surface-2"
          >
            Try again
          </button>
        </section>
      )}
    </div>
  )
}

function ScoreTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border bg-transparent p-3">
      <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">{label}</div>
      <div className="mt-1.5 font-mono text-2xl font-semibold tabular-nums tracking-tight text-text-primary">
        {value}
        <span className="ml-1 text-xs text-text-muted">/100</span>
      </div>
    </div>
  )
}
