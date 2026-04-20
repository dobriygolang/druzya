import {
  useCallback, useEffect, useMemo, useRef, useState,
  type PointerEvent as RPE, type WheelEvent as RWE,
} from 'react'
import { useTranslation } from 'react-i18next'
import type { Atlas, AtlasNode } from '../../lib/queries/profile'
import { layout, SECTION_ORDER, SECTION_ANGLE } from './layout'
import { TreeEdge } from './TreeEdge'
import { TreeNode } from './TreeNode'
import { Tooltip } from './Tooltip'
import { LoadingRune } from './LoadingRune'

type Props = {
  atlas: Atlas | undefined
  isLoading: boolean
  selected: string | null
  onSelect: (key: string) => void
}

const ACCENT: Record<string, string> = {
  algorithms: 'var(--sec-algo-accent)',
  sql: 'var(--sec-sql-accent)',
  go: 'var(--sec-go-accent)',
  system_design: 'var(--sec-sd-accent)',
  behavioral: 'var(--sec-beh-accent)',
}
const VIEW_W = 900
const VIEW_H = 720
const Z_MIN = 0.5
const Z_MAX = 2.4
const RINGS = [110, 195, 275]

export function SkillTree({ atlas, isLoading, selected, onSelect }: Props) {
  const { t } = useTranslation()
  // Default zoom 1.4× — at 1.0 nodes looked lost in the canvas. The PoE-style
  // tree should fill the panel right away so users feel the scale.
  const [zoom, setZoom] = useState(1.4)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [hovered, setHovered] = useState<string | null>(null)
  const [mouse, setMouse] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const dragRef = useRef<{ x: number; y: number; pan: { x: number; y: number } } | null>(null)

  const nodes = atlas?.nodes ?? []
  const edges = atlas?.edges ?? []
  const centerKey = atlas?.center_node ?? ''

  const coords = useMemo(() => layout(nodes, edges, centerKey), [nodes, edges, centerKey])
  const byKey = useMemo(() => {
    const m = new Map<string, AtlasNode>()
    for (const n of nodes) m.set(n.key, n)
    return m
  }, [nodes])

  const onWheel = useCallback((e: RWE<SVGSVGElement>) => {
    setZoom((z) => Math.min(Z_MAX, Math.max(Z_MIN, z + -e.deltaY * 0.0012)))
  }, [])
  const onPointerDown = (e: RPE<SVGSVGElement>) => {
    dragRef.current = { x: e.clientX, y: e.clientY, pan: { ...pan } }
    setDragging(true)
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
  }
  const onPointerMove = (e: RPE<SVGSVGElement>) => {
    setMouse({ x: e.clientX, y: e.clientY })
    if (!dragRef.current) return
    setPan({
      x: dragRef.current.pan.x + (e.clientX - dragRef.current.x),
      y: dragRef.current.pan.y + (e.clientY - dragRef.current.y),
    })
  }
  const onPointerUp = () => { dragRef.current = null; setDragging(false) }
  const resetView = () => { setZoom(1); setPan({ x: 0, y: 0 }) }

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') setHovered(null) }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  const hoveredNode = hovered ? byKey.get(hovered) : undefined
  const containerStyle = {
    position: 'relative', width: '100%', height: 'clamp(520px, 70vh, 820px)',
    background: `radial-gradient(ellipse at 50% 50%, rgba(40,28,20,0.35) 0%, transparent 70%), radial-gradient(circle at 1px 1px, rgba(74,60,40,0.28) 1px, transparent 1px) 0 0 / 26px 26px, var(--bg-stone)`,
    border: '1px solid var(--gold-dim)', overflow: 'hidden',
    cursor: dragging ? 'grabbing' : 'grab',
  } as const

  return (
    <div style={containerStyle}>
      {isLoading || !atlas ? (<LoadingRune />) : (
        <svg
          viewBox={`${-VIEW_W / 2} ${-VIEW_H / 2} ${VIEW_W} ${VIEW_H}`}
          preserveAspectRatio="xMidYMid meet"
          style={{ width: '100%', height: '100%', display: 'block' }}
          onWheel={onWheel}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
        >
          <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>
            {SECTION_ORDER.map((sec) => {
              const a = (SECTION_ANGLE[sec] * Math.PI) / 180
              return (
                <line key={sec} x1={0} y1={0} x2={Math.cos(a) * 320} y2={Math.sin(a) * 320}
                  stroke="var(--metal-dark)" strokeWidth={0.5} strokeDasharray="2 6" opacity={0.6} />
              )
            })}
            {RINGS.map((r, i) => (
              <circle key={r} r={r} fill="none" stroke="var(--metal-dark)"
                strokeDasharray="1 6" opacity={0.5 - i * 0.1} />
            ))}
            {edges.map((e, i) => {
              const a = byKey.get(e.from), b = byKey.get(e.to)
              const pa = coords.get(e.from), pb = coords.get(e.to)
              if (!a || !b || !pa || !pb) return null
              return (
                <TreeEdge key={`${e.from}->${e.to}-${i}`} from={pa} to={pb}
                  unlocked={a.unlocked && b.unlocked}
                  decaying={a.decaying || b.decaying}
                  ascendant={a.kind === 'ascendant' || b.kind === 'ascendant'} />
              )
            })}
            {SECTION_ORDER.map((sec) => {
              const a = (SECTION_ANGLE[sec] * Math.PI) / 180
              return (
                <text key={sec} x={Math.cos(a) * 330} y={Math.sin(a) * 330}
                  textAnchor="middle" fill={ACCENT[sec]}
                  fontFamily="var(--font-heraldic)" fontSize={11} letterSpacing={4}
                  style={{ textTransform: 'uppercase' }}>
                  ✦ {t(`sections.${sec}`, sec)} ✦
                </text>
              )
            })}
            {nodes.map((n) => {
              const pos = coords.get(n.key)
              if (!pos) return null
              return (
                <TreeNode key={n.key} node={n} pos={pos}
                  selected={n.key === selected}
                  accent={ACCENT[n.section] ?? 'var(--gold)'}
                  onHover={setHovered} onSelect={onSelect} />
              )
            })}
          </g>
        </svg>
      )}

      <div style={legendStyle}>
        {SECTION_ORDER.map((sec) => (
          <span key={sec} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{
              width: 10, height: 10, background: ACCENT[sec],
              display: 'inline-block', boxShadow: `0 0 6px ${ACCENT[sec]}`,
            }} />
            {t(`sections.${sec}`, sec)}
          </span>
        ))}
      </div>

      <div style={zoomBarStyle}>
        <button className="btn btn-ghost btn-sm" aria-label="zoom out"
          onClick={() => setZoom((z) => Math.max(Z_MIN, z - 0.15))}>−</button>
        <button className="btn btn-ghost btn-sm" aria-label="reset"
          onClick={resetView}>⌾</button>
        <button className="btn btn-ghost btn-sm" aria-label="zoom in"
          onClick={() => setZoom((z) => Math.min(Z_MAX, z + 0.15))}>+</button>
      </div>

      {hoveredNode && (
        <Tooltip node={hoveredNode} x={mouse.x} y={mouse.y}
          accent={ACCENT[hoveredNode.section] ?? 'var(--gold)'} />
      )}
    </div>
  )
}

const legendStyle = {
  position: 'absolute', left: 14, bottom: 14, display: 'flex', gap: 18,
  padding: '8px 14px', background: 'rgba(10,8,8,0.72)',
  border: '1px solid var(--gold-dim)', fontFamily: 'var(--font-code)',
  fontSize: 10, letterSpacing: '0.18em', color: 'var(--text-mid)',
  textTransform: 'uppercase', pointerEvents: 'none',
} as const

const zoomBarStyle = {
  position: 'absolute', right: 14, bottom: 14, display: 'flex', gap: 6,
  padding: 6, background: 'rgba(10,8,8,0.72)', border: '1px solid var(--gold-dim)',
} as const
