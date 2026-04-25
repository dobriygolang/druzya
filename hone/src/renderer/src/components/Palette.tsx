// Palette — the ⌘K command surface. Filter-by-prefix over a static set of
// actions; Enter runs the highlighted item, Arrow keys move the highlight,
// Escape closes. Nothing here is async — the whole thing is a router with
// a text filter, intentionally not a fuzzy search.
//
// `items` is kept inline (not a prop) because the set is the product's
// surface area; if a new destination needs to appear in the palette, the
// right change is here, not at the call site.
import { useEffect, useMemo, useRef, useState } from 'react';

import { Kbd } from './primitives/Kbd';

export type PageId =
  | 'home'
  | 'today'
  | 'notes'
  | 'board'
  | 'stats'
  | 'podcasts'
  | 'editor'
  | 'shared_boards'
  | 'events';
// PaletteAction — то, что палетка может попросить App'а сделать.
// Помимо переключения page и copilot'а, добавили `standup` —
// открывает модалку из 3 вопросов для daily-standup.
export type PaletteAction = PageId | 'copilot' | 'standup';

interface PaletteProps {
  onClose: () => void;
  onOpen: (id: PaletteAction) => void;
}

interface PaletteItem {
  id: string;
  label: string;
  sc: string;
  run: () => void;
}

export function Palette({ onClose, onOpen }: PaletteProps) {
  const [idx, setIdx] = useState(0);
  const [q, setQ] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const items: PaletteItem[] = useMemo(
    () => [
      { id: 'today', label: 'Today', sc: 'T', run: () => onOpen('today') },
      { id: 'notes', label: 'Notes', sc: 'N', run: () => onOpen('notes') },
      { id: 'board', label: 'Whiteboard', sc: 'D', run: () => onOpen('board') },
      { id: 'stats', label: 'Stats', sc: 'S', run: () => onOpen('stats') },
      { id: 'podcasts', label: 'Podcasts', sc: 'P', run: () => onOpen('podcasts') },
      { id: 'editor', label: 'Code rooms', sc: 'E', run: () => onOpen('editor') },
      { id: 'shared_boards', label: 'Shared boards', sc: 'B', run: () => onOpen('shared_boards') },
      { id: 'events', label: 'Events', sc: 'V', run: () => onOpen('events') },
      { id: 'standup', label: 'Daily standup', sc: '', run: () => onOpen('standup') },
      // "Open druz9.ru" is intentionally a no-op for now — in Phase 5b
      // we'll route through shell.openExternal via the preload bridge so
      // this hops the user's browser, not an in-app webview.
      { id: 'druz9', label: 'Open druz9.ru', sc: '⌘O', run: () => undefined },
      { id: 'ai', label: 'Ask AI', sc: '⌘⇧␣', run: () => onOpen('copilot') },
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
        background: 'rgba(0,0,0,0.8)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        display: 'flex',
        justifyContent: 'center',
        paddingTop: '14vh',
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 520,
          maxWidth: '90%',
          height: 'fit-content',
          background: 'rgba(8,8,8,0.92)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 14,
          overflow: 'hidden',
          boxShadow: '0 40px 100px -20px rgba(0,0,0,0.8)',
        }}
      >
        <div style={{ padding: '16px 18px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKey}
            placeholder="Type a command…"
            style={{ width: '100%', fontSize: 15, color: 'var(--ink)' }}
          />
        </div>
        <div style={{ padding: '8px 0' }}>
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
                style={{
                  width: '100%',
                  display: 'grid',
                  gridTemplateColumns: '1fr auto',
                  gap: 14,
                  alignItems: 'center',
                  padding: '11px 18px',
                  color: active ? 'var(--ink)' : 'var(--ink-60)',
                  background: active ? 'rgba(255,255,255,0.04)' : 'transparent',
                  fontSize: 14,
                }}
              >
                <span style={{ textAlign: 'left', display: 'inline-flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ color: 'var(--ink-40)', fontSize: 12 }}>›</span>
                  {it.label}
                </span>
                <Kbd>{it.sc}</Kbd>
              </button>
            );
          })}
          {filtered.length === 0 && (
            <div style={{ padding: '22px 18px', color: 'var(--ink-40)', fontSize: 13 }}>
              No matches.
            </div>
          )}
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            padding: '10px 18px',
            borderTop: '1px solid rgba(255,255,255,0.06)',
            fontSize: 11,
            color: 'var(--ink-40)',
          }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> select
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Kbd>↵</Kbd> open
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Kbd>esc</Kbd> close
          </span>
        </div>
      </div>
    </div>
  );
}
