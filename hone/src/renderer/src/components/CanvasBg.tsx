// CanvasBg — медитативный фон Hone'а.
//
// Layers (full-mode):
//   1. Grid 64×64 — едва видна, даёт «координатной бумаги» текстуру.
//   2. Stars (~32 штуки) — каждая «парит» (translate3d ±N px, period 12-30s)
//      и «мерцает» (opacity range, period 3-7s). Случайные delay'и
//      детерминированно сидятся от seed → один и тот же starfield между
//      перерисовками.
//   3. Waves — 5 SVG-полос, каждая со своей duration / delay / direction
//      drift'а. Пересекают друг друга в хаотичном ритме (никогда не
//      синхронизируются — duration'ы взаимно простые).
//
// Quiet-mode: только звёзды, opacity 0.35.
// Void-mode: ничего (Focus раньше; теперь в Hone Focus снят, но void
// оставлен для совместимости / будущих full-blank страниц).
import { useMemo } from 'react';

const GRID_STEP_PX = 64;

// Wave-конфиги. duration'ы выбраны так чтобы фазы разошлись:
// 17, 23, 29, 31, 37 секунд — все простые, цикл совмещения ~ 17·23·29·31·37 sec.
const WAVES = [
  { d: 'M-200,260 C 260,180 480,360 760,290 S 1240,220 1900,250', dur: '17s', delay: '0s', anim: 'wave-drift', op: 0.22, sw: 1 },
  { d: 'M-200,400 C 240,360 520,460 880,400 S 1320,320 1900,400', dur: '23s', delay: '-3s', anim: 'wave-tilt', op: 0.18, sw: 1 },
  { d: 'M-200,520 C 280,500 580,600 900,540 S 1380,440 1900,500', dur: '29s', delay: '-7s', anim: 'wave-drift', op: 0.20, sw: 1 },
  { d: 'M-200,640 C 320,610 660,720 980,660 S 1420,580 1900,620', dur: '31s', delay: '-11s', anim: 'wave-tilt', op: 0.16, sw: 1 },
  { d: 'M-200,760 C 360,740 700,800 1020,760 S 1460,720 1900,750', dur: '37s', delay: '-19s', anim: 'wave-drift', op: 0.14, sw: 1 },
];

export type CanvasMode = 'full' | 'quiet' | 'void';

interface CanvasBgProps {
  mode?: CanvasMode;
}

export function CanvasBg({ mode = 'full' }: CanvasBgProps) {
  // Детерминированный pseudo-random — звёзды не дёргаются между mount'ами
  // когда CanvasBg перерендеривается (а это происходит на каждой смене
  // page'а через canvasMode). useMemo + seeded RNG даёт стабильность.
  const stars = useMemo(() => makeStars(32, 1337), []);

  if (mode === 'void') return null;

  const starOpMul = mode === 'full' ? 1 : 0.35;
  const showWaves = mode === 'full';

  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
      {/* Grid */}
      {showWaves && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundImage:
              `linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px),` +
              `linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px)`,
            backgroundSize: `${GRID_STEP_PX}px ${GRID_STEP_PX}px`,
          }}
        />
      )}

      {/* Stars */}
      {stars.map((s, i) => (
        <span
          key={i}
          className="star"
          style={
            {
              left: `${s.x}%`,
              top: `${s.y}%`,
              width: s.size,
              height: s.size,
              opacity: s.baseOp * starOpMul,
              animation:
                `star-float ${s.floatDur}s ease-in-out ${s.floatDelay}s infinite,` +
                ` star-twinkle ${s.twinkleDur}s ease-in-out ${s.twinkleDelay}s infinite`,
              ['--star-dx' as string]: `${s.dx}px`,
              ['--star-dy' as string]: `${s.dy}px`,
              ['--star-base' as string]: `${s.baseOp * starOpMul}`,
            } as React.CSSProperties
          }
        />
      ))}

      {/* Waves */}
      {showWaves &&
        WAVES.map((w, i) => (
          <div
            key={i}
            className="wave-layer"
            style={{
              animation: `${w.anim} ${w.dur} ease-in-out ${w.delay} infinite`,
            }}
          >
            <svg
              width="100%"
              height="100%"
              viewBox="0 0 1700 900"
              preserveAspectRatio="none"
              style={{ position: 'absolute', inset: 0 }}
            >
              <path
                d={w.d}
                fill="none"
                stroke={`rgba(255,255,255,${w.op})`}
                strokeWidth={w.sw}
              />
            </svg>
          </div>
        ))}
    </div>
  );
}

interface Star {
  x: number;
  y: number;
  size: number;
  baseOp: number;
  floatDur: number;
  floatDelay: number;
  twinkleDur: number;
  twinkleDelay: number;
  dx: number;
  dy: number;
}

function makeStars(count: number, seed: number): Star[] {
  const rng = mulberry32(seed);
  const out: Star[] = [];
  for (let i = 0; i < count; i++) {
    const big = rng() < 0.18; // ~18% bright/big stars, остальные мелкие
    out.push({
      x: rng() * 100,
      y: rng() * 100,
      size: big ? 1.7 + rng() * 0.7 : 1.0 + rng() * 0.5,
      baseOp: big ? 0.45 + rng() * 0.3 : 0.18 + rng() * 0.2,
      floatDur: 14 + rng() * 18, // 14-32s
      floatDelay: -rng() * 18,
      twinkleDur: 3 + rng() * 4, // 3-7s
      twinkleDelay: -rng() * 5,
      dx: (rng() * 12 - 6),
      dy: (rng() * 10 - 5),
    });
  }
  return out;
}

// mulberry32 — крошечный seeded PRNG, дёшево и стабильно.
function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
