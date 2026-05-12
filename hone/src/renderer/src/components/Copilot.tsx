// Copilot — MOCK stealth-style overlay kept in Hone for design continuity.
//
// Important: the actual stealth/invisible-to-screen-share product is
// the sibling `cue/` app. This component is a
// visual affordance inside Hone that hints the ecosystem — when the
// user presses ⌘⇧Space, they see what a copilot call *looks* like. It
// does NOT implement stealth at the window-layer here — Hone is a
// normal dock-first window by design.
//
// A Phase 5c cleanup will extract this into a promo widget or a
// deep-link into Cue; for now it's the same mock the design artifact
// shipped with so we can iterate on the overall feel.
import { useEffect, useState } from 'react';

import { Icon } from './primitives/Icon';
import { motion as motionTokens } from '../lib/design-tokens';

interface CopilotProps {
  onClose: () => void;
}

const LINES = [
  'The hot path allocates a new slice every call inside the inner loop.',
  'Each append past capacity triggers a grow+copy — O(n²).',
  '',
  'Two fixes, cheapest first:',
  '  items := make([]Item, 0, len(src))',
  '  move allocation outside the loop; reuse the buffer.',
  '',
  'Second: json.Marshal re-reflects the struct every call.',
  'Cache a *jsoniter.Encoder — 3-4× faster on stable shapes.',
];

export function Copilot({ onClose }: CopilotProps) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (shown >= LINES.length) return;
    // Step cadence between lines — small motion token (160ms) keeps the
    // typewriter beat steady without feeling sluggish.
    const t = setTimeout(() => setShown((s) => s + 1), motionTokens.dur.small);
    return () => clearTimeout(t);
  }, [shown]);

  return (
    <div
      className="fadein"
      style={{
        position: 'absolute',
        top: 72,
        right: 22,
        width: 420,
        zIndex: 55,
        background: 'rgba(8, 8, 8, 0.88)',
        border: '1px solid var(--hair)',
        borderRadius: 'var(--radius-outer)',
        backdropFilter: 'blur(24px) saturate(1.2)',
        WebkitBackdropFilter: 'blur(24px) saturate(1.2)',
        overflow: 'hidden',
        boxShadow: '0 30px 80px -10px rgba(0, 0, 0, 0.7)',
      }}
    >
      {/* Live-indicator row: canonical red dot + ink-ramp text, no green hue. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--gap-row)',
          padding: '8px 14px',
          fontSize: 10.5,
          color: 'var(--ink-90)',
          background: 'var(--hair)',
          borderBottom: '1px solid var(--hair-2)',
        }}
        className="mono"
      >
        <span
          style={{
            width: 5,
            height: 5,
            borderRadius: 99,
            background: 'var(--red)',
          }}
          className="red-pulse"
        />
        <span style={{ letterSpacing: '0.08em' }}>HIDDEN FROM SCREEN SHARE</span>
        <button
          onClick={onClose}
          aria-label="dismiss copilot"
          style={{
            marginLeft: 'auto',
            color: 'var(--ink-40)',
            background: 'transparent',
            border: 0,
            cursor: 'pointer',
            padding: 2,
          }}
        >
          <Icon name="x" size={11} />
        </button>
      </div>
      <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--hair)' }}>
        <div
          className="mono"
          style={{ fontSize: 10, letterSpacing: '0.08em', color: 'var(--ink-40)', marginBottom: 4 }}
        >
          Q
        </div>
        <div style={{ fontSize: 14, color: 'var(--ink)' }}>Why is this code slow?</div>
      </div>
      <div style={{ padding: '12px 16px 16px' }}>
        <div
          className="mono"
          style={{ fontSize: 10, letterSpacing: '0.08em', color: 'var(--ink-40)', marginBottom: 6 }}
        >
          A
        </div>
        <div style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--ink-90)' }}>
          {LINES.slice(0, shown).map((line, i) => {
            if (line === '') return <div key={i} style={{ height: 6 }} />;
            const isCode =
              line.includes(':=') || line.trim().startsWith('items') || line.includes('Encoder');
            return (
              <div
                key={i}
                className={isCode ? 'mono' : ''}
                style={{
                  margin: '2px 0',
                  fontSize: isCode ? 12 : 13,
                  color: isCode ? 'var(--ink)' : 'var(--ink-90)',
                }}
              >
                {line}
              </div>
            );
          })}
          {shown < LINES.length && <span className="caret" />}
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '9px 14px',
          borderTop: '1px solid var(--hair)',
          fontSize: 10.5,
          color: 'var(--ink-40)',
          letterSpacing: '0.08em',
        }}
        className="mono"
      >
        <span>esc dismiss</span>
        <span style={{ opacity: 0.4 }}>·</span>
        <span>⌘⇧S screenshot again</span>
      </div>
    </div>
  );
}
