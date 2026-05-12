// GoalPresetsPanel — Admin Phase 2: goal preset CRUD surface.
//
// Plain CRUD table:
//   - rows show slug / title / kind / target_company / default_target_days
//     / sort_order / is_active.
//   - «+ New preset» button → modal form (slug + title + kind dropdown +
//     optional target_company / target_level / target_text + default_days).
//   - Per-row edit (same modal, prefilled) + Deactivate buttons.
//
// B/W only. Monospaced font for slug + kind chips, no decorations.

import { useMemo, useState } from 'react'

import { Button } from '../../../components/Button'
import { Modal } from '../../../components/primitives/Modal'
import { ErrorBox, PanelSkeleton } from '../shared'
import {
  useAdminGoalPresetsQuery,
  useCreateGoalPresetMutation,
  useDeactivateGoalPresetMutation,
  useUpdateGoalPresetMutation,
  type CreateGoalPresetBody,
  type GoalPreset,
  type GoalPresetKind,
  type UpdateGoalPresetBody,
} from '../../../lib/queries/goalPresets'

const KIND_OPTIONS: { value: GoalPresetKind; label: string }[] = [
  { value: 'GOAL_KIND_TOP_TIER_CO', label: 'Top-Tier Co' },
  { value: 'GOAL_KIND_ANY_SENIOR', label: 'Any Senior' },
  { value: 'GOAL_KIND_ML_OFFER', label: 'ML Offer' },
  { value: 'GOAL_KIND_ENGLISH_TARGET', label: 'English Target' },
  { value: 'GOAL_KIND_CUSTOM', label: 'Custom' },
]

const KIND_SHORT: Record<GoalPresetKind, string> = {
  GOAL_KIND_TOP_TIER_CO: 'top-tier',
  GOAL_KIND_ANY_SENIOR: 'any-senior',
  GOAL_KIND_ML_OFFER: 'ml-offer',
  GOAL_KIND_ENGLISH_TARGET: 'english',
  GOAL_KIND_CUSTOM: 'custom',
}

export function GoalPresetsPanel() {
  const query = useAdminGoalPresetsQuery()
  const deactivate = useDeactivateGoalPresetMutation()
  const [modal, setModal] = useState<{ kind: 'create' } | { kind: 'edit'; preset: GoalPreset } | null>(
    null,
  )
  const [err, setErr] = useState<string | null>(null)

  const sorted = useMemo(() => {
    if (!query.data) return []
    return [...query.data].sort((a, b) => a.sort_order - b.sort_order || a.title.localeCompare(b.title))
  }, [query.data])

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
          <h3 className="font-display text-base font-bold text-text-primary">Goal presets</h3>
          <p className="font-mono text-[11px] text-text-muted">
            Quick-start templates для GoalWizard. Active presets отображаются как
            pills в верхней части wizard'а.
          </p>
        </div>
        <Button size="sm" onClick={() => setModal({ kind: 'create' })}>
          + New preset
        </Button>
      </header>

      {err && (
        <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-[12px] text-danger">
          {err}
        </div>
      )}

      {sorted.length === 0 ? (
        <div className="rounded-md border border-dashed border-border bg-surface-1 px-4 py-10 text-center font-mono text-[12px] text-text-muted">
          Нет пресетов. Создай первый — он сразу появится в wizard'е.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="min-w-full">
            <thead className="bg-surface-1">
              <tr>
                <Th>Slug</Th>
                <Th>Title</Th>
                <Th>Kind</Th>
                <Th>Company</Th>
                <Th>Days</Th>
                <Th>Order</Th>
                <Th>Active</Th>
                <Th>{''}</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sorted.map((p) => (
                <tr key={p.id} className="bg-surface-2 hover:bg-surface-1">
                  <Td className="font-mono text-[11px]">{p.slug}</Td>
                  <Td>{p.title}</Td>
                  <Td>
                    <span className="rounded-full border border-border bg-bg px-2 py-0.5 font-mono text-[10px] uppercase text-text-muted">
                      {KIND_SHORT[p.kind]}
                    </span>
                  </Td>
                  <Td className="text-text-secondary">{p.target_company || '—'}</Td>
                  <Td className="font-mono text-[11px] text-text-muted">
                    {p.default_target_days ?? '—'}
                  </Td>
                  <Td className="font-mono text-[11px] text-text-muted">{p.sort_order}</Td>
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
                  <Td className="text-right">
                    <div className="flex justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => setModal({ kind: 'edit', preset: p })}
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
        <PresetForm
          onClose={() => setModal(null)}
          onError={setErr}
        />
      )}
      {modal?.kind === 'edit' && (
        <PresetForm
          existing={modal.preset}
          onClose={() => setModal(null)}
          onError={setErr}
        />
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
// Form modal — shared between create + edit.
// ─────────────────────────────────────────────────────────────────────────

interface PresetFormProps {
  existing?: GoalPreset
  onClose: () => void
  onError: (msg: string | null) => void
}

function PresetForm({ existing, onClose, onError }: PresetFormProps) {
  const isEdit = !!existing
  const createMut = useCreateGoalPresetMutation()
  const updateMut = useUpdateGoalPresetMutation()

  const [slug, setSlug] = useState(existing?.slug ?? '')
  const [title, setTitle] = useState(existing?.title ?? '')
  const [kind, setKind] = useState<GoalPresetKind>(existing?.kind ?? 'GOAL_KIND_TOP_TIER_CO')
  const [company, setCompany] = useState(existing?.target_company ?? '')
  const [level, setLevel] = useState(existing?.target_level ?? '')
  const [text, setText] = useState(existing?.target_text ?? '')
  const [days, setDays] = useState<string>(
    existing?.default_target_days != null ? String(existing.default_target_days) : '',
  )
  const [sortOrder, setSortOrder] = useState<string>(String(existing?.sort_order ?? 100))
  const [isActive, setIsActive] = useState(existing?.is_active ?? true)
  const [busy, setBusy] = useState(false)

  const canSubmit =
    (isEdit || slug.trim().length >= 2) && title.trim().length >= 2 && kind.startsWith('GOAL_KIND_')

  const submit = async () => {
    if (!canSubmit) return
    setBusy(true)
    onError(null)
    try {
      const parsedDays = days.trim() === '' ? null : Number.parseInt(days, 10)
      const parsedOrder = Number.parseInt(sortOrder, 10) || 0

      if (isEdit && existing) {
        const body: UpdateGoalPresetBody = {
          title: title.trim(),
          kind,
          target_company: company,
          target_level: level,
          target_text: text,
          default_target_days: parsedDays === null ? -1 : parsedDays,
          is_active: isActive,
          sort_order: parsedOrder,
        }
        await updateMut.mutateAsync({ id: existing.id, body })
      } else {
        const body: CreateGoalPresetBody = {
          slug: slug.trim(),
          title: title.trim(),
          kind,
          target_company: company,
          target_level: level,
          target_text: text,
          default_target_days: parsedDays,
          is_active: isActive,
          sort_order: parsedOrder,
        }
        await createMut.mutateAsync(body)
      }
      onClose()
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Failed to save preset')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} size="md" title={isEdit ? 'Edit preset' : 'New goal preset'}>
      <div className="flex flex-col gap-4">
        <Field label="Slug" hint={isEdit ? 'Read-only after creation' : 'lowercase-hyphenated, e.g. senior-yandex'}>
          <input
            type="text"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            disabled={isEdit}
            className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 font-mono text-[12px] text-text-primary disabled:opacity-60 focus:border-text-primary focus:outline-none"
            placeholder="senior-yandex"
          />
        </Field>

        <Field label="Title" hint="What user sees in the pill, e.g. «Senior Backend @ Yandex»">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-[13px] text-text-primary focus:border-text-primary focus:outline-none"
          />
        </Field>

        <Field label="Kind">
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as GoalPresetKind)}
            className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-[13px] text-text-primary focus:border-text-primary focus:outline-none"
          >
            {KIND_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Target company">
            <input
              type="text"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="Yandex"
              className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-[13px] text-text-primary focus:border-text-primary focus:outline-none"
            />
          </Field>
          <Field label="Target level (optional)">
            <input
              type="text"
              value={level}
              onChange={(e) => setLevel(e.target.value)}
              placeholder="Senior"
              className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-[13px] text-text-primary focus:border-text-primary focus:outline-none"
            />
          </Field>
        </div>

        <Field label="Target text (optional)" hint="For english_target / custom — e.g. «TOEFL 100+»">
          <input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-[13px] text-text-primary focus:border-text-primary focus:outline-none"
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Default target days" hint="Optional. Wizard будет ставить date = today + N">
            <input
              type="number"
              min={0}
              max={3650}
              value={days}
              onChange={(e) => setDays(e.target.value)}
              className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 font-mono text-[12px] text-text-primary focus:border-text-primary focus:outline-none"
            />
          </Field>
          <Field label="Sort order">
            <input
              type="number"
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value)}
              className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 font-mono text-[12px] text-text-primary focus:border-text-primary focus:outline-none"
            />
          </Field>
        </div>

        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
            className="h-4 w-4 accent-text-primary"
          />
          <span className="text-[13px] text-text-primary">Active (visible in GoalWizard)</span>
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
