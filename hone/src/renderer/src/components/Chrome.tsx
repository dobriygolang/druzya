// Chrome — persistent corner widgets.
//
//   Wordmark  — HONE top-left, always.
//   Versionmark — top-right: либо «druz9.online» на home (link, открывает
//                 web в системном браузере), либо ESC-hint назад на home
//                 на саб-страницах. Один и тот же слот: угол не должен
//                 визуально дёргаться при переходах.
import { Kbd } from './primitives/Kbd';

const WEB_HOST = 'druz9.online';

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
        <button
          onClick={() => {
            void window.hone?.shell.openExternal(`https://${WEB_HOST}`);
          }}
          className="mono focus-ring"
          style={{
            fontSize: 10,
            color: 'var(--ink-40)',
            letterSpacing: '0.18em',
            background: 'transparent',
            padding: 0,
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--ink-90)')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--ink-40)')}
        >
          {WEB_HOST}
        </button>
      )}
    </div>
  );
}
