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
import { Modal } from '../../components/primitives/Modal'
import { motion as motionTokens } from '../../lib/design-tokens'
import { Button } from '../../components/Button'
import type { AdminPersona, AdminPersonaUpsertBody } from '../../lib/queries/personas'

const captionMonoLabel: React.CSSProperties = {
  fontFamily: "'JetBrains Mono', ui-monospace, monospace",
  fontSize: 10,
  fontWeight: 500,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--ink-40)',
}

const underlineInput: React.CSSProperties = {
  height: 34,
  padding: '6px 0',
  background: 'transparent',
  border: 0,
  borderBottom: '1px solid var(--hair-2)',
  color: 'rgb(var(--ink))',
  fontSize: 14,
  outline: 'none',
  transition: 'border-color var(--motion-dur-small) var(--motion-ease-decelerate)',
}

const onFocusBorder = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
  e.currentTarget.style.borderBottomColor = 'rgb(var(--ink))'
}
const onBlurBorder = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
  e.currentTarget.style.borderBottomColor = 'var(--hair-2)'
}

// Whitelist for the suggested_task field — matches backend llmchain
// Task constants. Frontend shows a dropdown rather than free-form
// because a typo here silently disables the task routing.
const TASK_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: '— без подсказки —' },
  { value: 'copilot_stream', label: 'copilot_stream (реальное время, 70B)' },
  { value: 'reasoning', label: 'reasoning (структура, 70B)' },
  { value: 'insight_prose', label: 'insight_prose (связный текст)' },
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
  const [open, setOpen] = useState(true)
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

  const close = () => {
    setOpen(false)
    window.setTimeout(onClose, motionTokens.dur.medium)
  }

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
    <Modal open={open} onClose={close} size="lg" title={initial ? `Редактировать «${initial.label}»` : 'Новая персона'}>
      <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2" style={{ gap: 14 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={captionMonoLabel}>id * (стабильный slug)</span>
          <input
            value={id}
            onChange={(e) => setId(e.target.value)}
            placeholder="react-expert"
            disabled={!!initial}
            style={{ ...underlineInput, fontFamily: "'JetBrains Mono', ui-monospace, monospace", opacity: initial ? 0.6 : 1 }}
            onFocus={onFocusBorder}
            onBlur={onBlurBorder}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={captionMonoLabel}>label *</span>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="React Expert"
            style={underlineInput}
            onFocus={onFocusBorder}
            onBlur={onBlurBorder}
          />
        </label>

        <label className="md:col-span-2" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={captionMonoLabel}>hint (подсказка в дропдауне)</span>
          <input
            value={hint}
            onChange={(e) => setHint(e.target.value)}
            placeholder="React · TypeScript · performance"
            style={underlineInput}
            onFocus={onFocusBorder}
            onBlur={onBlurBorder}
          />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={captionMonoLabel}>icon (эмодзи или 2 символа)</span>
          <input
            value={iconEmoji}
            onChange={(e) => setIconEmoji(e.target.value)}
            placeholder="⚛️"
            style={underlineInput}
            onFocus={onFocusBorder}
            onBlur={onBlurBorder}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={captionMonoLabel}>sort_order (меньше = выше)</span>
          <input
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value)}
            type="number"
            style={underlineInput}
            onFocus={onFocusBorder}
            onBlur={onBlurBorder}
          />
        </label>

        <label className="md:col-span-2" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={captionMonoLabel}>brand_gradient (CSS linear-gradient)</span>
          <input
            value={brandGradient}
            onChange={(e) => setBrandGradient(e.target.value)}
            placeholder="linear-gradient(135deg, #61dafb 0%, #3178c6 100%)"
            style={{ ...underlineInput, fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: 12 }}
            onFocus={onFocusBorder}
            onBlur={onBlurBorder}
          />
          {brandGradient && (
            <div style={{ marginTop: 6, height: 28, borderRadius: 'var(--radius-inner)', border: '1px solid var(--hair-2)', background: brandGradient }} />
          )}
        </label>

        <label className="md:col-span-2" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={captionMonoLabel}>suggested_task (подсказка llmchain; не обязательна)</span>
          <select
            value={suggestedTask}
            onChange={(e) => setSuggestedTask(e.target.value)}
            style={{ ...underlineInput, appearance: 'none', cursor: 'pointer' }}
            onFocus={onFocusBorder}
            onBlur={onBlurBorder}
          >
            {TASK_OPTIONS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>

        <label className="md:col-span-2" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={captionMonoLabel}>system_prompt (префиксится к user-тексту при активной персоне)</span>
          <textarea
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            placeholder="Инструкция: ты senior React-разработчик…"
            rows={8}
            style={{
              padding: '8px 0',
              background: 'transparent',
              border: 0,
              borderBottom: '1px solid var(--hair-2)',
              color: 'rgb(var(--ink))',
              fontSize: 12,
              outline: 'none',
              resize: 'vertical',
              fontFamily: 'inherit',
              transition: 'border-color var(--motion-dur-small) var(--motion-ease-decelerate)',
            }}
            onFocus={onFocusBorder}
            onBlur={onBlurBorder}
          />
        </label>

        <label className="md:col-span-2" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={isEnabled}
            onChange={(e) => setIsEnabled(e.target.checked)}
            style={{ width: 16, height: 16, accentColor: 'rgb(var(--ink))', cursor: 'pointer' }}
          />
          <span style={{ fontSize: 13, color: 'var(--ink-60)' }}>Включена (видна в desktop-пикере)</span>
        </label>

        {error && (
          <div
            role="alert"
            className="md:col-span-2"
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 10,
              padding: '8px 12px',
              border: '1px solid rgba(255, 59, 48, 0.4)',
              borderRadius: 'var(--radius-inner)',
              fontSize: 12,
              color: 'var(--red)',
              background: 'transparent',
            }}
          >
            <span aria-hidden="true" style={{ display: 'inline-block', width: 1.5, minHeight: 16, background: 'var(--red)', marginTop: 4, flex: '0 0 auto' }} />
            {error}
          </div>
        )}

        <div className="md:col-span-2" style={{ marginTop: 6, display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <Button variant="ghost" onClick={close} type="button">
            Отмена
          </Button>
          <Button type="submit" loading={busy}>
            {initial ? 'Сохранить' : 'Создать'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
