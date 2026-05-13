// CommandPalette — Spotlight/Cluely-style ⌘K popup со списком actions.
//
// UX:
//   - ⌘K (или ⌃K на Linux/Win) открывает поверх expanded окна.
//   - Input на верху, list filterable по substring (case-insensitive).
//   - ↑/↓ navigate, Enter execute, Esc close.
//   - Click outside — close.
//
// Контракт: список Action'ов передаётся снаружи (актуальные действия
// зависят от контекста — есть ли messages, есть ли live session etc.
// Логика filtering universal'на).
//
// Цель — ускорить power-user flow + дать discoverability фичей которые
// раньше прятались за глубокими меню (Export MD, Save to Hone, etc).

import { useEffect, useMemo, useRef, useState } from 'react';

import { Modal } from './primitives/Modal';

export interface Action {
  id: string;
  label: string;
  hint?: string;
  /** Optional shortcut display (e.g. "⌘⇧S"). */
  shortcut?: string;
  run: () => void;
}

export function CommandPalette({
  actions,
  open,
  onClose,
}: {
  actions: Action[];
  open: boolean;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Reset query на каждый open чтобы юзер не видел stale текст.
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActiveIdx(0);
    // Microtask focus — ждём до того как modal действительно в DOM.
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  // Filtered list. Простой substring match по label + hint. Для 10-20
  // actions достаточно; fuzzy-match не нужен.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return actions;
    return actions.filter((a) =>
      a.label.toLowerCase().includes(q) ||
      (a.hint || '').toLowerCase().includes(q),
    );
  }, [actions, query]);

  // Reset active index когда filter меняется чтобы не оказаться на
  // out-of-bound элементе.
  useEffect(() => {
    setActiveIdx(0);
  }, [query]);

  // ↑/↓/Enter handled inline on the wrapper. ESC is owned by Modal primitive
  // (no need to duplicate). Input doesn't trap arrows so keyboard nav works
  // while the user is typing.
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(filtered.length - 1, i + 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(0, i - 1));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const action = filtered[activeIdx];
      if (action) {
        onClose();
        // Defer to next tick чтобы closing-animation не conflict'нул
        // с open'ом dialog'ов внутри action'а (Persona picker и т.п.).
        setTimeout(() => action.run(), 0);
      }
    }
  };

  return (
    <Modal open={open} onClose={onClose} size="md" initialFocusRef={inputRef as React.RefObject<HTMLElement>}>
      <div
        onKeyDown={onKey}
        style={{
          display: 'flex',
          flexDirection: 'column',
          maxHeight: '56vh',
          minHeight: 220,
          // Negative margin to bleed against Modal's padding so input + footer
          // span the full card width like the original spotlight design.
          margin: 'calc(var(--pad-container) * -1)',
        }}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Команда или поиск…"
          aria-label="Команда или поиск"
          style={{
            padding: '14px 18px',
            background: 'transparent',
            border: 0,
            borderBottom: '1px solid var(--d9-hairline)',
            color: 'var(--d9-ink)',
            fontSize: 14,
            fontFamily: 'inherit',
            outline: 'none',
          }}
        />
        <div
          ref={listRef}
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: 6,
          }}
        >
          {filtered.length === 0 ? (
            <div
              style={{
                padding: '22px 18px',
                textAlign: 'center',
                fontSize: 12,
                color: 'var(--d9-ink-mute)',
              }}
            >
              Ничего не найдено
            </div>
          ) : (
            filtered.map((a, i) => (
              <div
                key={a.id}
                role="button"
                aria-current={i === activeIdx ? 'true' : undefined}
                onClick={() => {
                  onClose();
                  setTimeout(() => a.run(), 0);
                }}
                onMouseEnter={() => setActiveIdx(i)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '9px 12px',
                  borderRadius: 'var(--radius-inner, 8px)',
                  cursor: 'pointer',
                  background: i === activeIdx ? 'var(--d9-hairline)' : 'transparent',
                  transition: 'background-color var(--motion-dur-small) var(--motion-ease-standard)',
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 13,
                      color: 'var(--d9-ink)',
                      letterSpacing: '-0.005em',
                    }}
                  >
                    {a.label}
                  </div>
                  {a.hint && (
                    <div
                      style={{
                        fontSize: 11,
                        color: 'var(--d9-ink-mute)',
                        marginTop: 2,
                        letterSpacing: '-0.005em',
                      }}
                    >
                      {a.hint}
                    </div>
                  )}
                </div>
                {a.shortcut && (
                  <span
                    style={{
                      fontFamily: 'var(--d9-font-mono)',
                      fontSize: 10,
                      color: 'var(--d9-ink-ghost)',
                      letterSpacing: '0.08em',
                    }}
                  >
                    {a.shortcut}
                  </span>
                )}
              </div>
            ))
          )}
        </div>
        <div
          style={{
            padding: '10px 16px',
            borderTop: '1px solid var(--d9-hairline)',
            fontSize: 10,
            fontFamily: 'var(--d9-font-mono)',
            color: 'var(--d9-ink-ghost)',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            display: 'flex',
            gap: 14,
            flexWrap: 'wrap',
          }}
        >
          <span>↑↓ NAV</span>
          <span>↵ RUN</span>
          <span>ESC CLOSE</span>
        </div>
      </div>
    </Modal>
  );
}
