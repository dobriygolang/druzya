// Sparkline — Phase 8 inline trend graph для tutor dashboard activity cards.
//
// SVG-only, no external lib. Render: smooth area + endpoint dot. Width 100%
// height fixed; y-axis auto-scales to max(values). Все точки collapse'ятся
// в straight line при values все = 0 (визуальный «нет активности»).
//
// Accessibility: title attribute = peak value + window-length string.
import type { CSSProperties } from 'react'

interface SparklineProps {
  values: number[]
  width?: number | string
  height?: number
  stroke?: string
  fill?: string
  ariaLabel?: string
  className?: string
  style?: CSSProperties
}

export function Sparkline({
  values,
  width = '100%',
  height = 24,
  stroke = 'rgba(255,255,255,0.7)',
  fill = 'rgba(255,255,255,0.08)',
  ariaLabel,
  className,
  style,
}: SparklineProps) {
  if (!values.length) {
    return null
  }
  const max = Math.max(1, ...values) // avoid zero-division
  const w = 100 // viewBox is 0..100, parent style controls actual width
  const h = height
  const stepX = values.length === 1 ? 0 : w / (values.length - 1)

  const points = values.map((v, i) => {
    const x = i * stepX
    const y = h - (v / max) * (h - 2) - 1 // 1px top/bottom padding
    return `${x.toFixed(2)},${y.toFixed(2)}`
  })

  // Closed area path: line + bottom-corners + close.
  const linePath = `M ${points.join(' L ')}`
  const areaPath = `${linePath} L ${w},${h} L 0,${h} Z`

  // Endpoint dot — last value visualised.
  const lastX = values.length === 1 ? w / 2 : (values.length - 1) * stepX
  const lastY = h - (values[values.length - 1]! / max) * (h - 2) - 1

  const peak = Math.max(...values)
  const title = ariaLabel ?? `Trend over ${values.length}d · peak ${peak}`

  return (
    <svg
      role="img"
      aria-label={title}
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      width={width}
      height={h}
      className={className}
      style={style}
    >
      <title>{title}</title>
      <path d={areaPath} fill={fill} stroke="none" />
      <path d={linePath} fill="none" stroke={stroke} strokeWidth={1} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lastX} cy={lastY} r={1.6} fill={stroke} />
    </svg>
  )
}
