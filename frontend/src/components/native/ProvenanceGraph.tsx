import { useMemo } from 'react'
import type { ProvenanceNode } from '../../lib/queries/native'

const KIND_COLOR: Record<ProvenanceNode['kind'], string> = {
  human: 'var(--gold)',
  ai: 'var(--blood-lit)',
  test: 'var(--tier-normal)',
  merge: 'var(--ember-lit)',
}

type Laid = ProvenanceNode & { depth: number; row: number; x: number; y: number }

/**
 * DAG layout by longest-path-from-root depth.
 *
 * Why longest path instead of BFS: two parents at different depths would
 * otherwise collide when the child is placed one step past the shallow
 * parent, creating visually-wrong back-edges. Longest path guarantees
 * every edge goes left→right.
 */
function layout(nodes: ProvenanceNode[]): {
  laid: Laid[]
  width: number
  height: number
} {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const depthOf = new Map<string, number>()
  const resolve = (id: string): number => {
    if (depthOf.has(id)) return depthOf.get(id)!
    const n = byId.get(id)
    if (!n || n.parents.length === 0) {
      depthOf.set(id, 0)
      return 0
    }
    const d = 1 + Math.max(...n.parents.map(resolve))
    depthOf.set(id, d)
    return d
  }
  nodes.forEach((n) => resolve(n.id))

  // Group by depth, preserving declaration order within a column.
  const cols: ProvenanceNode[][] = []
  nodes.forEach((n) => {
    const d = depthOf.get(n.id)!
    if (!cols[d]) cols[d] = []
    cols[d].push(n)
  })

  const COL_W = 160
  const ROW_H = 56
  const PAD_X = 40
  const PAD_Y = 28

  const laid: Laid[] = []
  cols.forEach((col, d) => {
    col.forEach((n, i) => {
      laid.push({
        ...n,
        depth: d,
        row: i,
        x: PAD_X + d * COL_W,
        y: PAD_Y + i * ROW_H,
      })
    })
  })

  const width = PAD_X * 2 + (cols.length - 1) * COL_W + 120
  const height =
    PAD_Y * 2 +
    (Math.max(...cols.map((c) => c.length)) - 1) * ROW_H +
    40

  return { laid, width, height }
}

export function ProvenanceGraph({ nodes }: { nodes: ProvenanceNode[] }) {
  const { laid, width, height } = useMemo(() => layout(nodes), [nodes])
  const byId = useMemo(() => new Map(laid.map((n) => [n.id, n])), [laid])

  if (!nodes.length) return null

  return (
    <div style={{ overflowX: 'auto', padding: '8px 0' }}>
      <svg
        width={width}
        height={height}
        style={{ display: 'block' }}
        role="img"
        aria-label="provenance graph"
      >
        <defs>
          <marker
            id="arrow-gold"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="5"
            markerHeight="5"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--gold-dim)" />
          </marker>
        </defs>

        {/* Edges */}
        {laid.flatMap((n) =>
          n.parents
            .map((pid) => byId.get(pid))
            .filter(Boolean)
            .map((p) => {
              const from = p!
              const mx = (from.x + n.x) / 2
              const d = `M ${from.x + 18} ${from.y + 10}
                         C ${mx} ${from.y + 10},
                           ${mx} ${n.y + 10},
                           ${n.x - 2} ${n.y + 10}`
              return (
                <path
                  key={`${from.id}->${n.id}`}
                  d={d}
                  fill="none"
                  stroke="var(--gold-faint)"
                  strokeWidth="1.5"
                  markerEnd="url(#arrow-gold)"
                />
              )
            }),
        )}

        {/* Nodes */}
        {laid.map((n) => {
          const color = KIND_COLOR[n.kind]
          return (
            <g key={n.id} transform={`translate(${n.x}, ${n.y})`}>
              {/* Diamond badge */}
              <rect
                x="0"
                y="0"
                width="20"
                height="20"
                transform="rotate(45 10 10)"
                fill="var(--bg-inset)"
                stroke={color}
                strokeWidth="1.5"
              />
              <rect
                x="4"
                y="4"
                width="12"
                height="12"
                transform="rotate(45 10 10)"
                fill={color}
                opacity="0.9"
              />
              {/* Label */}
              <text
                x="28"
                y="7"
                fill={color}
                fontSize="9"
                fontFamily="var(--font-display)"
                letterSpacing="0.15em"
              >
                {n.kind.toUpperCase()}
              </text>
              <text
                x="28"
                y="20"
                fill="var(--text-bright)"
                fontSize="11"
                fontFamily="var(--font-body)"
              >
                {n.label.length > 18 ? n.label.slice(0, 17) + '…' : n.label}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

/**
 * Donut for AI-share.
 * value: 0..1
 */
export function AiDonut({
  value,
  size = 120,
  label,
}: {
  value: number
  size?: number
  label?: string
}) {
  const clamped = Math.max(0, Math.min(1, value))
  const stroke = 10
  const r = (size - stroke) / 2
  const circ = 2 * Math.PI * r
  const dash = `${circ * clamped} ${circ}`
  const cx = size / 2
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 6,
      }}
    >
      <svg width={size} height={size}>
        <circle
          cx={cx}
          cy={cx}
          r={r}
          fill="none"
          stroke="var(--gold-faint)"
          strokeWidth={stroke}
        />
        <circle
          cx={cx}
          cy={cx}
          r={r}
          fill="none"
          stroke="var(--blood-lit)"
          strokeWidth={stroke}
          strokeDasharray={dash}
          strokeLinecap="butt"
          transform={`rotate(-90 ${cx} ${cx})`}
          style={{ filter: 'drop-shadow(0 0 4px rgba(194,34,34,0.5))' }}
        />
        <text
          x={cx}
          y={cx - 2}
          textAnchor="middle"
          fill="var(--blood-lit)"
          fontSize="22"
          fontFamily="var(--font-display)"
        >
          {Math.round(clamped * 100)}%
        </text>
        <text
          x={cx}
          y={cx + 16}
          textAnchor="middle"
          fill="var(--text-mid)"
          fontSize="9"
          letterSpacing="0.2em"
        >
          AI
        </text>
      </svg>
      {label && (
        <div
          style={{
            fontSize: 10,
            color: 'var(--text-mid)',
            letterSpacing: '0.15em',
          }}
        >
          {label}
        </div>
      )}
    </div>
  )
}
