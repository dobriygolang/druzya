// PersonaDropdown — quick-switch panel for expert-mode persona.
// Visually mirrors ModelDropdown 1:1 so both picker flows feel
// identical (same width, padding, item rows, hover states). Only
// difference: the leading indicator is a persona-gradient dot
// instead of a flat accent square — gradient encodes which persona
// without extra text.

import { useEffect, useRef } from 'react';

import { D9IconCheck } from './icons';
import { Kbd } from './Kbd';
import { resolvePersonaGradient } from './BrandMark';

export interface PersonaDropdownItem {
  id: string;
  label: string;
  hint?: string;
  hotkey?: string;
  /** Server-driven raw gradient; takes precedence over id-based lookup. */
  background?: string;
}

interface Props {
  items: PersonaDropdownItem[];
  activeId?: string;
  onSelect: (id: string) => void;
  onClose?: () => void;
  style?: React.CSSProperties;
}

export function PersonaDropdown({ items, activeId, onSelect, onClose, style }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!onClose) return;
    const onDocClick = (e: MouseEvent) => {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="d9-root"
      style={{
        width: 300,
        borderRadius: 14,
        background:
          'linear-gradient(180deg, oklch(0.18 0.04 278 / calc(var(--d9-window-alpha) * 1.05)), oklch(0.13 0.035 278 / calc(var(--d9-window-alpha) * 1.1)))',
        backdropFilter: 'var(--d9-glass-blur)',
        WebkitBackdropFilter: 'var(--d9-glass-blur)' as unknown as string,
        boxShadow: 'var(--d9-shadow-pop)',
        padding: 6,
        ...style,
        WebkitAppRegion: 'no-drag',
      } as React.CSSProperties}
    >
      <div
        style={{
          padding: '8px 10px 6px',
          fontSize: 10,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'var(--d9-ink-ghost)',
          fontFamily: 'var(--d9-font-mono)',
        }}
      >
        Persona
      </div>
      {items.length === 0 && (
        <div
          style={{
            padding: '10px 10px 12px',
            fontSize: 12,
            color: 'var(--d9-ink-mute)',
            letterSpacing: '-0.005em',
          }}
        >
          Personas не загружены. Проверь соединение с backend.
        </div>
      )}
      {items.map((p) => {
        const grad = resolvePersonaGradient(p.id);
        const bg = p.background ?? undefined;
        const dotClass = bg ? undefined : `d9-grad-${grad}`;
        const active = p.id === activeId;
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => onSelect(p.id)}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '8px 10px',
              borderRadius: 9,
              border: 0,
              background: active ? 'oklch(1 0 0 / 0.06)' : 'transparent',
              cursor: 'pointer',
              textAlign: 'left',
              fontFamily: 'inherit',
            }}
            onMouseEnter={(e) => {
              if (!active) e.currentTarget.style.background = 'oklch(1 0 0 / 0.04)';
            }}
            onMouseLeave={(e) => {
              if (!active) e.currentTarget.style.background = 'transparent';
            }}
          >
            {/* Leading indicator — persona-gradient square, same slot as
                ModelDropdown's accent dot. Small + crisp, no "9" glyph
                cluttering the row. */}
            <span
              className={dotClass}
              style={{
                width: 12,
                height: 12,
                borderRadius: 3,
                background: bg,
                boxShadow:
                  'inset 0 0.5px 0 rgba(255,255,255,0.3), 0 0 8px -2px currentColor',
                flex: 'none',
                marginLeft: 4,
              }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 12.5,
                  color: 'var(--d9-ink)',
                  fontWeight: 500,
                  letterSpacing: '-0.005em',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {p.label}
              </div>
              {p.hint && (
                <div
                  style={{
                    fontSize: 10.5,
                    color: 'var(--d9-ink-mute)',
                    fontFamily: 'var(--d9-font-mono)',
                    marginTop: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {p.hint}
                </div>
              )}
            </div>
            {active && (
              <span style={{ color: 'var(--d9-accent-hi)', display: 'inline-flex' }}>
                <D9IconCheck size={12} />
              </span>
            )}
            {p.hotkey && <Kbd size="sm">⌥{p.hotkey}</Kbd>}
          </button>
        );
      })}
    </div>
  );
}
