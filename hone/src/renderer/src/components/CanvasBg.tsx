// CanvasBg — the meditative backdrop that sits behind every Hone page.
//
// Three modes drive visibility and cost:
//   - "full"  — all three layers (stars, waveforms, rotating squares), with
//               the rotating squares driven by a tick to avoid a frozen feel.
//               Used on Home + Stats where the canvas is half the product.
//   - "quiet" — just stars, at 0.35× opacity. Today / Notes / Whiteboard:
//               the backdrop is present but recedes behind the content.
//   - "void"  — renders nothing. Focus mode is deliberately empty to keep
//               the page weightless around the big timer.
//
// The RAF loop is gated on `mode === "full"` — in quiet/void there is no
// animation worth the frame budget, so we don't register the callback at
// all. That keeps idle focus-mode CPU at ~0%.
import { useEffect, useState } from 'react';

const STARS = [
  { x: 8, y: 14, r: 1.1, o: 0.45 },
  { x: 17, y: 72, r: 1, o: 0.35 },
  { x: 23, y: 28, r: 1.3, o: 0.55 },
  { x: 31, y: 84, r: 0.9, o: 0.3 },
  { x: 39, y: 12, r: 1, o: 0.4 },
  { x: 44, y: 58, r: 1.1, o: 0.5 },
  { x: 52, y: 22, r: 0.9, o: 0.3 },
  { x: 58, y: 80, r: 1.2, o: 0.55 },
  { x: 63, y: 38, r: 1, o: 0.4 },
  { x: 68, y: 64, r: 0.9, o: 0.35 },
  { x: 73, y: 18, r: 1.1, o: 0.5 },
  { x: 78, y: 48, r: 1, o: 0.4 },
  { x: 83, y: 74, r: 0.9, o: 0.3 },
  { x: 88, y: 30, r: 1.2, o: 0.6 },
  { x: 92, y: 58, r: 1, o: 0.45 },
  { x: 14, y: 44, r: 0.9, o: 0.35 },
  { x: 46, y: 90, r: 1, o: 0.3 },
  { x: 3, y: 62, r: 1.1, o: 0.45 },
  { x: 36, y: 50, r: 0.9, o: 0.3 },
  { x: 71, y: 88, r: 1, o: 0.4 },
];

const WAVES = [
  'M-50,280 C 260,220 420,340 700,290 S 1200,200 1700,260',
  'M-50,390 C 200,350 500,430 820,390 S 1300,340 1700,380',
  'M-50,500 C 240,470 520,560 860,510 S 1340,450 1700,490',
  'M-50,605 C 300,580 620,660 920,620 S 1380,570 1700,600',
  'M-50,700 C 280,680 560,750 900,720 S 1360,680 1700,705',
  'M-50,790 C 320,770 640,820 960,800 S 1420,770 1700,790',
];

// Подложка-сетка — едва видна, добавляет «координатной» текстуры
// (winter.so style). Шаг 64 px → ~0.06 opacity → не отвлекает, но даёт
// чувство «бумаги в клетку» / «терминал».
const GRID_STEP_PX = 64;

export type CanvasMode = 'full' | 'quiet' | 'void';

interface CanvasBgProps {
  mode?: CanvasMode;
}

export function CanvasBg({ mode = 'full' }: CanvasBgProps) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (mode !== 'full') return;
    let raf = 0;
    const loop = () => {
      setTick((t) => t + 0.1);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [mode]);

  if (mode === 'void') return null;

  const starOp = mode === 'full' ? 1 : 0.35;
  const showWaves = mode === 'full';
  const showSquares = mode === 'full';

  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
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
      <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0 }}>
        {STARS.map((s, i) => (
          <circle
            key={i}
            cx={`${s.x}%`}
            cy={`${s.y}%`}
            r={s.r * 1.4}
            fill={`rgba(255,255,255,${Math.min(1, s.o * 1.7) * starOp})`}
          />
        ))}
      </svg>
      {showWaves && (
        <svg
          width="100%"
          height="100%"
          viewBox="0 0 1600 900"
          preserveAspectRatio="none"
          style={{ position: 'absolute', inset: 0 }}
        >
          {WAVES.map((d, i) => (
            <path
              key={i}
              d={d}
              fill="none"
              stroke={`rgba(255,255,255,${0.18 + (i % 3) * 0.02})`}
              strokeWidth="1"
            />
          ))}
        </svg>
      )}
      {showSquares && (
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            width: 280,
            height: 280,
            transform: 'translate(-50%,-50%)',
            opacity: 0.42,
          }}
        >
          <svg
            width="280"
            height="280"
            viewBox="-140 -140 280 280"
            style={{ transform: `rotate(${tick}deg)` }}
          >
            <rect
              x={-90}
              y={-90}
              width={180}
              height={180}
              fill="none"
              stroke="rgba(255,255,255,0.95)"
              strokeWidth="1"
            />
          </svg>
          <svg
            width="280"
            height="280"
            viewBox="-140 -140 280 280"
            style={{ position: 'absolute', inset: 0, transform: `rotate(${tick + 22}deg)` }}
          >
            <rect
              x={-90}
              y={-90}
              width={180}
              height={180}
              fill="none"
              stroke="rgba(255,255,255,0.95)"
              strokeWidth="1"
            />
          </svg>
        </div>
      )}
    </div>
  );
}
