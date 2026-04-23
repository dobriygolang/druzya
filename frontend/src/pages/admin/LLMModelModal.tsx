import { useState, type FormEvent } from 'react'
import { Button } from '../../components/Button'
import type { AdminLLMModel, AdminLLMModelUpsertBody } from '../../lib/queries/ai'

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
  const [modelId, setModelId] = useState(initial?.model_id ?? '')
  const [label, setLabel] = useState(initial?.label ?? '')
  const [provider, setProvider] = useState(initial?.provider ?? '')
  const [tier, setTier] = useState<'free' | 'premium'>(initial?.tier ?? 'free')
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
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="w-full max-w-xl rounded-lg border border-border bg-surface-1 p-5">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-display text-sm font-bold text-text-primary">
            {initial ? 'Редактировать модель' : 'Новая модель'}
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
          <label className="flex flex-col gap-1 md:col-span-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">model_id * (OpenRouter id)</span>
            <input
              value={modelId}
              onChange={(e) => setModelId(e.target.value)}
              placeholder="openai/gpt-4o"
              disabled={!!initial}
              className="h-9 rounded-md border border-border bg-surface-2 px-3 font-mono text-sm text-text-primary disabled:opacity-60"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">label *</span>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="h-9 rounded-md border border-border bg-surface-2 px-3 text-sm text-text-primary"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">provider *</span>
            <input
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              placeholder="openai / anthropic / …"
              className="h-9 rounded-md border border-border bg-surface-2 px-3 text-sm text-text-primary"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">tier</span>
            <select
              value={tier}
              onChange={(e) => setTier(e.target.value as 'free' | 'premium')}
              className="h-9 rounded-md border border-border bg-surface-2 px-3 text-sm text-text-primary"
            >
              <option value="free">free</option>
              <option value="premium">premium</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">sort_order</span>
            <input
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value)}
              type="number"
              className="h-9 rounded-md border border-border bg-surface-2 px-3 text-sm text-text-primary"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">context_window</span>
            <input
              value={contextWindow}
              onChange={(e) => setContextWindow(e.target.value)}
              type="number"
              placeholder="128000"
              className="h-9 rounded-md border border-border bg-surface-2 px-3 text-sm text-text-primary"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">cost / 1k in (USD)</span>
            <input
              value={costIn}
              onChange={(e) => setCostIn(e.target.value)}
              type="number"
              step="0.000001"
              className="h-9 rounded-md border border-border bg-surface-2 px-3 text-sm text-text-primary"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">cost / 1k out (USD)</span>
            <input
              value={costOut}
              onChange={(e) => setCostOut(e.target.value)}
              type="number"
              step="0.000001"
              className="h-9 rounded-md border border-border bg-surface-2 px-3 text-sm text-text-primary"
            />
          </label>
          <div className="md:col-span-2 flex flex-wrap gap-4 pt-1">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={isEnabled} onChange={(e) => setIsEnabled(e.target.checked)} className="h-4 w-4" />
              <span className="text-sm text-text-secondary">is_enabled</span>
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={useArena} onChange={(e) => setUseArena(e.target.checked)} className="h-4 w-4" />
              <span className="text-sm text-text-secondary">use_for_arena</span>
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={useInsight} onChange={(e) => setUseInsight(e.target.checked)} className="h-4 w-4" />
              <span className="text-sm text-text-secondary">use_for_insight</span>
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={useMock} onChange={(e) => setUseMock(e.target.checked)} className="h-4 w-4" />
              <span className="text-sm text-text-secondary">use_for_mock</span>
            </label>
          </div>
          {error && (
            <p className="md:col-span-2 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
              {error}
            </p>
          )}
          <div className="md:col-span-2 flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>
              Отмена
            </Button>
            <Button type="submit" size="sm" disabled={busy}>
              {busy ? 'Сохраняем…' : initial ? 'Сохранить' : 'Создать'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
