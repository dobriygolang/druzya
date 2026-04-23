// XPRain — falling cyan dashes evoking "experience pouring in"
// (Wave-10, design-review v4 shared component #4).
//
// Pure CSS animation, zero JS per-frame work — 30 absolutely-positioned
// 1px tall <span>s with their own animation-delay/duration so the pattern
// looks organic. Reduced-motion users see static dashes (browser disables
// the keyframe).
//
// Use ONLY for win+normal; win+promote owns confetti and would over-stack.

import { useMemo } from 'react'

export type XPRainProps = {
  /** Opacity multiplier 0..1; default 0.6 keeps it ambient. */
  intensity?: number
  /** Number of falling streaks. */
  count?: number
}

export function XPRain({ intensity = 0.6, count = 30 }: XPRainProps) {
  // Pre-compute random positions so they don't reshuffle each render.
  const drops = useMemo(
    () =>
      Array.from({ length: count }, () => ({
        left: Math.random() * 100,
        delay: Math.random() * 3.5,
        len: 10 + Math.random() * 14,
        dur: 2.2 + Math.random() * 1.3,
      })),
    [count],
  )
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden" style={{ opacity: intensity }} aria-hidden="true">
      {drops.map((d, i) => (
        <span
          key={i}
          className="xp-drop"
          style={{
            left: `${d.left}%`,
            animationDelay: `${d.delay}s`,
            animationDuration: `${d.dur}s`,
            height: `${d.len}px`,
          }}
        />
      ))}
      <style>{`
        .xp-drop {
          position: absolute;
          top: -20px;
          width: 1px;
          background: linear-gradient(to bottom, transparent, rgb(var(--color-cyan) / .7), transparent);
          animation-name: xpdrop;
          animation-iteration-count: infinite;
          animation-timing-function: linear;
        }
        @keyframes xpdrop {
          from { transform: translateY(0); }
          to   { transform: translateY(110vh); }
        }
        @media (prefers-reduced-motion: reduce) {
          .xp-drop { animation: none !important; }
        }
      `}</style>
    </div>
  )
}
