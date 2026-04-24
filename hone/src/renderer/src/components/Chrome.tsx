// Chrome — persistent corner widgets.
//
//   Wordmark  — HONE top-left, always.
//   Versionmark — top-right: either the "1010 / v.0.0.1" pair on home, or
//                 an ESC hint back to home on any sub-page. The two are
//                 the same slot because the corner should never visually
//                 shift when the user navigates.
import { Kbd } from './primitives/Kbd';

export function Wordmark() {
  return (
    <div
      style={{ position: 'absolute', top: 28, left: 32, zIndex: 10 }}
      className="no-select"
    >
      <div
        className="mono"
        style={{
          fontSize: 14,
          fontWeight: 700,
          letterSpacing: '0.32em',
          color: 'var(--ink)',
          paddingBottom: 6,
          borderBottom: '1px solid rgba(255,255,255,0.5)',
          display: 'inline-block',
        }}
      >
        HONE
      </div>
    </div>
  );
}

interface VersionmarkProps {
  escHint: boolean;
  onEsc: () => void;
}

export function Versionmark({ escHint, onEsc }: VersionmarkProps) {
  return (
    <div
      style={{ position: 'absolute', top: 28, right: 32, zIndex: 10, textAlign: 'right' }}
      className="no-select"
    >
      {escHint ? (
        <button
          onClick={onEsc}
          className="focus-ring mono"
          style={{
            fontSize: 10,
            color: 'var(--ink-40)',
            letterSpacing: '.18em',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--ink-90)')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--ink-40)')}
        >
          <Kbd>esc</Kbd> HOME
        </button>
      ) : (
        <>
          <div
            className="mono"
            style={{
              fontSize: 10,
              color: 'var(--ink-40)',
              letterSpacing: '0.26em',
              lineHeight: 1,
            }}
          >
            1010
          </div>
          <div
            className="mono"
            style={{ fontSize: 10, color: 'var(--ink-40)', letterSpacing: '0.14em', marginTop: 6 }}
          >
            v.0.0.1
          </div>
        </>
      )}
    </div>
  );
}
