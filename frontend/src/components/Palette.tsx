// Palette — ⌘K command surface for druz9.online. Ported 1:1 from
// hone/src/renderer/src/components/Palette.tsx so the keyboard-first UX
// feels identical between web ↔ Hone (single ecosystem, identity 2026-05-04).
//
// Filter-by-prefix over a static set of routes; Enter runs the highlighted
// item, Arrows navigate, Escape closes. Items are inline (not props) — the
// set IS the product surface; if a destination needs to appear here, the
// right edit is in this file.
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'

import { useFocusTrap } from '../hooks/useFocusTrap'
import {
  Search,
  Sun,
  Sparkles,
  BarChart3,
  Map as MapIcon,
  MessageSquare,
  BookOpen,
  Settings,
  type LucideIcon,
} from 'lucide-react'

interface PaletteProps {
  onClose: () => void
}

interface PaletteItem {
  id: string
  label: string
  icon: LucideIcon
  shortcut: string[]
  to: string
}

export function Palette({ onClose }: PaletteProps) {
  const navigate = useNavigate()
  const [idx, setIdx] = useState(0)
  const [q, setQ] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const items: PaletteItem[] = useMemo(
    () => [
      { id: 'today', label: 'Today', icon: Sun, shortcut: ['T'], to: '/today' },
      { id: 'atlas', label: 'Atlas', icon: MapIcon, shortcut: ['A'], to: '/atlas' },
      { id: 'mock', label: 'Mock', icon: Sparkles, shortcut: ['M'], to: '/mock' },
      { id: 'insights', label: 'Insights', icon: BarChart3, shortcut: ['I'], to: '/insights' },
      { id: 'tutor', label: 'Coach', icon: MessageSquare, shortcut: ['C'], to: '/tutor' },
      { id: 'codex', label: 'Codex', icon: BookOpen, shortcut: ['X'], to: '/codex' },
      { id: 'settings', label: 'Settings', icon: Settings, shortcut: [','], to: '/settings' },
    ],
    [],
  )

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    return s ? items.filter((i) => i.label.toLowerCase().includes(s)) : items
  }, [q, items])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])
  useEffect(() => {
    setIdx(0)
  }, [q])

  const run = (it: PaletteItem) => {
    navigate(it.to)
    onClose()
  }

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setIdx((i) => Math.min(filtered.length - 1, i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setIdx((i) => Math.max(0, i - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const it = filtered[idx]
      if (it) run(it)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  const trapRef = useFocusTrap(true)

  return (
    <div
      ref={trapRef}
      className="fixed inset-0 z-[60] flex items-start justify-center pt-[12vh]"
      style={{
        background: 'rgba(0,0,0,0.62)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
      }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 480,
          maxWidth: '92%',
          height: 'fit-content',
          background: 'rgba(12,12,12,0.96)',
          border: '1px solid rgba(255,255,255,0.07)',
          borderRadius: 'var(--radius-outer)',
          overflow: 'hidden',
          boxShadow: '0 40px 100px -20px rgba(0,0,0,0.85)',
          animation: 'druz9-fade-up var(--motion-dur-medium) var(--motion-ease-standard) both',
        }}
      >
        <div
          style={{
            padding: '11px 14px',
            display: 'grid',
            gridTemplateColumns: 'auto 1fr auto',
            gap: 10,
            alignItems: 'center',
            borderBottom: '1px solid rgba(255,255,255,0.05)',
          }}
        >
          <span style={{ color: 'var(--ink-40)', display: 'flex' }}>
            <Search size={14} />
          </span>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKey}
            placeholder="Type a command…"
            style={{
              width: '100%',
              fontSize: 13.5,
              color: 'rgb(var(--ink))',
              background: 'transparent',
              border: 'none',
              outline: 'none',
              fontFamily: 'Inter, system-ui, sans-serif',
            }}
          />
          <Chip>esc</Chip>
        </div>

        <div style={{ padding: '4px 0', maxHeight: '60vh', overflowY: 'auto' }}>
          {filtered.map((it, i) => {
            const active = i === idx
            const Icon = it.icon
            return (
              <button
                key={it.id}
                onMouseEnter={() => setIdx(i)}
                onClick={() => run(it)}
                style={{
                  width: '100%',
                  display: 'grid',
                  gridTemplateColumns: '34px 1fr auto',
                  gap: 4,
                  alignItems: 'center',
                  padding: '7px 12px',
                  background: active ? 'rgba(255,255,255,0.05)' : 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'background-color var(--motion-dur-small) var(--motion-ease-standard)',
                }}
              >
                <span
                  style={{
                    width: 26,
                    height: 26,
                    display: 'grid',
                    placeItems: 'center',
                    borderRadius: 6,
                    background: 'rgba(255,255,255,0.04)',
                    color: active ? 'rgb(var(--ink))' : 'var(--ink-60)',
                  }}
                >
                  <Icon size={13} />
                </span>
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 500,
                    color: active ? 'rgb(var(--ink))' : 'var(--ink-90)',
                  }}
                >
                  {it.label}
                </span>
                <span style={{ display: 'flex', gap: 4 }}>
                  {it.shortcut.map((k, ki) => (
                    <Chip key={ki}>{k}</Chip>
                  ))}
                </span>
              </button>
            )
          })}
          {filtered.length === 0 && (
            <div style={{ padding: '18px 16px', color: 'var(--ink-40)', fontSize: 12 }}>
              No matches.
            </div>
          )}
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '9px 14px',
            borderTop: '1px solid rgba(255,255,255,0.05)',
            fontSize: 10,
            color: 'var(--ink-40)',
          }}
        >
          <FooterCue>
            <Chip>↑</Chip>
            <Chip>↓</Chip> select
          </FooterCue>
          <FooterCue>
            <Chip>↵</Chip> open
          </FooterCue>
          <span style={{ flex: 1 }} />
          <FooterCue>
            <Chip>⌘</Chip>
            <Chip>K</Chip>
          </FooterCue>
        </div>
      </div>
    </div>
  )
}

function FooterCue({ children }: { children: ReactNode }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>{children}</span>
  )
}

function Chip({ children }: { children: ReactNode }) {
  const style: CSSProperties = {
    display: 'inline-grid',
    placeItems: 'center',
    minWidth: 18,
    height: 18,
    padding: '0 5px',
    fontSize: 9.5,
    letterSpacing: '0.04em',
    color: 'var(--ink-60)',
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 5,
    fontFamily: 'JetBrains Mono, ui-monospace, monospace',
  }
  return <span style={style}>{children}</span>
}
