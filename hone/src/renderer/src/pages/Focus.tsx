// Focus — the single "empty" page. Everything else on screen (dock,
// wordmark) fades out while this is active; see App.tsx for the gating.
// The big mono clock is deliberately not typography-tunable here —
// tweaks land in globals.css alongside the rest of the numeric scale.
import { Kbd } from '../components/primitives/Kbd';

interface FocusPageProps {
  remain: number; // seconds
}

export function FocusPage({ remain }: FocusPageProps) {
  const mm = String(Math.floor(remain / 60)).padStart(2, '0');
  const ss = String(remain % 60).padStart(2, '0');
  return (
    <div
      className="fadein"
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 36,
      }}
    >
      <div
        className="mono"
        style={{ fontSize: 11, letterSpacing: '0.24em', color: 'var(--ink-40)' }}
      >
        FOCUSING ON
      </div>
      <div style={{ fontSize: 15, color: 'var(--ink-90)', marginTop: -18 }}>
        Binary Tree Level Order Traversal
      </div>
      <div
        className="mono"
        style={{
          fontSize: 'clamp(120px, 18vw, 220px)',
          fontWeight: 200,
          letterSpacing: '-0.04em',
          color: 'var(--ink)',
          lineHeight: 1,
        }}
      >
        {mm}
        <span style={{ color: 'var(--ink-40)' }}>:</span>
        {ss}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span
          className="mono"
          style={{ fontSize: 11, color: 'var(--ink-40)', letterSpacing: '0.22em' }}
        >
          POMODORO 2 / 4
        </span>
        <span
          style={{ width: 6, height: 6, borderRadius: 99, background: 'var(--red)' }}
          className="red-pulse"
        />
        <span
          className="mono"
          style={{ fontSize: 11, color: 'var(--red)', letterSpacing: '0.22em' }}
        >
          LIVE
        </span>
      </div>

      <div
        className="mono no-select"
        style={{
          position: 'absolute',
          bottom: 44,
          fontSize: 11,
          color: 'var(--ink-40)',
          letterSpacing: '0.04em',
        }}
      >
        <Kbd>␣</Kbd> pause <span style={{ opacity: 0.4, padding: '0 10px' }}>·</span>
        <Kbd>S</Kbd> stop <span style={{ opacity: 0.4, padding: '0 10px' }}>·</span>
        <Kbd>esc</Kbd> exit
      </div>
    </div>
  );
}
