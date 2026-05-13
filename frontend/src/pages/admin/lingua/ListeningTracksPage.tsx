// ListeningTracksPage — admin view для hone_listening_materials.
//
// CRUD scope:
//   - List + filter (active|archived)
//   - Add via two paths: YouTube (URL → backend yt-dlp captions ingest)
//     или Manual (title + audio_url + transcript_md).
//   - Archive
//   - Update — NOT supported (нет UpdateListeningMaterial RPC).

import { useMemo, useState } from 'react'

import { Button } from '../../../components/Button'
import { Modal } from '../../../components/primitives/Modal'
import { ErrorBox, PanelSkeleton } from '../shared'
import {
  useAdminListeningMaterialsQuery,
  useAddListeningMaterialMutation,
  useIngestYouTubeMutation,
  useArchiveListeningMaterialMutation,
  type ListeningMaterial,
} from '../../../lib/queries/adminLingua'

type StatusFilter = 'all' | 'active' | 'archived'

export function ListeningTracksPage() {
  const query = useAdminListeningMaterialsQuery()
  const archive = useArchiveListeningMaterialMutation()
  const [modal, setModal] = useState<'manual' | 'youtube' | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

  const filtered = useMemo(() => {
    if (!query.data) return []
    return query.data.filter((m) => {
      const isArchived = !!m.archived_at && m.archived_at !== ''
      if (statusFilter === 'active' && isArchived) return false
      if (statusFilter === 'archived' && !isArchived) return false
      return true
    })
  }, [query.data, statusFilter])

  if (query.isPending) return <PanelSkeleton rows={6} />
  if (query.error) return <ErrorBox message={(query.error as Error).message || 'Failed to load'} />

  const handleArchive = async (id: string) => {
    setErr(null)
    try {
      await archive.mutateAsync(id)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to archive')
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="font-display text-[14px] font-bold text-text-primary">Listening tracks</h4>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className="rounded-md border border-border bg-surface-2 px-2 py-1.5 font-mono text-[11px] text-text-primary focus:border-text-primary focus:outline-none"
          >
            <option value="all">Все статусы</option>
            <option value="active">Active</option>
            <option value="archived">Archived</option>
          </select>
          <Button size="sm" variant="ghost" onClick={() => setModal('manual')}>
            + Manual
          </Button>
          <Button size="sm" onClick={() => setModal('youtube')}>
            + YouTube
          </Button>
        </div>
      </header>

      {err && (
        <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-[12px] text-danger">
          {err}
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-md border border-dashed border-border bg-surface-1 px-4 py-10 text-center">
          <span className="font-mono text-[12px] text-text-muted">Нет треков под текущие фильтры</span>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setModal('manual')}>
              + Manual
            </Button>
            <Button size="sm" onClick={() => setModal('youtube')}>
              + YouTube
            </Button>
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="min-w-full">
            <thead className="bg-surface-1">
              <tr>
                <Th>ID</Th>
                <Th>Title</Th>
                <Th>Audio URL</Th>
                <Th>Transcript</Th>
                <Th>Created</Th>
                <Th>Status</Th>
                <Th>{''}</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((m) => (
                <ListeningRow
                  key={m.id}
                  m={m}
                  onArchive={() => handleArchive(m.id)}
                  archiving={archive.isPending}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal === 'manual' && (
        <AddManualModal onClose={() => setModal(null)} onError={setErr} />
      )}
      {modal === 'youtube' && (
        <AddYouTubeModal onClose={() => setModal(null)} onError={setErr} />
      )}
    </div>
  )
}

function ListeningRow({
  m,
  onArchive,
  archiving,
}: {
  m: ListeningMaterial
  onArchive: () => void
  archiving: boolean
}) {
  const isArchived = !!m.archived_at && m.archived_at !== ''
  const transcriptLen = m.transcript_md?.length ?? 0
  return (
    <tr className={`bg-surface-2 hover:bg-surface-1 ${isArchived ? 'opacity-60' : ''}`}>
      <Td className="font-mono text-[10px] text-text-muted">{m.id.slice(0, 8)}…</Td>
      <Td className="max-w-[240px] truncate text-[12px] text-text-primary" title={m.title}>
        {m.title || <span className="text-text-muted">—</span>}
      </Td>
      <Td className="max-w-[200px]">
        {m.audio_url ? (
          <a
            href={m.audio_url}
            target="_blank"
            rel="noopener noreferrer"
            className="block truncate font-mono text-[10px] text-text-secondary hover:text-text-primary"
            title={m.audio_url}
          >
            {m.audio_url}
          </a>
        ) : (
          <span className="font-mono text-[10px] text-text-muted">—</span>
        )}
      </Td>
      <Td className="font-mono text-[11px] text-text-muted">
        {transcriptLen > 0 ? `${transcriptLen.toLocaleString('ru-RU')} chars` : '—'}
      </Td>
      <Td className="font-mono text-[10px] text-text-muted">{m.created_at.slice(0, 10) || '—'}</Td>
      <Td>
        {isArchived ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 font-mono text-[10px] uppercase text-text-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-text-muted" /> archived
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full border border-text-primary/30 bg-text-primary/5 px-2 py-0.5 font-mono text-[10px] uppercase text-text-primary">
            <span className="h-1.5 w-1.5 rounded-full bg-text-primary" /> active
          </span>
        )}
      </Td>
      <Td className="text-right">
        {!isArchived && (
          <button
            type="button"
            onClick={onArchive}
            disabled={archiving}
            className="rounded-md border border-border px-2 py-1 font-mono text-[10px] text-text-muted hover:border-danger hover:text-danger disabled:opacity-50"
          >
            archive
          </button>
        )}
      </Td>
    </tr>
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
    <td className={`px-3 py-2 text-[12px] text-text-primary ${className ?? ''}`} title={title}>
      {children}
    </td>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Manual add modal
// ─────────────────────────────────────────────────────────────────────────

function AddManualModal({
  onClose,
  onError,
}: {
  onClose: () => void
  onError: (msg: string | null) => void
}) {
  const mutation = useAddListeningMaterialMutation()
  const [title, setTitle] = useState('')
  const [audioUrl, setAudioUrl] = useState('')
  const [transcriptMd, setTranscriptMd] = useState('')
  const [busy, setBusy] = useState(false)

  const canSubmit =
    title.trim().length >= 2 && audioUrl.trim().length >= 6 && transcriptMd.trim().length >= 10

  const submit = async () => {
    if (!canSubmit) return
    setBusy(true)
    onError(null)
    try {
      await mutation.mutateAsync({
        title: title.trim(),
        audio_url: audioUrl.trim(),
        transcript_md: transcriptMd,
      })
      onClose()
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Failed to add track')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} size="md" title="Manual listening track">
      <div className="flex flex-col gap-4">
        <Field label="Title">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-[13px] text-text-primary focus:border-text-primary focus:outline-none"
            placeholder="System Design — Caching basics"
          />
        </Field>

        <Field label="Audio URL" hint="Прямая ссылка на mp3/mp4/wav">
          <input
            type="url"
            value={audioUrl}
            onChange={(e) => setAudioUrl(e.target.value)}
            className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 font-mono text-[11px] text-text-primary focus:border-text-primary focus:outline-none"
            placeholder="https://example.com/audio.mp3"
          />
        </Field>

        <Field label="Transcript (markdown)" hint="Полный текст транскрипта">
          <textarea
            value={transcriptMd}
            onChange={(e) => setTranscriptMd(e.target.value)}
            rows={10}
            className="w-full resize-y rounded-md border border-border bg-surface-2 px-3 py-2 font-mono text-[12px] text-text-primary focus:border-text-primary focus:outline-none"
            placeholder="Welcome to this episode…"
          />
        </Field>

        <footer className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" onClick={submit} disabled={!canSubmit || busy}>
            Create
          </Button>
        </footer>
      </div>
    </Modal>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// YouTube ingest modal
// ─────────────────────────────────────────────────────────────────────────

function AddYouTubeModal({
  onClose,
  onError,
}: {
  onClose: () => void
  onError: (msg: string | null) => void
}) {
  const mutation = useIngestYouTubeMutation()
  const [url, setUrl] = useState('')
  const [lang, setLang] = useState<'' | 'en' | 'ru'>('')
  const [busy, setBusy] = useState(false)

  const canSubmit =
    /^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test(url.trim())

  const submit = async () => {
    if (!canSubmit) return
    setBusy(true)
    onError(null)
    try {
      await mutation.mutateAsync({
        url: url.trim(),
        language_hint: lang || undefined,
      })
      onClose()
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Failed to ingest YouTube — captions missing?')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} size="sm" title="Ingest YouTube">
      <div className="flex flex-col gap-4">
        <p className="text-[12px] text-text-secondary">
          Paste YouTube URL — backend через yt-dlp вытащит auto-captions + metadata.
          Если captions нет → возвращает ошибку.
        </p>

        <Field label="YouTube URL">
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 font-mono text-[11px] text-text-primary focus:border-text-primary focus:outline-none"
            placeholder="https://youtube.com/watch?v=…"
          />
        </Field>

        <Field label="Language hint" hint="Опционально. По дефолту пробуем en → ru → any">
          <select
            value={lang}
            onChange={(e) => setLang(e.target.value as '' | 'en' | 'ru')}
            className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-[13px] text-text-primary focus:border-text-primary focus:outline-none"
          >
            <option value="">Auto (en → ru → any)</option>
            <option value="en">English</option>
            <option value="ru">Russian</option>
          </select>
        </Field>

        <footer className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" onClick={submit} disabled={!canSubmit || busy}>
            {busy ? 'Pulling…' : 'Ingest'}
          </Button>
        </footer>
      </div>
    </Modal>
  )
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">{label}</span>
      {children}
      {hint && <span className="font-mono text-[10px] text-text-muted">{hint}</span>}
    </label>
  )
}
