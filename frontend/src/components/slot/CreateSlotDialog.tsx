// CreateSlotDialog — interviewer-only form for spinning up a new slot.
//
// Submits to POST /api/v1/slot via useCreateSlot. The meet_url is intended
// for the interviewer's pre-existing Google Meet room (they create one
// manually). When non-empty, BookSlot reuses this URL on the booking
// instead of generating a mock — see backend/services/slot/app/book_slot.go.
import { useState } from 'react'
import {
  useCreateSlot,
  type CreateSlotInput,
  type SlotDifficulty,
  type SlotSection,
} from '../../lib/queries/slot'

type Props = {
  open: boolean
  onClose: () => void
  onCreated?: () => void
}

const SECTIONS: { value: SlotSection; label: string }[] = [
  { value: 'algorithms', label: 'Algorithms' },
  { value: 'sql', label: 'SQL' },
  { value: 'go', label: 'Go' },
  { value: 'system_design', label: 'System Design' },
  { value: 'behavioral', label: 'Behavioral' },
]

const DIFFS: { value: SlotDifficulty; label: string }[] = [
  { value: 'easy', label: 'Easy' },
  { value: 'medium', label: 'Medium' },
  { value: 'hard', label: 'Hard' },
]

const LANGS = [
  { value: 'ru', label: 'Русский' },
  { value: 'en', label: 'English' },
]

// Default starts_at: now + 2 hours rounded to next 5-minute slot. Local time
// for the <input type="datetime-local"> control; we serialize via toISOString.
function defaultStart(): string {
  const d = new Date(Date.now() + 2 * 3600_000)
  d.setMinutes(Math.ceil(d.getMinutes() / 5) * 5, 0, 0)
  // datetime-local wants YYYY-MM-DDTHH:mm (no seconds, no Z)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function CreateSlotDialog({ open, onClose, onCreated }: Props) {
  const create = useCreateSlot()

  const [startsAt, setStartsAt] = useState(defaultStart)
  const [durationMin, setDurationMin] = useState(60)
  const [section, setSection] = useState<SlotSection>('algorithms')
  const [difficulty, setDifficulty] = useState<SlotDifficulty>('medium')
  const [language, setLanguage] = useState('ru')
  const [priceRub, setPriceRub] = useState(0)
  const [meetUrl, setMeetUrl] = useState('')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  if (!open) return null

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg(null)
    // datetime-local strings are local time; convert to ISO with TZ offset
    // (toISOString gives UTC) so the backend receives an absolute instant.
    const isoUTC = new Date(startsAt).toISOString()
    const input: CreateSlotInput = {
      starts_at: isoUTC,
      duration_min: durationMin,
      section,
      difficulty,
      language,
      price_rub: priceRub,
    }
    if (meetUrl.trim()) input.meet_url = meetUrl.trim()
    try {
      await create.mutateAsync(input)
      onCreated?.()
      onClose()
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Не удалось создать слот')
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
          Создать слот
        </h2>
        <p className="mb-4 text-xs text-text-muted">
          Mock-интервью с реальным кандидатом. Оплата сейчас отключена — поле
          цены носит информационный характер.
        </p>

        <Field label="Время старта">
          <input
            type="datetime-local"
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
            required
            className="h-9 w-full rounded-md border border-border bg-surface-2 px-2 text-sm text-text-primary"
          />
        </Field>

        <Field label={`Длительность · ${durationMin} мин`}>
          <input
            type="range"
            min={15}
            max={180}
            step={15}
            value={durationMin}
            onChange={(e) => setDurationMin(Number(e.target.value))}
            className="w-full"
          />
        </Field>

        <Field label="Секция">
          <select
            value={section}
            onChange={(e) => setSection(e.target.value as SlotSection)}
            className="h-9 w-full rounded-md border border-border bg-surface-2 px-2 text-sm text-text-primary"
          >
            {SECTIONS.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </Field>

        <Field label="Сложность">
          <div className="flex gap-1">
            {DIFFS.map((d) => (
              <button
                key={d.value}
                type="button"
                onClick={() => setDifficulty(d.value)}
                className={`flex-1 rounded-md border px-3 py-1.5 text-xs ${
                  difficulty === d.value
                    ? 'border-accent bg-accent/15 text-accent-hover'
                    : 'border-border bg-surface-2 text-text-secondary hover:border-border-strong'
                }`}
              >
                {d.label}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Язык интервью">
          <div className="flex gap-1">
            {LANGS.map((l) => (
              <button
                key={l.value}
                type="button"
                onClick={() => setLanguage(l.value)}
                className={`flex-1 rounded-md border px-3 py-1.5 text-xs ${
                  language === l.value
                    ? 'border-accent bg-accent/15 text-accent-hover'
                    : 'border-border bg-surface-2 text-text-secondary hover:border-border-strong'
                }`}
              >
                {l.label}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Цена, ₽ (платежи в разработке)">
          <input
            type="number"
            min={0}
            step={100}
            value={priceRub}
            onChange={(e) => setPriceRub(Math.max(0, Number(e.target.value) || 0))}
            className="h-9 w-full rounded-md border border-border bg-surface-2 px-2 text-sm text-text-primary"
          />
        </Field>

        <Field label="Ссылка на Google Meet (опционально)">
          <input
            type="url"
            placeholder="https://meet.google.com/abc-defg-hij"
            value={meetUrl}
            onChange={(e) => setMeetUrl(e.target.value)}
            className="h-9 w-full rounded-md border border-border bg-surface-2 px-2 text-sm text-text-primary"
          />
          <p className="mt-1 text-[11px] text-text-muted">
            Создай встречу в Google Meet и вставь ссылку — кандидат получит
            её при бронировании. Оставь пустым — сгенерируем заглушку.
          </p>
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
