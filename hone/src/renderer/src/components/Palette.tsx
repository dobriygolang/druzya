import { useEffect, useMemo, useRef, useState } from 'react';

import { Icon, type IconName } from './primitives/Icon';
import { trackEvent } from '../api/events';

export type PageId =
  | 'home'
  | 'today'
  | 'coach'
  | 'notes'
  | 'stats'
  | 'assignments'
  | 'calendar'
  | 'schedule'
  | 'energy'
  | 'memory'
  | 'settings';

export type PaletteAction = PageId | 'copilot' | 'day-shutdown';

interface PaletteProps {
  onClose: () => void;
  onOpen: (id: PaletteAction) => void;
}

interface PaletteItem {
  id: string;
  label: string;
  icon: IconName;
  shortcut?: string[];
  run: () => void;
  section: string;
}

const ITEMS_BY_SECTION: { section: string; items: Omit<PaletteItem, 'run' | 'section'>[] }[] = [
  {
    section: 'Daily',
    items: [
      { id: 'today', label: 'Today', icon: 'sun', shortcut: ['T'] },
      { id: 'coach', label: 'Coach', icon: 'sparkle', shortcut: ['C'] },
      { id: 'schedule', label: 'Schedule', icon: 'calendar', shortcut: ['Y'] },
      { id: 'energy', label: 'Energy', icon: 'bars', shortcut: ['E'] },
      { id: 'stats', label: 'Stats', icon: 'bars', shortcut: ['S'] },
    ],
  },
  {
    section: 'Capture',
    items: [
      { id: 'notes', label: 'Notes', icon: 'note', shortcut: ['N'] },
      { id: 'memory', label: 'Memory', icon: 'sparkle' },
      // Phase K Wave 15 — end-of-day shutdown ritual (manual trigger).
      { id: 'day-shutdown', label: 'Закрыть день', icon: 'sun' },
    ],
  },
  {
    section: 'System',
    items: [{ id: 'settings', label: 'Settings', icon: 'settings', shortcut: [','] }],
  },
];

export function Palette({ onClose, onOpen }: PaletteProps) {
  const [idx, setIdx] = useState(0);
  const [q, setQ] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const items: PaletteItem[] = useMemo(
    () =>
      ITEMS_BY_SECTION.flatMap(({ section, items: groupItems }) =>
        groupItems.map((it) => ({
          ...it,
          section,
          run: () => onOpen(it.id as PaletteAction),
        })),
      ),
    [onOpen],
  );

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return items;
    return items.filter((i) => i.label.toLowerCase().includes(s));
  }, [q, items]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  useEffect(() => {
    setIdx(0);
  }, [q]);

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setIdx((i) => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setIdx((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const it = filtered[idx];
      if (it) {
        trackEvent('palette_select', { id: it.id, source: 'keyboard' });
        it.run();
        onClose();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  let lastSection: string | null = null;

  return (
    <div
      className="fadein"
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 60,
        background: 'rgba(0,0,0,0.62)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="scale-pop"
        style={{
          width: 520,
          maxWidth: '92%',
          height: 'fit-content',
          background: 'rgba(12,12,12,0.96)',
          border: '1px solid rgba(255,255,255,0.07)',
          borderRadius: 16,
          overflow: 'hidden',
          boxShadow: '0 40px 100px -20px rgba(0,0,0,0.85)',
        }}
      >
        <div
          style={{
            padding: '14px 16px',
            display: 'grid',
            gridTemplateColumns: 'auto 1fr auto',
            gap: 10,
            alignItems: 'center',
            borderBottom: '1px solid rgba(255,255,255,0.05)',
          }}
        >
          <span style={{ color: 'var(--ink-40)', display: 'flex' }}>
            <Icon name="search" size={15} />
          </span>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKey}
            placeholder="Type a command…"
            style={{
              width: '100%',
              fontSize: 14,
              color: 'var(--ink)',
              background: 'transparent',
              border: 'none',
              outline: 'none',
            }}
          />
          <Chip>esc</Chip>
        </div>

        <div role="listbox" aria-label="Commands" style={{ padding: '6px 0' }}>
          {filtered.map((it, i) => {
            const active = i === idx;
            const showHeader = !q.trim() && it.section !== lastSection;
            lastSection = it.section;
            return (
              <div key={it.id}>
                {showHeader && <SectionHeader>{it.section}</SectionHeader>}
                <button
                  onMouseEnter={() => setIdx(i)}
                  onClick={() => {
                    trackEvent('palette_select', { id: it.id, source: 'click' });
                    it.run();
                    onClose();
                  }}
                  role="option"
                  aria-selected={active}
                  className="row"
                  style={{
                    width: '100%',
                    display: 'grid',
                    gridTemplateColumns: '40px 1fr auto',
                    gap: 8,
                    alignItems: 'center',
                    padding: '10px 14px',
                    background: active ? 'rgba(255,255,255,0.06)' : 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'background-color 120ms ease-out',
                  }}
                >
                  <span
                    style={{
                      width: 30,
                      height: 30,
                      display: 'grid',
                      placeItems: 'center',
                      borderRadius: 8,
                      background: 'rgba(255,255,255,0.04)',
                      color: active ? 'var(--ink)' : 'var(--ink-60)',
                      transition: 'color 120ms ease-out',
                    }}
                  >
                    <Icon name={it.icon} size={14} />
                  </span>
                  <span
                    style={{
                      fontSize: 14,
                      fontWeight: 500,
                      color: active ? 'var(--ink)' : 'var(--ink-90)',
                      transition: 'color 120ms ease-out',
                    }}
                  >
                    {it.label}
                  </span>
                  <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    {(it.shortcut ?? []).map((k, ki) => (
                      <span
                        key={ki}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                      >
                        {ki > 0 && (
                          <span style={{ color: 'var(--ink-40)', fontSize: 9, opacity: 0.6 }}>·</span>
                        )}
                        <Chip>{k}</Chip>
                      </span>
                    ))}
                  </span>
                </button>
              </div>
            );
          })}
          {filtered.length === 0 && (
            <div style={{ padding: '20px 16px', color: 'var(--ink-40)', fontSize: 13 }}>
              No matches.
            </div>
          )}
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '10px 16px',
            borderTop: '1px solid rgba(255,255,255,0.05)',
            fontSize: 10,
            color: 'var(--ink-40)',
          }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <Chip>↑</Chip>
            <Chip>↓</Chip> select
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <Chip>↵</Chip> open
          </span>
          <span style={{ flex: 1 }} />
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Chip>⌘</Chip>
            <Chip>K</Chip>
          </span>
        </div>
      </div>
    </div>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: '10px 16px 4px',
        fontSize: 9.5,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        color: 'var(--ink-40)',
        fontFamily: 'JetBrains Mono, ui-monospace, monospace',
        userSelect: 'none',
      }}
    >
      {children}
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="mono"
      style={{
        display: 'inline-grid',
        placeItems: 'center',
        minWidth: 20,
        height: 20,
        padding: '0 6px',
        fontSize: 10,
        letterSpacing: '0.04em',
        color: 'var(--ink-60)',
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 6,
      }}
    >
      {children}
    </span>
  );
}
