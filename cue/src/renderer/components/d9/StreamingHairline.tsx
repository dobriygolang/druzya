// StreamingHairline — the animated violet ribbon that sweeps along the
// bottom of the compact window while the assistant is streaming. Lives
// outside the glass (absolute, bottom: 0) so it reads as an edge-lit
// glow rather than part of the surface.

import { useEffect } from 'react';

let injected = false;

export function StreamingHairline({ inset = 18 }: { inset?: number }) {
  useEffect(() => {
    if (injected || typeof document === 'undefined') return;
    if (document.getElementById('d9-stream-keyframes')) { injected = true; return; }
    const style = document.createElement('style');
    style.id = 'd9-stream-keyframes';
    style.textContent = `
      @keyframes d9stream {
        0%   { background-position: -50% 0; }
        100% { background-position: 150% 0; }
      }
    `;
    document.head.appendChild(style);
    injected = true;
  }, []);

  return (
    <div
      style={{
        position: 'absolute',
        left: inset,
        right: inset,
        bottom: 0,
        height: 1.5,
        background:
          'linear-gradient(90deg, transparent, var(--d9-accent-hi) 30%, var(--d9-accent) 50%, var(--d9-accent-hi) 70%, transparent)',
        backgroundSize: '200% 100%',
        animation: 'd9stream 1.8s linear infinite',
        borderRadius: 2,
        filter: 'blur(0.3px)',
        pointerEvents: 'none',
      }}
    />
  );
}
