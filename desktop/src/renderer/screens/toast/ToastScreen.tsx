// ToastScreen — lives inside the 'toast' BrowserWindow (main/windows/
// window-manager.ts showToast). Reads `msg` + `kind` from the URL
// fragment query — main passes them in when calling loadURL so the
// content renders on first paint without an extra IPC round-trip.
//
// The window is small (360×90), frameless, transparent, alwaysOnTop,
// not focusable. Clicking the toast dismisses it immediately.
//
// Auto-dismiss timer lives on the main side (showToast schedules the
// hideWindow). The renderer just animates a progress-bar to show time
// remaining; if the user lingers, the main timer fires first.

import { useEffect, useState } from 'react';

type Kind = 'error' | 'warn' | 'info';

interface Params {
  msg: string;
  kind: Kind;
}

function readParams(): Params {
  // Hash is "#/toast?msg=...&kind=..."
  const h = window.location.hash;
  const qIdx = h.indexOf('?');
  const params = new URLSearchParams(qIdx >= 0 ? h.slice(qIdx + 1) : '');
  const kind = (params.get('kind') as Kind | null) ?? 'info';
  return {
    msg: params.get('msg') ?? '',
    kind: kind === 'error' || kind === 'warn' || kind === 'info' ? kind : 'info',
  };
}

export function ToastScreen() {
  const [params, setParams] = useState<Params>(() => readParams());

  useEffect(() => {
    const onHash = () => setParams(readParams());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const accent =
    params.kind === 'error'
      ? 'var(--d9-err)'
      : params.kind === 'warn'
      ? 'var(--d9-warn)'
      : 'var(--d9-accent-hi)';

  const iconChar = params.kind === 'error' ? '!' : params.kind === 'warn' ? '!' : 'i';

  return (
    <div
      className="d9-root"
      onClick={() => { void window.druz9.toast.dismiss(); }}
      style={{
        width: '100%',
        height: '100%',
        padding: 4,
        cursor: 'pointer',
      }}
    >
      <div
        style={{
          width: '100%',
          height: '100%',
          borderRadius: 12,
          background:
            'linear-gradient(180deg, oklch(0.16 0.04 278 / 0.92), oklch(0.12 0.035 278 / 0.96))',
          backdropFilter: 'var(--d9-glass-blur)',
          WebkitBackdropFilter: 'var(--d9-glass-blur)' as unknown as string,
          border: '0.5px solid var(--d9-hairline-b)',
          boxShadow: 'var(--d9-shadow-pop)',
          color: 'var(--d9-ink)',
          display: 'flex',
          alignItems: 'stretch',
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        {/* Left accent bar tinted by kind */}
        <div
          style={{
            width: 3,
            background: accent,
            boxShadow: `0 0 12px ${accent}`,
          }}
        />
        {/* Icon + message body */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '10px 12px',
            minWidth: 0,
          }}
        >
          <div
            style={{
              width: 22,
              height: 22,
              flex: 'none',
              borderRadius: '50%',
              background: accent,
              color: 'var(--d9-obsidian)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: 'var(--d9-font-sans)',
              fontWeight: 800,
              fontSize: 13,
              boxShadow: `0 0 10px ${accent}`,
            }}
          >
            {iconChar}
          </div>
          <div
            style={{
              flex: 1,
              minWidth: 0,
              fontSize: 12.5,
              lineHeight: 1.4,
              letterSpacing: '-0.005em',
              color: 'var(--d9-ink)',
              display: '-webkit-box',
              WebkitLineClamp: 3,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {params.msg}
          </div>
          <span
            style={{
              fontSize: 10,
              fontFamily: 'var(--d9-font-mono)',
              letterSpacing: '0.06em',
              color: 'var(--d9-ink-ghost)',
              textTransform: 'uppercase',
              flex: 'none',
            }}
          >
            click to close
          </span>
        </div>
      </div>
    </div>
  );
}
