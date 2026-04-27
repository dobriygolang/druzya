// PersonaDropdown — quick-switch panel for expert-mode persona.
// Mirrors ModelDropdown 1:1 — same .d9-popover + .d9-menu-item classes,
// so visual changes to either happen in globals.css, not here.

import { useEffect, useRef } from 'react';


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
    <div ref={ref} className="d9-root d9-popover" style={{ width: 240, ...style }}>
      <div className="d9-popover-label">
        <span>PERSONA</span>
        <span className="d9-popover-label-esc">ESC</span>
      </div>
      {items.length === 0 && (
        <div className="d9-popover-empty">
          Personas не загружены
        </div>
      )}
      {items.map((p) => {
        const active = p.id === activeId;
        return (
          <button
            key={p.id}
            type="button"
            className="d9-menu-item"
            aria-selected={active}
            onClick={() => onSelect(p.id)}
          >
            <span className="d9-menu-item-marker" />
            <span className="d9-menu-item-title">{p.label}</span>
            {p.hotkey && (
              <span className="d9-menu-item-meta">⌥{p.hotkey}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
