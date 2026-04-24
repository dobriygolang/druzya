// CohortSettingsDialog — owner-only edit form for a cohort. Backed by
// PATCH /api/v1/cohort/{id}. Three editable fields: name, ends_at,
// visibility. Form is initialised from the current cohort so unchanged
// fields keep their values; backend uses null-aware partial update.
import { useEffect, useState } from 'react'
import { useUpdateCohortMutation, type Cohort } from '../../lib/queries/cohort'

type Props = {
  open: boolean
  cohort: Cohort
  onClose: () => void
}

function toLocalDate(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export default function CohortSettingsDialog({ open, cohort, onClose }: Props) {
  const update = useUpdateCohortMutation()
  const [name, setName] = useState(cohort.name)
  const [endsAt, setEndsAt] = useState(toLocalDate(cohort.ends_at))
  const [visibility, setVisibility] = useState<'public' | 'invite'>(
    cohort.visibility === 'invite' ? 'invite' : 'public',
  )
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // Reset on reopen so a stale aborted edit doesn't bleed.
  useEffect(() => {
    if (!open) return
    setName(cohort.name)
    setEndsAt(toLocalDate(cohort.ends_at))
    setVisibility(cohort.visibility === 'invite' ? 'invite' : 'public')
    setErrorMsg(null)
  }, [open, cohort])

  if (!open) return null

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg(null)
    if (!name.trim()) {
      setErrorMsg('Название обязательно')
      return
    }
    try {
      await update.mutateAsync({
        cohortID: cohort.id,
        name: name !== cohort.name ? name.trim() : undefined,
        ends_at: endsAt !== toLocalDate(cohort.ends_at) ? new Date(endsAt).toISOString() : undefined,
        visibility: visibility !== cohort.visibility ? visibility : undefined,
      })
      onClose()
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Не удалось сохранить')
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
      onClick={onClose}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={onSubmit}
        className="w-full max-w-md rounded-lg border border-border bg-surface-1 p-6 shadow-xl"
      >
        <h2 className="font-display mb-1 text-xl font-bold text-text-primary">
          Настройки когорты
        </h2>
        <p className="mb-4 text-xs text-text-muted">
          Можешь поменять название, продлить дату окончания, переключить видимость.
          Slug менять нельзя — он часть публичного URL.
        </p>

        <Field label="Название">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={80}
            className="h-9 w-full rounded-md border border-border bg-surface-2 px-2 text-sm text-text-primary"
          />
        </Field>

        <Field label="Дата окончания">
          <input
            type="date"
            value={endsAt}
            onChange={(e) => setEndsAt(e.target.value)}
            required
            className="h-9 w-full rounded-md border border-border bg-surface-2 px-2 text-sm text-text-primary"
          />
        </Field>

        <Field label="Видимость">
          <div className="flex gap-1">
            {(['public', 'invite'] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setVisibility(v)}
                className={`flex-1 rounded-md border px-3 py-1.5 text-xs ${
                  visibility === v
                    ? 'border-accent bg-accent/15 text-accent-hover'
                    : 'border-border bg-surface-2 text-text-secondary hover:border-border-strong'
                }`}
              >
                {v === 'public' ? 'Публичная' : 'По приглашению'}
              </button>
            ))}
          </div>
        </Field>

        {errorMsg && (
          <div className="mb-3 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
            {errorMsg}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="h-9 rounded-md border border-border px-3 text-sm text-text-secondary hover:bg-surface-2"
          >
            Отмена
          </button>
          <button
            type="submit"
            disabled={update.isPending}
            className="h-9 rounded-md bg-accent px-4 text-sm font-semibold text-text-primary hover:bg-accent/90 disabled:opacity-60"
          >
            {update.isPending ? 'Сохраняем…' : 'Сохранить'}
          </button>
        </div>
      </form>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <div className="mb-1 text-xs uppercase tracking-wide text-text-muted">{label}</div>
      {children}
    </div>
  )
}
