import React, { useEffect, useState } from 'react';
import { monoFont } from './lib/styles';

// ── AI-cursor overlay ───────────────────────────────────────────────────
//
// Animated SVG cursor moves across the page on mode-change, simulating
// «AI thinking». Random target inside viewport — no click effect (this is
// pure animation hint). Mockup pattern: cursor + ai-pulse + ai-label.

export const AICursor: React.FC = () => {
  const [pos, setPos] = useState<{ x: number; y: number; visible: boolean }>({
    x: -100,
    y: -100,
    visible: false,
  });
  const [label, setLabel] = useState<string>('');

  useEffect(() => {
    // Trigger animation periodically — every 25-40s, simulating
    // proactive AI moves. Real WS-driven cursor — Phase 5 (Notes).
    const tick = () => {
      const targetX = 60 + Math.random() * (window.innerWidth - 200);
      const targetY = 120 + Math.random() * (window.innerHeight - 280);
      const labels = [
        'updating fork-snapshot',
        'rerolling next action',
        'syncing radar scores',
        'rescoring activity',
      ];
      setLabel(labels[Math.floor(Math.random() * labels.length)]);
      setPos({ x: targetX, y: targetY, visible: true });
      setTimeout(() => setPos((p) => ({ ...p, visible: false })), 2400);
    };
    const id = setInterval(tick, 30_000);
    // First show after 4s — initial "AI is awake" hint.
    const first = setTimeout(tick, 4000);
    return () => {
      clearInterval(id);
      clearTimeout(first);
    };
  }, []);

  return (
    <div
      aria-hidden
      style={{
        position: 'fixed',
        left: pos.x,
        top: pos.y,
        pointerEvents: 'none',
        opacity: pos.visible ? 1 : 0,
        transition: 'opacity var(--motion-dur-medium) var(--motion-ease-standard), left 1100ms var(--motion-ease-standard), top 1100ms var(--motion-ease-standard)',
        zIndex: 50,
      }}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="rgba(255,255,255,0.85)">
        <path d="M3 2 L11 17 L13 11 L20 9 Z" />
      </svg>
      <span
        style={{
          position: 'absolute',
          top: 22,
          left: 14,
          fontSize: 10,
          fontFamily: monoFont,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          background: 'rgba(255,255,255,0.92)',
          color: '#000',
          padding: '3px 7px',
          borderRadius: 4,
          whiteSpace: 'nowrap',
        }}
      >
        ai · {label}
      </span>
    </div>
  );
};
