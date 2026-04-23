import { useState, type FormEvent } from 'react'
import { Button } from '../../components/Button'
import type { PodcastCategory } from '../../lib/queries/podcasts'

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
  const [slug, setSlug] = useState('')
  const [name, setName] = useState('')
  const [color, setColor] = useState('#6c7af0')
  const [sortOrder, setSortOrder] = useState('100')
  const [error, setError] = useState<string | null>(null)

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

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="w-full max-w-md rounded-lg border border-border bg-surface-1 p-5">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-display text-sm font-bold text-text-primary">Категории подкастов</h3>
          <button
            type="button"
            onClick={onClose}
            className="font-mono text-xs text-text-muted hover:text-text-primary"
          >
            ✕
          </button>
        </div>
        <ul className="mb-4 max-h-[200px] overflow-y-auto rounded-md border border-border bg-surface-2 p-2">
          {categories.length === 0 && (
            <li className="px-2 py-1 font-mono text-[11px] text-text-muted">Категорий пока нет.</li>
          )}
          {categories.map((c) => (
            <li key={c.id} className="flex items-center gap-2 px-2 py-1.5 text-sm">
              <span
                className="h-3 w-3 rounded-full"
                style={{ backgroundColor: c.color }}
                aria-hidden
              />
              <span className="text-text-primary">{c.name}</span>
              <span className="ml-auto font-mono text-[10px] text-text-muted">{c.slug}</span>
            </li>
          ))}
        </ul>
        <form onSubmit={handleSubmit} className="flex flex-col gap-2">
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">Slug *</span>
            <input
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="frontend-prod"
              className="h-9 rounded-md border border-border bg-surface-2 px-3 text-sm text-text-primary"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">Название *</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Frontend в проде"
              className="h-9 rounded-md border border-border bg-surface-2 px-3 text-sm text-text-primary"
            />
          </label>
          <div className="flex gap-2">
            <label className="flex flex-1 flex-col gap-1">
              <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">Цвет</span>
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="h-9 w-full rounded-md border border-border bg-surface-2"
              />
            </label>
            <label className="flex flex-1 flex-col gap-1">
              <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">Sort order</span>
              <input
                type="number"
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value)}
                className="h-9 rounded-md border border-border bg-surface-2 px-3 text-sm text-text-primary"
              />
            </label>
          </div>
          {error && (
            <p className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>
              Закрыть
            </Button>
            <Button type="submit" size="sm" disabled={busy}>
              {busy ? 'Создаём…' : 'Создать категорию'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
