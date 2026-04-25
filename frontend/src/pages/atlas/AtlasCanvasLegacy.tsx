// AtlasCanvasLegacy — extracted from the WAVE-10 monolithic AtlasPage.tsx
// in WAVE-11. The interactive radial-spoke SVG renderer (GraphCanvas) plus
// supporting layout math, node/edge shape components, hover tooltip, mini
// map and the visual-token table that the drawer/filters also consume.
//
// "Legacy" because v2-flag wires up the Canvas v2 surface (component
// AtlasCanvas in components/atlas/) which uses the designer-pinned
// coordinates path. This file remains the default/v1 path until the v2
// rollout is fully GA. Behaviour identical to the inline version.
//
// What lives here:
//   - NodeState / computePct / nodeState / daysSince / sectionLabel
//     (shared with AtlasDrawer + AtlasFilters)
//   - CATEGORIES / STATUS_FILTERS / STATE_LABEL / STATE_FILL / STATE_STROKE
//   - GraphCanvas (the interactive SVG)
//   - HoverTooltip / NodeShape / ConnectionLine / MiniMap

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Flame, Clock } from 'lucide-react'
import type { Atlas, AtlasNode } from '../../lib/queries/profile'
import { humanizeDifficulty } from '../../lib/labels'
import { ZoomControls } from './ZoomControls'

// SVG-координаты — всё считается в одной системе с центром (0,0).
export const VIEWBOX_SIZE = 1400
const CENTER = VIEWBOX_SIZE / 2
const RADIUS_INNER = 180
const RADIUS_OUTER = 520
const RADIUS_LABEL = 620
const NODE_R_NORMAL = 26
const NODE_R_KEYSTONE = 34
const NODE_R_CENTER = 44

// 5 визуальных состояний.
export type NodeState =
  | 'locked'
  | 'available'
  | 'in_progress'
  | 'mastered'
  | 'decaying'

export function nodeState(n: AtlasNode): NodeState {
  const p = n.progress ?? 0
  if (n.decaying) return 'decaying'
  if (n.unlocked && p >= 80) return 'mastered'
  if (n.unlocked && p > 0) return 'in_progress'
  if (n.unlocked) return 'available'
  if (p > 0) return 'in_progress'
  return 'locked'
}

export const STATE_LABEL: Record<NodeState, string> = {
  locked: 'Заблокирован',
  available: 'Доступен',
  in_progress: 'В процессе',
  mastered: 'Освоен',
  decaying: 'Затухает',
}

type EdgeState = 'solid' | 'dashed' | 'faded'

function edgeState(from: AtlasNode | undefined, to: AtlasNode | undefined): EdgeState {
  if (!from || !to) return 'faded'
  if (from.unlocked && to.unlocked) return 'solid'
  if (from.unlocked) return 'dashed'
  return 'faded'
}

export function sectionLabel(section: string): string {
  const map: Record<string, string> = {
    SECTION_ALGORITHMS: 'Алгоритмы',
    SECTION_SQL: 'SQL',
    SECTION_GO: 'Go / Backend',
    SECTION_SYSTEM_DESIGN: 'System Design',
    SECTION_BEHAVIORAL: 'Behavioral',
    SECTION_CONCURRENCY: 'Concurrency',
    SECTION_DATA_STRUCTURES: 'Data Structures',
    algorithms: 'Алгоритмы',
    sql: 'SQL',
    go: 'Go / Backend',
    system_design: 'System Design',
    behavioral: 'Behavioral',
  }
  return map[section] ?? section
}

export const CATEGORIES: { key: string; label: string; sections: string[] }[] = [
  {
    key: 'algorithms',
    label: 'Algorithms',
    sections: ['SECTION_ALGORITHMS', 'algorithms'],
  },
  {
    key: 'data_structures',
    label: 'Data Structures',
    sections: ['SECTION_DATA_STRUCTURES', 'data_structures'],
  },
  {
    key: 'system_design',
    label: 'System Design',
    sections: ['SECTION_SYSTEM_DESIGN', 'system_design'],
  },
  {
    key: 'backend',
    label: 'Backend',
    sections: ['SECTION_GO', 'SECTION_SQL', 'SECTION_BEHAVIORAL', 'go', 'sql', 'behavioral'],
  },
  {
    key: 'concurrency',
    label: 'Concurrency',
    sections: ['SECTION_CONCURRENCY'],
  },
]

export const STATUS_FILTERS: { key: NodeState | 'all'; label: string }[] = [
  { key: 'all', label: 'Все' },
  { key: 'locked', label: 'Закрытые' },
  { key: 'available', label: 'Доступные' },
  { key: 'in_progress', label: 'В процессе' },
  { key: 'mastered', label: 'Освоенные' },
  { key: 'decaying', label: 'Затухающие' },
]

function categoryOf(node: AtlasNode): string {
  for (const c of CATEGORIES) if (c.sections.includes(node.section)) return c.key
  return CATEGORIES[0].key
}

export function daysSince(iso?: string): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  const days = Math.floor((Date.now() - t) / (1000 * 60 * 60 * 24))
  return days < 0 ? 0 : days
}

// computePct returns the 0..100 integer to render in progress labels,
// or null when backend gave us no usable data (legacy payload / total=0
// / missing progress). Callers render "—" for null so we never leak
// "undefined%" or "NaN%" to the user.
export function computePct(node: AtlasNode): number | null {
  const total = node.total_count ?? 0
  const solved = node.solved_count ?? 0
  if (total > 0) {
    return Math.min(100, Math.max(0, Math.round((solved / total) * 100)))
  }
  const p =
    typeof node.progress === 'number' && Number.isFinite(node.progress) ? node.progress : null
  if (p === null) return null
  return Math.min(100, Math.max(0, Math.round(p)))
}

// ── Layout helpers
type NodePos = {
  node: AtlasNode
  x: number
  y: number
  r: number
  angle: number
  category: string
}

function bfsDepths(atlas: Atlas): Map<string, number> {
  const adj = new Map<string, string[]>()
  for (const e of atlas.edges) {
    if (!adj.has(e.from)) adj.set(e.from, [])
    if (!adj.has(e.to)) adj.set(e.to, [])
    adj.get(e.from)!.push(e.to)
    adj.get(e.to)!.push(e.from)
  }
  const depth = new Map<string, number>()
  depth.set(atlas.center_node, 0)
  const queue: string[] = [atlas.center_node]
  while (queue.length > 0) {
    const cur = queue.shift()!
    const d = depth.get(cur)!
    for (const nb of adj.get(cur) ?? []) {
      if (depth.has(nb)) continue
      depth.set(nb, d + 1)
      queue.push(nb)
    }
  }
  for (const n of atlas.nodes) if (!depth.has(n.key)) depth.set(n.key, 2)
  return depth
}

function computeLayout(atlas: Atlas): Map<string, NodePos> {
  const positions = new Map<string, NodePos>()
  const center = atlas.nodes.find((n) => n.key === atlas.center_node)
  if (center) {
    positions.set(center.key, {
      node: center,
      x: CENTER,
      y: CENTER,
      r: NODE_R_CENTER,
      angle: 0,
      category: 'center',
    })
  }

  const others = atlas.nodes.filter((n) => n.key !== atlas.center_node)
  const depths = bfsDepths(atlas)
  const byCat = new Map<string, AtlasNode[]>()
  for (const c of CATEGORIES) byCat.set(c.key, [])
  for (const n of others) {
    const cat = categoryOf(n)
    byCat.get(cat)!.push(n)
  }

  const sectorCount = CATEGORIES.length
  const sectorAngle = (2 * Math.PI) / sectorCount
  const sectorUseRatio = 0.7

  CATEGORIES.forEach((cat, ci) => {
    const center0 = -Math.PI / 2 + ci * sectorAngle
    const half = (sectorAngle * sectorUseRatio) / 2
    const items = byCat.get(cat.key) ?? []
    if (items.length === 0) return

    const byDepth = new Map<number, AtlasNode[]>()
    for (const n of items) {
      const d = Math.max(1, depths.get(n.key) ?? 2)
      if (!byDepth.has(d)) byDepth.set(d, [])
      byDepth.get(d)!.push(n)
    }
    const depthKeys = Array.from(byDepth.keys()).sort((a, b) => a - b)
    const maxDepth = depthKeys[depthKeys.length - 1] ?? 1

    depthKeys.forEach((d) => {
      const ring = byDepth.get(d)!
      const t = maxDepth === 1 ? 0 : (d - 1) / (maxDepth - 1)
      const baseRadius = RADIUS_INNER + (RADIUS_OUTER - RADIUS_INNER) * t
      ring.forEach((n, idx) => {
        const r =
          n.kind === 'keystone'
            ? NODE_R_KEYSTONE
            : n.kind === 'ascendant'
              ? NODE_R_KEYSTONE + 4
              : NODE_R_NORMAL
        const a =
          ring.length === 1
            ? center0
            : center0 - half + (2 * half * idx) / (ring.length - 1)
        const radius =
          n.kind === 'ascendant'
            ? Math.min(RADIUS_OUTER + 30, baseRadius + 30)
            : baseRadius
        positions.set(n.key, {
          node: n,
          x: CENTER + radius * Math.cos(a),
          y: CENTER + radius * Math.sin(a),
          r,
          angle: center0,
          category: cat.key,
        })
      })
    })
  })

  return positions
}

// ── Visual constants per state.
export const STATE_FILL: Record<NodeState, string> = {
  locked: '#1F2434',
  available: '#7C5CFF',
  in_progress: '#0A0E1A',
  mastered: '#22C55E',
  decaying: '#0A0E1A',
}
const STATE_STROKE: Record<NodeState, string> = {
  locked: '#2A2F45',
  available: '#FFFFFF',
  in_progress: '#FFFFFF',
  mastered: '#16A34A',
  decaying: '#F59E0B',
}

export function stateBadgeClass(state: NodeState): string {
  switch (state) {
    case 'mastered':
      return 'bg-success/15 text-success'
    case 'decaying':
      return 'bg-warn/15 text-warn'
    case 'in_progress':
      return 'bg-text-primary/15 text-text-primary'
    case 'available':
      return 'bg-text-primary/10 text-text-secondary'
    default:
      return 'bg-surface-2 text-text-muted'
  }
}

function NodeShape({
  pos,
  selected,
  faded,
  hovered,
  onSelect,
  onHover,
  onLeave,
}: {
  pos: NodePos
  selected: boolean
  faded: boolean
  hovered: boolean
  onSelect: () => void
  onHover: () => void
  onLeave: () => void
}) {
  const { node, x, y, r } = pos
  const state = nodeState(node)
  const fill = STATE_FILL[state]
  const stroke = STATE_STROKE[state]
  const opacity = faded ? 0.28 : state === 'locked' ? 0.55 : 1

  const pct = Math.min(100, Math.max(0, node.progress ?? 0))
  const arc =
    state === 'in_progress' && pct > 0 ? describeArc(x, y, r - 4, 0, (pct / 100) * 360) : null

  const isHex = node.kind === 'keystone' || node.kind === 'ascendant'
  const isCenter = pos.category === 'center'

  return (
    <g
      style={{ cursor: 'pointer', opacity }}
      onClick={(e) => {
        e.stopPropagation()
        onSelect()
      }}
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
      onFocus={onHover}
      onBlur={onLeave}
      tabIndex={0}
      role="button"
      aria-label={`${node.title} — ${STATE_LABEL[state]}`}
    >
      {state === 'decaying' && (
        <circle cx={x} cy={y} r={r + 8} fill="none" stroke="#F59E0B" strokeWidth={2} opacity={0.5}>
          <animate attributeName="r" from={r + 4} to={r + 14} dur="1.6s" repeatCount="indefinite" />
          <animate attributeName="opacity" from="0.6" to="0" dur="1.6s" repeatCount="indefinite" />
        </circle>
      )}
      {(selected || hovered) && (
        <circle
          cx={x}
          cy={y}
          r={r + 6}
          fill="none"
          stroke="#FFFFFF"
          strokeWidth={selected ? 3 : 2}
          opacity={selected ? 0.9 : 0.55}
        />
      )}
      {isHex ? (
        <polygon points={hexPoints(x, y, r)} fill={fill} stroke={stroke} strokeWidth={2} />
      ) : (
        <circle cx={x} cy={y} r={r} fill={fill} stroke={stroke} strokeWidth={2} />
      )}
      {isCenter && (
        <g pointerEvents="none">
          <circle cx={x} cy={y} r={r + 18} fill="none" stroke="#7C5CFF" strokeWidth={1.5} opacity={0.5}>
            <animate attributeName="r" from={r + 8} to={r + 26} dur="2.4s" repeatCount="indefinite" />
            <animate attributeName="opacity" from="0.6" to="0" dur="2.4s" repeatCount="indefinite" />
          </circle>
          <circle cx={x} cy={y} r={r} fill="url(#centerSigilGrad)" stroke="#FFFFFF" strokeWidth={2.5} />
          <text
            x={x}
            y={y}
            textAnchor="middle"
            dominantBaseline="central"
            fill="#F8FAFC"
            fontSize={r * 1.05}
            fontFamily="ui-sans-serif, system-ui"
            fontWeight={900}
          >
            9
          </text>
        </g>
      )}
      {arc && (
        <path d={arc} fill="none" stroke="#FFFFFF" strokeWidth={4} strokeLinecap="round" />
      )}
      {state === 'mastered' && (
        <g transform={`translate(${x - 7}, ${y - 7})`}>
          <path
            d="M2 7l4 4L13 3"
            fill="none"
            stroke="#0A0E1A"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
      )}
      {state === 'locked' && (
        <g transform={`translate(${x - 6}, ${y - 6})`} opacity={0.7}>
          <rect x={1} y={5} width={10} height={7} rx={1.5} fill="#475569" />
          <path d="M3 5V3.5a3 3 0 0 1 6 0V5" stroke="#475569" strokeWidth={1.5} fill="none" />
        </g>
      )}
    </g>
  )
}

function describeArc(cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
  const start = polar(cx, cy, r, endDeg - 90)
  const end = polar(cx, cy, r, startDeg - 90)
  const largeArc = endDeg - startDeg <= 180 ? '0' : '1'
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 0 ${end.x} ${end.y}`
}

function polar(cx: number, cy: number, r: number, deg: number): { x: number; y: number } {
  const rad = (deg * Math.PI) / 180
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) }
}

function hexPoints(cx: number, cy: number, r: number): string {
  const pts: string[] = []
  for (let i = 0; i < 6; i += 1) {
    const a = (-Math.PI / 2) + (i * Math.PI) / 3
    pts.push(`${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`)
  }
  return pts.join(' ')
}

function ConnectionLine({
  x1,
  y1,
  x2,
  y2,
  state,
}: {
  x1: number
  y1: number
  x2: number
  y2: number
  state: EdgeState
}) {
  const stroke =
    state === 'solid' ? '#7C5CFF' : state === 'dashed' ? '#FFFFFF' : '#2A2F45'
  const dash = state === 'dashed' ? '6 6' : undefined
  const opacity = state === 'faded' ? 0.35 : 0.85
  const width = state === 'solid' ? 2.5 : 1.5
  return (
    <line
      x1={x1}
      y1={y1}
      x2={x2}
      y2={y2}
      stroke={stroke}
      strokeWidth={width}
      strokeDasharray={dash}
      opacity={opacity}
    />
  )
}

// HoverTooltip — unchanged from inline; rendered above the transformed
// SVG using container-pixel coordinates so it doesn't scale with zoom.
function HoverTooltip({
  pos,
  containerRect,
}: {
  pos: NodePos
  containerRect: DOMRect | null
}) {
  const { node } = pos
  const state = nodeState(node)
  const days = daysSince(node.last_solved_at)
  const solved = node.solved_count ?? 0
  const total = node.total_count ?? 0
  const pct = computePct(node)
  const pctLabel = pct === null ? '—' : `${pct}%`
  const barWidth = pct ?? 0
  const recommended = (node.recommended_kata ?? []).slice(0, 2)

  const TOOLTIP_W = 280
  if (!containerRect) return null
  const sx = (pos.x / VIEWBOX_SIZE) * containerRect.width
  const sy = (pos.y / VIEWBOX_SIZE) * containerRect.height
  const placeBelow = sy < containerRect.height / 2
  const top = placeBelow ? sy + 40 : sy - 40
  const left = Math.max(
    8,
    Math.min(containerRect.width - TOOLTIP_W - 8, sx - TOOLTIP_W / 2),
  )

  return (
    <motion.div
      initial={{ opacity: 0, y: placeBelow ? -4 : 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15, ease: 'easeOut' }}
      className="pointer-events-none absolute z-30 rounded-lg border border-border bg-surface-1/95 p-3 shadow-card backdrop-blur"
      style={{
        width: TOOLTIP_W,
        top,
        left,
        transform: placeBelow ? 'translateY(0)' : 'translateY(-100%)',
      }}
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="font-display text-sm font-bold leading-tight text-text-primary">
          {node.title}
        </span>
        <span className={`shrink-0 rounded-full px-2 py-0.5 font-mono text-[9px] uppercase ${stateBadgeClass(state)}`}>
          {STATE_LABEL[state]}
        </span>
      </div>
      <div className="mb-2 font-mono text-[10px] uppercase text-text-muted">
        {sectionLabel(node.section)}
      </div>
      {node.description && (
        <p className="mb-2 text-xs leading-relaxed text-text-secondary">
          {node.description}
        </p>
      )}
      <div className="mb-2 flex items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
          <div
            className={`h-full rounded-full ${
              state === 'mastered'
                ? 'bg-success'
                : state === 'decaying'
                  ? 'bg-warn'
                  : 'bg-text-primary'
            }`}
            style={{ width: `${barWidth}%` }}
          />
        </div>
        <span className="font-mono text-[10px] text-text-secondary">
          {total > 0 ? `${solved}/${total}` : pctLabel}
        </span>
      </div>
      {(node.decaying || days !== null) && (
        <div className="mb-2 flex items-center gap-1.5 text-[11px] text-text-muted">
          {node.decaying ? (
            <>
              <Flame className="h-3 w-3 text-warn" />
              <span>Знание тает {days != null ? `· ${days} дн.` : ''}</span>
            </>
          ) : (
            <>
              <Clock className="h-3 w-3" />
              <span>
                {days === 0 ? 'Решал сегодня' : `Последняя задача: ${days ?? '?'} дн. назад`}
              </span>
            </>
          )}
        </div>
      )}
      {recommended.length > 0 && (
        <div className="border-t border-border pt-2">
          <div className="mb-1 font-mono text-[9px] uppercase text-text-muted">
            Рекомендованное
          </div>
          <ul className="flex flex-col gap-0.5">
            {recommended.map((k) => (
              <li key={k.id} className="truncate text-[11px] text-text-primary">
                <span className="text-text-secondary">·</span> {k.title}
                <span className="ml-1 font-mono text-[9px] uppercase text-text-muted">
                  {humanizeDifficulty(k.difficulty)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </motion.div>
  )
}

function MiniMap({
  layout,
  scale,
  offset,
  onRecenter,
  containerSize,
}: {
  layout: Map<string, NodePos>
  scale: number
  offset: { x: number; y: number }
  onRecenter: () => void
  containerSize: { w: number; h: number }
}) {
  const SIZE = 150
  const viewW = (containerSize.w / scale) * (VIEWBOX_SIZE / containerSize.w)
  const viewH = (containerSize.h / scale) * (VIEWBOX_SIZE / containerSize.h)
  const cx = CENTER - (offset.x * VIEWBOX_SIZE) / (containerSize.w * scale)
  const cy = CENTER - (offset.y * VIEWBOX_SIZE) / (containerSize.h * scale)

  return (
    <button
      type="button"
      onClick={onRecenter}
      className="absolute bottom-4 right-4 z-20 rounded-md border border-border bg-surface-1/90 p-1.5 backdrop-blur transition-colors hover:border-text-primary"
      aria-label="Свернуть к центру"
      title="Свернуть к центру"
    >
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${VIEWBOX_SIZE} ${VIEWBOX_SIZE}`}>
        <rect x={0} y={0} width={VIEWBOX_SIZE} height={VIEWBOX_SIZE} fill="#0A0E1A" />
        {Array.from(layout.values()).map((p) => (
          <circle
            key={p.node.key}
            cx={p.x}
            cy={p.y}
            r={p.r * 0.9}
            fill={STATE_FILL[nodeState(p.node)]}
            opacity={p.node.unlocked ? 0.9 : 0.4}
          />
        ))}
        <rect
          x={cx - viewW / 2}
          y={cy - viewH / 2}
          width={viewW}
          height={viewH}
          fill="none"
          stroke="#FFFFFF"
          strokeWidth={6}
          opacity={0.8}
        />
      </svg>
    </button>
  )
}

// GraphCanvas — собственно интерактивный граф.
export function GraphCanvas({
  atlas,
  selectedKey,
  onSelect,
  highlightKeys,
}: {
  atlas: Atlas
  selectedKey: string | null
  onSelect: (k: string) => void
  highlightKeys: Set<string> | null
}) {
  const layout = useMemo(() => computeLayout(atlas), [atlas])

  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [hoveredKey, setHoveredKey] = useState<string | null>(null)
  const dragRef = useRef<{ startX: number; startY: number; ox: number; oy: number; moved: boolean } | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [containerRect, setContainerRect] = useState<DOMRect | null>(null)

  useEffect(() => {
    if (!containerRef.current) return
    const update = () => {
      if (containerRef.current) setContainerRect(containerRef.current.getBoundingClientRect())
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(containerRef.current)
    window.addEventListener('resize', update)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [])

  const onMouseDown = (e: React.MouseEvent) => {
    if ((e.target as Element).closest('[data-node]')) return
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      ox: offset.x,
      oy: offset.y,
      moved: false,
    }
  }
  const onMouseMove = (e: React.MouseEvent) => {
    if (!dragRef.current) return
    const dx = e.clientX - dragRef.current.startX
    const dy = e.clientY - dragRef.current.startY
    if (Math.abs(dx) + Math.abs(dy) > 3) dragRef.current.moved = true
    setOffset({ x: dragRef.current.ox + dx, y: dragRef.current.oy + dy })
  }
  const stopDrag = () => {
    dragRef.current = null
  }
  const reset = useCallback(() => {
    setScale(1)
    setOffset({ x: 0, y: 0 })
  }, [])

  const hoveredPos = hoveredKey ? layout.get(hoveredKey) ?? null : null

  return (
    <div
      ref={containerRef}
      className="relative flex-1 overflow-hidden"
      style={{
        minHeight: 720,
        cursor: dragRef.current ? 'grabbing' : 'grab',
        background:
          'radial-gradient(ellipse at center, #14182B 0%, #0A0E1A 60%, #05070F 100%)',
      }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={stopDrag}
      onMouseLeave={stopDrag}
    >
      <ZoomControls scale={scale} setScale={setScale} reset={reset} />
      <div
        className="h-full w-full"
        style={{
          transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
          transformOrigin: 'center center',
          transition: dragRef.current ? 'none' : 'transform 0.15s ease-out',
        }}
      >
        <svg
          viewBox={`0 0 ${VIEWBOX_SIZE} ${VIEWBOX_SIZE}`}
          width="100%"
          height="100%"
          preserveAspectRatio="xMidYMid meet"
        >
          <defs>
            {/* Phase-4: backdrop and centerSigil gradients collapsed to
                monochrome ink. Canvas reads as one material; node intensity
                is the only "color" cue. */}
            <radialGradient id="atlasBg" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.06" />
              <stop offset="60%" stopColor="#FFFFFF" stopOpacity="0.02" />
              <stop offset="100%" stopColor="#000000" stopOpacity="0" />
            </radialGradient>
            <radialGradient id="centerSigilGrad" cx="35%" cy="35%" r="75%">
              <stop offset="0%" stopColor="#FFFFFF" />
              <stop offset="60%" stopColor="#A6A6A6" />
              <stop offset="100%" stopColor="#595959" />
            </radialGradient>
          </defs>
          <circle cx={CENTER} cy={CENTER} r={RADIUS_OUTER + 80} fill="url(#atlasBg)" />
          <circle
            cx={CENTER}
            cy={CENTER}
            r={RADIUS_INNER}
            fill="none"
            stroke="#1F2434"
            strokeWidth={1}
            opacity={0.45}
          />
          <circle
            cx={CENTER}
            cy={CENTER}
            r={(RADIUS_INNER + RADIUS_OUTER) / 2}
            fill="none"
            stroke="#1F2434"
            strokeWidth={1}
            opacity={0.3}
            strokeDasharray="3 6"
          />
          <circle
            cx={CENTER}
            cy={CENTER}
            r={RADIUS_OUTER}
            fill="none"
            stroke="#1F2434"
            strokeWidth={1}
            opacity={0.45}
          />

          {atlas.edges.map((e, idx) => {
            const a = layout.get(e.from)
            const b = layout.get(e.to)
            if (!a || !b) return null
            return (
              <ConnectionLine
                key={`${e.from}-${e.to}-${idx}`}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                state={edgeState(a.node, b.node)}
              />
            )
          })}

          {CATEGORIES.map((cat, ci) => {
            const angle = -Math.PI / 2 + ci * ((2 * Math.PI) / CATEGORIES.length)
            const lx = CENTER + RADIUS_LABEL * Math.cos(angle)
            const ly = CENTER + RADIUS_LABEL * Math.sin(angle)
            const deg = (angle * 180) / Math.PI + 90
            return (
              <g key={cat.key} transform={`translate(${lx} ${ly}) rotate(${deg})`}>
                <text
                  textAnchor="middle"
                  fill="#E5E7EB"
                  opacity={0.5}
                  fontSize={28}
                  fontFamily="ui-sans-serif, system-ui"
                  fontWeight={700}
                  letterSpacing={4}
                >
                  {cat.label.toUpperCase()}
                </text>
              </g>
            )
          })}

          {Array.from(layout.values()).map((p) => {
            const faded = highlightKeys !== null && !highlightKeys.has(p.node.key)
            const selected = p.node.key === selectedKey
            const hovered = p.node.key === hoveredKey
            return (
              <g key={p.node.key} data-node={p.node.key}>
                <NodeShape
                  pos={p}
                  selected={selected}
                  faded={faded}
                  hovered={hovered}
                  onSelect={() => {
                    if (dragRef.current?.moved) return
                    onSelect(p.node.key)
                  }}
                  onHover={() => setHoveredKey(p.node.key)}
                  onLeave={() =>
                    setHoveredKey((cur) => (cur === p.node.key ? null : cur))
                  }
                />
                <text
                  x={p.x}
                  y={p.y + p.r + 14}
                  textAnchor="middle"
                  fill="#E5E7EB"
                  fontSize={12}
                  fontFamily="ui-sans-serif, system-ui"
                  opacity={faded ? 0.35 : 0.92}
                  pointerEvents="none"
                >
                  {p.node.title}
                </text>
              </g>
            )
          })}
        </svg>
      </div>

      <AnimatePresence>
        {hoveredPos && (
          <HoverTooltip
            key={hoveredPos.node.key}
            pos={transformPos(hoveredPos, scale, offset, containerRect)}
            containerRect={containerRect}
          />
        )}
      </AnimatePresence>

      {containerRect && (
        <MiniMap
          layout={layout}
          scale={scale}
          offset={offset}
          onRecenter={reset}
          containerSize={{ w: containerRect.width, h: containerRect.height }}
        />
      )}
    </div>
  )
}

// LegendStrip — visual key for the radial canvas. Lives next to GraphCanvas
// because it documents the same visual grammar (state colours / shapes).
export function LegendStrip() {
  return (
    <div className="flex h-14 items-center gap-4 overflow-x-auto border-t border-border bg-surface-1 px-4 sm:gap-6 sm:px-8 lg:px-20">
      <LegendDot fill="#7C5CFF" stroke="#FFFFFF" label="Доступен" />
      <LegendDot fill="#0A0E1A" stroke="#FFFFFF" label="В процессе" arc />
      <LegendDot fill="#22C55E" stroke="#16A34A" label="Освоен" check />
      <LegendDot fill="#0A0E1A" stroke="#F59E0B" label="Затухает" pulse />
      <LegendDot fill="#1F2434" stroke="#2A2F45" label="Закрыт" lock />
    </div>
  )
}

function LegendDot({
  fill,
  stroke,
  label,
  arc,
  check,
  pulse,
  lock,
}: {
  fill: string
  stroke: string
  label: string
  arc?: boolean
  check?: boolean
  pulse?: boolean
  lock?: boolean
}) {
  return (
    <div className="flex items-center gap-2">
      <svg width={20} height={20} viewBox="0 0 20 20">
        {pulse && (
          <circle cx={10} cy={10} r={9} fill="none" stroke={stroke} strokeWidth={1.5} opacity={0.5} />
        )}
        <circle cx={10} cy={10} r={7} fill={fill} stroke={stroke} strokeWidth={1.5} />
        {arc && <path d="M10 4 A 6 6 0 0 1 16 10" fill="none" stroke="#FFFFFF" strokeWidth={2} strokeLinecap="round" />}
        {check && (
          <path
            d="M6 10l3 3 5-6"
            fill="none"
            stroke="#0A0E1A"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
        {lock && (
          <g transform="translate(6 6)">
            <rect x={1} y={3} width={6} height={5} rx={1} fill="#475569" />
            <path d="M2 3V2a2 2 0 0 1 4 0v1" stroke="#475569" strokeWidth={1} fill="none" />
          </g>
        )}
      </svg>
      <span className="font-mono text-[12px] text-text-secondary">{label}</span>
    </div>
  )
}

function transformPos(
  p: NodePos,
  scale: number,
  offset: { x: number; y: number },
  rect: DOMRect | null,
): NodePos {
  if (!rect) return p
  const side = Math.min(rect.width, rect.height)
  const sx = (p.x / VIEWBOX_SIZE) * side
  const sy = (p.y / VIEWBOX_SIZE) * side
  const dx = sx - rect.width / 2
  const dy = sy - rect.height / 2
  const px = rect.width / 2 + dx * scale + offset.x
  const py = rect.height / 2 + dy * scale + offset.y
  return {
    ...p,
    x: (px / rect.width) * VIEWBOX_SIZE,
    y: (py / rect.height) * VIEWBOX_SIZE,
  }
}
