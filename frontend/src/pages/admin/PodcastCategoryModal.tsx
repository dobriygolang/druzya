
import { useState, type FormEvent } from 'react'
import { Modal } from '../../components/primitives/Modal'
import { motion as motionTokens } from '../../lib/design-tokens'
import { Button } from '../../components/Button'
import type { PodcastCategory } from '../../lib/queries/podcasts'

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

export function CategoryModal({
  categories,
  onClose,
  onCreate,
  busy,
}: {
  categories: PodcastCategory[]
  onClose: () => void
  onCreate: (input: { slug: string; name: string; color?: string; sort_order?: number }) => Promise<void>
  busy: boolean
}) {
  const [open, setOpen] = useState(true)
  const [slug, setSlug] = useState('')
  const [name, setName] = useState('')
  const [color, setColor] = useState('#6c7af0')
  const [sortOrder, setSortOrder] = useState('100')
  const [error, setError] = useState<string | null>(null)

  const close = () => {
    setOpen(false)
    window.setTimeout(onClose, motionTokens.dur.medium)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!slug.trim() || !name.trim()) {
      setError('slug и name обязательны.')
      return
    }
    try {
      await onCreate({
        slug: slug.trim(),
        name: name.trim(),
        color: color || undefined,
        sort_order: sortOrder ? Number(sortOrder) : undefined,
      })
      setSlug('')
      setName('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось создать категорию.')
    }
  }

  const onFocusBorder = (e: React.FocusEvent<HTMLInputElement>) => {
    e.currentTarget.style.borderBottomColor = 'rgb(var(--ink))'
  }
  const onBlurBorder = (e: React.FocusEvent<HTMLInputElement>) => {
    e.currentTarget.style.borderBottomColor = 'var(--hair-2)'
  }

  return (
    <Modal open={open} onClose={close} size="sm" title="Категории подкастов">
      <ul
        style={{
          margin: 0,
          marginBottom: 18,
          padding: 6,
          listStyle: 'none',
          maxHeight: 200,
          overflowY: 'auto',
          border: '1px solid var(--hair)',
          borderRadius: 'var(--radius-inner)',
          background: 'transparent',
        }}
      >
        {categories.length === 0 && (
          <li style={{ padding: '4px 8px', ...captionMonoLabel, fontSize: 11 }}>Категорий пока нет.</li>
        )}
        {categories.map((c) => (
          <li
            key={c.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '6px 8px',
              fontSize: 13,
            }}
          >
            <span
              aria-hidden
              style={{ width: 10, height: 10, borderRadius: 999, background: c.color, flex: '0 0 auto' }}
            />
            <span style={{ color: 'rgb(var(--ink))' }}>{c.name}</span>
            <span
              style={{
                marginLeft: 'auto',
                fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                fontSize: 10,
                color: 'var(--ink-40)',
              }}
            >
              {c.slug}
            </span>
          </li>
        ))}
      </ul>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={captionMonoLabel}>Slug *</span>
          <input
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="frontend-prod"
            style={underlineInput}
            onFocus={onFocusBorder}
            onBlur={onBlurBorder}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={captionMonoLabel}>Название *</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Frontend в проде"
            style={underlineInput}
            onFocus={onFocusBorder}
            onBlur={onBlurBorder}
          />
        </label>
        <div className="flex-wrap-row" style={{ gap: 14 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 140px', minWidth: 0 }}>
            <span style={captionMonoLabel}>Цвет</span>
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              style={{
                height: 34,
                width: '100%',
                background: 'transparent',
                border: '1px solid var(--hair-2)',
                borderRadius: 'var(--radius-inner)',
                cursor: 'pointer',
              }}
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 140px', minWidth: 0 }}>
            <span style={captionMonoLabel}>Sort order</span>
            <input
              type="number"
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value)}
              style={underlineInput}
              onFocus={onFocusBorder}
              onBlur={onBlurBorder}
            />
          </label>
        </div>
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
            Закрыть
          </Button>
          <Button type="submit" size="sm" disabled={busy}>
            {busy ? 'Создаём…' : 'Создать категорию'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
