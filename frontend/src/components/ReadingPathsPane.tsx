// ReadingPathsPane — Stream D (2026-05-12). 4th sub-surface of the
// tutor dashboard. Lists curated atlas-node sequences + provides a
// new-path form + per-path archive.
//
// V1 surface: minimal create form (name + textarea of `atlas.node.keys,
// one-per-line`). Drag-drop ribbon onto atlas-nodes is deferred to a
// UX pass — the textarea is honest about being a list editor, not a
// fake-rich UX. resource_ids editing is deferred entirely (UUIDs from
// external_resources require a picker UI; today tutors set resources
// via assignments instead, so this gap doesn't block the surface).
import { useState } from 'react'
import { Loader2 } from 'lucide-react'

import { Button } from './Button'
import { Card } from './Card'
import { ApiError } from '../lib/apiClient'
import {
  useArchiveReadingPathMutation,
  useCreateReadingPathMutation,
  useTutorReadingPathsQuery,
  type TutorReadingPath,
} from '../lib/queries/tutorPaths'

export function ReadingPathsPane() {
  const q = useTutorReadingPathsQuery()
  const items = q.data?.items ?? []

  return (
    <section className="flex flex-col gap-5">
      <header className="flex flex-col gap-2">
        <h2 className="font-display text-xl font-semibold">Reading paths</h2>
        <p className="max-w-2xl text-[13px] leading-relaxed text-text-secondary">
          Кураторские маршруты — упорядоченные последовательности atlas-узлов,
          которые ты рекомендуешь студентам пройти. В отличие от Reading library
          (одноразовый broadcast) — path многоразовый: можешь назначать одной
          стек'ой нескольким студентам через assignments.
        </p>
      </header>

      <CreatePathForm />

      {q.isPending ? (
        <Card className="flex-row items-center gap-2 p-4 text-text-secondary" interactive={false}>
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Загружаем…</span>
        </Card>
      ) : q.isError ? (
        <Card className="flex-col gap-1 border-danger/40 bg-danger/5 p-4" interactive={false}>
          <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-danger">
            Ошибка
          </div>
          <p className="text-[13px] leading-relaxed text-text-secondary">
            Не удалось загрузить paths. Попробуй обновить страницу.
          </p>
        </Card>
      ) : items.length === 0 ? (
        <Card className="flex-col gap-1 p-4" interactive={false}>
          <p className="text-[13px] leading-relaxed text-text-secondary">
            Пока нет ни одного пути. Создай первый — например, «Senior Go
            basics» с 6–10 atlas-узлами, которые junior должен пройти.
          </p>
        </Card>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((p) => (
            <li key={p.id}>
              <PathRow path={p} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function CreatePathForm() {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [keysText, setKeysText] = useState('')
  const create = useCreateReadingPathMutation()

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    // Parse the textarea — one node-key per line. Trim + drop empties.
    const keys = keysText
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
    create.mutate(
      {
        name: trimmed,
        description: description.trim(),
        atlas_node_keys: keys,
      },
      {
        onSuccess: () => {
          setName('')
          setDescription('')
          setKeysText('')
        },
      },
    )
  }

  return (
    <Card className="flex-col gap-3 p-4" interactive={false}>
      <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
        Новый path
      </div>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Senior Go basics"
          maxLength={240}
          required
          className="rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-text-primary focus:outline-none"
        />
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Что включает этот path, для кого, как пользоваться (optional)"
          rows={3}
          maxLength={2000}
          className="rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-text-primary focus:outline-none"
        />
        <label className="flex flex-col gap-1.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
            Atlas node keys (по одному в строке, в порядке прохождения)
          </span>
          <textarea
            value={keysText}
            onChange={(e) => setKeysText(e.target.value)}
            placeholder={'go.routines\ngo.channels\ngo.scheduler\n…'}
            rows={6}
            maxLength={8000}
            className="resize-y rounded-md border border-border bg-surface-2 px-3 py-2 font-mono text-[12px] leading-relaxed text-text-primary placeholder:text-text-muted focus:border-text-primary focus:outline-none"
          />
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={create.isPending || name.trim() === ''}>
            {create.isPending ? 'Создаём…' : 'Создать path'}
          </Button>
          {create.isError && (
            <span className="text-[12px] text-warn">
              {create.error instanceof ApiError ? create.error.body : 'Не получилось'}
            </span>
          )}
        </div>
      </form>
    </Card>
  )
}

function PathRow({ path }: { path: TutorReadingPath }) {
  const archive = useArchiveReadingPathMutation()
  const created = path.created_at ? new Date(path.created_at).toLocaleDateString() : '—'

  return (
    <Card className="flex-col gap-2 p-4" interactive={false}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-text-primary">{path.name}</div>
          {path.description && (
            <div className="mt-1 text-[12px] leading-relaxed text-text-secondary">
              {path.description}
            </div>
          )}
        </div>
        <span className="shrink-0 rounded-full border border-border bg-surface-2 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-text-muted">
          {path.assigned_count} assign
        </span>
      </div>
      {path.atlas_node_keys.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {path.atlas_node_keys.map((k, i) => (
            <li
              key={`${k}-${i}`}
              className="rounded-md border border-border bg-surface-2 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-text-secondary"
            >
              {i + 1}. {k}
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-3 font-mono text-[10px] uppercase tracking-wider text-text-muted">
        <span>создан {created}</span>
        <button
          type="button"
          onClick={() => {
            if (window.confirm(`Архивировать «${path.name}»? Это soft-delete — данные останутся.`)) {
              archive.mutate(path.id)
            }
          }}
          disabled={archive.isPending}
          className="ml-auto rounded-md border border-warn/40 bg-warn/5 px-2 py-0.5 text-warn hover:bg-warn/10 disabled:opacity-50"
        >
          Архивировать
        </button>
      </div>
    </Card>
  )
}
