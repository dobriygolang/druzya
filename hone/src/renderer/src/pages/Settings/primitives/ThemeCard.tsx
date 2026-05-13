import { CanvasBg, type ThemeId } from '../../../components/CanvasBg';
import { labelFor } from '../lib/settings-store';

export function ThemeCard({
  id,
  active,
  onPick,
}: {
  id: ThemeId;
  active: boolean;
  onPick: () => void;
}) {
  return (
    <button
      onClick={onPick}
      role="radio"
      aria-checked={active}
      aria-pressed={active}
      aria-label={`Theme: ${labelFor(id)}`}
      className="surface lift"
      style={{
        position: 'relative',
        padding: 0,
        height: 120,
        borderRadius: 10,
        overflow: 'hidden',
        cursor: 'pointer',
        background: '#000',
        border: active ? '1px solid rgba(255,255,255,0.55)' : '1px solid rgba(255,255,255,0.08)',
        boxShadow: active
          ? '0 0 0 3px rgba(255,255,255,0.08), 0 8px 28px -10px rgba(255,255,255,0.18)'
          : '0 4px 14px -8px rgba(0,0,0,0.6)',
        textAlign: 'left',
      }}
    >
      <div style={{ position: 'absolute', inset: 0 }}>
        {/* Live mini-preview — one pass through CanvasBg, scaled down via container */}
        <div style={{ position: 'absolute', inset: 0 }}>
          <CanvasBg theme={id} mode="full" />
        </div>
        {/* Bottom-fade label */}
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            padding: '20px 12px 10px',
            background: 'linear-gradient(to top, rgba(0,0,0,0.85), transparent)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span
            className="mono"
            style={{
              fontSize: 10,
              letterSpacing: '0.08em',
              color: active ? 'var(--ink)' : 'var(--ink-60)',
              textTransform: 'uppercase',
            }}
          >
            {labelFor(id)}
          </span>
          {active && (
            <span
              className="mono"
              style={{
                fontSize: 9,
                letterSpacing: '0.08em',
                color: 'var(--ink)',
                padding: '2px 6px',
                borderRadius: 4,
                background: 'rgba(255,255,255,0.12)',
              }}
            >
              ACTIVE
            </span>
          )}
        </div>
      </div>
    </button>
  );
}
