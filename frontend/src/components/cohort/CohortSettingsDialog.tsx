// CohortSettingsDialog — owner-only edit form for a cohort. Backed by
// PATCH /api/v1/cohort/{id}. Three editable fields: name, ends_at,
// visibility. Form is initialised from the current cohort so unchanged
// fields keep their values; backend uses null-aware partial update.
import { useEffect, useState } from 'react'
import {
  useUpdateCohortMutation,
  useTransferOwnershipMutation,
  type Cohort,
  type CohortMember,
} from '../../lib/queries/cohort'

type Props = {
  open: boolean
  cohort: Cohort
  members?: CohortMember[]
  /** 'coach' gets a restricted form (name + ends_at only). */
  role?: 'owner' | 'coach'
  onClose: () => void
}

function toLocalDate(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export default function CohortSettingsDialog({ open, cohort, members, role = 'owner', onClose }: Props) {
  const isOwner = role === 'owner'
  const update = useUpdateCohortMutation()
  const transfer = useTransferOwnershipMutation()
  const [transferTo, setTransferTo] = useState<string>('')
  const [transferBusy, setTransferBusy] = useState(false)
  const [name, setName] = useState(cohort.name)
  const [endsAt, setEndsAt] = useState(toLocalDate(cohort.ends_at))
  const [capacity, setCapacity] = useState<number>(cohort.capacity ?? 50)
  const [visibility, setVisibility] = useState<'public' | 'invite'>(
    cohort.visibility === 'invite' ? 'invite' : 'public',
  )
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // Reset on reopen so a stale aborted edit doesn't bleed.
  useEffect(() => {
    if (!open) return
    setName(cohort.name)
    setEndsAt(toLocalDate(cohort.ends_at))
    setCapacity(cohort.capacity ?? 50)
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
      if (isOwner && (capacity < 2 || capacity > 500)) {
        setErrorMsg('Размер когорты должен быть от 2 до 500')
        return
      }
      await update.mutateAsync({
        cohortID: cohort.id,
        name: name !== cohort.name ? name.trim() : undefined,
        ends_at: endsAt !== toLocalDate(cohort.ends_at) ? new Date(endsAt).toISOString() : undefined,
        // coach-edit restriction: visibility + capacity are owner-only.
        visibility: isOwner && visibility !== cohort.visibility ? visibility : undefined,
        capacity: isOwner && capacity !== (cohort.capacity ?? 50) ? capacity : undefined,
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
          {isOwner
            ? 'Поменяй название, продли дату окончания, переключи видимость, размер или передай права другому участнику. Slug менять нельзя — он часть публичного URL.'
            : 'Coach может править только название и дату окончания. Видимость, размер и состав — у owner\u2019а.'}
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

        {isOwner && <Field label="Размер когорты">
          <input
            type="number"
            min={2}
            max={500}
            value={capacity}
            onChange={(e) => setCapacity(parseInt(e.target.value, 10) || 0)}
            required
            className="h-9 w-full rounded-md border border-border bg-surface-2 px-2 text-sm text-text-primary"
          />
          <p className="mt-1 text-[11px] text-text-muted">
            Нельзя опустить ниже числа уже вступивших участников.
          </p>
        </Field>}

        {isOwner && <Field label="Видимость">
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
        </Field>}

        {errorMsg && (
          <div className="mb-3 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
            {errorMsg}
          </div>
        )}

        {isOwner && members && members.length > 1 && (
          <div className="mb-4 rounded-md border border-border bg-surface-2/60 p-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">
              Передать права
            </div>
            <p className="mb-2 text-[11px] text-text-secondary">
              Новый owner получит полный доступ; ты станешь coach&apos;ем и сохранишь
              модераторские права.
            </p>
            <div className="flex gap-2">
              <select
                value={transferTo}
                onChange={(e) => setTransferTo(e.target.value)}
                className="h-9 flex-1 rounded-md border border-border bg-surface-1 px-2 text-sm text-text-primary"
              >
                <option value="">— выберите участника —</option>
                {members
                  .filter((m) => m.user_id !== cohort.owner_id && m.role !== 'owner')
                  .map((m) => (
                    <option key={m.user_id} value={m.user_id}>
                      {m.display_name || m.username || m.user_id}
                      {m.role === 'coach' && ' · coach'}
                    </option>
                  ))}
              </select>
              <button
                type="button"
                disabled={!transferTo || transferBusy || transfer.isPending}
                onClick={async () => {
                  if (!transferTo) return
                  const target = members.find((m) => m.user_id === transferTo)
                  const label = target?.display_name || target?.username || 'участника'
                  if (!window.confirm(`Передать owner-права «${label}»?`)) return
                  setTransferBusy(true)
                  try {
                    await transfer.mutateAsync({ cohortID: cohort.id, newOwnerID: transferTo })
                    setTransferTo('')
                    onClose()
                  } catch (err) {
                    setErrorMsg(err instanceof Error ? err.message : 'Не удалось передать права')
                  } finally {
                    setTransferBusy(false)
                  }
                }}
                className="h-9 rounded-md border border-accent/60 bg-accent/15 px-3 text-xs font-semibold text-accent-hover hover:bg-accent/25 disabled:opacity-40"
              >
                {transferBusy || transfer.isPending ? '…' : 'Передать'}
              </button>
            </div>
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
