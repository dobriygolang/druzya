// StatusDot — idle / ready / thinking / streaming / error indicator.
// The pulse ring animates only for thinking + streaming; idle/ready/error
// hold steady. Keyframes `d9pulse` are declared below — once.

import { Fragment } from 'react';

export type DotState = 'idle' | 'ready' | 'thinking' | 'streaming' | 'recording' | 'error';

const CFG: Record<DotState, { c: string; pulse: boolean }> = {
  idle:      { c: 'var(--d9-ink-mute)',   pulse: false },
  ready:     { c: 'var(--d9-ok)',         pulse: false },
  thinking:  { c: 'var(--d9-accent)',     pulse: true  },
  streaming: { c: 'var(--d9-accent-hi)',  pulse: true  },
  recording: { c: 'var(--d9-err)',        pulse: true  },
  error:     { c: 'var(--d9-err)',        pulse: false },
};

let keyframesInjected = false;
function injectKeyframes() {
  if (keyframesInjected || typeof document === 'undefined') return;
  const id = 'd9-status-keyframes';
  if (document.getElementById(id)) { keyframesInjected = true; return; }
  const style = document.createElement('style');
  style.id = id;
  style.textContent = `
    @keyframes d9pulse {
      0%   { transform: scale(1);   opacity: 0.5; }
      100% { transform: scale(1.9); opacity: 0;   }
    }
    @keyframes d9stream {
      0%   { background-position: -50% 0; }
      100% { background-position:  150% 0; }
    }
  `;
  document.head.appendChild(style);
  keyframesInjected = true;
}

export function StatusDot({ state = 'idle', size = 6 }: { state?: DotState; size?: number }) {
  injectKeyframes();
  const cfg = CFG[state];
  return (
    <span
      style={{
        position: 'relative',
        width: size,
        height: size,
        borderRadius: '50%',
        background: cfg.c,
        boxShadow: `0 0 6px ${cfg.c}`,
        flex: 'none',
      }}
    >
      {cfg.pulse && (
        <Fragment>
          <span
            style={{
              position: 'absolute',
              inset: -3,
              borderRadius: '50%',
              border: `1px solid ${cfg.c}`,
              opacity: 0.5,
              animation: 'd9pulse 1.4s ease-out infinite',
            }}
          />
        </Fragment>
      )}
    </span>
  );
}
