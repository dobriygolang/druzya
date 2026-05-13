
import { useState, type FormEvent } from 'react'
import { Modal } from '../../components/primitives/Modal'
import { motion as motionTokens } from '../../lib/design-tokens'
import { Button } from '../../components/Button'
import type { AdminLLMModel, AdminLLMModelUpsertBody } from '../../lib/queries/ai'

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

const onFocusBorder = (e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) => {
  e.currentTarget.style.borderBottomColor = 'rgb(var(--ink))'
}
const onBlurBorder = (e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) => {
  e.currentTarget.style.borderBottomColor = 'var(--hair-2)'
}

export function LLMModelModal({
  initial,
  busy,
  onClose,
  onSave,
}: {
  initial: AdminLLMModel | null
  busy: boolean
  onClose: () => void
  onSave: (body: AdminLLMModelUpsertBody) => Promise<void>
}) {
  const [open, setOpen] = useState(true)
  const [modelId, setModelId] = useState(initial?.model_id ?? '')
  const [label, setLabel] = useState(initial?.label ?? '')
  const [provider, setProvider] = useState(initial?.provider ?? '')
  const [tier, setTier] = useState<'free' | 'pro' | 'max'>(initial?.tier ?? 'free')
  const [isEnabled, setIsEnabled] = useState(initial?.is_enabled ?? true)
  const [contextWindow, setContextWindow] = useState(
    initial?.context_window != null ? String(initial.context_window) : '',
  )
  const [costIn, setCostIn] = useState(
    initial?.cost_per_1k_input_usd != null ? String(initial.cost_per_1k_input_usd) : '',
  )
  const [costOut, setCostOut] = useState(
    initial?.cost_per_1k_output_usd != null ? String(initial.cost_per_1k_output_usd) : '',
  )
  const [useArena, setUseArena] = useState(initial?.use_for_arena ?? true)
  const [useInsight, setUseInsight] = useState(initial?.use_for_insight ?? true)
  const [useMock, setUseMock] = useState(initial?.use_for_mock ?? true)
  const [sortOrder, setSortOrder] = useState(String(initial?.sort_order ?? 0))
  const [error, setError] = useState<string | null>(null)

  const close = () => {
    setOpen(false)
    window.setTimeout(onClose, motionTokens.dur.medium)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!modelId.trim() || !label.trim() || !provider.trim()) {
      setError('model_id, label, provider обязательны.')
      return
    }
    try {
      const body: AdminLLMModelUpsertBody = {
        model_id: modelId.trim(),
        label: label.trim(),
        provider: provider.trim(),
        tier,
        is_enabled: isEnabled,
        context_window: contextWindow ? Number(contextWindow) : null,
        cost_per_1k_input_usd: costIn ? Number(costIn) : null,
        cost_per_1k_output_usd: costOut ? Number(costOut) : null,
        use_for_arena: useArena,
        use_for_insight: useInsight,
        use_for_mock: useMock,
        sort_order: sortOrder ? Number(sortOrder) : 0,
      }
      await onSave(body)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить.')
    }
  }

  return (
    <Modal open={open} onClose={close} size="lg" title={initial ? 'Редактировать модель' : 'Новая модель'}>
      <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2" style={{ gap: 14 }}>
        <label className="md:col-span-2" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={captionMonoLabel}>model_id * (OpenRouter id)</span>
          <input
            value={modelId}
            onChange={(e) => setModelId(e.target.value)}
            placeholder="openai/gpt-4o"
            disabled={!!initial}
            style={{ ...underlineInput, fontFamily: "'JetBrains Mono', ui-monospace, monospace", opacity: initial ? 0.6 : 1 }}
            onFocus={onFocusBorder}
            onBlur={onBlurBorder}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={captionMonoLabel}>label *</span>
          <input value={label} onChange={(e) => setLabel(e.target.value)} style={underlineInput} onFocus={onFocusBorder} onBlur={onBlurBorder} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={captionMonoLabel}>provider *</span>
          <input
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            placeholder="openai / anthropic / …"
            style={underlineInput}
            onFocus={onFocusBorder}
            onBlur={onBlurBorder}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={captionMonoLabel}>tier</span>
          <select
            value={tier}
            onChange={(e) => setTier(e.target.value as 'free' | 'pro' | 'max')}
            style={{ ...underlineInput, appearance: 'none', cursor: 'pointer' }}
            onFocus={onFocusBorder}
            onBlur={onBlurBorder}
          >
            <option value="free">free</option>
            <option value="pro">pro</option>
            <option value="max">max</option>
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={captionMonoLabel}>sort_order</span>
          <input value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} type="number" style={underlineInput} onFocus={onFocusBorder} onBlur={onBlurBorder} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={captionMonoLabel}>context_window</span>
          <input value={contextWindow} onChange={(e) => setContextWindow(e.target.value)} type="number" placeholder="128000" style={underlineInput} onFocus={onFocusBorder} onBlur={onBlurBorder} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={captionMonoLabel}>cost / 1k in (USD)</span>
          <input value={costIn} onChange={(e) => setCostIn(e.target.value)} type="number" step="0.000001" style={underlineInput} onFocus={onFocusBorder} onBlur={onBlurBorder} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={captionMonoLabel}>cost / 1k out (USD)</span>
          <input value={costOut} onChange={(e) => setCostOut(e.target.value)} type="number" step="0.000001" style={underlineInput} onFocus={onFocusBorder} onBlur={onBlurBorder} />
        </label>
        <div className="md:col-span-2 flex-wrap-row" style={{ gap: 16, paddingTop: 6 }}>
          <CheckboxLabel checked={isEnabled} onChange={setIsEnabled} label="is_enabled" />
          <CheckboxLabel checked={useArena} onChange={setUseArena} label="use_for_arena · legacy" title="Backend поле use_for_arena (legacy имя — выпиливается при следующем proto-bump'е)." />
          <CheckboxLabel checked={useInsight} onChange={setUseInsight} label="use_for_insight" />
          <CheckboxLabel checked={useMock} onChange={setUseMock} label="use_for_mock" />
        </div>
        {error && (
          <p
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
              margin: 0,
            }}
          >
            <span aria-hidden="true" style={{ display: 'inline-block', width: 1.5, minHeight: 16, background: 'var(--red)', marginTop: 4, flex: '0 0 auto' }} />
            {error}
          </p>
        )}
        <div className="md:col-span-2" style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, paddingTop: 6 }}>
          <Button type="button" variant="ghost" size="sm" onClick={close}>
            Отмена
          </Button>
          <Button type="submit" size="sm" disabled={busy}>
            {busy ? 'Сохраняем…' : initial ? 'Сохранить' : 'Создать'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

function CheckboxLabel({ checked, onChange, label, title }: { checked: boolean; onChange: (v: boolean) => void; label: string; title?: string }) {
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer' }} title={title}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} style={{ width: 16, height: 16, accentColor: 'rgb(var(--ink))', cursor: 'pointer' }} />
      <span style={{ fontSize: 13, color: 'var(--ink-60)' }}>{label}</span>
    </label>
  )
}
