// CoachPromptsPanel — Admin Phase 2: LLM prompt template editor.
//
// Table view (slug / category / version / active / updated_at) с inline edit
// + variables hint chips. Modal form для create + edit:
//   - slug read-only post-creation.
//   - category dropdown — fixed whitelist (matches admin/app/coach_prompts.go).
//   - template textarea + Variables chips field — comma-split.
//   - Version increments backend-side on every save (visible read-only).
//
// B/W only. Anti-fallback: empty list → CTA «+ Добавить prompt».

import { useMemo, useState } from 'react'

import { Button } from '../../../components/Button'
import { Modal } from '../../../components/primitives/Modal'
import { ErrorBox, PanelSkeleton } from '../shared'
import {
  useAdminCoachPromptsQuery,
  useCreateCoachPromptMutation,
  useDeactivateCoachPromptMutation,
  useUpdateCoachPromptMutation,
  type CoachPrompt,
  type CoachPromptCategory,
  type CreateCoachPromptBody,
  type UpdateCoachPromptBody,
} from '../../../lib/queries/coachPrompts'

const CATEGORY_OPTIONS: { value: CoachPromptCategory; label: string }[] = [
  { value: 'daily_brief', label: 'Daily brief' },
  { value: 'insight', label: 'Insight' },
  { value: 'mock_grade', label: 'Mock grade' },
  { value: 'reflection_grade', label: 'Reflection grade' },
  { value: 'cue_summary', label: 'Cue summary' },
  { value: 'milestones_gen', label: 'Milestones generator' },
]

export function CoachPromptsPanel() {
  const query = useAdminCoachPromptsQuery()
  const deactivate = useDeactivateCoachPromptMutation()
  const [modal, setModal] = useState<{ kind: 'create' } | { kind: 'edit'; prompt: CoachPrompt } | null>(
    null,
  )
  const [err, setErr] = useState<string | null>(null)
  const [categoryFilter, setCategoryFilter] = useState<CoachPromptCategory | 'all'>('all')

  const filtered = useMemo(() => {
    if (!query.data) return []
    const base = categoryFilter === 'all' ? query.data : query.data.filter((p) => p.category === categoryFilter)
    return [...base].sort((a, b) => a.category.localeCompare(b.category) || a.slug.localeCompare(b.slug))
  }, [query.data, categoryFilter])

  if (query.isPending) return <PanelSkeleton rows={6} />
  if (query.error) return <ErrorBox message={(query.error as Error).message || 'Failed to load'} />

  const handleDeactivate = async (id: string) => {
    setErr(null)
    try {
      await deactivate.mutateAsync(id)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to deactivate')
    }
  }

  return (
    <section className="flex flex-col gap-4 px-4 py-5 sm:px-7">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="font-display text-base font-bold text-text-primary">Coach prompts</h3>
          <p className="font-mono text-[11px] text-text-muted">
            LLM prompt templates по категориям. Variables вида {'{{name}}'} — placeholder'ы для backend templating.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value as CoachPromptCategory | 'all')}
            className="rounded-md border border-border bg-surface-2 px-2 py-1.5 font-mono text-[11px] text-text-primary focus:border-text-primary focus:outline-none"
          >
            <option value="all">Все категории</option>
            {CATEGORY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <Button size="sm" onClick={() => setModal({ kind: 'create' })}>
            + Добавить prompt
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
          <span className="font-mono text-[12px] text-text-muted">Нет шаблонов</span>
          <Button size="sm" onClick={() => setModal({ kind: 'create' })}>
            + Добавить prompt
          </Button>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="min-w-full">
            <thead className="bg-surface-1">
              <tr>
                <Th>Slug</Th>
                <Th>Category</Th>
                <Th>Variables</Th>
                <Th>Version</Th>
                <Th>Active</Th>
                <Th>Updated</Th>
                <Th>{''}</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((p) => (
                <tr key={p.id} className="bg-surface-2 hover:bg-surface-1">
                  <Td className="font-mono text-[11px]">{p.slug}</Td>
                  <Td>
                    <span className="rounded-full border border-border bg-bg px-2 py-0.5 font-mono text-[10px] uppercase text-text-muted">
                      {p.category}
                    </span>
                  </Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      {p.variables.length === 0 && (
                        <span className="font-mono text-[10px] text-text-muted">—</span>
                      )}
                      {p.variables.map((v) => (
                        <span key={v} className="rounded-md border border-border bg-bg px-1.5 py-0.5 font-mono text-[10px] text-text-secondary">
                          {v}
                        </span>
                      ))}
                    </div>
                  </Td>
                  <Td className="font-mono text-[11px] text-text-muted">v{p.version}</Td>
                  <Td>
                    <span
                      className={`rounded-full px-2 py-0.5 font-mono text-[9px] uppercase ${
                        p.is_active
                          ? 'border border-text-primary text-text-primary'
                          : 'border border-border text-text-muted'
                      }`}
                    >
                      {p.is_active ? 'on' : 'off'}
                    </span>
                  </Td>
                  <Td className="font-mono text-[10px] text-text-muted">
                    {p.updated_at.slice(0, 10)}
                  </Td>
                  <Td className="text-right">
                    <div className="flex justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => setModal({ kind: 'edit', prompt: p })}
                        className="rounded-md border border-border px-2 py-1 font-mono text-[10px] text-text-secondary hover:border-border-strong hover:text-text-primary"
                      >
                        edit
                      </button>
                      {p.is_active && (
                        <button
                          type="button"
                          onClick={() => handleDeactivate(p.id)}
                          disabled={deactivate.isPending}
                          className="rounded-md border border-border px-2 py-1 font-mono text-[10px] text-text-muted hover:border-danger hover:text-danger disabled:opacity-50"
                        >
                          deactivate
                        </button>
                      )}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal?.kind === 'create' && (
        <CoachPromptForm onClose={() => setModal(null)} onError={setErr} />
      )}
      {modal?.kind === 'edit' && (
        <CoachPromptForm existing={modal.prompt} onClose={() => setModal(null)} onError={setErr} />
      )}
    </section>
  )
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-3 py-2 text-left font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted">
      {children}
    </th>
  )
}

function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2 text-[12px] text-text-primary ${className ?? ''}`}>{children}</td>
}

// ─────────────────────────────────────────────────────────────────────────
// Form modal
// ─────────────────────────────────────────────────────────────────────────

interface FormProps {
  existing?: CoachPrompt
  onClose: () => void
  onError: (msg: string | null) => void
}

function CoachPromptForm({ existing, onClose, onError }: FormProps) {
  const isEdit = !!existing
  const createMut = useCreateCoachPromptMutation()
  const updateMut = useUpdateCoachPromptMutation()

  const [slug, setSlug] = useState(existing?.slug ?? '')
  const [category, setCategory] = useState<CoachPromptCategory>(existing?.category ?? 'daily_brief')
  const [template, setTemplate] = useState(existing?.template ?? '')
  const [varsText, setVarsText] = useState(existing?.variables?.join(', ') ?? '')
  const [description, setDescription] = useState(existing?.description ?? '')
  const [isActive, setIsActive] = useState(existing?.is_active ?? true)
  const [busy, setBusy] = useState(false)

  // simple {{name}} validation
  const variables = useMemo(
    () =>
      varsText
        .split(/[,\n]/)
        .map((s) => s.trim())
        .filter(Boolean),
    [varsText],
  )
  const invalidVar = variables.find((v) => !/^\{\{[a-zA-Z_][a-zA-Z0-9_]*\}\}$/.test(v))

  const canSubmit =
    (isEdit || slug.trim().length >= 2) && template.trim().length >= 5 && !invalidVar

  const submit = async () => {
    if (!canSubmit) return
    setBusy(true)
    onError(null)
    try {
      if (isEdit && existing) {
        const body: UpdateCoachPromptBody = {
          category,
          template,
          variables,
          description,
          is_active: isActive,
        }
        await updateMut.mutateAsync({ id: existing.id, body })
      } else {
        const body: CreateCoachPromptBody = {
          slug: slug.trim(),
          category,
          template,
          variables,
          description,
          is_active: isActive,
        }
        await createMut.mutateAsync(body)
      }
      onClose()
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Failed to save prompt')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} size="md" title={isEdit ? 'Edit prompt' : 'New coach prompt'}>
      <div className="flex flex-col gap-4">
        <Field label="Slug" hint={isEdit ? 'Read-only after creation' : 'lowercase-snake, e.g. daily_brief_v2'}>
          <input
            type="text"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            disabled={isEdit}
            className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 font-mono text-[12px] text-text-primary disabled:opacity-60 focus:border-text-primary focus:outline-none"
            placeholder="daily_brief_baseline"
          />
        </Field>

        <Field label="Category">
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as CoachPromptCategory)}
            className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-[13px] text-text-primary focus:border-text-primary focus:outline-none"
          >
            {CATEGORY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label="Template"
          hint="Use {{variable_name}} placeholders. Версия повышается каждым save."
        >
          <textarea
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
            rows={6}
            className="w-full resize-y rounded-md border border-border bg-surface-2 px-3 py-2 font-mono text-[12px] text-text-primary focus:border-text-primary focus:outline-none"
            placeholder="Generate brief headline + 2-3 recommendations для user goal {{goal}}…"
          />
        </Field>

        <Field
          label="Variables"
          hint={
            invalidVar
              ? `«${invalidVar}» не соответствует {{name}}`
              : 'Comma-separated: {{user_goal}}, {{readiness}}'
          }
        >
          <input
            type="text"
            value={varsText}
            onChange={(e) => setVarsText(e.target.value)}
            className={`w-full rounded-md border bg-surface-2 px-3 py-2 font-mono text-[11px] text-text-primary focus:outline-none ${
              invalidVar ? 'border-danger focus:border-danger' : 'border-border focus:border-text-primary'
            }`}
            placeholder="{{goal}}, {{readiness}}, {{last_wins}}"
          />
        </Field>

        <Field label="Description (admin-internal)">
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-[13px] text-text-primary focus:border-text-primary focus:outline-none"
          />
        </Field>

        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
            className="h-4 w-4 accent-text-primary"
          />
          <span className="text-[13px] text-text-primary">Active</span>
        </label>

        <footer className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" onClick={submit} disabled={!canSubmit || busy}>
            {isEdit ? 'Save' : 'Create'}
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
