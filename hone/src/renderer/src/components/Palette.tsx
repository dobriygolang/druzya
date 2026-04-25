// Palette — the ⌘K command surface. Filter-by-prefix over a static set of
// actions; Enter runs the highlighted item, Arrow keys move the highlight,
// Escape closes. Nothing here is async — the whole thing is a router with
// a text filter, intentionally not a fuzzy search.
//
// `items` is kept inline (not a prop) because the set is the product's
// surface area; if a new destination needs to appear in the palette, the
// right change is here, not at the call site.
import { useEffect, useMemo, useRef, useState } from 'react';

import { Icon, type IconName } from './primitives/Icon';

export type PageId =
  | 'home'
  | 'today'
  | 'notes'
  | 'stats'
  | 'podcasts'
  | 'editor'
  | 'shared_boards' // единый boards-флоу (private/public — кому отдан URL)
  | 'events'
  | 'settings';
// PaletteAction — то, что палетка может попросить App'а сделать.
// `standup` — переходит на Today page (banner там сам решит показываться
// или нет, см. TodayStandupBanner). Раньше был отдельный overlay,
// теперь интегрирован morning-flow в Today.
export type PaletteAction = PageId | 'copilot' | 'standup';

interface PaletteProps {
  onClose: () => void;
  onOpen: (id: PaletteAction) => void;
}

interface PaletteItem {
  id: string;
  label: string;
  icon: IconName;
  shortcut: string[]; // массив букв; рендерим каждую отдельным «чипом»
  run: () => void;
}

export function Palette({ onClose, onOpen }: PaletteProps) {
  const [idx, setIdx] = useState(0);
  const [q, setQ] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const items: PaletteItem[] = useMemo(
    () => [
      { id: 'today', label: 'Today', icon: 'sun', shortcut: ['T'], run: () => onOpen('today') },
      { id: 'notes', label: 'Notes', icon: 'note', shortcut: ['N'], run: () => onOpen('notes') },
      // Boards = единый collaboration-surface (Excalidraw + Yjs + WS).
      // Каждая комната private до момента шаринга URL. Code rooms — тот
      // же концепт для кода. Hotkeys: D/B → Boards, E → Code rooms.
      {
        id: 'shared_boards',
        label: 'Boards · Code rooms',
        icon: 'grid',
        shortcut: ['D', 'B', 'E'],
        run: () => onOpen('shared_boards'),
      },
      { id: 'events', label: 'Events', icon: 'calendar', shortcut: ['V'], run: () => onOpen('events') },
      { id: 'podcasts', label: 'Podcasts', icon: 'headphones', shortcut: ['P'], run: () => onOpen('podcasts') },
      { id: 'stats', label: 'Stats', icon: 'bars', shortcut: ['S'], run: () => onOpen('stats') },
      // Daily standup теперь morning banner на Today page. Команда
      // оставлена в палетке — для тех кто привык её искать; ведёт на
      // Today, где banner появится при условии morning-window.
      { id: 'standup', label: 'Daily standup', icon: 'standup', shortcut: [], run: () => onOpen('standup') },
      { id: 'settings', label: 'Settings', icon: 'settings', shortcut: [','], run: () => onOpen('settings') },
    ],
    [onOpen],
  );

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? items.filter((i) => i.label.toLowerCase().includes(s)) : items;
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
        it.run();
        onClose();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

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
          width: 480,
          maxWidth: '92%',
          height: 'fit-content',
          background: 'rgba(12,12,12,0.96)',
          border: '1px solid rgba(255,255,255,0.07)',
          borderRadius: 14,
          overflow: 'hidden',
          boxShadow: '0 40px 100px -20px rgba(0,0,0,0.85)',
        }}
      >
        {/* search input */}
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
            <Icon name="search" size={14} />
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
              color: 'var(--ink)',
              background: 'transparent',
              border: 'none',
              outline: 'none',
            }}
          />
          <Chip>esc</Chip>
        </div>

        {/* items */}
        <div style={{ padding: '4px 0' }}>
          {filtered.map((it, i) => {
            const active = i === idx;
            return (
              <button
                key={it.id}
                onMouseEnter={() => setIdx(i)}
                onClick={() => {
                  it.run();
                  onClose();
                }}
                className="row"
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
                    color: active ? 'var(--ink)' : 'var(--ink-60)',
                    transition: 'color var(--t-fast), background-color var(--t-fast)',
                  }}
                >
                  <Icon name={it.icon} size={13} />
                </span>
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 500,
                    color: active ? 'var(--ink)' : 'var(--ink-90)',
                    transition: 'color var(--t-fast)',
                  }}
                >
                  {it.label}
                </span>
                <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                  {it.shortcut.map((k, ki) => (
                    <span
                      key={ki}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                    >
                      {ki > 0 && (
                        <span
                          style={{
                            color: 'var(--ink-40)',
                            fontSize: 9,
                            opacity: 0.6,
                          }}
                        >
                          ·
                        </span>
                      )}
                      <Chip>{k}</Chip>
                    </span>
                  ))}
                </span>
              </button>
            );
          })}
          {filtered.length === 0 && (
            <div style={{ padding: '18px 16px', color: 'var(--ink-40)', fontSize: 12 }}>
              No matches.
            </div>
          )}
        </div>

        {/* footer */}
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

// Chip — мини-кнопка в стиле macOS-keycap. Унифицированный размер +
// rounded-square форма как в Winter / Linear.
function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="mono"
      style={{
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
      }}
    >
      {children}
    </span>
  );
}
