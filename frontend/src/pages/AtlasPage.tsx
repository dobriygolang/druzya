// /atlas — PoE2-inspired skill-progress tracker.
//
// Layout: «всё расходится из центра», на радиальные «спицы» по секциям
// (Algorithms / Data Structures / System Design / Backend / Concurrency).
// Внутри спицы — фундаментальные темы ближе к центру, продвинутые дальше.
// Hover показывает богатую подсказку, click открывает правый drawer.
//
// Источник правды — `useAtlasQuery` (REST GET /api/v1/profile/me/atlas).
// Бэкенд в Wave-3 расширен полями recommended_kata, last_solved_at,
// solved_count, total_count — мы их используем тут без изменений в proto.

import {
  useState,
  useMemo,
  useRef,
  useCallback,
  useEffect,
} from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Sparkles,
  RotateCcw,
  AlertCircle,
  X,
  Search,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Flame,
  Clock,
  ArrowRight,
} from 'lucide-react'
import { AppShellV2 } from '../components/AppShell'
import { Button } from '../components/Button'
import {
  useAtlasQuery,
  type AtlasNode,
  type Atlas,
  type KataRef,
} from '../lib/queries/profile'

// SVG-координаты — всё считается в одной системе с центром (0,0).
// Канва шире и выше, чем у предыдущей реализации, чтобы дерево «дышало».
const VIEWBOX_SIZE = 1400
const CENTER = VIEWBOX_SIZE / 2
const RADIUS_INNER = 180
const RADIUS_OUTER = 520
const RADIUS_LABEL = 620
const NODE_R_NORMAL = 26
const NODE_R_KEYSTONE = 34
const NODE_R_CENTER = 44

// 5 визуальных состояний.
type NodeState =
  | 'locked'
  | 'available'
  | 'in_progress'
  | 'mastered'
  | 'decaying'

function nodeState(n: AtlasNode): NodeState {
  if (n.decaying) return 'decaying'
  if (n.unlocked && n.progress >= 80) return 'mastered'
  if (n.unlocked && n.progress > 0) return 'in_progress'
  if (n.unlocked) return 'available'
  if (n.progress > 0) return 'in_progress'
  return 'locked'
}

const STATE_LABEL: Record<NodeState, string> = {
  locked: 'Заблокирован',
  available: 'Доступен',
  in_progress: 'В процессе',
  mastered: 'Освоен',
  decaying: 'Затухает',
}

// Edge state: 'solid' если оба unlocked, 'dashed' если только prereq unlocked,
// 'faded' если оба locked.
type EdgeState = 'solid' | 'dashed' | 'faded'

function edgeState(from: AtlasNode | undefined, to: AtlasNode | undefined): EdgeState {
  if (!from || !to) return 'faded'
  if (from.unlocked && to.unlocked) return 'solid'
  if (from.unlocked) return 'dashed'
  return 'faded'
}

function sectionLabel(section: string): string {
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

// Категории = радиальные спицы. Bind-сектора по 72° (5 категорий, всё что
// не попало — в Algorithms по умолчанию). Order имеет значение: визуально
// расходится с верхней-правой стороны по часовой.
const CATEGORIES: { key: string; label: string; sections: string[] }[] = [
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

const STATUS_FILTERS: { key: NodeState | 'all'; label: string }[] = [
  { key: 'all', label: 'Все' },
  { key: 'locked', label: 'Закрытые' },
  { key: 'available', label: 'Доступные' },
  { key: 'in_progress', label: 'В процессе' },
  { key: 'mastered', label: 'Освоенные' },
  { key: 'decaying', label: 'Затухающие' },
]

function categoryOf(node: AtlasNode): string {
  for (const c of CATEGORIES) if (c.sections.includes(node.section)) return c.key
  // Если секция неизвестна — пихаем в Algorithms, чтобы спица не «потерялась».
  return CATEGORIES[0].key
}

function daysSince(iso?: string): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  const days = Math.floor((Date.now() - t) / (1000 * 60 * 60 * 24))
  return days < 0 ? 0 : days
}

// ── Layout: PoE2-style.
//
// Каждой категории — своя угловая «спица» (центр сектора). Внутри сектора
// мы располагаем ноды по двум осям:
//   - расстояние от центра берётся из BFS-глубины (от center_node по edges);
//     keystone/ascendant сдвигаются дальше для веса;
//   - угол распределяется веером ±sectorWidth/2 вокруг центра спицы.
//
// Это даёт ощущение «дерева, расходящегося из центра», а не плоского кольца.
type NodePos = {
  node: AtlasNode
  x: number
  y: number
  r: number
  angle: number // angle of the spoke (radians), used for label rotation
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
  // Ноды без рёбер с центром: даём глубину 2 (ставим в средне-удалённое кольцо).
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
  // Группируем по категории.
  const byCat = new Map<string, AtlasNode[]>()
  for (const c of CATEGORIES) byCat.set(c.key, [])
  for (const n of others) {
    const cat = categoryOf(n)
    byCat.get(cat)!.push(n)
  }

  const sectorCount = CATEGORIES.length
  const sectorAngle = (2 * Math.PI) / sectorCount
  // Внутри сектора используем 70% его ширины — оставляем зазор между спицами.
  const sectorUseRatio = 0.7

  CATEGORIES.forEach((cat, ci) => {
    // Сектор центрируется на углу = -π/2 + ci * sectorAngle (start с верха).
    const center0 = -Math.PI / 2 + ci * sectorAngle
    const half = (sectorAngle * sectorUseRatio) / 2
    const items = byCat.get(cat.key) ?? []
    if (items.length === 0) return

    // Group by depth — каждая «глубина» = одно радиальное кольцо внутри спицы.
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
      // Радиус: depth=1 → RADIUS_INNER; depth=maxDepth → RADIUS_OUTER.
      const t = maxDepth === 1 ? 0 : (d - 1) / (maxDepth - 1)
      const baseRadius = RADIUS_INNER + (RADIUS_OUTER - RADIUS_INNER) * t
      ring.forEach((n, idx) => {
        const r =
          n.kind === 'keystone'
            ? NODE_R_KEYSTONE
            : n.kind === 'ascendant'
              ? NODE_R_KEYSTONE + 4
              : NODE_R_NORMAL
        // Если в кольце одна нода — ставим ровно на центр спицы.
        // Иначе равномерно веером в пределах ±half.
        const a =
          ring.length === 1
            ? center0
            : center0 - half + (2 * half * idx) / (ring.length - 1)
        // ascendant визуально «дальше» — небольшой сдвиг наружу.
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

// ── Visual constants per state. Цвета берём из tailwind-темы (accent/success/
// warn/danger/cyan/border) — рендерим через css var, чтобы не пересобирать
// кучу классов внутри SVG.
const STATE_FILL: Record<NodeState, string> = {
  locked: '#1F2434',
  available: '#7C5CFF',
  in_progress: '#0A0E1A',
  mastered: '#22C55E',
  decaying: '#0A0E1A',
}
const STATE_STROKE: Record<NodeState, string> = {
  locked: '#2A2F45',
  available: '#A78BFA',
  in_progress: '#A78BFA',
  mastered: '#16A34A',
  decaying: '#F59E0B',
}

// ── NodeShape (SVG): рисует ноду со всеми визуальными подсказками
// её состояния. На клик — открывает drawer; на hover — поднимает tooltip.
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

  // In-progress arc fill (показываем % прогресса дугой).
  const pct = Math.min(100, Math.max(0, node.progress))
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
      {/* Decay pulsing ring */}
      {state === 'decaying' && (
        <circle cx={x} cy={y} r={r + 8} fill="none" stroke="#F59E0B" strokeWidth={2} opacity={0.5}>
          <animate attributeName="r" from={r + 4} to={r + 14} dur="1.6s" repeatCount="indefinite" />
          <animate attributeName="opacity" from="0.6" to="0" dur="1.6s" repeatCount="indefinite" />
        </circle>
      )}
      {/* Selection glow */}
      {(selected || hovered) && (
        <circle
          cx={x}
          cy={y}
          r={r + 6}
          fill="none"
          stroke="#22D3EE"
          strokeWidth={selected ? 3 : 2}
          opacity={selected ? 0.9 : 0.55}
        />
      )}
      {/* Body */}
      {isHex ? (
        <polygon points={hexPoints(x, y, r)} fill={fill} stroke={stroke} strokeWidth={2} />
      ) : (
        <circle cx={x} cy={y} r={r} fill={fill} stroke={stroke} strokeWidth={2} />
      )}
      {/* Center node — special accent */}
      {isCenter && (
        <circle cx={x} cy={y} r={r - 8} fill="#7C5CFF" opacity={0.4} />
      )}
      {/* Progress arc (in_progress) */}
      {arc && (
        <path d={arc} fill="none" stroke="#A78BFA" strokeWidth={4} strokeLinecap="round" />
      )}
      {/* Mastered check icon */}
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
      {/* Locked padlock */}
      {state === 'locked' && (
        <g transform={`translate(${x - 6}, ${y - 6})`} opacity={0.7}>
          <rect x={1} y={5} width={10} height={7} rx={1.5} fill="#475569" />
          <path d="M3 5V3.5a3 3 0 0 1 6 0V5" stroke="#475569" strokeWidth={1.5} fill="none" />
        </g>
      )}
    </g>
  )
}

// SVG arc helper: рисует часть круга (centerX, centerY, radius) от
// startAngle до endAngle (в градусах, 0 = top, по часовой).
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

// ── ConnectionLine (SVG).
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
    state === 'solid' ? '#7C5CFF' : state === 'dashed' ? '#A78BFA' : '#2A2F45'
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

// ── HoverTooltip — rich card на hover. Auto-position сверху или снизу,
// чтобы не вылезать за viewport.
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
  const pct =
    total > 0 ? Math.min(100, Math.round((solved / total) * 100)) : node.progress
  const recommended = (node.recommended_kata ?? []).slice(0, 2)

  // Преобразуем SVG-координаты в HTML-координаты внутри контейнера.
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
                  : 'bg-accent'
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="font-mono text-[10px] text-text-secondary">
          {total > 0 ? `${solved}/${total}` : `${pct}%`}
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
                  {k.difficulty}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </motion.div>
  )
}

// ── FilterBar — search + category chips + status chips.
function FilterBar({
  query,
  setQuery,
  category,
  setCategory,
  status,
  setStatus,
}: {
  query: string
  setQuery: (s: string) => void
  category: string
  setCategory: (s: string) => void
  status: NodeState | 'all'
  setStatus: (s: NodeState | 'all') => void
}) {
  return (
    <div className="flex flex-col gap-3 border-b border-border bg-surface-1 px-4 py-3 sm:px-8 lg:px-20">
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск по названию навыка…"
            className="h-9 w-full rounded-md border border-border bg-bg pl-9 pr-3 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
          />
        </div>
        {(query || category !== 'all' || status !== 'all') && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setQuery('')
              setCategory('all')
              setStatus('all')
            }}
          >
            Сбросить
          </Button>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        <FilterChip
          active={category === 'all'}
          onClick={() => setCategory('all')}
          label="Все категории"
        />
        {CATEGORIES.map((c) => (
          <FilterChip
            key={c.key}
            active={category === c.key}
            onClick={() => setCategory(c.key)}
            label={c.label}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {STATUS_FILTERS.map((s) => (
          <FilterChip
            key={s.key}
            active={status === s.key}
            onClick={() => setStatus(s.key)}
            label={s.label}
            tone={s.key === 'mastered' ? 'success' : s.key === 'decaying' ? 'warn' : 'default'}
          />
        ))}
      </div>
    </div>
  )
}

function FilterChip({
  active,
  onClick,
  label,
  tone = 'default',
}: {
  active: boolean
  onClick: () => void
  label: string
  tone?: 'default' | 'success' | 'warn'
}) {
  const base = 'rounded-full px-3 py-1 text-xs uppercase transition-colors'
  const activeCls =
    tone === 'success'
      ? 'border-success/60 bg-success/15 text-success border'
      : tone === 'warn'
        ? 'border-warn/60 bg-warn/15 text-warn border'
        : 'border-accent bg-accent/15 text-text-primary border'
  const inactiveCls =
    'border border-border bg-surface-2 text-text-secondary hover:border-border-strong'
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${base} ${active ? activeCls : inactiveCls}`}
    >
      {label}
    </button>
  )
}

// ── ZoomControls — pan/zoom через transform: scale + drag. Reset
// возвращает scale=1, offset=(0,0).
function ZoomControls({
  scale,
  setScale,
  reset,
}: {
  scale: number
  setScale: (s: number) => void
  reset: () => void
}) {
  return (
    <div className="absolute right-4 top-4 z-20 flex flex-col gap-1 rounded-md border border-border bg-surface-1/90 p-1 backdrop-blur">
      <button
        type="button"
        onClick={() => setScale(Math.min(2, scale + 0.15))}
        aria-label="Zoom in"
        className="rounded p-1.5 text-text-secondary hover:bg-surface-2"
      >
        <ZoomIn className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => setScale(Math.max(0.5, scale - 0.15))}
        aria-label="Zoom out"
        className="rounded p-1.5 text-text-secondary hover:bg-surface-2"
      >
        <ZoomOut className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={reset}
        aria-label="Reset view"
        className="rounded p-1.5 text-text-secondary hover:bg-surface-2"
      >
        <Maximize2 className="h-4 w-4" />
      </button>
    </div>
  )
}

// ── MiniMap — превью всего дерева в правом нижнем углу + viewport rect.
// Click на минимапу — recenter (offset = 0,0, scale = 1).
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
  // Окно viewport: при transform translate(offset)+scale(s) центр окна
  // показывает viewBox-координаты (CENTER - offset/scale).
  const viewW = (containerSize.w / scale) * (VIEWBOX_SIZE / containerSize.w)
  const viewH = (containerSize.h / scale) * (VIEWBOX_SIZE / containerSize.h)
  const cx = CENTER - (offset.x * VIEWBOX_SIZE) / (containerSize.w * scale)
  const cy = CENTER - (offset.y * VIEWBOX_SIZE) / (containerSize.h * scale)

  return (
    <button
      type="button"
      onClick={onRecenter}
      className="absolute bottom-4 right-4 z-20 rounded-md border border-border bg-surface-1/90 p-1.5 backdrop-blur transition-colors hover:border-accent"
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
          stroke="#22D3EE"
          strokeWidth={6}
          opacity={0.8}
        />
      </svg>
    </button>
  )
}

// ── GraphCanvas — собственно интерактивный граф. SVG + pan через mousedown
// + drag, zoom через ZoomControls. Hover показывает tooltip, click — drawer.
function GraphCanvas({
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
          {/* subtle radial bg ring */}
          <defs>
            <radialGradient id="atlasBg" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#2D1B4D" stopOpacity="0.55" />
              <stop offset="60%" stopColor="#14182B" stopOpacity="0.2" />
              <stop offset="100%" stopColor="#0A0E1A" stopOpacity="0" />
            </radialGradient>
          </defs>
          <circle cx={CENTER} cy={CENTER} r={RADIUS_OUTER + 80} fill="url(#atlasBg)" />
          {/* concentric guide rings */}
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

          {/* edges */}
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

          {/* category labels around perimeter */}
          {CATEGORIES.map((cat, ci) => {
            const angle = -Math.PI / 2 + ci * ((2 * Math.PI) / CATEGORIES.length)
            const lx = CENTER + RADIUS_LABEL * Math.cos(angle)
            const ly = CENTER + RADIUS_LABEL * Math.sin(angle)
            // Поворот на угол спицы, чтобы лейблы «следовали» дуге.
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

          {/* nodes + labels */}
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
                {/* full title under node — больше не аббревиатура */}
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

      {/* Hover tooltip — поверх transformed-слоя, считается в координатах
          контейнера, чтобы не масштабироваться с zoom. */}
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

// transformPos — учитывает zoom/pan, чтобы tooltip следовал за реальной
// позицией ноды в контейнере.
function transformPos(
  p: NodePos,
  scale: number,
  offset: { x: number; y: number },
  rect: DOMRect | null,
): NodePos {
  if (!rect) return p
  // SVG растянут на весь контейнер (preserveAspectRatio meet) — определяем
  // эффективную сторону, чтобы перевести viewBox-координаты в пиксели.
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

// ── NodeDrawer — правый drawer с прогрессом, decay, рекомендациями, related.
function NodeDrawer({
  atlas,
  node,
  onClose,
  onSelectNeighbour,
}: {
  atlas: Atlas
  node: AtlasNode
  onClose: () => void
  onSelectNeighbour: (k: string) => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const state = nodeState(node)
  const days = daysSince(node.last_solved_at)
  const solved = node.solved_count ?? 0
  const total = node.total_count ?? 0
  const pct = total > 0 ? Math.min(100, Math.round((solved / total) * 100)) : node.progress
  const recommended = node.recommended_kata ?? []

  const prereqs = atlas.edges
    .filter((e) => e.to === node.key)
    .map((e) => atlas.nodes.find((n) => n.key === e.from))
    .filter((n): n is AtlasNode => Boolean(n))
  const unlocks = atlas.edges
    .filter((e) => e.from === node.key)
    .map((e) => atlas.nodes.find((n) => n.key === e.to))
    .filter((n): n is AtlasNode => Boolean(n))

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-end" role="dialog" aria-modal="true">
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        role="button"
        tabIndex={-1}
        aria-label="Закрыть"
      />
      <aside className="relative h-full w-full max-w-[440px] overflow-y-auto bg-surface-1 shadow-card">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-surface-1 px-5 py-3">
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[10px] font-semibold uppercase ${stateBadgeClass(state)}`}>
            {STATE_LABEL[state]}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-text-secondary hover:bg-surface-2"
            aria-label="Закрыть"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-col gap-5 p-5">
          <div>
            <h2 className="font-display text-[22px] font-bold leading-tight text-text-primary">
              {node.title}
            </h2>
            <span className="mt-0.5 block font-mono text-xs text-text-muted">
              {sectionLabel(node.section)} · {node.kind}
            </span>
          </div>

          {node.description && (
            <p className="rounded-lg bg-surface-2 p-4 text-[13px] leading-relaxed text-text-secondary">
              {node.description}
            </p>
          )}

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                Прогресс
              </span>
              <span className="font-mono text-xs text-text-secondary">
                {total > 0 ? `${solved} из ${total} задач` : `${pct}%`}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-surface-2">
              <div
                className={`h-full rounded-full ${
                  state === 'mastered'
                    ? 'bg-gradient-to-r from-success to-cyan'
                    : state === 'decaying'
                      ? 'bg-gradient-to-r from-warn to-danger'
                      : 'bg-gradient-to-r from-cyan to-accent'
                }`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>

          {(node.decaying || days !== null) && (
            <div
              className={`flex items-start gap-3 rounded-lg p-3 ${
                node.decaying ? 'bg-warn/10 border border-warn/30' : 'bg-surface-2'
              }`}
            >
              {node.decaying ? (
                <Flame className="h-4 w-4 shrink-0 text-warn" />
              ) : (
                <Clock className="h-4 w-4 shrink-0 text-text-muted" />
              )}
              <div className="flex flex-col gap-0.5">
                <span className="text-sm text-text-primary">
                  {node.decaying
                    ? `Ты не решал эту тему ${days ?? '?'} дней — знание тает`
                    : days === 0
                      ? 'Решал сегодня'
                      : `Последняя задача: ${days ?? '?'} дн. назад`}
                </span>
                {node.decaying && (
                  <span className="text-xs text-text-muted">
                    Реши хотя бы одну задачу, чтобы остановить decay.
                  </span>
                )}
              </div>
            </div>
          )}

          {recommended.length > 0 ? (
            <div className="flex flex-col gap-2">
              <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                Рекомендованные ката
              </span>
              <ul className="flex flex-col gap-1.5">
                {recommended.slice(0, 5).map((k) => (
                  <KataItem key={k.id} k={k} />
                ))}
              </ul>
              <Link to={`/daily/kata/${encodeURIComponent(recommended[0].id)}`} className="block">
                <Button
                  size="md"
                  iconRight={<ArrowRight className="h-4 w-4" />}
                  className="w-full"
                >
                  Решить рекомендованное сейчас
                </Button>
              </Link>
            </div>
          ) : (
            <div className="rounded-lg bg-surface-2 p-3 text-xs text-text-muted">
              Каталог ката для этой темы ещё не размечен — попробуй открыть{' '}
              <Link to="/arena" className="text-accent hover:underline">
                Арену с фильтром по теме
              </Link>
              .
            </div>
          )}

          {(prereqs.length > 0 || unlocks.length > 0) && (
            <div className="flex flex-col gap-3 border-t border-border pt-4">
              {prereqs.length > 0 && (
                <RelatedGroup
                  title="Открывает доступ к этому"
                  nodes={prereqs}
                  onClick={onSelectNeighbour}
                />
              )}
              {unlocks.length > 0 && (
                <RelatedGroup
                  title="Этот узел открывает"
                  nodes={unlocks}
                  onClick={onSelectNeighbour}
                />
              )}
            </div>
          )}
        </div>
      </aside>
    </div>
  )
}

function stateBadgeClass(state: NodeState): string {
  switch (state) {
    case 'mastered':
      return 'bg-success/15 text-success'
    case 'decaying':
      return 'bg-warn/15 text-warn'
    case 'in_progress':
      return 'bg-accent/15 text-accent-hover'
    case 'available':
      return 'bg-cyan/15 text-cyan'
    default:
      return 'bg-surface-2 text-text-muted'
  }
}

function KataItem({ k }: { k: KataRef }) {
  const diffColor =
    k.difficulty === 'easy'
      ? 'text-success'
      : k.difficulty === 'medium'
        ? 'text-warn'
        : 'text-danger'
  return (
    <li>
      <Link
        to={`/daily/kata/${encodeURIComponent(k.id)}`}
        className="flex items-center justify-between rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-text-primary transition-colors hover:border-accent"
      >
        <div className="flex min-w-0 flex-col">
          <span className="truncate">{k.title}</span>
          <span className={`font-mono text-[10px] uppercase ${diffColor}`}>
            {k.difficulty}
            {k.estimated_minutes ? ` · ~${k.estimated_minutes} мин` : ''}
          </span>
        </div>
        <ArrowRight className="h-4 w-4 shrink-0 text-text-muted" />
      </Link>
    </li>
  )
}

function RelatedGroup({
  title,
  nodes,
  onClick,
}: {
  title: string
  nodes: AtlasNode[]
  onClick: (k: string) => void
}) {
  return (
    <div>
      <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-text-muted">
        {title}
      </span>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {nodes.map((n) => (
          <button
            key={n.key}
            type="button"
            onClick={() => onClick(n.key)}
            className="rounded-md border border-border bg-surface-2 px-2.5 py-1 text-xs text-text-primary hover:border-accent"
          >
            {n.title}
          </button>
        ))}
      </div>
    </div>
  )
}

// ── HeaderStrip / GraphSkeleton / EmptyProgressCTA / LegendStrip
function HeaderStrip({
  unlocked,
  total,
  isError,
  onRetry,
}: {
  unlocked: number
  total: number
  isError: boolean
  onRetry: () => void
}) {
  return (
    <div className="flex flex-col items-start gap-4 border-b border-border bg-surface-1 px-4 py-4 sm:px-8 lg:flex-row lg:items-center lg:justify-between lg:px-20 lg:py-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-bold leading-[1.1] text-text-primary lg:text-[28px]">
          Skill Atlas
        </h1>
        <p className="font-mono text-xs text-text-muted">
          {isError ? 'Не удалось загрузить' : `${unlocked} / ${total} узлов открыто`}
        </p>
      </div>
      <div className="flex items-center gap-2">
        {isError && (
          <Button
            variant="ghost"
            size="sm"
            icon={<RotateCcw className="h-3.5 w-3.5" />}
            onClick={onRetry}
          >
            Повторить
          </Button>
        )}
      </div>
    </div>
  )
}

function GraphSkeleton() {
  return (
    <div className="relative flex-1" style={{ minHeight: 720 }}>
      <div
        className="absolute inset-0 animate-pulse"
        style={{
          background:
            'radial-gradient(ellipse at center, #14182B 0%, #0A0E1A 60%, #05070F 100%)',
        }}
      />
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 font-mono text-xs text-text-muted">
        Загружаем атлас…
      </div>
    </div>
  )
}

function EmptyProgressCTA() {
  return (
    <div className="flex flex-1 items-center justify-center bg-bg p-8">
      <div className="flex max-w-lg flex-col items-center gap-5 text-center">
        <span className="grid h-16 w-16 place-items-center rounded-full bg-accent/15 text-accent-hover">
          <Sparkles className="h-7 w-7" />
        </span>
        <div className="flex flex-col gap-2">
          <h2 className="font-display text-xl font-bold text-text-primary">
            Атлас пока пуст
          </h2>
          <p className="text-sm text-text-secondary">
            Реши первую задачу — и сюда придут первые навыки. Атлас покажет, что ты
            уже освоил, какие темы стоит подтянуть и какие следующие шаги
            рекомендованы.
          </p>
        </div>
        <Link to="/daily/kata/two-sum">
          <Button size="md" iconRight={<ArrowRight className="h-4 w-4" />}>
            Начни с Two Sum
          </Button>
        </Link>
      </div>
    </div>
  )
}

function LegendStrip() {
  return (
    <div className="flex h-14 items-center gap-4 overflow-x-auto border-t border-border bg-surface-1 px-4 sm:gap-6 sm:px-8 lg:px-20">
      <LegendDot fill="#7C5CFF" stroke="#A78BFA" label="Доступен" />
      <LegendDot fill="#0A0E1A" stroke="#A78BFA" label="В процессе" arc />
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
        {arc && <path d="M10 4 A 6 6 0 0 1 16 10" fill="none" stroke="#A78BFA" strokeWidth={2} strokeLinecap="round" />}
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

// ── AtlasPage — оркестратор. Мостит filter bar → highlight set → drawer.
export default function AtlasPage() {
  const { data: atlas, isError, isLoading, refetch } = useAtlasQuery()
  const total = atlas?.nodes.length ?? 0
  const unlocked = atlas?.nodes.filter((n) => n.unlocked).length ?? 0

  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<string>('all')
  const [status, setStatus] = useState<NodeState | 'all'>('all')

  const highlightKeys = useMemo<Set<string> | null>(() => {
    if (!atlas) return null
    const noFilters = !query.trim() && category === 'all' && status === 'all'
    if (noFilters) return null
    const cat = CATEGORIES.find((c) => c.key === category)
    const q = query.trim().toLowerCase()
    const keys = new Set<string>()
    for (const n of atlas.nodes) {
      if (cat && !cat.sections.includes(n.section)) continue
      if (q && !n.title.toLowerCase().includes(q)) continue
      if (status !== 'all' && nodeState(n) !== status) continue
      keys.add(n.key)
    }
    return keys
  }, [atlas, query, category, status])

  const isProgressEmpty = !!atlas && atlas.nodes.length > 0 && unlocked === 0

  const selectedNode =
    atlas && selectedKey ? atlas.nodes.find((n) => n.key === selectedKey) ?? null : null

  return (
    <AppShellV2>
      <div className="flex flex-col">
        <HeaderStrip
          unlocked={unlocked}
          total={total}
          isError={isError}
          onRetry={() => void refetch()}
        />
        {!isLoading && !isError && atlas && atlas.nodes.length > 0 && (
          <FilterBar
            query={query}
            setQuery={setQuery}
            category={category}
            setCategory={setCategory}
            status={status}
            setStatus={setStatus}
          />
        )}
        <div className="flex flex-col lg:flex-row">
          {isLoading ? (
            <GraphSkeleton />
          ) : isError || !atlas ? (
            <div className="flex flex-1 items-center justify-center bg-bg p-8">
              <div className="flex max-w-md flex-col items-center gap-3 text-center">
                <AlertCircle className="h-8 w-8 text-danger" />
                <p className="text-sm text-text-secondary">
                  Не удалось загрузить атлас. Попробуй обновить — если ошибка
                  повторяется, проверь подключение.
                </p>
                <Button
                  variant="primary"
                  icon={<RotateCcw className="h-3.5 w-3.5" />}
                  onClick={() => void refetch()}
                >
                  Повторить
                </Button>
              </div>
            </div>
          ) : atlas.nodes.length === 0 ? (
            <EmptyProgressCTA />
          ) : isProgressEmpty ? (
            <div className="flex flex-1 flex-col">
              <EmptyProgressCTA />
              <GraphCanvas
                atlas={atlas}
                selectedKey={selectedKey}
                onSelect={setSelectedKey}
                highlightKeys={highlightKeys}
              />
            </div>
          ) : (
            <GraphCanvas
              atlas={atlas}
              selectedKey={selectedKey}
              onSelect={setSelectedKey}
              highlightKeys={highlightKeys}
            />
          )}
        </div>
        <LegendStrip />
      </div>
      {selectedNode && atlas && (
        <NodeDrawer
          atlas={atlas}
          node={selectedNode}
          onClose={() => setSelectedKey(null)}
          onSelectNeighbour={(k) => setSelectedKey(k)}
        />
      )}
    </AppShellV2>
  )
}
