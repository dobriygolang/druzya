// /atlas — интерактивный skill-progress tracker.
//
// Исходная страница была декоративным SVG без смысла. Теперь она:
//   1. Показывает 5 визуальных состояний нод (locked / available / in-progress
//      / mastered / decaying), отражающих реальный прогресс пользователя.
//   2. Отдаёт правый drawer с «Решено N из M», статусом decay, списком
//      рекомендованных ката и связанными нодами при клике на любой узел.
//   3. Поддерживает pan/zoom мышью + кнопками сверху для удобства на больших
//      деревьях.
//   4. Имеет filter bar: search by name + chip-фильтры по category / status.
//   5. Empty-state CTA «Начни с Two Sum →» если у пользователя пока ноль
//      открытых нод.
//
// Источник правды — `useAtlasQuery` (REST GET /api/v1/profile/me/atlas).
// Бэкенд в Wave-2 расширен полями recommended_kata, last_solved_at,
// solved_count, total_count — см. proto/druz9/v1/profile.proto и
// backend/services/profile/app/atlas.go.

import {
  useState,
  useMemo,
  useRef,
  useCallback,
  useEffect,
} from 'react'
import { Link } from 'react-router-dom'
import {
  Sparkles,
  RotateCcw,
  Hexagon,
  AlertCircle,
  X,
  Search,
  ZoomIn,
  ZoomOut,
  Maximize2,
  CheckCircle2,
  Lock,
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

const HEX_CLIP = 'polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)'

const CANVAS_W = 960
const CANVAS_H = 700
const CENTER_X = CANVAS_W / 2
const CENTER_Y = CANVAS_H / 2
const RADIUS_INNER = 140
const RADIUS_OUTER = 260
const NODE_SIZE_NORMAL = 56
const NODE_SIZE_KEYSTONE = 72
const NODE_SIZE_CENTER = 96

// 5 визуальных состояний из брифа. Считаются на лету через nodeState(node).
type NodeState =
  | 'locked' // нет prereq → серый
  | 'available' // открыт но прогресс 0
  | 'in_progress' // 0 < progress < 80
  | 'mastered' // progress >= 80
  | 'decaying' // backend.decaying === true

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

const STATE_COLOR: Record<NodeState, string> = {
  locked: 'border border-border bg-surface-2',
  available: 'bg-accent text-text-primary',
  in_progress: 'bg-bg border-2 border-dashed border-accent-hover ring-2 ring-accent/30 animate-pulse',
  mastered: 'bg-success text-text-primary shadow-glow',
  decaying: 'bg-bg border-2 border-warn ring-2 ring-warn/40 animate-pulse',
}

// Edge state: 'solid' если оба unlocked, 'dashed' если только prereq unlocked,
// 'faded' если оба locked. См. AtlasEdge в proto.
type EdgeState = 'solid' | 'dashed' | 'faded'

function edgeState(from: AtlasNode | undefined, to: AtlasNode | undefined): EdgeState {
  if (!from || !to) return 'faded'
  if (from.unlocked && to.unlocked) return 'solid'
  if (from.unlocked) return 'dashed'
  return 'faded'
}

type NodePos = { node: AtlasNode; x: number; y: number; size: number }

function computeLayout(atlas: Atlas): Map<string, NodePos> {
  const positions = new Map<string, NodePos>()
  const center = atlas.nodes.find((n) => n.key === atlas.center_node)
  const others = atlas.nodes.filter((n) => n.key !== atlas.center_node)
  const outer = others.filter((n) => n.kind === 'keystone' || n.kind === 'ascendant')
  const inner = others.filter((n) => n.kind !== 'keystone' && n.kind !== 'ascendant')

  if (center) {
    positions.set(center.key, {
      node: center,
      x: CENTER_X,
      y: CENTER_Y,
      size: NODE_SIZE_CENTER,
    })
  }
  const placeRing = (list: AtlasNode[], radius: number, size: number) => {
    if (list.length === 0) return
    const step = (2 * Math.PI) / list.length
    list.forEach((n, idx) => {
      const angle = -Math.PI / 2 + step * idx
      positions.set(n.key, {
        node: n,
        x: CENTER_X + radius * Math.cos(angle),
        y: CENTER_Y + radius * Math.sin(angle),
        size,
      })
    })
  }
  placeRing(outer, RADIUS_OUTER, NODE_SIZE_KEYSTONE)
  placeRing(inner, RADIUS_INNER, NODE_SIZE_NORMAL)
  return positions
}

function shortLabel(title: string): string {
  const main = title.split(':')[0].trim()
  const words = main.split(/\s+/).filter(Boolean)
  if (words.length === 1) return words[0].slice(0, 4).toUpperCase()
  return words
    .slice(0, 3)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')
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
    sections: ['SECTION_GO', 'SECTION_SQL', 'go', 'sql'],
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

function daysSince(iso?: string): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  const days = Math.floor((Date.now() - t) / (1000 * 60 * 60 * 24))
  return days < 0 ? 0 : days
}

// ── NodeShape — кликабельный «узел» с одним из 5 визуальных состояний.
function NodeShape({
  pos,
  selected,
  faded,
  onClick,
}: {
  pos: NodePos
  selected: boolean
  faded: boolean
  onClick: () => void
}) {
  const { node, x, y, size } = pos
  const state = nodeState(node)
  const stateClass = STATE_COLOR[state]
  const shapeStyle =
    node.kind === 'keystone' || node.kind === 'ascendant'
      ? { clipPath: HEX_CLIP }
      : {}
  const selectedRing = selected ? 'ring-4 ring-cyan ring-offset-2 ring-offset-bg z-10' : ''
  const fadedClass = faded ? 'opacity-25' : ''
  const masteredCheck = state === 'mastered' && (
    <span className="absolute -right-1 -top-1 grid h-5 w-5 place-items-center rounded-full bg-success text-bg shadow">
      <CheckCircle2 className="h-3.5 w-3.5" />
    </span>
  )
  const lockBadge = state === 'locked' && (
    <span className="absolute -right-1 -top-1 grid h-5 w-5 place-items-center rounded-full bg-surface-3 text-text-muted">
      <Lock className="h-3 w-3" />
    </span>
  )
  return (
    <button
      type="button"
      onClick={onClick}
      className={`absolute grid place-items-center font-display font-bold transition-transform hover:scale-110 ${stateClass} ${selectedRing} ${fadedClass}`}
      style={{
        left: x - size / 2,
        top: y - size / 2,
        width: size,
        height: size,
        borderRadius: node.kind === 'keystone' || node.kind === 'ascendant' ? 0 : size / 2,
        ...shapeStyle,
      }}
      aria-label={`${node.title} — ${STATE_LABEL[state]}`}
    >
      <span className="px-1 text-center font-mono text-[9px] uppercase tracking-[0.06em]">
        {shortLabel(node.title)}
      </span>
      {masteredCheck}
      {lockBadge}
    </button>
  )
}

// ── ConnectionLine — рисует ребро prereq → unlock с тремя состояниями.
// Также, если оба unlocked, добавляется маленькая стрелочка в середине, чтобы
// направление было читаемо.
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
  const dx = x2 - x1
  const dy = y2 - y1
  const len = Math.sqrt(dx * dx + dy * dy)
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI
  let cls = ''
  if (state === 'solid') cls = 'bg-accent h-[2px]'
  else if (state === 'dashed')
    cls = 'h-px bg-[length:8px_1px] bg-no-repeat bg-[linear-gradient(to_right,theme(colors.accent.hover/.7)_50%,transparent_50%)]'
  else cls = 'bg-border h-px opacity-30'
  return (
    <div
      className={`absolute origin-left ${cls}`}
      style={{
        left: x1,
        top: y1,
        width: len,
        transform: `rotate(${angle}deg)`,
      }}
    />
  )
}

// ── FilterBar — search + category chips + status chips. Поддерживает «сброс».
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
  const inactiveCls = 'border border-border bg-surface-2 text-text-secondary hover:border-border-strong'
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

// ── ZoomControls — pan/zoom через transform: scale + drag. Mini-mape не
// делаем (брифа — «опционально»). Reset возвращает scale=1, offset=(0,0).
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

// ── GraphCanvas — собственно интерактивный граф. Pan через mousedown + drag,
// zoom через ZoomControls (или wheel, если хочется потом).
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
  const positions = Array.from(layout.values())

  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const dragRef = useRef<{ startX: number; startY: number; ox: number; oy: number } | null>(null)

  const onMouseDown = (e: React.MouseEvent) => {
    // Не перехватываем клик по узлу — он обработается своим onClick.
    if ((e.target as HTMLElement).closest('button')) return
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      ox: offset.x,
      oy: offset.y,
    }
  }
  const onMouseMove = (e: React.MouseEvent) => {
    if (!dragRef.current) return
    setOffset({
      x: dragRef.current.ox + (e.clientX - dragRef.current.startX),
      y: dragRef.current.oy + (e.clientY - dragRef.current.startY),
    })
  }
  const stopDrag = () => {
    dragRef.current = null
  }
  const reset = useCallback(() => {
    setScale(1)
    setOffset({ x: 0, y: 0 })
  }, [])

  return (
    <div
      className="relative flex-1 overflow-hidden bg-bg"
      style={{ minHeight: 720, cursor: dragRef.current ? 'grabbing' : 'grab' }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={stopDrag}
      onMouseLeave={stopDrag}
    >
      <ZoomControls scale={scale} setScale={setScale} reset={reset} />
      <div
        className="pointer-events-none absolute"
        style={{
          width: 800,
          height: 800,
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          background: 'radial-gradient(ellipse at center, #2D1B4D 0%, transparent 70%)',
          opacity: 0.55,
        }}
      />
      <div
        className="relative"
        style={{
          width: CANVAS_W,
          height: CANVAS_H,
          transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
          transformOrigin: 'center center',
          margin: '0 auto',
        }}
      >
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
        {positions.map((p) => (
          <NodeShape
            key={p.node.key}
            pos={p}
            selected={p.node.key === selectedKey}
            faded={highlightKeys !== null && !highlightKeys.has(p.node.key)}
            onClick={() => onSelect(p.node.key)}
          />
        ))}
      </div>
    </div>
  )
}

// ── NodeDrawer — правый drawer с прогрессом, decay, рекомендациями, related.
// На mobile — full-width снизу. Закрывается клавишей Esc и кликом по подложке.
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
  // Esc — close.
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

  // Связанные ноды: prereq (edge.to === node.key) и unlocks (edge.from === node.key).
  const prereqs = atlas.edges
    .filter((e) => e.to === node.key)
    .map((e) => atlas.nodes.find((n) => n.key === e.from))
    .filter((n): n is AtlasNode => Boolean(n))
  const unlocks = atlas.edges
    .filter((e) => e.from === node.key)
    .map((e) => atlas.nodes.find((n) => n.key === e.to))
    .filter((n): n is AtlasNode => Boolean(n))

  // CTA «Решить рекомендованное сейчас» — пушит на первый рекомендованный
  // ката. Если нет рекомендаций (новая, ещё не настроенная нода) — вместо
  // этого ведёт на /arena с фильтром по секции.
  const primaryHref =
    recommended.length > 0
      ? `/daily/kata/${encodeURIComponent(recommended[0].id)}`
      : `/arena?skill=${encodeURIComponent(node.key)}`

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

          {/* Прогресс */}
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

          {/* Decay / last solved */}
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

          {/* Recommended kata */}
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

          {/* Primary CTA */}
          <Link to={primaryHref} className="block">
            <Button
              size="md"
              iconRight={<ArrowRight className="h-4 w-4" />}
              className="w-full"
            >
              {recommended.length > 0
                ? 'Решить рекомендованное сейчас'
                : 'Открыть на Арене'}
            </Button>
          </Link>

          {/* Related nodes */}
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
  const ring = Array.from({ length: 6 }).map((_, idx) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * idx) / 6
    return {
      x: CENTER_X + RADIUS_OUTER * Math.cos(angle),
      y: CENTER_Y + RADIUS_OUTER * Math.sin(angle),
    }
  })
  return (
    <div className="relative flex-1 overflow-auto bg-bg" style={{ minHeight: 720, padding: 40 }}>
      <div className="relative" style={{ width: CANVAS_W, height: CANVAS_H }}>
        <div
          className="absolute animate-pulse rounded-full bg-surface-2"
          style={{
            left: CENTER_X - NODE_SIZE_CENTER / 2,
            top: CENTER_Y - NODE_SIZE_CENTER / 2,
            width: NODE_SIZE_CENTER,
            height: NODE_SIZE_CENTER,
          }}
        />
        {ring.map((p, i) => (
          <div
            key={i}
            className="absolute animate-pulse rounded-md bg-surface-2"
            style={{
              left: p.x - NODE_SIZE_KEYSTONE / 2,
              top: p.y - NODE_SIZE_KEYSTONE / 2,
              width: NODE_SIZE_KEYSTONE,
              height: NODE_SIZE_KEYSTONE,
            }}
          />
        ))}
      </div>
    </div>
  )
}

function EmptyProgressCTA() {
  // Брифа: «Если у пользователя ещё ноль unlocked — большой CTA «Начни с Two
  // Sum →» в центре атласа». ID two-sum совпадает с recommendedKataByNode для
  // algo_basics + class_core (см. backend atlas.go).
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
      <LegendDot cls="bg-accent" label="Доступен" />
      <LegendDot cls="bg-bg border-2 border-dashed border-accent-hover" label="В процессе" />
      <LegendDot cls="bg-success" label="Освоен" />
      <LegendDot cls="bg-bg border-2 border-warn" label="Затухает" />
      <LegendDot cls="border border-border bg-surface-2" label="Закрыт" />
      <div className="flex items-center gap-2">
        <Hexagon className="h-4 w-4 fill-warn text-warn" />
        <span className="font-mono text-[12px] text-text-secondary">Keystone</span>
      </div>
      <div className="flex items-center gap-2">
        <Hexagon className="h-4 w-4 fill-pink text-pink" />
        <span className="font-mono text-[12px] text-text-secondary">Ascendant</span>
      </div>
    </div>
  )
}

function LegendDot({ cls, label }: { cls: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`h-3.5 w-3.5 rounded-full ${cls}`} />
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

  // highlightKeys = подсвеченные ноды по фильтрам. null = «нет активных
  // фильтров, не приглушаем». Иначе — set ключей, остальные ноды get faded.
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

  const isProgressEmpty =
    !!atlas && atlas.nodes.length > 0 && unlocked === 0

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
            // Граф есть, но прогресса нет — показываем CTA + сам граф ниже,
            // чтобы пользователь видел будущую карту.
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

