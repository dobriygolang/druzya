// TrackFilterChips — reusable «3 equal tracks» filter for surfaces
// that need to scope content по Go / ML / English / Cross-cutting
// Visual: hairline B/W chips, active = filled ink, inactive = hairline +
// secondary text. The «All» chip is rendered first when `showAll` is on;
// pressing it clears the selection (== «show everything»). Pressing a
// non-All chip toggles that track only — unless the user is holding cmd/
// ctrl, in which case it adds/removes без clearing the others (multi-
// select). This mirrors finder/IDE selection conventions.
//
// Persistence: when `persistKey` is provided, the component writes the
// selection to localStorage under `druz9.track-filter:<key>`. Parents
// hydrate the initial state through useTrackFilter() hook (see below);
// they pass `selected` + `onChange` so the chip array stays a controlled
// component, easy to compose с URL params, query-key invalidation, etc.
//
// B/W rule: the red signal (`var(--red)`) is reserved for a tiny dot on
// the active chip — single-pixel indicator, not background/fill. All
// state otherwise rides on the ink ramp.

import { useEffect } from 'react'
import {
  TRACK_KEYS,
  TRACK_LABEL,
  TRACK_DESCRIPTION,
  writeTrackFilterToStorage,
  type TrackKey,
} from '../lib/trackFilter'

export interface TrackFilterChipsProps {
  /** Current selection. Empty Set == «show all». */
  selected: Set<TrackKey>
  /** Called when the user toggles a chip. Receives the NEW set. */
  onChange: (selected: Set<TrackKey>) => void
  /** Show the «All» reset chip. Defaults to true. */
  showAll?: boolean
  /** When set, persists selection to localStorage under this key. */
  persistKey?: string
  /** Visual size — `sm` chips are 24px tall, default is 28px. */
  size?: 'sm' | 'md'
  /** Optional className override for the wrapper. */
  className?: string
  /** Optional aria-label override for the wrapper (defaults to «Фильтр по трекам»). */
  ariaLabel?: string
}

export function TrackFilterChips({
  selected,
  onChange,
  showAll = true,
  persistKey,
  size = 'md',
  className,
  ariaLabel = 'Фильтр по трекам',
}: TrackFilterChipsProps) {
  // Write-through to localStorage whenever the parent's selection changes.
  // Read happens via `useTrackFilter()` in the parent — keeps render →
  // storage one-directional, no useState loops.
  useEffect(() => {
    if (!persistKey) return
    writeTrackFilterToStorage(persistKey, selected)
  }, [persistKey, selected])

  const toggle = (key: TrackKey, opts: { multi: boolean }) => {
    const next = new Set(selected)
    if (opts.multi) {
      if (next.has(key)) next.delete(key)
      else next.add(key)
    } else {
      // Solo-select mode. If chip is already the only one selected, clear
      // (== «show all»). Otherwise replace selection with just this chip.
      if (next.size === 1 && next.has(key)) {
        next.clear()
      } else {
        next.clear()
        next.add(key)
      }
    }
    onChange(next)
  }

  const clearAll = () => {
    if (selected.size === 0) return
    onChange(new Set())
  }

  const allActive = selected.size === 0

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={`flex flex-wrap items-center gap-1.5 ${className ?? ''}`}
      style={{ minWidth: 0 }}
    >
      {showAll && (
        <Chip
          active={allActive}
          label="Все"
          size={size}
          onClick={clearAll}
          ariaLabel="Сбросить фильтр — показать все треки"
        />
      )}
      {TRACK_KEYS.map((key) => (
        <Chip
          key={key}
          active={selected.has(key)}
          label={TRACK_LABEL[key]}
          size={size}
          title={TRACK_DESCRIPTION[key]}
          onClick={(e) => toggle(key, { multi: e.metaKey || e.ctrlKey || e.shiftKey })}
          ariaLabel={`${TRACK_LABEL[key]} — ${TRACK_DESCRIPTION[key]}`}
        />
      ))}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────
// Chip primitive — hairline B/W. Active = filled ink (text-bg on
// text-primary), inactive = bg-surface-2 with hairline border. The red
// signal lives on the active chip как 4px dot — sub-pixel-thin indicator
// that the chip is «live filter».
// ────────────────────────────────────────────────────────────────────

function Chip({
  active,
  label,
  size,
  title,
  ariaLabel,
  onClick,
}: {
  active: boolean
  label: string
  size: 'sm' | 'md'
  title?: string
  ariaLabel?: string
  onClick: (e: React.MouseEvent) => void
}) {
  const heightCls = size === 'sm' ? 'h-6 px-2 text-[11px]' : 'h-7 px-3 text-xs'
  const baseCls =
    'inline-flex items-center gap-1.5 rounded-full font-mono uppercase tracking-[0.04em] transition-colors duration-[var(--motion-dur-small)] ease-[var(--motion-ease-emphasized)]'
  const activeCls = 'border border-text-primary bg-text-primary text-bg'
  const inactiveCls =
    'border border-border bg-surface-2 text-text-secondary hover:border-border-strong hover:text-text-primary'

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={ariaLabel ?? label}
      title={title}
      className={`${baseCls} ${heightCls} ${active ? activeCls : inactiveCls}`}
      style={{ minWidth: 0 }}
    >
      {active && (
        <span
          aria-hidden
          className="inline-block h-1 w-1 shrink-0 rounded-full"
          style={{ background: 'var(--red)' }}
        />
      )}
      <span className="whitespace-nowrap">{label}</span>
    </button>
  )
}
