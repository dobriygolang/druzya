// PersonaDropdown — quick-switch panel for expert-mode persona.
// Mirrors ModelDropdown 1:1 — same .d9-popover + .d9-menu-item classes,
// so visual changes to either happen in globals.css, not here.

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
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div ref={ref} className="d9-root d9-popover" style={{ width: 300, ...style }}>
      <div className="d9-popover-label">Persona</div>
      {items.length === 0 && (
        <div className="d9-popover-empty">
          Personas не загружены. Проверь соединение с backend.
        </div>
      )}
      {items.map((p) => {
        const grad = resolvePersonaGradient(p.id);
        const bg = p.background ?? undefined;
        const dotClass = bg ? 'd9-gradient-dot' : `d9-gradient-dot d9-grad-${grad}`;
        const active = p.id === activeId;
        return (
          <button
            key={p.id}
            type="button"
            className="d9-menu-item"
            aria-selected={active}
            onClick={() => onSelect(p.id)}
          >
            {/* Leading indicator — persona-gradient square, same slot as
                ModelDropdown's accent dot. Visual identity per persona
                without extra glyphs. */}
            <span
              className={dotClass}
              style={{ background: bg, marginLeft: 4 }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="d9-menu-item-title">{p.label}</div>
              {p.hint && <div className="d9-menu-item-meta">{p.hint}</div>}
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
