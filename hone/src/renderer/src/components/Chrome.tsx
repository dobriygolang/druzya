// Chrome — persistent corner widgets.
//
//   Wordmark   — HONE top-left, always.
//   Versionmark — top-right druz9.online link. Always shown (no esc-hint
//                 variant; the hotkey-toggle pattern in App.tsx handles
//                 navigation back to home without a visible button).
//
// Wordmark uses pointerEvents: 'none' so it doesn't intercept hover events
// from the TrafficLightsHover area underneath — otherwise macOS traffic
// lights flicker when the cursor crosses the logo.
const WEB_HOST = 'druz9.online';

export function Wordmark() {
  return (
    <div
      style={{
        position: 'absolute',
        // top: 28 ставил HONE ровно под нижним краем macOS traffic-light
        // кнопок (которые сидят y≈14-28) — когда юзер hover'ил угол,
        // визуально кнопки «приклеивались» к логотипу. 48 даёт ~20px
        // breathing room ниже зоны кнопок.
        top: 48,
        left: 32,
        zIndex: 10,
        pointerEvents: 'none',
      }}
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
          borderBottom: '1px solid var(--ink-60)',
          display: 'inline-block',
        }}
      >
        HONE
      </div>
    </div>
  );
}

interface VersionmarkProps {
  // Kept in the prop signature for backward compatibility with App.tsx; the
  // values are intentionally unused — the button is always the web link.
  escHint?: boolean;
  onEsc?: () => void;
}

export function Versionmark(_: VersionmarkProps) {
  return (
    <div
      style={{
        position: 'absolute',
        top: 28,
        right: 32,
        zIndex: 10,
        textAlign: 'right',
        // @ts-expect-error — Electron CSS extension
        WebkitAppRegion: 'no-drag',
      }}
      className="no-select"
    >
      <button
        onClick={() => {
          void window.hone?.shell.openExternal(`https://${WEB_HOST}`);
        }}
        className="mono focus-ring"
        style={{
          fontSize: 10,
          color: 'var(--ink-40)',
          letterSpacing: '0.08em',
          background: 'transparent',
          padding: 0,
        }}
        onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--ink-90)')}
        onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--ink-40)')}
      >
        {WEB_HOST}
      </button>
    </div>
  );
}
