// Two-pane: library list + reader. Click-on-word → vocab popover →
// addVocab mutation. EndSession on exit. SRS daily review widget bottom-left.
//
// AICoachPill: existing /lingua reader keeps coach pill (только Reading
// получает coach surface per E2 plan). Persona — active-track based.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AICoachPill } from '../../components/AICoachPill'
import { VocabPopover, WordTokenizedText, type VocabPopoverAnchor } from '../../components/lingua/WordToken'
import { VocabReviewWidget } from '../../components/lingua/VocabReviewWidget'
import {
  useAddReadingMaterialMutation,
  useAddVocabMutation,
  useArchiveReadingMaterialMutation,
  useEndReadingSessionMutation,
  useReadingMaterialsQuery,
  useStartReadingSessionMutation,
  useVocabBySourceQuery,
} from '../../lib/queries/lingua'
import { useActiveStudyModeQuery, type ActiveTrack } from '../../lib/queries/honeSettings'
import type {
  ReadingMaterial,
  ReadingSession,
  ReadingSourceKind,
  VocabEntry,
} from '../../api/lingua/reading'
import { cn } from '../../lib/cn'

type Mode =
  | { kind: 'library' }
  | { kind: 'adding' }
  | { kind: 'reader'; material: ReadingMaterial; session: ReadingSession }

function formatRelative(d: Date | null): string {
  if (!d) return ''
  const now = Date.now()
  const ms = now - d.getTime()
  if (ms < 60_000) return 'just now'
  const m = Math.floor(ms / 60_000)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  const days = Math.floor(h / 24)
  if (days < 30) return `${days}d`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function ReadingPage() {
  const { t } = useTranslation('toasts')
  const materialsQuery = useReadingMaterialsQuery()
  const archiveMut = useArchiveReadingMaterialMutation()
  const startSessionMut = useStartReadingSessionMutation()
  const [mode, setMode] = useState<Mode>({ kind: 'library' })

  const materials = materialsQuery.data ?? []

  const handleOpenMaterial = useCallback(
    async (m: ReadingMaterial) => {
      try {
        // Backend full-fetch — list responses strip body_md.
        const full = await import('../../api/lingua/reading').then((mod) => mod.getReadingMaterial(m.id))
        const session = await startSessionMut.mutateAsync(m.id)
        setMode({ kind: 'reader', material: full, session })
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'unknown'
        window.alert(t('lingua.open_failed', { message: msg }))
      }
    },
    [startSessionMut, t],
  )

  const handleArchive = useCallback(
    async (id: string) => {
      if (!window.confirm(t('lingua.archive_reading_confirm'))) return
      try {
        await archiveMut.mutateAsync(id)
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'unknown'
        window.alert(t('lingua.archive_failed', { message: msg }))
      }
    },
    [archiveMut, t],
  )

  return (
    <div className="flex min-h-[calc(100vh-180px)] w-full flex-col gap-0 md:flex-row">
      <LibraryPane
        materials={materials}
        loading={materialsQuery.isLoading}
        error={materialsQuery.error?.message}
        activeId={mode.kind === 'reader' ? mode.material.id : null}
        onAdd={() => setMode({ kind: 'adding' })}
        onOpen={(m) => void handleOpenMaterial(m)}
        onArchive={(id) => void handleArchive(id)}
      />
      <main className="min-w-0 flex-1">
        {mode.kind === 'library' && <WelcomePane onAdd={() => setMode({ kind: 'adding' })} />}
        {mode.kind === 'adding' && (
          <AddMaterialForm
            onCancel={() => setMode({ kind: 'library' })}
            onAdded={() => setMode({ kind: 'library' })}
          />
        )}
        {mode.kind === 'reader' && (
          <Reader
            material={mode.material}
            session={mode.session}
            onExit={() => setMode({ kind: 'library' })}
          />
        )}
      </main>
    </div>
  )
}

// ─── Library pane ─────────────────────────────────────────────────────────

interface LibraryPaneProps {
  materials: ReadingMaterial[]
  loading: boolean
  error: string | undefined
  activeId: string | null
  onAdd: () => void
  onOpen: (m: ReadingMaterial) => void
  onArchive: (id: string) => void
}

function LibraryPane({ materials, loading, error, activeId, onAdd, onOpen, onArchive }: LibraryPaneProps) {
  return (
    <aside className="flex w-full shrink-0 flex-col border-b border-border md:w-[280px] md:border-b-0 md:border-r">
      <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
          Reading · Library
        </div>
        <button
          type="button"
          aria-label="Add material"
          onClick={onAdd}
          className="grid h-6 w-6 place-items-center rounded-md border border-border text-text-primary hover:bg-surface-2"
        >
          +
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-2 py-2">
        {loading && (
          <ul aria-busy="true" aria-label="Loading materials" className="list-none">
            {Array.from({ length: 4 }).map((_, i) => (
              <li key={i} className="my-0.5 px-3 py-2.5">
                <div className="mb-2 h-[13px] w-[70%] rounded bg-surface-2" />
                <div className="h-2.5 w-[40%] rounded bg-surface-2/70" />
              </li>
            ))}
          </ul>
        )}
        {error && (
          <div role="alert" className="m-2 rounded-md border border-border-strong bg-surface-1 px-3 py-2 text-xs text-text-secondary">
            <div className="text-sm text-text-primary">Library не загрузилась</div>
            <div className="mt-1 text-xs text-text-muted">{error}</div>
          </div>
        )}
        {!loading && !error && materials.length === 0 && (
          <div className="px-3 py-3 text-xs text-text-muted">
            Пока пусто.
            <br />
            <span className="text-text-secondary">+ — добавить первый материал</span>
          </div>
        )}
        <ul className="list-none">
          {materials.map((m) => {
            const isActive = activeId === m.id
            return (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => onOpen(m)}
                  aria-current={isActive ? 'page' : undefined}
                  aria-pressed={isActive}
                  className={cn(
                    'my-0.5 block w-full rounded-md border px-3 py-2.5 text-left',
                    isActive
                      ? 'border-border-strong bg-surface-2 text-text-primary'
                      : 'border-transparent bg-transparent text-text-primary hover:bg-surface-2',
                  )}
                >
                  <div className="overflow-hidden text-ellipsis whitespace-nowrap text-[13px] font-medium">
                    {m.title || '(untitled)'}
                  </div>
                  <div className="mt-1 flex gap-2 font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
                    <span>{m.sourceKind}</span>
                    <span>·</span>
                    <span>{Math.round(m.totalChars / 1000)}k chars</span>
                    <span>·</span>
                    <span>{formatRelative(m.updatedAt ?? m.createdAt)}</span>
                  </div>
                </button>
                {isActive && (
                  <button
                    type="button"
                    onClick={() => onArchive(m.id)}
                    className="mx-3 mb-1.5 rounded-md border border-border bg-transparent px-2 py-0.5 text-[10px] text-text-muted hover:bg-surface-2"
                  >
                    Archive
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      </div>

      <VocabReviewWidget compact />
    </aside>
  )
}

// ─── Welcome pane ─────────────────────────────────────────────────────────

function WelcomePane({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="mx-auto mt-8 w-full max-w-2xl px-4 sm:px-6 lg:px-8">
      <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">Reading</div>
      <h1 className="font-display text-[40px] font-medium leading-tight tracking-tight text-text-primary">
        Read a chapter
      </h1>
      <p className="mt-3 max-w-xl text-sm text-text-secondary">
        Положи статью или главу в библиотеку. Кликай по словам — они уйдут в SRS-очередь. 5 минут review каждое утро снизу слева.
      </p>
      <button
        type="button"
        onClick={onAdd}
        className="mt-6 rounded-md border border-border-strong bg-surface-1 px-4 py-2.5 text-[13px] text-text-primary hover:bg-surface-2"
      >
        + Add material
      </button>
    </div>
  )
}

// ─── Add-material form ────────────────────────────────────────────────────

function AddMaterialForm({ onCancel, onAdded }: { onCancel: () => void; onAdded: () => void }) {
  const [sourceKind, setSourceKind] = useState<ReadingSourceKind>('paste')
  const [title, setTitle] = useState('')
  const [bodyMd, setBodyMd] = useState('')
  const [sourceUrl, setSourceUrl] = useState('')
  const [bookChapter, setBookChapter] = useState('')
  const [bookTotal, setBookTotal] = useState('')
  const [error, setError] = useState<string | null>(null)
  const addMut = useAddReadingMaterialMutation()

  const submit = useCallback(async () => {
    setError(null)
    try {
      const args: Parameters<typeof addMut.mutateAsync>[0] = {
        sourceKind,
        title: title.trim(),
        bodyMd: bodyMd.trim(),
        sourceUrl: sourceUrl.trim(),
      }
      if (sourceKind === 'book') {
        const ch = parseInt(bookChapter, 10)
        const tot = parseInt(bookTotal, 10)
        if (Number.isFinite(ch)) args.bookChapter = ch
        if (Number.isFinite(tot)) args.bookTotalChapters = tot
      }
      await addMut.mutateAsync(args)
      onAdded()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'unknown'
      setError(msg)
    }
  }, [addMut, sourceKind, title, bodyMd, sourceUrl, bookChapter, bookTotal, onAdded])

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
      className="mx-auto mt-8 w-full max-w-2xl px-4 sm:px-6 lg:px-8"
    >
      <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">Reading · Add</div>
      <h1 className="font-display text-[28px] font-medium leading-tight tracking-tight text-text-primary">New material</h1>

      <fieldset className="mt-6 mb-3 border-0 p-0">
        <legend className="mb-2 font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">Source</legend>
        <div className="flex flex-wrap gap-1.5">
          {(['paste', 'url', 'book'] as ReadingSourceKind[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setSourceKind(k)}
              className={cn(
                'rounded-full border px-3 py-1 font-mono text-[10px] uppercase tracking-[0.08em] transition-colors',
                sourceKind === k
                  ? 'border-border-strong bg-surface-2 text-text-primary'
                  : 'border-border bg-transparent text-text-secondary hover:bg-surface-2',
              )}
            >
              {k}
            </button>
          ))}
        </div>
      </fieldset>

      <FieldLabel label="Title">
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Chapter 4 — The Black Swan"
          className="w-full rounded-md border border-border bg-surface-1 px-3 py-2 text-sm text-text-primary outline-none focus:border-border-strong"
          required
        />
      </FieldLabel>

      {sourceKind === 'url' && (
        <FieldLabel label="Source URL">
          <input
            type="url"
            value={sourceUrl}
            onChange={(e) => setSourceUrl(e.target.value)}
            placeholder="https://example.com/article"
            className="w-full rounded-md border border-border bg-surface-1 px-3 py-2 text-sm text-text-primary outline-none focus:border-border-strong"
          />
        </FieldLabel>
      )}

      {sourceKind === 'book' && (
        <div className="mt-3.5 flex flex-wrap gap-3">
          <FieldLabel label="Current chapter" className="min-w-[140px] flex-1">
            <input
              type="number"
              min={0}
              value={bookChapter}
              onChange={(e) => setBookChapter(e.target.value)}
              placeholder="3"
              className="w-full rounded-md border border-border bg-surface-1 px-3 py-2 text-sm text-text-primary outline-none focus:border-border-strong"
            />
          </FieldLabel>
          <FieldLabel label="Total chapters" className="min-w-[140px] flex-1">
            <input
              type="number"
              min={1}
              value={bookTotal}
              onChange={(e) => setBookTotal(e.target.value)}
              placeholder="20"
              className="w-full rounded-md border border-border bg-surface-1 px-3 py-2 text-sm text-text-primary outline-none focus:border-border-strong"
            />
          </FieldLabel>
        </div>
      )}

      <FieldLabel label={sourceKind === 'book' ? 'Notes (optional)' : 'Body (markdown)'}>
        <textarea
          value={bodyMd}
          onChange={(e) => setBodyMd(e.target.value)}
          placeholder={
            sourceKind === 'book'
              ? 'Заметки по книге — что важно запомнить (можно оставить пустым)'
              : 'Paste the full text here…'
          }
          rows={sourceKind === 'book' ? 6 : 14}
          className="w-full resize-y rounded-md border border-border bg-surface-1 px-3 py-2 font-mono text-[13px] leading-relaxed text-text-primary outline-none focus:border-border-strong"
          required={sourceKind !== 'book'}
        />
      </FieldLabel>

      {error && <p className="mt-3 text-xs" style={{ color: '#FF3B30' }}>{error}</p>}

      <div className="mt-4 flex gap-2">
        <button
          type="submit"
          disabled={addMut.isPending}
          className="rounded-md border border-border-strong bg-surface-2 px-4 py-2 text-[13px] text-text-primary hover:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {addMut.isPending ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={addMut.isPending}
          className="rounded-md border border-border bg-transparent px-4 py-2 text-[13px] text-text-secondary hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}

function FieldLabel({
  label,
  children,
  className,
}: {
  label: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <label className={cn('mt-3.5 block', className)}>
      <span className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">{label}</span>
      {children}
    </label>
  )
}

// ─── Reader ───────────────────────────────────────────────────────────────

interface ReaderProps {
  material: ReadingMaterial
  session: ReadingSession
  onExit: () => void
}

type GradingState =
  | { kind: 'idle' }
  | { kind: 'grading' }
  | { kind: 'scored'; score: number }
  | { kind: 'no_score' }

function Reader({ material, session, onExit }: ReaderProps) {
  const [popover, setPopover] = useState<VocabPopoverAnchor | null>(null)
  const [summary, setSummary] = useState('')
  const [grading, setGrading] = useState<GradingState>({ kind: 'idle' })
  const charsReadRef = useRef(0)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const endSessionMut = useEndReadingSessionMutation()
  const addVocabMut = useAddVocabMutation()
  const savedVocabQuery = useVocabBySourceQuery(material.id)
  const savedVocab = savedVocabQuery.data ?? []

  const onScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const { scrollTop, scrollHeight, clientHeight } = el
    const denom = Math.max(1, scrollHeight - clientHeight)
    const frac = Math.min(1, Math.max(0, scrollTop / denom))
    charsReadRef.current = Math.round(frac * material.totalChars)
  }, [material.totalChars])

  const finishWithoutGrade = useCallback(async () => {
    try {
      await endSessionMut.mutateAsync({
        sessionId: session.id,
        charsRead: charsReadRef.current,
        summaryMd: '',
      })
    } catch {
      /* silent */
    }
    onExit()
  }, [endSessionMut, session.id, onExit])

  const submitForGrading = useCallback(async () => {
    const trimmed = summary.trim()
    if (trimmed === '') {
      void finishWithoutGrade()
      return
    }
    setGrading({ kind: 'grading' })
    try {
      const resp = await endSessionMut.mutateAsync({
        sessionId: session.id,
        charsRead: charsReadRef.current,
        summaryMd: trimmed,
      })
      if (resp.aiSummaryScore !== null) {
        setGrading({ kind: 'scored', score: resp.aiSummaryScore })
      } else {
        setGrading({ kind: 'no_score' })
        window.setTimeout(() => onExit(), 350)
      }
    } catch {
      onExit()
    }
  }, [summary, endSessionMut, session.id, onExit, finishWithoutGrade])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      if (grading.kind === 'scored') {
        onExit()
        return
      }
      if (grading.kind === 'idle') {
        void finishWithoutGrade()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [grading.kind, finishWithoutGrade, onExit])

  const handleWordClick = useCallback(
    (word: string, context: string, e: React.MouseEvent<HTMLSpanElement>) => {
      const rect = e.currentTarget.getBoundingClientRect()
      setPopover({
        word,
        context,
        anchor: { x: rect.left + rect.width / 2, y: rect.bottom + 6 },
      })
    },
    [],
  )

  const handlePopoverSave = useCallback(
    async (translation: string) => {
      if (!popover) return
      try {
        await addVocabMut.mutateAsync({
          word: popover.word,
          translation: translation.trim(),
          contextMd: popover.context,
          sourceMaterial: material.id,
        })
      } catch {
        /* silent */
      }
      setPopover(null)
    },
    [popover, addVocabMut, material.id],
  )

  return (
    <>
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="h-full overflow-y-auto px-4 pb-24 pt-6 sm:px-6 lg:px-8"
      >
        <div className="mx-auto w-full max-w-3xl">
          <header className="mb-6">
            <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
              Reading · {material.sourceKind.toUpperCase()}
            </div>
            <h1 className="font-display text-[28px] font-medium leading-tight tracking-tight text-text-primary">
              {material.title}
            </h1>
            {material.sourceUrl && (
              <a
                href={material.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-1.5 inline-block text-xs text-text-muted no-underline hover:text-text-secondary"
              >
                {material.sourceUrl}
              </a>
            )}
          </header>

          <ReaderPillRow material={material} />

          <WordTokenizedText text={material.bodyMd} onWordClick={handleWordClick} serif />

          {savedVocab.length > 0 && <SavedVocabPanel items={savedVocab} />}

          <section className="mt-12 border-t border-border pt-6">
            <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
              Summary {grading.kind === 'idle' ? '(optional — AI will grade if you write one)' : ''}
            </div>
            <textarea
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="Briefly: what was this chapter about?"
              rows={4}
              className="w-full resize-y rounded-md border border-border bg-surface-1 px-3 py-2 text-sm text-text-primary outline-none focus:border-border-strong"
              disabled={grading.kind !== 'idle'}
            />
            {grading.kind === 'idle' && (
              <div className="mt-3.5 flex gap-2">
                <button
                  type="button"
                  onClick={() => void submitForGrading()}
                  className="rounded-md border border-border-strong bg-surface-2 px-4 py-2 text-[13px] text-text-primary hover:bg-surface-3"
                >
                  Finish &amp; save
                </button>
                <button
                  type="button"
                  onClick={() => void finishWithoutGrade()}
                  className="rounded-md border border-border bg-transparent px-4 py-2 text-[13px] text-text-secondary hover:bg-surface-2"
                >
                  Close
                </button>
              </div>
            )}
            {grading.kind === 'grading' && (
              <div className="mt-3.5 text-xs italic text-text-secondary">AI grading your summary…</div>
            )}
            {grading.kind === 'no_score' && (
              <div className="mt-3.5 text-xs text-text-muted">Saved. (AI grader is offline — no score this time.)</div>
            )}
            {grading.kind === 'scored' && <ScoreResultPanel score={grading.score} onClose={onExit} />}
          </section>
        </div>
      </div>

      {popover && (
        <VocabPopover
          popover={popover}
          onSave={(t) => void handlePopoverSave(t)}
          onCancel={() => setPopover(null)}
        />
      )}
    </>
  )
}

function SavedVocabPanel({ items }: { items: VocabEntry[] }) {
  return (
    <section className="mt-8 border-t border-border px-1 pb-3 pt-4">
      <div className="mb-2.5 flex items-baseline gap-2 font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
        <span>Words you've saved here</span>
        <span className="text-text-secondary">· {items.length}</span>
      </div>
      <ul className="flex list-none flex-wrap gap-2">
        {items.map((v) => (
          <li
            key={v.word}
            title={v.translation || ''}
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-1 px-2.5 py-1 text-xs text-text-primary"
          >
            <span>{v.word}</span>
            <span className="font-mono text-[9px] uppercase tracking-[0.08em] text-text-muted">box {v.box}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function ScoreResultPanel({ score, onClose }: { score: number; onClose: () => void }) {
  const tier = score >= 80 ? 'strong' : score >= 50 ? 'mid' : 'weak'
  const stripe =
    tier === 'strong' ? 'rgba(255, 255, 255, 0.85)' : tier === 'mid' ? 'rgba(255, 255, 255, 0.55)' : '#FF3B30'
  const label = tier === 'strong' ? 'Solid coverage' : tier === 'mid' ? 'Decent — some gaps' : 'Mostly missed it'

  return (
    <div className="mt-3.5 rounded-md border border-border bg-surface-1 px-4 py-3.5" style={{ borderLeft: `3px solid ${stripe}` }}>
      <div className="mb-1 font-mono text-[9px] uppercase tracking-[0.08em] text-text-muted">AI summary score</div>
      <div className="flex items-baseline gap-2.5">
        <span className="text-3xl font-medium text-text-primary">{score}</span>
        <span className="text-xs text-text-muted">/ 100</span>
        <span className="ml-2 text-sm text-text-secondary">{label}</span>
      </div>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-border-strong bg-surface-2 px-4 py-2 text-[13px] text-text-primary hover:bg-surface-3"
        >
          Done
        </button>
      </div>
    </div>
  )
}

function ReaderPillRow({ material }: { material: ReadingMaterial }) {
  const activeTrackQuery = useActiveStudyModeQuery()
  const activeTrack: ActiveTrack = activeTrackQuery.data?.activeTrack ?? 'general'
  const persona = pickPersonaForReading(activeTrack)
  const excerpt = useMemo(() => material.bodyMd.replace(/\s+/g, ' ').trim().slice(0, 600), [material.bodyMd])
  const ctx = `Студент читает: «${material.title}». Источник: ${material.sourceKind}. Excerpt: ${excerpt}${
    material.bodyMd.length > 600 ? '…' : ''
  }`
  return (
    <div className="mb-6 flex">
      <AICoachPill
        personaSlug={persona.slug}
        coachName={persona.name}
        contextNote={ctx}
        label="Спросить coach'а про этот текст"
      />
    </div>
  )
}

function pickPersonaForReading(activeTrack: ActiveTrack): { slug: string; name: string } {
  switch (activeTrack) {
    case 'go':
      return { slug: 'go-coach', name: 'go coach' }
    case 'ml':
      return { slug: 'ml-coach', name: 'ml coach' }
    case 'english':
      return { slug: 'english-coach', name: 'english coach' }
    default:
      return { slug: 'algo-coach', name: 'algo coach' }
  }
}
