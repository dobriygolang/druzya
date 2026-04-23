// CreateLobbyDialog — owner-side form for spinning up a Custom Lobby.
//
// Submits to POST /lobby and, on success, navigates to /lobby/{id} so the
// owner immediately sees the share-code + member slots. Anti-fallback: any
// 4xx surfaces inline; nothing is invented.
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  useCreateLobby,
  type CreateLobbyPayload,
  type LobbyMode,
  type LobbyVisibility,
} from '../../lib/queries/lobby'

type Props = {
  open: boolean
  onClose: () => void
}

const SECTIONS = ['algorithms', 'sql', 'go', 'system_design', 'behavioral']
const DIFFS = ['easy', 'medium', 'hard']

export default function CreateLobbyDialog({ open, onClose }: Props) {
  const navigate = useNavigate()
  const create = useCreateLobby()

  const [mode, setMode] = useState<LobbyMode>('1v1')
  const [section, setSection] = useState('algorithms')
  const [difficulty, setDifficulty] = useState('medium')
  const [visibility, setVisibility] = useState<LobbyVisibility>('public')
  const [aiAllowed, setAIAllowed] = useState(false)
  const [timeLimitMin, setTimeLimitMin] = useState(30)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  if (!open) return null

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg(null)
    const payload: CreateLobbyPayload = {
      mode,
      section,
      difficulty,
      visibility,
      ai_allowed: aiAllowed,
      time_limit_min: timeLimitMin,
      max_members: mode === '1v1' ? 2 : 4,
    }
    try {
      const lobby = await create.mutateAsync(payload)
      navigate(`/lobby/${lobby.id}`)
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to create lobby')
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
        <h2 className="font-display mb-4 text-xl font-bold text-text-primary">
          Создать лобби
        </h2>

        <Field label="Режим">
          <SegmentedSelect
            value={mode}
            options={[
              { value: '1v1', label: '1 на 1' },
              { value: '2v2', label: '2 на 2' },
            ]}
            onChange={(v) => setMode(v as LobbyMode)}
          />
        </Field>

        <Field label="Секция">
          <select
            value={section}
            onChange={(e) => setSection(e.target.value)}
            className="h-9 w-full rounded-md border border-border bg-surface-2 px-2 text-sm text-text-primary"
          >
            {SECTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Сложность">
          <SegmentedSelect
            value={difficulty}
            options={DIFFS.map((d) => ({ value: d, label: d }))}
            onChange={setDifficulty}
          />
        </Field>

        <Field label="Видимость">
          <SegmentedSelect
            value={visibility}
            options={[
              { value: 'public', label: 'public' },
              { value: 'unlisted', label: 'unlisted' },
              { value: 'private', label: 'private' },
            ]}
            onChange={(v) => setVisibility(v as LobbyVisibility)}
          />
        </Field>

        <Field label={`Лимит времени: ${timeLimitMin} мин`}>
          <input
            type="range"
            min={5}
            max={180}
            step={5}
            value={timeLimitMin}
            onChange={(e) => setTimeLimitMin(Number(e.target.value))}
            className="w-full"
          />
        </Field>

        <label className="mb-4 flex cursor-pointer items-center gap-2 text-sm text-text-secondary">
          <input
            type="checkbox"
            checked={aiAllowed}
            onChange={(e) => setAIAllowed(e.target.checked)}
          />
          Разрешить AI-помощника
        </label>

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

function SegmentedSelect({
  value,
  options,
  onChange,
}: {
  value: string
  options: Array<{ value: string; label: string }>
  onChange: (v: string) => void
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={
            'h-8 rounded-md border px-3 text-xs ' +
            (value === o.value
              ? 'border-accent bg-accent/15 font-semibold text-text-primary'
              : 'border-border bg-surface-2 text-text-secondary hover:bg-surface-1')
          }
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
