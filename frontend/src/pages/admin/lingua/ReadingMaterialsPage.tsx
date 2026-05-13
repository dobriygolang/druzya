// ReadingMaterialsPage — admin view для hone_reading_materials.
//
// CRUD scope:
//   - List + filter (source_kind / active|archived)
//   - Add via modal (5 source_kind variants)
//   - Archive
//   - Update beyond initial create — NOT supported by backend (нет
//     UpdateReadingMaterial RPC, только UpdateBookProgress). Edit-modal
//     отсутствует, materials managed как append-only.

import { useMemo, useState } from 'react'

import { Button } from '../../../components/Button'
import { Modal } from '../../../components/primitives/Modal'
import { ErrorBox, PanelSkeleton } from '../shared'
import {
  useAdminReadingMaterialsQuery,
  useAddReadingMaterialMutation,
  useArchiveReadingMaterialMutation,
  type AddReadingMaterialBody,
  type ReadingMaterial,
  type ReadingSourceKind,
} from '../../../lib/queries/adminLingua'

const SOURCE_KINDS: { value: ReadingSourceKind; label: string }[] = [
  { value: 'paste', label: 'Paste' },
  { value: 'url', label: 'URL' },
  { value: 'pdf', label: 'PDF' },
  { value: 'epub', label: 'EPUB' },
  { value: 'book', label: 'Book' },
]

type StatusFilter = 'all' | 'active' | 'archived'

export function ReadingMaterialsPage() {
  const query = useAdminReadingMaterialsQuery()
  const archive = useArchiveReadingMaterialMutation()
  const [modalOpen, setModalOpen] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [kindFilter, setKindFilter] = useState<ReadingSourceKind | 'all'>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

  const filtered = useMemo(() => {
    if (!query.data) return []
    return query.data.filter((m) => {
      const isArchived = !!m.archived_at && m.archived_at !== ''
      if (statusFilter === 'active' && isArchived) return false
      if (statusFilter === 'archived' && !isArchived) return false
      if (kindFilter !== 'all' && m.source_kind !== kindFilter) return false
      return true
    })
  }, [query.data, kindFilter, statusFilter])

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
        <h4 className="font-display text-[14px] font-bold text-text-primary">Reading materials</h4>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={kindFilter}
            onChange={(e) => setKindFilter(e.target.value as ReadingSourceKind | 'all')}
            className="rounded-md border border-border bg-surface-2 px-2 py-1.5 font-mono text-[11px] text-text-primary focus:border-text-primary focus:outline-none"
          >
            <option value="all">Все kind</option>
            {SOURCE_KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className="rounded-md border border-border bg-surface-2 px-2 py-1.5 font-mono text-[11px] text-text-primary focus:border-text-primary focus:outline-none"
          >
            <option value="all">Все статусы</option>
            <option value="active">Active</option>
            <option value="archived">Archived</option>
          </select>
          <Button size="sm" onClick={() => setModalOpen(true)}>
            + Добавить material
          </Button>
        </div>
      </header>

      {err && (
        <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-[12px] text-danger">
          {err}
        </div>
      )}

      {filtered.length === 0 ? (
        <EmptyState onAdd={() => setModalOpen(true)} />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="min-w-full">
            <thead className="bg-surface-1">
              <tr>
                <Th>ID</Th>
                <Th>Title</Th>
                <Th>Kind</Th>
                <Th>Chars</Th>
                <Th>Created</Th>
                <Th>Status</Th>
                <Th>{''}</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((m) => (
                <ReadingRow
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

      {modalOpen && (
        <AddReadingModal onClose={() => setModalOpen(false)} onError={setErr} />
      )}
    </div>
  )
}

function ReadingRow({
  m,
  onArchive,
  archiving,
}: {
  m: ReadingMaterial
  onArchive: () => void
  archiving: boolean
}) {
  const isArchived = !!m.archived_at && m.archived_at !== ''
  return (
    <tr className={`bg-surface-2 hover:bg-surface-1 ${isArchived ? 'opacity-60' : ''}`}>
      <Td className="font-mono text-[10px] text-text-muted">{m.id.slice(0, 8)}…</Td>
      <Td className="max-w-[260px] truncate text-[12px] text-text-primary" title={m.title}>
        {m.title || <span className="text-text-muted">—</span>}
      </Td>
      <Td>
        <span className="rounded-full border border-border bg-bg px-2 py-0.5 font-mono text-[10px] uppercase text-text-secondary">
          {m.source_kind}
        </span>
      </Td>
      <Td className="font-mono text-[11px] text-text-muted">{m.total_chars.toLocaleString('ru-RU')}</Td>
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

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-md border border-dashed border-border bg-surface-1 px-4 py-10 text-center">
      <span className="font-mono text-[12px] text-text-muted">Нет материалов под текущие фильтры</span>
      <Button size="sm" onClick={onAdd}>
        + Добавить material
      </Button>
    </div>
  )
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-3 py-2 text-left font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted">
      {children}
    </th>
  )
}

function Td({ children, className, title }: { children: React.ReactNode; className?: string; title?: string }) {
  return (
    <td className={`px-3 py-2 text-[12px] text-text-primary ${className ?? ''}`} title={title}>
      {children}
    </td>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Add modal
// ─────────────────────────────────────────────────────────────────────────

function AddReadingModal({
  onClose,
  onError,
}: {
  onClose: () => void
  onError: (msg: string | null) => void
}) {
  const mutation = useAddReadingMaterialMutation()
  const [sourceKind, setSourceKind] = useState<ReadingSourceKind>('paste')
  const [title, setTitle] = useState('')
  const [sourceUrl, setSourceUrl] = useState('')
  const [bodyMd, setBodyMd] = useState('')
  const [bookChapter, setBookChapter] = useState('')
  const [bookTotalChapters, setBookTotalChapters] = useState('')
  const [busy, setBusy] = useState(false)

  const needsUrl = sourceKind === 'url' || sourceKind === 'pdf' || sourceKind === 'epub'
  const needsBody = sourceKind === 'paste'
  const isBook = sourceKind === 'book'

  const canSubmit =
    title.trim().length >= 2 &&
    (!needsUrl || sourceUrl.trim().length >= 4) &&
    (!needsBody || bodyMd.trim().length >= 10)

  const submit = async () => {
    if (!canSubmit) return
    setBusy(true)
    onError(null)
    try {
      const body: AddReadingMaterialBody = {
        source_kind: sourceKind,
        title: title.trim(),
      }
      if (needsUrl) body.source_url = sourceUrl.trim()
      if (needsBody) body.body_md = bodyMd
      if (isBook) {
        const ch = parseInt(bookChapter, 10)
        const total = parseInt(bookTotalChapters, 10)
        if (!isNaN(ch) && ch > 0) {
          body.book_chapter = ch
          body.has_book_chapter = true
        }
        if (!isNaN(total) && total > 0) {
          body.book_total_chapters = total
          body.has_book_total = true
        }
      }
      await mutation.mutateAsync(body)
      onClose()
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Failed to add material')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} size="md" title="Новый reading material">
      <div className="flex flex-col gap-4">
        <Field label="Title">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-[13px] text-text-primary focus:border-text-primary focus:outline-none"
            placeholder="Designing Data-Intensive Applications — chapter 4"
          />
        </Field>

        <Field label="Source kind">
          <select
            value={sourceKind}
            onChange={(e) => setSourceKind(e.target.value as ReadingSourceKind)}
            className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-[13px] text-text-primary focus:border-text-primary focus:outline-none"
          >
            {SOURCE_KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </Field>

        {needsUrl && (
          <Field label="Source URL" hint="https://… (для url/pdf/epub)">
            <input
              type="url"
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 font-mono text-[11px] text-text-primary focus:border-text-primary focus:outline-none"
              placeholder="https://example.com/article.pdf"
            />
          </Field>
        )}

        {needsBody && (
          <Field label="Body (markdown)" hint="Полный текст для paste-варианта">
            <textarea
              value={bodyMd}
              onChange={(e) => setBodyMd(e.target.value)}
              rows={8}
              className="w-full resize-y rounded-md border border-border bg-surface-2 px-3 py-2 font-mono text-[12px] text-text-primary focus:border-text-primary focus:outline-none"
              placeholder="# Heading&#10;&#10;Paragraph…"
            />
          </Field>
        )}

        {isBook && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Chapter" hint="Опционально">
              <input
                type="number"
                min={1}
                value={bookChapter}
                onChange={(e) => setBookChapter(e.target.value)}
                className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 font-mono text-[12px] text-text-primary focus:border-text-primary focus:outline-none"
                placeholder="4"
              />
            </Field>
            <Field label="Total chapters" hint="Опционально">
              <input
                type="number"
                min={1}
                value={bookTotalChapters}
                onChange={(e) => setBookTotalChapters(e.target.value)}
                className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 font-mono text-[12px] text-text-primary focus:border-text-primary focus:outline-none"
                placeholder="12"
              />
            </Field>
          </div>
        )}

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
