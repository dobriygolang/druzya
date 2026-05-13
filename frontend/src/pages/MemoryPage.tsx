// «What Coach remembers about you» — full list paginated по kind. Каждая
// entry соответствует coach_episodes row backend'а (kind=goal_set /
// mock_complete / cue_session / reflection_grade / weak_topic / streak_milestone
// / etc).
//
// Юзер может delete entry → backend soft-deletes (sets deleted_at) → AI
// больше не reads. This unlocks identity claim «AI помнит» с visible
// truth — без черного ящика.
//
// Route: /profile/memory (linked from CoachMemoryCard на AITutorChatPage).

import { useState } from 'react'
import { Brain, Check, Pencil, Trash2, X } from 'lucide-react'

import { AppShellV2 } from '../components/AppShell'
import { Card } from '../components/Card'
import { DataLoader } from '../components/DataLoader'
import { ErrorBoundary } from '../components/ErrorBoundary'
import {
  useDeleteMemoryEntryMutation,
  useEditMemoryEntryMutation,
  useMemoryEntriesQuery,
  type CoachMemoryEntry,
} from '../lib/queries/coachMemory'

const KIND_FILTERS: { value: string | null; label: string }[] = [
  { value: null, label: 'Все' },
  { value: 'goal_set', label: 'Goals' },
  { value: 'mock_complete', label: 'Mocks' },
  { value: 'cue_session', label: 'Cue sessions' },
  { value: 'reflection_grade', label: 'Reflections' },
  { value: 'weak_topic', label: 'Weak topics' },
  { value: 'streak_milestone', label: 'Streaks' },
]

export default function MemoryPage() {
  const [activeKind, setActiveKind] = useState<string | null>(null)
  const memoryQ = useMemoryEntriesQuery({ kind: activeKind, limit: 50 })
  const deleteMut = useDeleteMemoryEntryMutation()
  const editMut = useEditMemoryEntryMutation()

  return (
    <AppShellV2>
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-10 sm:px-8 sm:py-14">
        <header className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Brain className="h-5 w-5 text-text-secondary" />
            <h1 className="font-display text-3xl font-bold leading-tight">
              Что AI помнит
            </h1>
          </div>
          <p className="text-[14px] text-text-secondary">
            Полный список memory entries, на которые опирается coach. Удали
            запись — AI больше не использует её в next session. Это твоя
            память; ты решаешь что AI хранит.
          </p>
        </header>

        <div className="flex flex-wrap gap-2">
          {KIND_FILTERS.map((f) => (
            <button
              key={f.value ?? 'all'}
              type="button"
              onClick={() => setActiveKind(f.value)}
              className={
                activeKind === f.value
                  ? 'inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-3.5 py-1.5 text-[13px] font-semibold text-text-primary'
                  : 'inline-flex items-center gap-1.5 rounded-full border border-border bg-bg px-3.5 py-1.5 text-[13px] text-text-secondary hover:border-border-strong hover:text-text-primary'
              }
            >
              {f.label}
            </button>
          ))}
        </div>

        <ErrorBoundary section="Memory entries">
          <DataLoader
            state={memoryQ}
            section="Memory"
            skeleton={
              <Card className="flex-col gap-1 p-8 text-center">
                <span className="font-display text-base font-bold text-text-primary">
                  Загружаем memory
                </span>
              </Card>
            }
            empty={(d) => d.items.length === 0}
            emptyContent={
              <Card className="flex-col gap-1 p-8 text-center">
                <span className="font-display text-base font-bold text-text-primary">
                  Memory ещё пуста
                </span>
                <span className="text-sm text-text-secondary">
                  Coach пока ничего не зафиксировал. После первой сессии / mock /
                  diagnostic появятся entries.
                </span>
              </Card>
            }
          >
            {(data) => (
              <div className="flex flex-col gap-2">
                <p className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
                  {data.total} {pluralEntries(data.total)} · {data.items.length} показано
                </p>
                <ul className="flex flex-col gap-2">
                  {data.items.map((e) => (
                    <MemoryRow
                      key={e.id}
                      entry={e}
                      onDelete={() => {
                        if (window.confirm('Удалить эту memory entry? AI больше не будет её использовать.')) {
                          deleteMut.mutate(e.id)
                        }
                      }}
                      onSaveEdit={(content) => editMut.mutateAsync({ id: e.id, content })}
                      isSaving={editMut.isPending}
                    />
                  ))}
                </ul>
              </div>
            )}
          </DataLoader>
        </ErrorBoundary>
      </div>
    </AppShellV2>
  )
}

interface MemoryRowProps {
  entry: CoachMemoryEntry
  onDelete: () => void
  onSaveEdit: (content: string) => Promise<unknown>
  isSaving: boolean
}

function MemoryRow({ entry, onDelete, onSaveEdit, isSaving }: MemoryRowProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(entry.content)
  const remaining = 2000 - [...draft.trim()].length
  const tooLong = remaining < 0
  const empty = draft.trim().length === 0

  const cancel = () => {
    setEditing(false)
    setDraft(entry.content)
  }
  const save = async () => {
    if (empty || tooLong) return
    if (draft.trim() === entry.content.trim()) {
      setEditing(false)
      return
    }
    try {
      await onSaveEdit(draft.trim())
      setEditing(false)
    } catch {
      /* mutation surface error handled by tanstack; keep editor open */
    }
  }

  return (
    <Card className="flex-row items-start gap-3 p-4">
      <div className="flex flex-1 flex-col gap-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
            {entry.kind.replace(/_/g, ' ')}
          </span>
          {entry.importance !== undefined && entry.importance >= 7 && (
            <span className="rounded-sm border border-border bg-surface-2 px-1.5 py-px font-mono text-[9px] uppercase tracking-[0.1em] text-text-secondary">
              high · {entry.importance}/10
            </span>
          )}
          {entry.source && (
            <span className="font-mono text-[10px] text-text-muted">· {entry.source}</span>
          )}
          {entry.edited_at && (
            <span
              className="font-mono text-[10px] text-text-muted"
              title={`edited ${entry.edited_at.slice(0, 10)}`}
            >
              · edited
            </span>
          )}
          <span className="ml-auto font-mono text-[10px] text-text-muted">
            {formatAgo(entry.occurred_at)}
          </span>
        </div>
        {editing ? (
          <div className="flex flex-col gap-2">
            <textarea
              value={draft}
              onChange={(ev) => setDraft(ev.target.value)}
              rows={3}
              autoFocus
              className="w-full resize-y rounded-md border border-border bg-surface-1 px-2.5 py-2 text-[13px] leading-relaxed text-text-primary focus:border-border-strong focus:outline-none"
            />
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={save}
                disabled={empty || tooLong || isSaving}
                aria-label="Сохранить"
                title="Save (⌘+Enter)"
                className="inline-flex items-center gap-1.5 rounded-md border border-border-strong bg-surface-2 px-2.5 py-1 text-[12px] text-text-primary hover:bg-surface-3 disabled:opacity-50"
              >
                <Check className="h-3 w-3" />
                Save
              </button>
              <button
                type="button"
                onClick={cancel}
                disabled={isSaving}
                aria-label="Отмена"
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-bg px-2.5 py-1 text-[12px] text-text-secondary hover:text-text-primary disabled:opacity-50"
              >
                <X className="h-3 w-3" />
                Cancel
              </button>
              <span
                className={`ml-auto font-mono text-[10px] ${tooLong ? 'text-text-primary' : 'text-text-muted'}`}
                style={tooLong ? { color: 'var(--red)' } : undefined}
              >
                {remaining}
              </span>
            </div>
          </div>
        ) : (
          <>
            <p className="text-[13px] leading-relaxed text-text-primary">{entry.content}</p>
            {entry.expires_at && (
              <span className="font-mono text-[10px] text-text-muted">
                истекает {entry.expires_at.slice(0, 10)}
              </span>
            )}
          </>
        )}
      </div>
      {!editing && (
        <div className="flex shrink-0 items-start gap-1">
          <button
            type="button"
            onClick={() => {
              setDraft(entry.content)
              setEditing(true)
            }}
            aria-label="Редактировать"
            title="Уточнить formulation"
            className="rounded-md p-1.5 text-text-muted transition-colors hover:bg-surface-2 hover:text-text-primary"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onDelete}
            aria-label="Удалить запись"
            title="AI больше не будет использовать"
            className="rounded-md p-1.5 text-text-muted transition-colors hover:bg-surface-2 hover:text-text-primary"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </Card>
  )
}

function formatAgo(iso: string): string {
  if (!iso) return '—'
  const ts = Date.parse(iso)
  if (!Number.isFinite(ts)) return '—'
  const diff = Date.now() - ts
  const d = Math.floor(diff / (24 * 60 * 60 * 1000))
  if (d <= 0) return 'сегодня'
  if (d === 1) return 'вчера'
  if (d < 7) return `${d}д назад`
  if (d < 30) return `${Math.floor(d / 7)}нд назад`
  return iso.slice(0, 10)
}

function pluralEntries(n: number): string {
  if (n === 1) return 'запись'
  if (n >= 2 && n <= 4) return 'записи'
  return 'записей'
}
