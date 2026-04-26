// CodexPanel — admin CRUD над codex_articles. Замещает редактирование
// руками TS-файла. Список + inline-edit + create + soft-toggle active +
// hard delete.
import { useState } from 'react'
import { Button } from '../../components/Button'
import { ErrorBox, PanelSkeleton } from './shared'
import {
  useAdminCodexQuery,
  useCreateCodexArticleMutation,
  useDeleteCodexArticleMutation,
  useToggleCodexActiveMutation,
  useUpdateCodexArticleMutation,
  type CodexArticle,
  type CodexArticleUpsertBody,
} from '../../lib/queries/codex'

const CATEGORIES = [
  'system_design',
  'backend',
  'algorithms',
  'career',
  'behavioral',
  'concurrency',
  'data',
  'security',
] as const

function blankBody(): CodexArticleUpsertBody {
  return {
    slug: '',
    title: '',
    description: '',
    category: 'system_design',
    href: '',
    source: '',
    read_min: 10,
    sort_order: 0,
    active: true,
  }
}

function articleToBody(a: CodexArticle): CodexArticleUpsertBody {
  return {
    slug: a.slug,
    title: a.title,
    description: a.description,
    category: a.category,
    href: a.href,
    source: a.source,
    read_min: a.read_min,
    sort_order: a.sort_order,
    active: a.active,
  }
}

export function CodexPanel() {
  const list = useAdminCodexQuery()
  const [creating, setCreating] = useState(false)

  if (list.isPending) return <PanelSkeleton rows={6} />
  if (list.error) return <ErrorBox message="Не удалось загрузить codex" />
  const articles = list.data ?? []

  // Группируем по категории — admin обычно правит одну рубрику зараз.
  const byCat = new Map<string, CodexArticle[]>()
  for (const a of articles) {
    const arr = byCat.get(a.category) ?? []
    arr.push(a)
    byCat.set(a.category, arr)
  }

  return (
    <div className="flex flex-col gap-4 px-4 py-5 sm:px-7">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display text-sm font-bold text-text-primary">Codex · статьи</h2>
          <p className="font-mono text-[10px] text-text-muted">
            {articles.length} в БД · публичный read через /api/v1/codex/articles
          </p>
        </div>
        <Button size="sm" onClick={() => setCreating((v) => !v)}>
          {creating ? 'Cancel' : '+ Новая статья'}
        </Button>
      </div>

      {creating && <CreateForm onClose={() => setCreating(false)} />}

      {[...byCat.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([cat, rows]) => (
          <section key={cat} className="rounded-lg border border-border bg-surface-1 p-3">
            <h3 className="mb-2 font-mono text-[11px] uppercase tracking-wider text-text-secondary">
              {cat} · {rows.length}
            </h3>
            <ul className="flex flex-col gap-1.5">
              {rows
                .sort((a, b) => a.sort_order - b.sort_order)
                .map((a) => (
                  <ArticleRow key={a.id} a={a} />
                ))}
            </ul>
          </section>
        ))}
    </div>
  )
}

function CreateForm({ onClose }: { onClose: () => void }) {
  const [body, setBody] = useState<CodexArticleUpsertBody>(blankBody())
  const create = useCreateCodexArticleMutation()
  const [err, setErr] = useState<string | null>(null)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr(null)
    try {
      await create.mutateAsync(body)
      setBody(blankBody())
      onClose()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }
  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-2 rounded-lg border border-text-primary/30 bg-text-primary/[0.03] p-4"
    >
      <Fields body={body} setBody={setBody} />
      {err && <div className="text-[12px] text-danger">{err}</div>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" size="sm" loading={create.isPending}>
          Создать
        </Button>
      </div>
    </form>
  )
}

function ArticleRow({ a }: { a: CodexArticle }) {
  const [editing, setEditing] = useState(false)
  const [body, setBody] = useState<CodexArticleUpsertBody>(articleToBody(a))
  const update = useUpdateCodexArticleMutation()
  const toggle = useToggleCodexActiveMutation()
  const del = useDeleteCodexArticleMutation()
  const [err, setErr] = useState<string | null>(null)

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr(null)
    try {
      await update.mutateAsync({ id: a.id, body })
      setEditing(false)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }

  if (!editing) {
    return (
      <li className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface-2 px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[13px] font-semibold text-text-primary">{a.title}</span>
            {!a.active && (
              <span className="rounded-full bg-warn/15 px-1.5 py-0.5 font-mono text-[9px] uppercase text-warn">
                hidden
              </span>
            )}
          </div>
          <div className="truncate font-mono text-[10px] text-text-muted">
            {a.slug} · {a.source} · {a.read_min} мин
          </div>
        </div>
        <div className="flex shrink-0 gap-1">
          <button
            type="button"
            onClick={() => toggle.mutate({ id: a.id, active: !a.active })}
            className="rounded border border-border px-2 py-0.5 font-mono text-[10px] text-text-secondary hover:text-text-primary"
          >
            {a.active ? 'hide' : 'show'}
          </button>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="rounded border border-border px-2 py-0.5 font-mono text-[10px] text-text-secondary hover:text-text-primary"
          >
            edit
          </button>
          <button
            type="button"
            onClick={() => {
              if (confirm(`Удалить «${a.title}» окончательно?`)) del.mutate(a.id)
            }}
            className="rounded border border-danger/40 px-2 py-0.5 font-mono text-[10px] text-danger hover:bg-danger/10"
          >
            ✕
          </button>
        </div>
      </li>
    )
  }
  return (
    <li className="rounded-md border border-text-primary/30 bg-text-primary/[0.03] p-3">
      <form onSubmit={save} className="flex flex-col gap-2">
        <Fields body={body} setBody={setBody} />
        {err && <div className="text-[12px] text-danger">{err}</div>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>
            Cancel
          </Button>
          <Button type="submit" size="sm" loading={update.isPending}>
            Сохранить
          </Button>
        </div>
      </form>
    </li>
  )
}

function Fields({
  body,
  setBody,
}: {
  body: CodexArticleUpsertBody
  setBody: (next: CodexArticleUpsertBody) => void
}) {
  const set = <K extends keyof CodexArticleUpsertBody>(k: K, v: CodexArticleUpsertBody[K]) =>
    setBody({ ...body, [k]: v })
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      <Field label="slug" v={body.slug} onChange={(v) => set('slug', v)} />
      <Field label="title" v={body.title} onChange={(v) => set('title', v)} />
      <label className="col-span-1 sm:col-span-2 flex flex-col gap-1">
        <span className="font-mono text-[9px] uppercase tracking-wider text-text-muted">description</span>
        <textarea
          value={body.description}
          onChange={(e) => set('description', e.target.value)}
          rows={2}
          className="rounded-md border border-border bg-bg/40 px-2 py-1.5 text-[12px] text-text-primary"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="font-mono text-[9px] uppercase tracking-wider text-text-muted">category</span>
        <select
          value={body.category}
          onChange={(e) => set('category', e.target.value)}
          className="rounded-md border border-border bg-bg/40 px-2 py-1.5 text-[12px] text-text-primary"
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>
      <Field label="source — origin name" v={body.source} onChange={(v) => set('source', v)} />
      <Field label="href — full URL" v={body.href} onChange={(v) => set('href', v)} className="col-span-1 sm:col-span-2" />
      <NumField label="read_min" v={body.read_min} onChange={(v) => set('read_min', v)} />
      <NumField label="sort_order" v={body.sort_order} onChange={(v) => set('sort_order', v)} />
    </div>
  )
}

function Field({
  label,
  v,
  onChange,
  className,
}: {
  label: string
  v: string
  onChange: (s: string) => void
  className?: string
}) {
  return (
    <label className={['flex flex-col gap-1', className].filter(Boolean).join(' ')}>
      <span className="font-mono text-[9px] uppercase tracking-wider text-text-muted">{label}</span>
      <input
        value={v}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-border bg-bg/40 px-2 py-1.5 text-[12px] text-text-primary"
      />
    </label>
  )
}

function NumField({
  label,
  v,
  onChange,
}: {
  label: string
  v: number
  onChange: (n: number) => void
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-mono text-[9px] uppercase tracking-wider text-text-muted">{label}</span>
      <input
        type="number"
        value={v}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        className="rounded-md border border-border bg-bg/40 px-2 py-1.5 text-[12px] text-text-primary"
      />
    </label>
  )
}
