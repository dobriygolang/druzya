// AtlasFilters — extracted from AtlasPage.tsx in WAVE-11.
//
// Search input + category chips + status chips. Owner holds the state and
// passes through change callbacks. Pure presentation otherwise.

import { Search } from 'lucide-react'
import { Button } from '../../components/Button'
import { CATEGORIES, STATUS_FILTERS, type NodeState } from './AtlasCanvasLegacy'

export type AtlasFiltersProps = {
  query: string
  setQuery: (s: string) => void
  category: string
  setCategory: (s: string) => void
  status: NodeState | 'all'
  setStatus: (s: NodeState | 'all') => void
}

export function AtlasFilters({
  query,
  setQuery,
  category,
  setCategory,
  status,
  setStatus,
}: AtlasFiltersProps) {
  return (
    <div className="flex flex-col gap-3 border-b border-border bg-surface-1 px-4 py-3 sm:px-8 lg:px-20">
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск по названию навыка…"
            className="h-9 w-full rounded-md border border-border bg-bg pl-9 pr-3 text-sm text-text-primary placeholder:text-text-muted focus:border-text-primary focus:outline-none"
          />
        </div>
        {(query || category !== 'all' || status !== 'all') && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setQuery('')
              setCategory('all')
              setStatus('all')
            }}
          >
            Сбросить
          </Button>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        <FilterChip
          active={category === 'all'}
          onClick={() => setCategory('all')}
          label="Все категории"
        />
        {CATEGORIES.map((c) => (
          <FilterChip
            key={c.key}
            active={category === c.key}
            onClick={() => setCategory(c.key)}
            label={c.label}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {STATUS_FILTERS.map((s) => (
          <FilterChip
            key={s.key}
            active={status === s.key}
            onClick={() => setStatus(s.key)}
            label={s.label}
            tone={s.key === 'mastered' ? 'success' : s.key === 'decaying' ? 'warn' : 'default'}
          />
        ))}
      </div>
    </div>
  )
}

function FilterChip({
  active,
  onClick,
  label,
  tone = 'default',
}: {
  active: boolean
  onClick: () => void
  label: string
  tone?: 'default' | 'success' | 'warn'
}) {
  const base = 'rounded-full px-3 py-1 text-xs uppercase transition-colors'
  const activeCls =
    tone === 'success'
      ? 'border-success/60 bg-success/15 text-success border'
      : tone === 'warn'
        ? 'border-warn/60 bg-warn/15 text-warn border'
        : 'border-text-primary bg-text-primary/10 text-text-primary border'
  const inactiveCls =
    'border border-border bg-surface-2 text-text-secondary hover:border-border-strong'
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${base} ${active ? activeCls : inactiveCls}`}
    >
      {label}
    </button>
  )
}
