// ListeningPage — Phase K W8 port of Hone Listening.
//
// Two-pane: library + player. Audio player + transcript click-on-word.
// Vocab queue shared с Reading (single SRS table).
import { useCallback, useEffect, useState } from 'react'

import { AudioPlayer } from '../../components/lingua/AudioPlayer'
import { VocabPopover, WordTokenizedText, type VocabPopoverAnchor } from '../../components/lingua/WordToken'
import {
  useAddListeningMaterialMutation,
  useAddVocabMutation,
  useArchiveListeningMaterialMutation,
  useIngestYouTubeListeningMutation,
  useListeningMaterialQuery,
  useListeningMaterialsQuery,
} from '../../lib/queries/lingua'
import type { ListeningMaterial } from '../../api/lingua/listening'
import { cn } from '../../lib/cn'

type Mode =
  | { kind: 'library' }
  | { kind: 'adding' }
  | { kind: 'player'; materialId: string }

function formatRelative(d: Date | null): string {
  if (!d) return ''
  const ms = Date.now() - d.getTime()
  if (ms < 60_000) return 'just now'
  const m = Math.floor(ms / 60_000)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  const days = Math.floor(h / 24)
  if (days < 30) return `${days}d`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function ListeningPage() {
  const materialsQuery = useListeningMaterialsQuery()
  const archiveMut = useArchiveListeningMaterialMutation()
  const [mode, setMode] = useState<Mode>({ kind: 'library' })

  const materials = materialsQuery.data ?? []

  const handleArchive = useCallback(
    async (id: string) => {
      if (!window.confirm('Архивировать этот материал?')) return
      try {
        await archiveMut.mutateAsync(id)
        if (mode.kind === 'player' && mode.materialId === id) setMode({ kind: 'library' })
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'unknown'
        window.alert(`Не получилось архивировать: ${msg}`)
      }
    },
    [archiveMut, mode],
  )

  return (
    <div className="flex min-h-[calc(100vh-180px)] w-full flex-col gap-0 md:flex-row">
      <LibraryPane
        materials={materials}
        loading={materialsQuery.isLoading}
        error={materialsQuery.error?.message}
        activeId={mode.kind === 'player' ? mode.materialId : null}
        onAdd={() => setMode({ kind: 'adding' })}
        onOpen={(m) => setMode({ kind: 'player', materialId: m.id })}
        onArchive={(id) => void handleArchive(id)}
      />
      <main className="min-w-0 flex-1">
        {mode.kind === 'library' && <WelcomePane onAdd={() => setMode({ kind: 'adding' })} />}
        {mode.kind === 'adding' && (
          <AddForm
            onCancel={() => setMode({ kind: 'library' })}
            onAdded={() => setMode({ kind: 'library' })}
          />
        )}
        {mode.kind === 'player' && (
          <Player
            materialId={mode.materialId}
            onExit={() => setMode({ kind: 'library' })}
          />
        )}
      </main>
    </div>
  )
}

// ─── Library ──────────────────────────────────────────────────────────────

function LibraryPane({
  materials,
  loading,
  error,
  activeId,
  onAdd,
  onOpen,
  onArchive,
}: {
  materials: ListeningMaterial[]
  loading: boolean
  error: string | undefined
  activeId: string | null
  onAdd: () => void
  onOpen: (m: ListeningMaterial) => void
  onArchive: (id: string) => void
}) {
  return (
    <aside className="flex w-full shrink-0 flex-col border-b border-border md:w-[280px] md:border-b-0 md:border-r">
      <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
          Listening · Library
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
          <ul aria-busy="true" className="list-none">
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
            <span className="text-text-secondary">+ — добавить аудио + transcript</span>
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
                    <span>Audio</span>
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
    </aside>
  )
}

function WelcomePane({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="mx-auto mt-8 w-full max-w-2xl px-4 sm:px-6 lg:px-8">
      <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">Listening</div>
      <h1 className="font-display text-[40px] font-medium leading-tight tracking-tight text-text-primary">
        Listen with a transcript
      </h1>
      <p className="mt-3 max-w-xl text-sm text-text-secondary">
        Положи аудио + transcript в библиотеку. Кликай по словам в transcript'е — они уйдут в общую SRS-очередь (та же что у Reading).
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

// ─── Add ──────────────────────────────────────────────────────────────────

function AddForm({ onCancel, onAdded }: { onCancel: () => void; onAdded: () => void }) {
  const [source, setSource] = useState<'youtube' | 'manual'>('youtube')
  const [youtubeUrl, setYoutubeUrl] = useState('')
  const [title, setTitle] = useState('')
  const [audioURL, setAudioURL] = useState('')
  const [transcript, setTranscript] = useState('')
  const [error, setError] = useState<string | null>(null)
  const ingestMut = useIngestYouTubeListeningMutation()
  const addMut = useAddListeningMaterialMutation()

  const submitYoutube = useCallback(async () => {
    setError(null)
    const url = youtubeUrl.trim()
    if (!/^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test(url)) {
      setError('Нужен URL вида https://youtube.com/... или https://youtu.be/...')
      return
    }
    try {
      await ingestMut.mutateAsync({ url })
      onAdded()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'unknown'
      if (msg.includes('no captions')) {
        setError('У этого видео нет субтитров. Переключись на Manual и вставь транскрипт сам.')
      } else if (msg.includes('not wired')) {
        setError('Backend не настроен (нет yt-dlp). Используй Manual paste.')
      } else {
        setError(msg)
      }
    }
  }, [youtubeUrl, ingestMut, onAdded])

  const submitManual = useCallback(async () => {
    setError(null)
    const url = audioURL.trim()
    if (!isPlayableAudioUrl(url)) {
      setError('URL должен указывать на mp3/m4a/ogg/wav. YouTube/Spotify пока не поддерживаем.')
      return
    }
    try {
      await addMut.mutateAsync({
        title: title.trim(),
        audioUrl: url,
        transcriptMd: transcript.trim(),
      })
      onAdded()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'unknown'
      setError(msg)
    }
  }, [title, audioURL, transcript, addMut, onAdded])

  const busy = ingestMut.isPending || addMut.isPending

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (source === 'youtube') void submitYoutube()
        else void submitManual()
      }}
      className="mx-auto mt-8 w-full max-w-2xl px-4 sm:px-6 lg:px-8"
    >
      <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">Listening · Add</div>
      <h1 className="font-display text-[28px] font-medium leading-tight tracking-tight text-text-primary">New audio</h1>

      <div role="tablist" aria-label="Audio source" className="mt-5 flex flex-wrap gap-1">
        <SourceTab active={source === 'youtube'} onClick={() => setSource('youtube')}>
          YouTube
        </SourceTab>
        <SourceTab active={source === 'manual'} onClick={() => setSource('manual')}>
          Manual
        </SourceTab>
      </div>

      {source === 'youtube' ? (
        <>
          <label className="mt-3.5 block">
            <span className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">YouTube URL</span>
            <input
              type="url"
              value={youtubeUrl}
              onChange={(e) => setYoutubeUrl(e.target.value)}
              placeholder="https://www.youtube.com/watch?v=..."
              className="w-full rounded-md border border-border bg-surface-1 px-3 py-2 text-sm text-text-primary outline-none focus:border-border-strong"
              required
            />
          </label>
          <p className="mt-2 text-xs leading-relaxed text-text-muted">
            Backend pull'нет auto-captions через yt-dlp. Title + transcript заполнятся автоматически. Если у видео нет субтитров — переключись на Manual.
          </p>
          {error && <p className="mt-3 text-xs" style={{ color: '#FF3B30' }}>{error}</p>}
          <div className="mt-4 flex gap-2">
            <button
              type="submit"
              disabled={busy}
              className="rounded-md border border-border-strong bg-surface-2 px-4 py-2 text-[13px] text-text-primary hover:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? 'Pulling…' : 'Pull from YouTube'}
            </button>
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              className="rounded-md border border-border bg-transparent px-4 py-2 text-[13px] text-text-secondary hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </>
      ) : (
        <>
          <label className="mt-3.5 block">
            <span className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">Title</span>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Lex Fridman ep 400 — Sam Altman"
              className="w-full rounded-md border border-border bg-surface-1 px-3 py-2 text-sm text-text-primary outline-none focus:border-border-strong"
              required
            />
          </label>
          <label className="mt-3.5 block">
            <span className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">Audio URL</span>
            <input
              type="url"
              value={audioURL}
              onChange={(e) => setAudioURL(e.target.value)}
              placeholder="https://example.com/ep400.mp3"
              className="w-full rounded-md border border-border bg-surface-1 px-3 py-2 text-sm text-text-primary outline-none focus:border-border-strong"
              required
            />
          </label>
          <label className="mt-3.5 block">
            <span className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">Transcript (markdown)</span>
            <textarea
              value={transcript}
              onChange={(e) => setTranscript(e.target.value)}
              placeholder="Paste the full transcript here…"
              rows={14}
              className="w-full resize-y rounded-md border border-border bg-surface-1 px-3 py-2 font-mono text-[13px] leading-relaxed text-text-primary outline-none focus:border-border-strong"
              required
            />
          </label>
          {error && <p className="mt-3 text-xs" style={{ color: '#FF3B30' }}>{error}</p>}
          <div className="mt-4 flex gap-2">
            <button
              type="submit"
              disabled={busy}
              className="rounded-md border border-border-strong bg-surface-2 px-4 py-2 text-[13px] text-text-primary hover:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              className="rounded-md border border-border bg-transparent px-4 py-2 text-[13px] text-text-secondary hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </>
      )}
    </form>
  )
}

function SourceTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      role="tab"
      aria-selected={active}
      className={cn(
        'rounded-full border px-3.5 py-1 text-xs transition-colors',
        active
          ? 'border-border-strong bg-surface-2 text-text-primary'
          : 'border-border bg-transparent text-text-secondary hover:bg-surface-2',
      )}
    >
      {children}
    </button>
  )
}

function isPlayableAudioUrl(s: string): boolean {
  if (!s) return false
  if (!/^https?:\/\//i.test(s)) return false
  return /\.(mp3|m4a|ogg|oga|wav|aac|flac)(\?.*)?$/i.test(s)
}

// ─── Player ───────────────────────────────────────────────────────────────

function Player({ materialId, onExit }: { materialId: string; onExit: () => void }) {
  const materialQuery = useListeningMaterialQuery(materialId)
  const [popover, setPopover] = useState<VocabPopoverAnchor | null>(null)
  const addVocabMut = useAddVocabMutation()

  // Esc → exit.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onExit()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onExit])

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
        })
      } catch {
        /* silent */
      }
      setPopover(null)
    },
    [popover, addVocabMut],
  )

  if (materialQuery.isLoading) {
    return <div className="mx-auto w-full max-w-3xl px-4 py-8 text-xs text-text-muted">Loading…</div>
  }
  if (materialQuery.error || !materialQuery.data) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-8 text-xs text-text-muted">
        Не удалось открыть материал: {materialQuery.error?.message ?? 'not found'}
      </div>
    )
  }
  const material = materialQuery.data

  return (
    <>
      <div className="h-full overflow-y-auto px-4 pb-24 pt-6 sm:px-6 lg:px-8">
        <div className="mx-auto w-full max-w-3xl">
          <header className="mb-6">
            <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">Listening</div>
            <h1 className="font-display text-[28px] font-medium leading-tight tracking-tight text-text-primary">
              {material.title}
            </h1>
          </header>

          <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-surface-1 px-3.5 py-3">
            <AudioPlayer src={material.audioUrl} compact={false} />
            <audio src={material.audioUrl} controls preload="auto" className="min-w-0 flex-1" />
          </div>

          {material.transcriptMd ? (
            <div className="mt-7">
              <WordTokenizedText text={material.transcriptMd} onWordClick={handleWordClick} serif />
            </div>
          ) : (
            <p className="mt-8 text-sm text-text-secondary">
              Без transcript'а — кликабельные слова недоступны. Можно добавить позже, отредактировав материал в библиотеке.
            </p>
          )}
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
