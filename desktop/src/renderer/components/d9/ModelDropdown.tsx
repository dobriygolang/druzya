// ModelDropdown — floating glass panel with available models.
// All styling lives in globals.css (.d9-popover, .d9-menu-item, etc.);
// this file is now pure structure + behaviour. Visual tweaks happen
// in ONE place.

import { useEffect, useRef } from 'react';


export interface ModelDropdownItem {
  id: string;
  displayName: string;
  providerName?: string;
  latencyMs?: number;
  availableOnCurrentPlan?: boolean;
  supportsVision?: boolean;
}

interface Props {
  items: ModelDropdownItem[];
  activeId?: string;
  onSelect: (id: string) => void;
  onClose?: () => void;
  /** Called when user clicks "manage providers" footer link. */
  onManage?: () => void;
  style?: React.CSSProperties;
}

export function ModelDropdown({ items, activeId, onSelect, onClose, onManage, style }: Props) {
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
    <div ref={ref} className="d9-root d9-popover" style={{ width: 260, ...style }}>
      <div className="d9-popover-label">
        <span>MODEL</span>
        <span className="d9-popover-label-esc">ESC</span>
      </div>
      {items.length === 0 && (
        <div className="d9-popover-empty">Нет доступных моделей</div>
      )}
      {items.map((m) => {
        const active = m.id === activeId;
        const locked = m.availableOnCurrentPlan === false;
        const metaParts = [
          m.providerName,
          m.latencyMs ? `${m.latencyMs}ms` : null,
          m.supportsVision ? 'vision' : null,
        ].filter(Boolean).join(' · ');
        return (
          <button
            key={m.id}
            type="button"
            className="d9-menu-item"
            aria-selected={active}
            aria-disabled={locked}
            disabled={locked}
            onClick={() => !locked && onSelect(m.id)}
          >
            <span className="d9-menu-item-marker" />
            <span className="d9-menu-item-title">{m.displayName}</span>
            {locked && <span className="d9-tag d9-tag-locked">pro</span>}
            {metaParts && <span className="d9-menu-item-meta">{metaParts}</span>}
          </button>
        );
      })}
      {onManage && (
        <>
          <div className="d9-popover-divider" />
          <button
            type="button"
            className="d9-menu-item"
            onClick={onManage}
          >
            <span className="d9-menu-item-marker" />
            <span className="d9-menu-item-title" style={{ textTransform: 'none', letterSpacing: 0 }}>
              Управление провайдерами →
            </span>
          </button>
        </>
      )}
    </div>
  );
}
