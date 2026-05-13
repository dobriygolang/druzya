
import { useState, type FormEvent } from 'react'
import { Modal } from '../../components/primitives/Modal'
import { motion as motionTokens } from '../../lib/design-tokens'
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
  track_kind: 'dev',
}

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

const onFocusBorder = (e: React.FocusEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
  e.currentTarget.style.borderBottomColor = 'rgb(var(--ink))'
}
const onBlurBorder = (e: React.FocusEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
  e.currentTarget.style.borderBottomColor = 'var(--hair-2)'
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
    track_kind: ('track_kind' in initial && initial.track_kind) ? initial.track_kind : 'dev',
  }
  const [open, setOpen] = useState(true)
  const [form, setForm] = useState<UpsertNodePayload>(seed)
  const [error, setError] = useState<string | null>(null)

  const close = () => {
    setOpen(false)
    window.setTimeout(onClose, motionTokens.dur.medium)
  }

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
      close()
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
    <Modal open={open} onClose={close} size="md" title={mode === 'edit' ? `Редактирование «${initial.id}»` : 'Новый узел атласа'}>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="grid grid-cols-2" style={{ gap: 14 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={captionMonoLabel}>id (slug) *</span>
            <input
              value={form.id}
              onChange={(e) => setField('id', e.target.value)}
              disabled={mode === 'edit'}
              placeholder="algo_basics"
              style={{ ...underlineInput, opacity: mode === 'edit' ? 0.6 : 1 }}
              onFocus={onFocusBorder}
              onBlur={onBlurBorder}
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={captionMonoLabel}>title *</span>
            <input
              value={form.title}
              onChange={(e) => setField('title', e.target.value)}
              placeholder="Алгоритмы: основы"
              style={underlineInput}
              onFocus={onFocusBorder}
              onBlur={onBlurBorder}
            />
          </label>
        </div>

        <div className="grid grid-cols-2" style={{ gap: 14 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={captionMonoLabel}>section</span>
            <select
              value={form.section}
              onChange={(e) => setField('section', e.target.value)}
              style={{ ...underlineInput, appearance: 'none', cursor: 'pointer' }}
              onFocus={onFocusBorder}
              onBlur={onBlurBorder}
            >
              {ATLAS_SECTION_OPTIONS.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={captionMonoLabel}>kind</span>
            <select
              value={form.kind}
              onChange={(e) => setField('kind', e.target.value)}
              style={{ ...underlineInput, appearance: 'none', cursor: 'pointer' }}
              onFocus={onFocusBorder}
              onBlur={onBlurBorder}
            >
              {ATLAS_KIND_OPTIONS.map((k) => (
                <option key={k} value={k}>{k}</option>
              ))}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={captionMonoLabel}>track_kind</span>
            <select
              value={form.track_kind ?? 'dev'}
              onChange={(e) => setField('track_kind', e.target.value)}
              style={{ ...underlineInput, appearance: 'none', cursor: 'pointer' }}
              onFocus={onFocusBorder}
              onBlur={onBlurBorder}
            >
              <option value="dev">dev</option>
              <option value="dev_senior">dev_senior</option>
              <option value="sysanalyst">sysanalyst</option>
              <option value="product_analyst">product_analyst</option>
              <option value="qa">qa</option>
              <option value="english">english</option>
            </select>
          </label>
        </div>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={captionMonoLabel}>description</span>
          <textarea
            value={form.description ?? ''}
            onChange={(e) => setField('description', e.target.value)}
            rows={2}
            style={{
              padding: '8px 0',
              background: 'transparent',
              border: 0,
              borderBottom: '1px solid var(--hair-2)',
              color: 'rgb(var(--ink))',
              fontSize: 14,
              outline: 'none',
              resize: 'vertical',
              fontFamily: 'inherit',
              transition: 'border-color var(--motion-dur-small) var(--motion-ease-decelerate)',
            }}
            onFocus={onFocusBorder}
            onBlur={onBlurBorder}
          />
        </label>

        <div className="grid grid-cols-3" style={{ gap: 14 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={captionMonoLabel}>total_count</span>
            <input
              type="number"
              value={form.total_count}
              onChange={(e) => setField('total_count', Number(e.target.value || 0))}
              style={underlineInput}
              onFocus={onFocusBorder}
              onBlur={onBlurBorder}
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={captionMonoLabel}>sort_order</span>
            <input
              type="number"
              value={form.sort_order ?? 0}
              onChange={(e) => setField('sort_order', Number(e.target.value || 0))}
              style={underlineInput}
              onFocus={onFocusBorder}
              onBlur={onBlurBorder}
            />
          </label>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, paddingTop: 22, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={form.is_active ?? true}
              onChange={(e) => setField('is_active', e.target.checked)}
              style={{ width: 16, height: 16, accentColor: 'rgb(var(--ink))', cursor: 'pointer' }}
            />
            <span style={{ fontSize: 13, color: 'rgb(var(--ink))' }}>is_active</span>
          </label>
        </div>

        <fieldset
          style={{
            border: '1px solid var(--hair-2)',
            borderRadius: 'var(--radius-inner)',
            padding: 14,
            background: 'transparent',
          }}
        >
          <legend style={{ ...captionMonoLabel, padding: '0 6px' }}>
            Позиция (viewBox 0..1400, пусто = auto-layout)
          </legend>
          <div className="flex-wrap-row" style={{ alignItems: 'center', gap: 14 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ ...captionMonoLabel, fontSize: 10 }}>pos_x</span>
              <input
                type="number"
                value={form.pos_x ?? ''}
                onChange={(e) => setField('pos_x', e.target.value === '' ? null : Number(e.target.value))}
                style={{ ...underlineInput, width: 100 }}
                onFocus={onFocusBorder}
                onBlur={onBlurBorder}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ ...captionMonoLabel, fontSize: 10 }}>pos_y</span>
              <input
                type="number"
                value={form.pos_y ?? ''}
                onChange={(e) => setField('pos_y', e.target.value === '' ? null : Number(e.target.value))}
                style={{ ...underlineInput, width: 100 }}
                onFocus={onFocusBorder}
                onBlur={onBlurBorder}
              />
            </label>
            {mode === 'edit' && (
              <Button type="button" size="sm" variant="ghost" onClick={() => void savePositionOnly()} disabled={busy}>
                Сохранить только позицию
              </Button>
            )}
          </div>
        </fieldset>

        {error && (
          <p
            role="alert"
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
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, paddingTop: 4 }}>
          <Button type="button" variant="ghost" size="sm" onClick={close}>
            Отмена
          </Button>
          <Button type="submit" size="sm" disabled={busy}>
            {busy ? 'Сохраняем…' : mode === 'edit' ? 'Сохранить' : 'Создать'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
