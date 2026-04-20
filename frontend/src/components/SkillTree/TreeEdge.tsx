import type { Point } from './layout'

type Props = {
  from: Point
  to: Point
  unlocked: boolean
  decaying: boolean
  ascendant: boolean
}

// Single edge path. Gold stroke when both endpoints are unlocked,
// dashed dim metal when locked, thin crimson pulse when on a decaying path.
export function TreeEdge({ from, to, unlocked, decaying, ascendant }: Props) {
  const stroke = ascendant
    ? 'var(--gold)'
    : decaying
      ? 'var(--blood-lit)'
      : unlocked
        ? 'var(--ember-lit)'
        : 'var(--metal)'
  const width = ascendant ? 1.6 : unlocked ? 1.4 : 1
  const dash = !unlocked ? '3 5' : ascendant ? '6 4' : undefined
  const opacity = unlocked ? 0.85 : 0.55
  return (
    <line
      x1={from.x}
      y1={from.y}
      x2={to.x}
      y2={to.y}
      stroke={stroke}
      strokeWidth={width}
      strokeDasharray={dash}
      opacity={opacity}
      className={decaying ? 'atlas-decay' : undefined}
      style={
        unlocked
          ? {
              filter: 'drop-shadow(0 0 3px var(--ember-deep))',
            }
          : undefined
      }
    />
  )
}
