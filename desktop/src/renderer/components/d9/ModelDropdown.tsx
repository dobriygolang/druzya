// ModelDropdown — inline floating glass panel with available providers /
// models, rendered next to the compact window's model pill. Mirrors the
// shape and dismiss behaviour of PersonaDropdown so both picker flows
// feel identical.
//
// Design reference: the compact picker is a sibling of the persona
// dropdown, opened to the left of the compact window. Full provider
// management (keys, toggles) still lives in the ProviderPicker modal
// inside the expanded window; this dropdown is a quick-switch affordance.

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
        Model
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
          Нет доступных моделей. Войди через онбординг.
        </div>
      )}
      {items.map((m) => {
        const active = m.id === activeId;
        const locked = m.availableOnCurrentPlan === false;
        return (
          <button
            key={m.id}
            type="button"
            disabled={locked}
            onClick={() => !locked && onSelect(m.id)}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '8px 10px',
              borderRadius: 9,
              border: 0,
              background: active ? 'oklch(1 0 0 / 0.06)' : 'transparent',
              cursor: locked ? 'not-allowed' : 'pointer',
              textAlign: 'left',
              opacity: locked ? 0.55 : 1,
              fontFamily: 'inherit',
            }}
            onMouseEnter={(e) => {
              if (!active && !locked) e.currentTarget.style.background = 'oklch(1 0 0 / 0.04)';
            }}
            onMouseLeave={(e) => {
              if (!active && !locked) e.currentTarget.style.background = 'transparent';
            }}
          >
            <span
              style={{
                width: 5,
                height: 5,
                borderRadius: 1,
                background: 'var(--d9-accent)',
                boxShadow: '0 0 6px var(--d9-accent-glow)',
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
                {m.displayName}
              </div>
              {(m.providerName || m.latencyMs || m.supportsVision) && (
                <div
                  style={{
                    fontSize: 10.5,
                    color: 'var(--d9-ink-mute)',
                    fontFamily: 'var(--d9-font-mono)',
                    display: 'flex',
                    gap: 6,
                    marginTop: 1,
                  }}
                >
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
            {locked && (
              <span
                style={{
                  fontSize: 9.5,
                  fontFamily: 'var(--d9-font-mono)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  padding: '2px 7px',
                  borderRadius: 999,
                  background: 'var(--d9-accent-glow)',
                  color: 'var(--d9-accent-hi)',
                  border: '0.5px solid oklch(0.72 0.23 300 / 0.35)',
                }}
              >
                pro
              </span>
            )}
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
          <div style={{ height: 0.5, background: 'var(--d9-hairline)', margin: '4px 8px' }} />
          <button
            type="button"
            onClick={onManage}
            style={{
              width: '100%',
              padding: '8px 10px',
              borderRadius: 9,
              border: 0,
              background: 'transparent',
              cursor: 'pointer',
              textAlign: 'left',
              fontSize: 11.5,
              color: 'var(--d9-ink-mute)',
              letterSpacing: '-0.005em',
              fontFamily: 'inherit',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'oklch(1 0 0 / 0.04)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            Управление провайдерами →
          </button>
        </>
      )}
    </div>
  );
}
