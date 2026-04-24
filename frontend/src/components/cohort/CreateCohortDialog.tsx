// CreateCohortDialog — POST /api/v1/cohort. Minimal form: name + slug
// (auto-suggested from name) + ends_at + visibility. starts_at defaults
// to today; backend takes that as start of cohort.
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCreateCohortMutation } from '../../lib/queries/cohort'

type Props = {
  open: boolean
  onClose: () => void
}

function suggestSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 60)
}

function defaultEnds(): string {
  // 6 weeks out — local YYYY-MM-DD for the date input.
  const d = new Date(Date.now() + 42 * 86_400_000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export default function CreateCohortDialog({ open, onClose }: Props) {
  const navigate = useNavigate()
  const create = useCreateCohortMutation()

  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [endsAt, setEndsAt] = useState(defaultEnds)
  const [capacity, setCapacity] = useState<number>(50)
  const [visibility, setVisibility] = useState<'public' | 'invite'>('public')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  // Track whether the user manually edited the slug — once they did, we
  // stop overriding it from the name suggestion.
  const [slugTouched, setSlugTouched] = useState(false)

  // Auto-suggest the slug while the user types the name.
  useEffect(() => {
    if (slugTouched) return
    setSlug(suggestSlug(name))
  }, [name, slugTouched])

  // Reset state on reopen so a previously cancelled draft doesn't bleed.
  useEffect(() => {
    if (!open) return
    setErrorMsg(null)
  }, [open])

  if (!open) return null

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg(null)
    if (!name.trim()) {
      setErrorMsg('Название обязательно')
      return
    }
    if (capacity < 2 || capacity > 500) {
      setErrorMsg('Размер когорты должен быть от 2 до 500')
      return
    }
    try {
      const out = await create.mutateAsync({
        name: name.trim(),
        slug: slug.trim() || undefined,
        starts_at: new Date().toISOString(),
        ends_at: endsAt ? new Date(endsAt).toISOString() : undefined,
        visibility,
        capacity,
      })
      onClose()
      // Best-effort jump to the new cohort if we have its slug; otherwise
      // /cohorts re-fetch via cache invalidation will surface it.
      if (slug) navigate(`/c/${encodeURIComponent(slug)}`)
      // Reset form for next time.
      setName('')
      setSlug('')
      setSlugTouched(false)
      void out
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Не удалось создать когорту')
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
          Создать когорту
        </h2>
        <p className="mb-4 text-xs text-text-muted">
          Группа для совместного обучения. Стартует сегодня, длится по умолчанию 6 недель.
        </p>

        <Field label="Название">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={80}
            placeholder="Например: Яндекс spring'26"
            className="h-9 w-full rounded-md border border-border bg-surface-2 px-2 text-sm text-text-primary"
          />
        </Field>

        <Field label="Slug (URL-фрагмент)">
          <input
            type="text"
            value={slug}
            onChange={(e) => {
              setSlugTouched(true)
              setSlug(suggestSlug(e.target.value))
            }}
            maxLength={80}
            placeholder="yandex-spring-26"
            className="h-9 w-full rounded-md border border-border bg-surface-2 px-2 font-mono text-sm text-text-primary"
          />
          <p className="mt-1 text-[11px] text-text-muted">
            Адрес: <span className="font-mono">druz9.online/c/{slug || 'your-slug'}</span>
          </p>
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

        <Field label="Размер когорты">
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
            От 2 до 500 участников. По умолчанию 50 — хватает на учебную группу.
          </p>
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
            disabled={create.isPending}
            className="h-9 rounded-md bg-accent px-4 text-sm font-semibold text-text-primary hover:bg-accent/90 disabled:opacity-60"
          >
            {create.isPending ? 'Создаём…' : 'Создать'}
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
