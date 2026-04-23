// ScoreRadar — hand-rolled SVG 4-axis polygon for the debrief.
//
// We hand-roll instead of pulling recharts to keep bundle slim (the recharts
// PolarAreaChart is ~30kb gz). Pure SVG, no deps.
//
// 4 axes: clarity / depth / pace / structure. Each 0..100.

interface Score {
  clarity: number
  depth: number
  pace: number
  structure: number
}

interface Props {
  score: Score
  size?: number
}

const LABELS: Array<{ key: keyof Score; ru: string }> = [
  { key: 'clarity', ru: 'Чёткость' },
  { key: 'depth', ru: 'Глубина' },
  { key: 'pace', ru: 'Темп' },
  { key: 'structure', ru: 'Структура' },
]

export function ScoreRadar({ score, size = 280 }: Props) {
  const cx = size / 2
  const cy = size / 2
  const r = size * 0.36

  // 4 axes evenly spaced; start at top (-90°)
  const axes = LABELS.map((_, i) => {
    const angle = -Math.PI / 2 + (i * Math.PI * 2) / LABELS.length
    return { x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r, angle }
  })

  // Concentric rings at 25 / 50 / 75 / 100
  const rings = [0.25, 0.5, 0.75, 1].map((p) =>
    axes
      .map((_, i) => {
        const angle = -Math.PI / 2 + (i * Math.PI * 2) / LABELS.length
        return `${cx + Math.cos(angle) * r * p},${cy + Math.sin(angle) * r * p}`
      })
      .join(' '),
  )

  // Player polygon
  const poly = LABELS.map((lbl, i) => {
    const angle = -Math.PI / 2 + (i * Math.PI * 2) / LABELS.length
    const v = Math.max(0, Math.min(100, score[lbl.key])) / 100
    return `${cx + Math.cos(angle) * r * v},${cy + Math.sin(angle) * r * v}`
  }).join(' ')

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <defs>
          <linearGradient id="radarFill" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="rgb(34 211 238)" stopOpacity="0.5" />
            <stop offset="100%" stopColor="rgb(88 44 255)" stopOpacity="0.5" />
          </linearGradient>
        </defs>
        {/* Rings */}
        {rings.map((pts, i) => (
          <polygon
            key={i}
            points={pts}
            fill="none"
            stroke="rgb(42 42 63)"
            strokeWidth={1}
            strokeDasharray={i === rings.length - 1 ? '' : '2 4'}
          />
        ))}
        {/* Axes */}
        {axes.map((a, i) => (
          <line key={i} x1={cx} y1={cy} x2={a.x} y2={a.y} stroke="rgb(34 34 51)" strokeWidth={1} />
        ))}
        {/* Player polygon */}
        <polygon points={poly} fill="url(#radarFill)" stroke="rgb(34 211 238)" strokeWidth={2} />
        {/* Vertex dots */}
        {LABELS.map((lbl, i) => {
          const angle = -Math.PI / 2 + (i * Math.PI * 2) / LABELS.length
          const v = Math.max(0, Math.min(100, score[lbl.key])) / 100
          return (
            <circle
              key={lbl.key}
              cx={cx + Math.cos(angle) * r * v}
              cy={cy + Math.sin(angle) * r * v}
              r={4}
              fill="rgb(34 211 238)"
            />
          )
        })}
      </svg>
      {/* Axis labels — positioned outside the SVG via absolute so they wrap nicely */}
      {LABELS.map((lbl, i) => {
        const angle = -Math.PI / 2 + (i * Math.PI * 2) / LABELS.length
        const lx = cx + Math.cos(angle) * (r + 22)
        const ly = cy + Math.sin(angle) * (r + 22)
        return (
          <div
            key={lbl.key}
            className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap text-center"
            style={{ left: lx, top: ly }}
          >
            <div className="font-mono text-[10px] uppercase tracking-wider text-text-muted">{lbl.ru}</div>
            <div className="font-display text-base font-bold text-text-primary">
              {Math.round(score[lbl.key])}
            </div>
          </div>
        )
      })}
    </div>
  )
}
