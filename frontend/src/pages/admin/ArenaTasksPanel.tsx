// ArenaTasksPanel — admin CRUD для канонической `tasks` таблицы.
// Эти задачи использует Arena 1v1/2v2 + Daily Kata. Mock-tasks (другой
// пул) живут в собственном MockTasksPanel — не путать.

import { useEffect, useState } from 'react'
import { Button } from '../../components/Button'
import { FormField } from '../../components/FormField'
import { ErrorBox, PanelSkeleton } from './shared'
import {
  useArenaTaskQuery,
  useArenaTasksQuery,
  useCreateArenaTaskMutation,
  useDeleteArenaTaskMutation,
  useToggleArenaTaskActiveMutation,
  useUpdateArenaTaskMutation,
  type ArenaTask,
  type ArenaTaskDifficulty,
  type ArenaTaskSection,
} from '../../lib/queries/arenaAdmin'

const SECTIONS: ArenaTaskSection[] = ['algorithms', 'sql', 'go', 'system_design', 'behavioral']
const DIFFS: ArenaTaskDifficulty[] = ['easy', 'medium', 'hard']

export function ArenaTasksPanel() {
  const [section, setSection] = useState<ArenaTaskSection | undefined>(undefined)
  const [difficulty, setDifficulty] = useState<ArenaTaskDifficulty | undefined>(undefined)
  const [activeOnly, setActiveOnly] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const list = useArenaTasksQuery({
    section,
    difficulty,
    active: activeOnly ? true : undefined,
  })

  return (
    <div className="flex flex-col gap-4 px-4 py-5 sm:px-7 lg:flex-row">
      <aside className="flex w-full flex-col gap-3 lg:w-80">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-display text-sm font-bold text-text-primary">Arena · задачи</h2>
          <Button size="sm" onClick={() => setCreating(true)}>
            + New task
          </Button>
        </div>

        <div className="flex flex-col gap-2 rounded-md border border-border bg-surface-1 p-3">
          <ChipRow label="section" options={SECTIONS} value={section} onChange={setSection} />
          <ChipRow label="difficulty" options={DIFFS} value={difficulty} onChange={setDifficulty} />
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={activeOnly}
              onChange={(e) => setActiveOnly(e.target.checked)}
            />
            <span className="font-mono text-[11px] text-text-secondary">только active</span>
          </label>
        </div>

        {list.isPending ? (
          <PanelSkeleton rows={4} />
        ) : list.isError ? (
          <ErrorBox message="Не удалось загрузить список." />
        ) : (list.data?.items ?? []).length > 0 ? (
          <ul className="flex flex-col gap-1.5">
            {(list.data?.items ?? []).map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(t.id)}
                  className={`flex w-full flex-col gap-1 rounded-md border px-3 py-2 text-left transition-colors ${
                    selectedId === t.id
                      ? 'border-text-primary bg-surface-2'
                      : 'border-border bg-surface-1 hover:border-border-strong'
                  }`}
                >
                  <span className="truncate text-[13px] font-semibold text-text-primary">
                    {t.title_ru || t.title_en}
                  </span>
                  <span className="flex items-center gap-1.5 font-mono text-[10px] text-text-muted">
                    <Pill>{t.section}</Pill>
                    <Pill>{t.difficulty}</Pill>
                    {!t.is_active && <Pill>inactive</Pill>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="rounded-md border border-dashed border-border bg-surface-1 px-3 py-5 text-center font-mono text-[11px] text-text-muted">
            Нет задач — создай первую.
          </div>
        )}
      </aside>

      <main className="flex-1">
        {creating && (
          <CreateModal
            onClose={() => setCreating(false)}
            onCreated={(id) => {
              setSelectedId(id)
              setCreating(false)
            }}
          />
        )}
        {selectedId ? (
          <Editor key={selectedId} taskId={selectedId} />
        ) : (
          !creating && (
            <div className="grid h-full place-items-center rounded-lg border border-dashed border-border bg-surface-1 px-6 py-16 text-center font-mono text-[12px] text-text-muted">
              Выбери задачу слева или создай новую.
            </div>
          )
        )}
      </main>
    </div>
  )
}

function ChipRow<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: T[]
  value: T | undefined
  onChange: (v: T | undefined) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-text-muted">{label}</span>
      <button
        type="button"
        onClick={() => onChange(undefined)}
        className={`rounded-full border px-2 py-0.5 font-mono text-[10px] ${
          value === undefined
            ? 'border-text-primary bg-text-primary/10 text-text-primary'
            : 'border-border text-text-secondary'
        }`}
      >
        all
      </button>
      {options.map((o) => (
        <button
          key={o}
          type="button"
          onClick={() => onChange(value === o ? undefined : o)}
          className={`rounded-full border px-2 py-0.5 font-mono text-[10px] ${
            value === o
              ? 'border-text-primary bg-text-primary/10 text-text-primary'
              : 'border-border text-text-secondary'
          }`}
        >
          {o}
        </button>
      ))}
    </div>
  )
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded border border-border bg-bg/40 px-1.5 py-0.5 font-mono text-[9px]">
      {children}
    </span>
  )
}

function CreateModal({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: (id: string) => void
}) {
  const create = useCreateArenaTaskMutation()
  const [slug, setSlug] = useState('')
  const [title, setTitle] = useState('')
  const [section, setSection] = useState<ArenaTaskSection>('algorithms')
  const [difficulty, setDifficulty] = useState<ArenaTaskDifficulty>('easy')
  const [err, setErr] = useState<string | null>(null)

  // Cmd+S submit / Esc close — keyboard shortcuts for fast seeding.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        void submit()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, title, section, difficulty])

  async function submit() {
    setErr(null)
    if (!slug.trim() || !title.trim()) {
      setErr('slug и title обязательны')
      return
    }
    try {
      const t = await create.mutateAsync({
        slug: slug.trim(),
        title_ru: title.trim(),
        title_en: title.trim(),
        description_ru: '',
        description_en: '',
        section,
        difficulty,
      })
      onCreated(t.id)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Ошибка')
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-bg/70 px-4">
      <div
        className="w-full max-w-lg rounded-xl border border-border-strong bg-surface-1 p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-display text-base font-bold text-text-primary">Новая arena-задача</h3>
          <button
            type="button"
            onClick={onClose}
            className="font-mono text-[11px] text-text-muted hover:text-text-primary"
          >
            esc
          </button>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
          className="flex flex-col gap-3"
        >
          <FormField
            label="slug — URL-сегмент задачи"
            value={slug}
            onChange={(e) => setSlug(e.currentTarget.value)}
            placeholder="two-sum (попадёт в /arena/kata/two-sum)"
          />
          <FormField
            label="title"
            value={title}
            onChange={(e) => setTitle(e.currentTarget.value)}
            placeholder="Two Sum"
          />
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="font-mono text-[10px] uppercase text-text-muted">section</span>
              <select
                value={section}
                onChange={(e) => setSection(e.target.value as ArenaTaskSection)}
                className="rounded-md border border-border bg-bg/40 px-2 py-1.5 text-[13px] text-text-primary"
              >
                {SECTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-mono text-[10px] uppercase text-text-muted">difficulty</span>
              <select
                value={difficulty}
                onChange={(e) => setDifficulty(e.target.value as ArenaTaskDifficulty)}
                className="rounded-md border border-border bg-bg/40 px-2 py-1.5 text-[13px] text-text-primary"
              >
                {DIFFS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {err && <div className="text-[12px] text-danger">{err}</div>}
          <p className="font-mono text-[10px] text-text-muted">
            ⌘+S — сохранить, Esc — закрыть.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={onClose} type="button">
              Отмена
            </Button>
            <Button type="submit" size="sm" loading={create.isPending}>
              Создать
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

function Editor({ taskId }: { taskId: string }) {
  const q = useArenaTaskQuery(taskId)
  const update = useUpdateArenaTaskMutation()
  const toggle = useToggleArenaTaskActiveMutation()
  const del = useDeleteArenaTaskMutation()
  const [t, setT] = useState<ArenaTask | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (q.data) setT(q.data)
  }, [q.data])

  async function save() {
    if (!t) return
    setErr(null)
    try {
      await update.mutateAsync({
        id: t.id,
        body: {
          slug: t.slug,
          title_ru: t.title_ru,
          title_en: t.title_en,
          description_ru: t.description_ru,
          description_en: t.description_en,
          difficulty: t.difficulty,
          section: t.section,
          time_limit_sec: t.time_limit_sec,
          memory_limit_mb: t.memory_limit_mb,
          solution_hint: t.solution_hint,
          is_active: t.is_active,
        },
      })
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Ошибка')
    }
  }

  // Cmd+S — save shortcut.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        void save()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t])

  if (q.isPending) return <PanelSkeleton rows={5} />
  if (q.error || !t) return <ErrorBox message="Не удалось загрузить задачу." />

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface-1 p-4">
      <div className="flex items-center justify-between">
        <h3 className="truncate font-display text-sm font-bold text-text-primary">
          {t.title_ru || t.title_en}
        </h3>
        <span className="font-mono text-[10px] text-text-muted">{t.id}</span>
      </div>

      <FormField
        label="slug — URL-сегмент (/arena/kata/{slug})"
        value={t.slug}
        onChange={(e) => setT({ ...t, slug: e.currentTarget.value })}
      />
      <div className="grid grid-cols-2 gap-3">
        <FormField label="title_ru" value={t.title_ru} onChange={(e) => setT({ ...t, title_ru: e.currentTarget.value })} />
        <FormField label="title_en" value={t.title_en} onChange={(e) => setT({ ...t, title_en: e.currentTarget.value })} />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase text-text-muted">section</span>
          <select
            value={t.section}
            onChange={(e) => setT({ ...t, section: e.target.value as ArenaTaskSection })}
            className="rounded-md border border-border bg-bg/40 px-2 py-1.5 text-[13px] text-text-primary"
          >
            {SECTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase text-text-muted">difficulty</span>
          <select
            value={t.difficulty}
            onChange={(e) => setT({ ...t, difficulty: e.target.value as ArenaTaskDifficulty })}
            className="rounded-md border border-border bg-bg/40 px-2 py-1.5 text-[13px] text-text-primary"
          >
            {DIFFS.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
        <FormField
          label="time_limit_sec"
          type="number"
          value={String(t.time_limit_sec)}
          onChange={(e) => setT({ ...t, time_limit_sec: Number(e.currentTarget.value) || 60 })}
        />
      </div>
      <MarkdownArea
        label="description_ru"
        value={t.description_ru}
        onChange={(v) => setT({ ...t, description_ru: v })}
        rows={10}
      />
      <MarkdownArea
        label="description_en"
        value={t.description_en}
        onChange={(v) => setT({ ...t, description_en: v })}
        rows={10}
      />
      <MarkdownArea
        label="solution_hint — заметка для админов, юзеру не показывается, AI-судья не видит"
        value={t.solution_hint}
        onChange={(v) => setT({ ...t, solution_hint: v })}
        rows={4}
      />
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={t.is_active}
          onChange={(e) => setT({ ...t, is_active: e.currentTarget.checked })}
        />
        <span className="font-mono text-[11px] text-text-secondary">is_active</span>
      </label>

      {err && <div className="text-[12px] text-danger">{err}</div>}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
        <div className="flex gap-2">
          <Button size="sm" onClick={() => void save()} loading={update.isPending}>
            Сохранить (⌘+S)
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              toggle.mutate({ id: t.id, active: !t.is_active })
            }
            loading={toggle.isPending}
          >
            {t.is_active ? 'Скрыть' : 'Восстановить'}
          </Button>
        </div>
        <button
          type="button"
          onClick={() => {
            if (window.confirm('Удалить задачу безвозвратно?')) {
              del.mutate(t.id)
            }
          }}
          className="font-mono text-[11px] uppercase text-text-muted hover:text-danger"
        >
          delete
        </button>
      </div>
    </div>
  )
}

function MarkdownArea({
  label,
  value,
  onChange,
  rows,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  rows: number
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-mono text-[10px] uppercase text-text-muted">{label}</span>
      <textarea
        value={value}
        rows={rows}
        onChange={(e) => onChange(e.currentTarget.value)}
        className="rounded-md border border-border bg-bg/40 p-2 font-mono text-[12px] text-text-primary"
      />
    </label>
  )
}
