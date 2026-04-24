// ModelDropdown — floating glass panel with available models.
// All styling lives in globals.css (.d9-popover, .d9-menu-item, etc.);
// this file is now pure structure + behaviour. Visual tweaks happen
// in ONE place.

import { useEffect, useRef } from 'react';

import { D9IconCheck } from './icons';

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
    <div ref={ref} className="d9-root d9-popover" style={{ width: 300, ...style }}>
      <div className="d9-popover-label">Model</div>
      {items.length === 0 && (
        <div className="d9-popover-empty">Нет доступных моделей. Войди через онбординг.</div>
      )}
      {items.map((m) => {
        const active = m.id === activeId;
        const locked = m.availableOnCurrentPlan === false;
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
            <span className="d9-accent-square" style={{ marginLeft: 4 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="d9-menu-item-title">{m.displayName}</div>
              {(m.providerName || m.latencyMs || m.supportsVision) && (
                <div className="d9-menu-item-meta">
                  {m.providerName && <span>{m.providerName}</span>}
                  {m.providerName && m.latencyMs ? <span>·</span> : null}
                  {m.latencyMs && <span>{m.latencyMs} мс</span>}
                  {m.supportsVision && (
                    <>
                      <span>·</span>
                      <span>vision</span>
                    </>
                  )}
                </div>
              )}
            </div>
            {locked && <span className="d9-tag d9-tag-locked">pro</span>}
            {active && !locked && (
              <span style={{ color: 'var(--d9-accent-hi)', display: 'inline-flex' }}>
                <D9IconCheck size={12} />
              </span>
            )}
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
            style={{ fontSize: 11.5, color: 'var(--d9-ink-mute)' }}
          >
            Управление провайдерами →
          </button>
        </>
      )}
    </div>
  );
}
