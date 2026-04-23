import { useState, type FormEvent } from 'react'
import { Button } from '../../components/Button'
import type { AtlasAdminNode, UpsertNodePayload } from '../../lib/queries/atlasAdmin'

export const ATLAS_KIND_OPTIONS = ['normal', 'keystone', 'ascendant', 'center'] as const
export const ATLAS_SECTION_OPTIONS = [
  'algorithms',
  'data_structures',
  'sql',
  'go',
  'system_design',
  'behavioral',
  'concurrency',
] as const

export const emptyNodeForm: UpsertNodePayload = {
  id: '',
  title: '',
  section: 'algorithms',
  kind: 'normal',
  description: '',
  total_count: 0,
  pos_x: null,
  pos_y: null,
  sort_order: 0,
  is_active: true,
}

export function AtlasNodeModal({
  initial,
  mode,
  onClose,
  onSubmit,
  onSavePosition,
  busy,
}: {
  initial: UpsertNodePayload | AtlasAdminNode
  mode: 'create' | 'edit'
  onClose: () => void
  onSubmit: (payload: UpsertNodePayload) => Promise<void>
  onSavePosition: (id: string, posX: number | null, posY: number | null) => Promise<void>
  busy: boolean
}) {
  const seed: UpsertNodePayload = {
    id: initial.id,
    title: initial.title,
    section: initial.section,
    kind: initial.kind,
    description: initial.description ?? '',
    total_count: initial.total_count,
    pos_x: initial.pos_x ?? null,
    pos_y: initial.pos_y ?? null,
    sort_order: initial.sort_order ?? 0,
    is_active: initial.is_active ?? true,
  }
  const [form, setForm] = useState<UpsertNodePayload>(seed)
  const [error, setError] = useState<string | null>(null)

  const setField = <K extends keyof UpsertNodePayload>(k: K, v: UpsertNodePayload[K]) =>
    setForm((prev) => ({ ...prev, [k]: v }))

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!form.id.trim() || !form.title.trim()) {
      setError('id и title обязательны.')
      return
    }
    try {
      await onSubmit({ ...form, id: form.id.trim(), title: form.title.trim() })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Сохранить не удалось.')
    }
  }

  const savePositionOnly = async () => {
    setError(null)
    try {
      await onSavePosition(form.id.trim(), form.pos_x ?? null, form.pos_y ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить позицию.')
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="w-full max-w-lg rounded-lg border border-border bg-surface-1 p-5">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-display text-sm font-bold text-text-primary">
            {mode === 'edit' ? `Редактирование «${initial.id}»` : 'Новый узел атласа'}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="font-mono text-xs text-text-muted hover:text-text-primary"
          >
            ✕
          </button>
        </div>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">
              <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">id (slug) *</span>
              <input
                value={form.id}
                onChange={(e) => setField('id', e.target.value)}
                disabled={mode === 'edit'}
                placeholder="algo_basics"
                className="h-9 rounded-md border border-border bg-surface-2 px-3 text-sm text-text-primary disabled:opacity-60"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">title *</span>
              <input
                value={form.title}
                onChange={(e) => setField('title', e.target.value)}
                placeholder="Алгоритмы: основы"
                className="h-9 rounded-md border border-border bg-surface-2 px-3 text-sm text-text-primary"
              />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">
              <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">section</span>
              <select
                value={form.section}
                onChange={(e) => setField('section', e.target.value)}
                className="h-9 rounded-md border border-border bg-surface-2 px-2 text-sm text-text-primary"
              >
                {ATLAS_SECTION_OPTIONS.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">kind</span>
              <select
                value={form.kind}
                onChange={(e) => setField('kind', e.target.value)}
                className="h-9 rounded-md border border-border bg-surface-2 px-2 text-sm text-text-primary"
              >
                {ATLAS_KIND_OPTIONS.map((k) => (
                  <option key={k} value={k}>{k}</option>
                ))}
              </select>
            </label>
          </div>

          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">description</span>
            <textarea
              value={form.description ?? ''}
              onChange={(e) => setField('description', e.target.value)}
              rows={2}
              className="rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-text-primary"
            />
          </label>

          <div className="grid grid-cols-3 gap-2">
            <label className="flex flex-col gap-1">
              <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">total_count</span>
              <input
                type="number"
                value={form.total_count}
                onChange={(e) => setField('total_count', Number(e.target.value || 0))}
                className="h-9 rounded-md border border-border bg-surface-2 px-3 text-sm text-text-primary"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">sort_order</span>
              <input
                type="number"
                value={form.sort_order ?? 0}
                onChange={(e) => setField('sort_order', Number(e.target.value || 0))}
                className="h-9 rounded-md border border-border bg-surface-2 px-3 text-sm text-text-primary"
              />
            </label>
            <label className="flex items-center gap-2 pt-5">
              <input
                type="checkbox"
                checked={form.is_active ?? true}
                onChange={(e) => setField('is_active', e.target.checked)}
              />
              <span className="text-sm text-text-primary">is_active</span>
            </label>
          </div>

          <fieldset className="rounded-md border border-border bg-surface-2 p-3">
            <legend className="px-1 font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
              Позиция (viewBox 0..1400, пусто = auto-layout)
            </legend>
            <div className="flex items-center gap-2">
              <label className="flex flex-col gap-1">
                <span className="font-mono text-[10px] text-text-muted">pos_x</span>
                <input
                  type="number"
                  value={form.pos_x ?? ''}
                  onChange={(e) =>
                    setField('pos_x', e.target.value === '' ? null : Number(e.target.value))
                  }
                  className="h-9 w-24 rounded-md border border-border bg-surface-1 px-3 text-sm text-text-primary"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="font-mono text-[10px] text-text-muted">pos_y</span>
                <input
                  type="number"
                  value={form.pos_y ?? ''}
                  onChange={(e) =>
                    setField('pos_y', e.target.value === '' ? null : Number(e.target.value))
                  }
                  className="h-9 w-24 rounded-md border border-border bg-surface-1 px-3 text-sm text-text-primary"
                />
              </label>
              {mode === 'edit' && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => void savePositionOnly()}
                  disabled={busy}
                >
                  Сохранить только позицию
                </Button>
              )}
            </div>
          </fieldset>

          {error && (
            <p className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>
              Отмена
            </Button>
            <Button type="submit" size="sm" disabled={busy}>
              {busy ? 'Сохраняем…' : mode === 'edit' ? 'Сохранить' : 'Создать'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
