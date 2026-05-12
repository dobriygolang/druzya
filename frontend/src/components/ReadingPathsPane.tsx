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
  useAssignReadingPathMutation,
  useCreateReadingPathMutation,
  useTutorReadingPathsQuery,
  type TutorReadingPath,
} from '../lib/queries/tutorPaths'
import { useTutorStudentsQuery } from '../lib/queries/tutor'

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
  const [assignOpen, setAssignOpen] = useState(false)
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
          onClick={() => setAssignOpen(true)}
          disabled={path.atlas_node_keys.length === 0 && path.resource_ids.length === 0}
          className="ml-auto rounded-md border border-border bg-surface-2 px-2 py-0.5 text-text-secondary hover:border-text-primary hover:text-text-primary disabled:opacity-40"
        >
          Assign to student
        </button>
        <button
          type="button"
          onClick={() => {
            if (window.confirm(`Архивировать «${path.name}»? Это soft-delete — данные останутся.`)) {
              archive.mutate(path.id)
            }
          }}
          disabled={archive.isPending}
          className="rounded-md border border-warn/40 bg-warn/5 px-2 py-0.5 text-warn hover:bg-warn/10 disabled:opacity-50"
        >
          Архивировать
        </button>
      </div>
      {assignOpen && (
        <AssignToStudentModal
          path={path}
          onClose={() => setAssignOpen(false)}
        />
      )}
    </Card>
  )
}

// AssignToStudentModal — picker dialog that resolves «which student?»
// then fires AssignReadingPath. On success, surface a toast-style banner
// inside the same modal (rather than navigate away) so the tutor can
// assign the same path to multiple students back-to-back if needed.
function AssignToStudentModal({
  path,
  onClose,
}: {
  path: TutorReadingPath
  onClose: () => void
}) {
  const studentsQ = useTutorStudentsQuery()
  const assign = useAssignReadingPathMutation()
  const [studentId, setStudentId] = useState('')
  const [done, setDone] = useState<{ count: number; studentId: string } | null>(null)

  const students = studentsQ.data?.items ?? []
  const totalSteps = path.atlas_node_keys.length || path.resource_ids.length

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!studentId) return
    setDone(null)
    assign.mutate(
      { path_id: path.id, student_id: studentId },
      {
        onSuccess: (r) => {
          setDone({ count: r.assignments_created, studentId })
          setStudentId('')
        },
      },
    )
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Assign path ${path.name}`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => {
        // Click on the backdrop dismisses; clicks on the modal body
        // bubble up but we stopPropagation on the panel below.
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-lg border border-border bg-surface p-5 shadow-xl"
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
              Assign path
            </div>
            <h3 className="mt-1 text-base font-semibold">{path.name}</h3>
            <p className="mt-1 text-[12px] text-text-secondary">
              {totalSteps} step{totalSteps === 1 ? '' : 's'} — server will create one
              per-step assignment for the student.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border bg-surface-2 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted hover:border-text-primary hover:text-text-primary"
          >
            Esc
          </button>
        </div>

        <form onSubmit={submit} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
              Student
            </span>
            <select
              value={studentId}
              onChange={(e) => setStudentId(e.target.value)}
              required
              className="border-b border-[var(--hair-2)] bg-transparent px-1 py-2 text-sm text-[rgb(var(--ink))] outline-none transition-colors duration-[var(--motion-dur-small)] ease-[var(--motion-ease-decelerate)] focus:border-[rgb(var(--ink))]"
            >
              <option value="">— выбери студента —</option>
              {students.map((rel) => (
                <option key={rel.id} value={rel.student_id}>
                  student-{rel.student_id.slice(0, 8)}
                  {rel.note ? ` · ${rel.note}` : ''}
                </option>
              ))}
            </select>
            {students.length === 0 && (
              <span className="text-[11px] text-text-muted">
                Нет активных студентов. Сначала разошли инвайт.
              </span>
            )}
          </label>

          <div className="flex items-center gap-3">
            <Button
              type="submit"
              disabled={assign.isPending || !studentId || students.length === 0}
            >
              {assign.isPending ? 'Assigning…' : 'Assign'}
            </Button>
            <Button variant="ghost" type="button" onClick={onClose}>
              Cancel
            </Button>
          </div>

          {assign.isError && (
            <span className="text-[12px] text-danger">
              {assign.error instanceof ApiError ? assign.error.body : 'Не получилось'}
            </span>
          )}
          {done && (
            <Card
              className="flex-col gap-1 border-success/40 bg-success/5 p-3"
              interactive={false}
            >
              <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-success">
                Назначено
              </div>
              <p className="text-[12px] text-text-secondary">
                Push'нули student-{done.studentId.slice(0, 8)}: создали{' '}
                {done.count} per-step assignment{done.count === 1 ? '' : 's'}.
                Студент увидит их у себя в Hone TutorAssignments.
              </p>
            </Card>
          )}
        </form>
      </div>
    </div>
  )
}
