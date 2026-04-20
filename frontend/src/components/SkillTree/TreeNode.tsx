import type { AtlasNode } from '../../lib/queries/profile'
import type { Point } from './layout'

type Props = {
  node: AtlasNode
  pos: Point
  selected: boolean
  accent: string // CSS var ref for section accent
  onHover: (key: string | null) => void
  onSelect: (key: string) => void
}

// r pairs: [ring outer, inner fill] for each kind.
function radii(kind: string) {
  if (kind === 'ascendant') return { ring: 34, fill: 26 }
  if (kind === 'keystone') return { ring: 22, fill: 16 }
  return { ring: 13, fill: 9 }
}

function hexPoints(r: number): string {
  const pts: string[] = []
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 2
    pts.push(`${(r * Math.cos(a)).toFixed(2)},${(r * Math.sin(a)).toFixed(2)}`)
  }
  return pts.join(' ')
}

export function TreeNode({
  node,
  pos,
  selected,
  accent,
  onHover,
  onSelect,
}: Props) {
  const { ring, fill } = radii(node.kind)
  const isAscendant = node.kind === 'ascendant'
  const isKeystone = node.kind === 'keystone'

  const fillColor = node.unlocked ? accent : 'var(--bg-inset)'
  const ringColor = node.unlocked ? 'var(--metal-hi)' : 'var(--metal-dark)'
  const innerStroke = node.unlocked ? 'var(--gold-bright)' : 'var(--metal-lit)'
  const glow = node.unlocked
    ? `drop-shadow(0 0 ${selected ? 10 : 6}px ${accent})`
    : undefined

  return (
    <g
      transform={`translate(${pos.x.toFixed(2)},${pos.y.toFixed(2)})`}
      style={{ cursor: 'pointer' }}
      onMouseEnter={() => onHover(node.key)}
      onMouseLeave={() => onHover(null)}
      onClick={(e) => {
        e.stopPropagation()
        onSelect(node.key)
      }}
    >
      {/* decay pulse halo */}
      {node.decaying && (
        <circle
          r={ring + 6}
          fill="none"
          stroke="var(--blood-lit)"
          strokeWidth={1}
          className="atlas-decay"
        />
      )}

      {/* selection halo */}
      {selected && (
        <circle
          r={ring + 8}
          fill="none"
          stroke="var(--gold-bright)"
          strokeWidth={1.2}
          strokeDasharray="3 3"
          opacity={0.9}
        />
      )}

      {/* ascendant: dashed gold double-ring */}
      {isAscendant && (
        <>
          <circle
            r={ring + 10}
            fill="none"
            stroke="var(--gold-dim)"
            strokeDasharray="2 4"
            className="atlas-center-halo"
          />
          <circle
            r={ring + 4}
            fill="none"
            stroke="var(--gold)"
            strokeWidth={1.2}
          />
        </>
      )}

      {/* outer chrome — hex for keystones, circle for others */}
      {isKeystone ? (
        <polygon
          points={hexPoints(ring)}
          fill="var(--bg-card)"
          stroke={ringColor}
          strokeWidth={2}
          style={{ filter: glow }}
        />
      ) : (
        <circle
          r={ring}
          fill="var(--bg-card)"
          stroke={ringColor}
          strokeWidth={isAscendant ? 2 : 1.2}
          style={{ filter: glow }}
        />
      )}

      {/* inner fill */}
      {isKeystone ? (
        <polygon
          points={hexPoints(fill)}
          fill={fillColor}
          stroke={innerStroke}
          strokeWidth={1}
          opacity={node.unlocked ? 0.9 : 0.6}
        />
      ) : (
        <circle
          r={fill}
          fill={fillColor}
          stroke={innerStroke}
          strokeWidth={isAscendant ? 1.4 : 0.8}
          opacity={node.unlocked ? 0.95 : 0.6}
        />
      )}

      {/* ascendant mark */}
      {isAscendant && (
        <text
          y={5}
          textAnchor="middle"
          fill="var(--gold-bright)"
          fontSize={16}
          fontFamily="var(--font-heraldic)"
          style={{ pointerEvents: 'none' }}
        >
          ✦
        </text>
      )}

      {/* small label under keystones — read on hover anyway */}
      {isKeystone && (
        <text
          y={ring + 14}
          textAnchor="middle"
          fill="var(--text-mid)"
          fontSize={8}
          fontFamily="var(--font-display)"
          letterSpacing={2}
          style={{ pointerEvents: 'none', textTransform: 'uppercase' }}
        >
          {node.title}
        </text>
      )}
    </g>
  )
}
