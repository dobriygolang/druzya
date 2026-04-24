// Sparkline — a tiny trend line next to the streak count. Takes a fixed
// series of point values; the rightmost point is the "today" dot in
// accent red. Defensive empty-state: fewer than 2 points → a flat line
// at mid-height so the widget still occupies its space.
interface SparklineProps {
  points: number[];
}

const W = 200;
const H = 46;

export function Sparkline({ points }: SparklineProps) {
  if (points.length < 2) {
    return (
      <svg width={W} height={H} style={{ display: 'block' }}>
        <path
          d={`M0 ${H / 2} L${W} ${H / 2}`}
          fill="none"
          stroke="rgba(255,255,255,0.2)"
          strokeWidth="1"
        />
      </svg>
    );
  }

  const max = Math.max(...points);
  const min = Math.min(...points);
  const span = max - min || 1;
  const path = points
    .map((p, i) => {
      const x = (i / (points.length - 1)) * W;
      const y = H - ((p - min) / span) * (H - 4) - 2;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');
  const last = points[points.length - 1]!;
  const lastY = H - ((last - min) / span) * (H - 4) - 2;

  return (
    <svg width={W} height={H} style={{ display: 'block' }}>
      <path d={path} fill="none" stroke="rgba(255,255,255,0.85)" strokeWidth="1.2" />
      <circle cx={W} cy={lastY} r="3" fill="var(--red)" />
    </svg>
  );
}
