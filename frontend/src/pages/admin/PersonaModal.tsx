// Modal for creating / editing a persona row. Mirrors LLMModelModal
// style — same surface chrome, same field-label typography, same
// validation pattern (client-side required-field gate, server-side
// errors surfaced via the error state).
//
// Fields collected match the backend schema (migration 00051):
// id, label, hint, icon_emoji, brand_gradient (free-form CSS),
// suggested_task (whitelist), system_prompt (big textarea), sort_order,
// is_enabled.

import { useState, type FormEvent } from 'react'
import { Button } from '../../components/Button'
import type { AdminPersona, AdminPersonaUpsertBody } from '../../lib/queries/personas'

// Whitelist for the suggested_task field — matches backend llmchain
// Task constants. Frontend shows a dropdown rather than free-form
// because a typo here silently disables the task routing.
const TASK_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: '— без подсказки —' },
  { value: 'copilot_stream', label: 'copilot_stream (реальное время, 70B)' },
  { value: 'reasoning', label: 'reasoning (структура, 70B)' },
  { value: 'insight_prose', label: 'insight_prose (связный текст)' },
  { value: 'vacancies_json', label: 'vacancies_json (JSON, 8B)' },
]

export function PersonaModal({
  initial,
  busy,
  onClose,
  onSave,
}: {
  initial: AdminPersona | null
  busy: boolean
  onClose: () => void
  onSave: (body: AdminPersonaUpsertBody) => Promise<void>
}) {
  const [id, setId] = useState(initial?.id ?? '')
  const [label, setLabel] = useState(initial?.label ?? '')
  const [hint, setHint] = useState(initial?.hint ?? '')
  const [iconEmoji, setIconEmoji] = useState(initial?.icon_emoji ?? '💬')
  const [brandGradient, setBrandGradient] = useState(initial?.brand_gradient ?? '')
  const [suggestedTask, setSuggestedTask] = useState(initial?.suggested_task ?? '')
  const [systemPrompt, setSystemPrompt] = useState(initial?.system_prompt ?? '')
  const [sortOrder, setSortOrder] = useState(String(initial?.sort_order ?? 100))
  const [isEnabled, setIsEnabled] = useState(initial?.is_enabled ?? true)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!id.trim() || !label.trim()) {
      setError('id и label обязательны.')
      return
    }
    try {
      const body: AdminPersonaUpsertBody = {
        id: id.trim(),
        label: label.trim(),
        hint,
        icon_emoji: iconEmoji,
        brand_gradient: brandGradient,
        suggested_task: suggestedTask,
        system_prompt: systemPrompt,
        sort_order: sortOrder ? Number(sortOrder) : 100,
        is_enabled: isEnabled,
      }
      await onSave(body)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить.')
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-border bg-surface-1 p-5">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-display text-sm font-bold text-text-primary">
            {initial ? `Редактировать «${initial.label}»` : 'Новая персона'}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="font-mono text-xs text-text-muted hover:text-text-primary"
          >
            ✕
          </button>
        </div>
        <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
              id * (стабильный slug)
            </span>
            <input
              value={id}
              onChange={(e) => setId(e.target.value)}
              placeholder="react-expert"
              disabled={!!initial}
              className="h-9 rounded-md border border-border bg-surface-2 px-3 font-mono text-sm text-text-primary disabled:opacity-60"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
              label *
            </span>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="React Expert"
              className="h-9 rounded-md border border-border bg-surface-2 px-3 text-sm text-text-primary"
            />
          </label>

          <label className="flex flex-col gap-1 md:col-span-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
              hint (подсказка в дропдауне)
            </span>
            <input
              value={hint}
              onChange={(e) => setHint(e.target.value)}
              placeholder="React · TypeScript · performance"
              className="h-9 rounded-md border border-border bg-surface-2 px-3 text-sm text-text-primary"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
              icon (эмодзи или 2 символа)
            </span>
            <input
              value={iconEmoji}
              onChange={(e) => setIconEmoji(e.target.value)}
              placeholder="⚛️"
              className="h-9 rounded-md border border-border bg-surface-2 px-3 text-sm text-text-primary"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
              sort_order (меньше = выше)
            </span>
            <input
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value)}
              type="number"
              className="h-9 rounded-md border border-border bg-surface-2 px-3 text-sm text-text-primary"
            />
          </label>

          <label className="flex flex-col gap-1 md:col-span-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
              brand_gradient (CSS linear-gradient)
            </span>
            <input
              value={brandGradient}
              onChange={(e) => setBrandGradient(e.target.value)}
              placeholder="linear-gradient(135deg, #61dafb 0%, #3178c6 100%)"
              className="h-9 rounded-md border border-border bg-surface-2 px-3 font-mono text-xs text-text-primary"
            />
            {brandGradient && (
              <div
                className="mt-1 h-7 rounded-md border border-border"
                style={{ background: brandGradient }}
              />
            )}
          </label>

          <label className="flex flex-col gap-1 md:col-span-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
              suggested_task (подсказка llmchain; не обязательна)
            </span>
            <select
              value={suggestedTask}
              onChange={(e) => setSuggestedTask(e.target.value)}
              className="h-9 rounded-md border border-border bg-surface-2 px-3 text-sm text-text-primary"
            >
              {TASK_OPTIONS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 md:col-span-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
              system_prompt (префиксится к user-тексту при активной персоне)
            </span>
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="Инструкция: ты senior React-разработчик…"
              rows={8}
              className="rounded-md border border-border bg-surface-2 px-3 py-2 text-[12px] text-text-primary"
            />
          </label>

          <label className="flex items-center gap-2 md:col-span-2">
            <input
              type="checkbox"
              checked={isEnabled}
              onChange={(e) => setIsEnabled(e.target.checked)}
              className="h-4 w-4"
            />
            <span className="text-sm text-text-secondary">
              Включена (видна в desktop-пикере)
            </span>
          </label>

          {error && (
            <div className="md:col-span-2 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
              {error}
            </div>
          )}

          <div className="mt-2 flex justify-end gap-2 md:col-span-2">
            <Button variant="ghost" onClick={onClose} type="button">
              Отмена
            </Button>
            <Button type="submit" loading={busy}>
              {initial ? 'Сохранить' : 'Создать'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
