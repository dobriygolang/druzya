// /atlas — skill graph пользователя.
//
// Источник правды — `profile.GetMyAtlas` (REST: GET /api/v1/profile/me/atlas)
// через `useAtlasQuery` (queries/profile.ts). Ответ — { center_node, nodes,
// edges }; nodes несут kind = "keystone" | "ascendant" | "normal", флаги
// unlocked / decaying и progress.
//
// Раньше страница была захардкожена на 22 поддельных узла с pixel-coordinates
// «top: 90, left: 500» и витиеватыми лейблами «Sliding Window Sage». Сейчас
// — детерминированный radial-layout, считающийся на лету по реальному
// каталогу: keystones и ascendants — на внешнем кольце, normal — на внутреннем,
// центральный узел — в середине. Если бэк добавит новый skill, он автоматически
// окажется в правильной зоне без ручной правки координат.
//
// Loading: skeleton со skeleton-ring узлов. Error: retry-CTA. Empty: пустое
// состояние с пояснением.

import { useState, useMemo } from 'react'
import {
  Sparkles,
  RotateCcw,
  TrendingUp,
  Unlock,
  Hexagon,
  AlertCircle,
} from 'lucide-react'
import { AppShellV2 } from '../components/AppShell'
import { Button } from '../components/Button'
import { useAtlasQuery, type AtlasNode, type Atlas } from '../lib/queries/profile'

const HEX_CLIP = 'polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)'

// CANVAS_W / CANVAS_H — фиксированный логический размер графа. Реальный
// контейнер скроллится; absolute-positioning внутри использует эти числа
// как basis. radius_inner / outer выбраны так, чтобы 6–10 keystones и
// 10–20 normal-узлов влезли без визуальных коллизий.
const CANVAS_W = 960
const CANVAS_H = 700
const CENTER_X = CANVAS_W / 2
const CENTER_Y = CANVAS_H / 2
const RADIUS_INNER = 140
const RADIUS_OUTER = 260
const NODE_SIZE_NORMAL = 56
const NODE_SIZE_KEYSTONE = 72
const NODE_SIZE_CENTER = 96

type NodePos = { node: AtlasNode; x: number; y: number; size: number }

// computeLayout — детерминированный полярный layout.
//   - центральный узел (по center_node) — в центре.
//   - keystones и ascendants — равномерно по внешнему кольцу.
//   - normal — равномерно по внутреннему.
// Один и тот же массив nodes даёт ту же раскладку на каждом рендере, что
// важно для пользовательской привычки.
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
  // -π/2 — старт сверху, по часовой стрелке. Гарантирует «ALGO сверху»
  // как в дизайне, без жёстких координат.
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

function nodeStateColor(n: AtlasNode): { fill: string; ring: string; label: string } {
  if (n.unlocked) {
    if (n.kind === 'keystone') return { fill: 'bg-warn/90', ring: '', label: 'text-bg' }
    if (n.kind === 'ascendant') return { fill: 'bg-pink', ring: '', label: 'text-bg' }
    return { fill: 'bg-accent', ring: '', label: 'text-text-primary' }
  }
  if (n.progress > 0) {
    return { fill: 'bg-bg', ring: 'border-2 border-dashed border-accent-hover', label: 'text-accent-hover' }
  }
  return { fill: 'bg-surface-2', ring: 'border border-border', label: 'text-text-muted' }
}

function NodeShape({
  pos,
  selected,
  onClick,
}: {
  pos: NodePos
  selected: boolean
  onClick: () => void
}) {
  const { node, x, y, size } = pos
  const { fill, ring, label } = nodeStateColor(node)
  const shapeStyle =
    node.kind === 'keystone' || node.kind === 'ascendant'
      ? { clipPath: HEX_CLIP }
      : {}
  const glow = node.unlocked ? 'shadow-glow' : ''
  const selectedRing = selected ? 'ring-2 ring-cyan ring-offset-2 ring-offset-bg' : ''
  const decay = node.decaying ? 'opacity-60' : ''
  return (
    <button
      type="button"
      onClick={onClick}
      className={`absolute grid place-items-center font-display font-bold transition-transform hover:scale-110 ${fill} ${ring} ${glow} ${selectedRing} ${decay}`}
      style={{
        left: x - size / 2,
        top: y - size / 2,
        width: size,
        height: size,
        borderRadius: node.kind === 'keystone' || node.kind === 'ascendant' ? 0 : size / 2,
        ...shapeStyle,
      }}
      aria-label={node.title}
    >
      <span className={`px-1 text-center font-mono text-[9px] uppercase tracking-[0.06em] ${label}`}>
        {shortLabel(node.title)}
      </span>
    </button>
  )
}

// shortLabel — даёт краткий ярлык 2–3 буквы. Для сегмента «Алгоритмы:
// основы» вернёт «АЛГ». Не пытается быть умным: первые буквы слов из
// первого « : »-сегмента.
function shortLabel(title: string): string {
  const main = title.split(':')[0].trim()
  const words = main.split(/\s+/).filter(Boolean)
  if (words.length === 1) return words[0].slice(0, 4).toUpperCase()
  return words
    .slice(0, 3)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')
}

function ConnectionLine({
  x1,
  y1,
  x2,
  y2,
  highlighted,
}: {
  x1: number
  y1: number
  x2: number
  y2: number
  highlighted: boolean
}) {
  const dx = x2 - x1
  const dy = y2 - y1
  const len = Math.sqrt(dx * dx + dy * dy)
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI
  return (
    <div
      className={`absolute origin-left ${highlighted ? 'bg-accent' : 'bg-border'}`}
      style={{
        left: x1,
        top: y1,
        width: len,
        height: highlighted ? 2 : 1,
        transform: `rotate(${angle}deg)`,
      }}
    />
  )
}

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
  // Простой shimmer-каркас: центральный узел + 6 «keystones» по кругу.
  // Не пытается имитировать конкретное дерево пользователя.
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

function GraphCanvas({
  atlas,
  selectedKey,
  onSelect,
}: {
  atlas: Atlas
  selectedKey: string | null
  onSelect: (k: string) => void
}) {
  const layout = useMemo(() => computeLayout(atlas), [atlas])
  const positions = Array.from(layout.values())
  return (
    <div className="relative flex-1 overflow-auto bg-bg" style={{ minHeight: 720, padding: 40 }}>
      <div
        className="pointer-events-none absolute"
        style={{
          width: 800,
          height: 800,
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          background: 'radial-gradient(ellipse at center, #2D1B4D 0%, transparent 70%)',
          opacity: 0.7,
        }}
      />
      <div className="relative" style={{ width: CANVAS_W, height: CANVAS_H }}>
        {/* Edges рисуем первыми, чтобы узлы перекрывали их концы. */}
        {atlas.edges.map((e, idx) => {
          const a = layout.get(e.from)
          const b = layout.get(e.to)
          if (!a || !b) return null
          const highlighted = a.node.unlocked && b.node.unlocked
          return (
            <ConnectionLine
              key={`${e.from}-${e.to}-${idx}`}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              highlighted={highlighted}
            />
          )
        })}
        {positions.map((p) => (
          <NodeShape
            key={p.node.key}
            pos={p}
            selected={p.node.key === selectedKey}
            onClick={() => onSelect(p.node.key)}
          />
        ))}
      </div>
    </div>
  )
}

function NodeDetails({ node }: { node: AtlasNode | null }) {
  if (!node) {
    return (
      <aside className="flex w-full shrink-0 flex-col gap-3 border-t border-border bg-surface-1 p-6 lg:w-[380px] lg:border-l lg:border-t-0">
        <span className="font-mono text-[11px] font-semibold tracking-[0.08em] text-text-muted">
          ВЫБЕРИ УЗЕЛ
        </span>
        <p className="text-sm text-text-secondary">
          Кликни на любой узел графа слева, чтобы увидеть его описание, эффекты и
          предусловия.
        </p>
      </aside>
    )
  }
  const kindLabel =
    node.kind === 'keystone' ? 'Keystone'
      : node.kind === 'ascendant' ? 'Ascendant'
      : 'Notable'
  const stateLabel = node.unlocked
    ? 'Открыт'
    : node.progress > 0
      ? `В процессе · ${node.progress}%`
      : 'Закрыт'
  return (
    <aside className="flex w-full shrink-0 flex-col gap-5 border-t border-border bg-surface-1 p-6 lg:w-[380px] lg:border-l lg:border-t-0">
      <div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-cyan/15 px-2.5 py-1 font-mono text-[11px] font-semibold tracking-[0.08em] text-cyan">
          {kindLabel.toUpperCase()}
        </span>
      </div>

      <div className="flex flex-col gap-1">
        <h2 className="font-display text-[24px] font-bold leading-tight text-text-primary">
          {node.title}
        </h2>
        <span className="font-mono text-xs text-text-muted">
          {sectionLabel(node.section)} · {stateLabel}
        </span>
      </div>

      <div className="rounded-lg bg-surface-2 p-4 text-[13px] leading-relaxed text-text-secondary">
        {node.description || 'Описание узла появится позже.'}
      </div>

      {node.unlocked && (
        <div className="flex flex-col gap-2.5">
          <span className="font-mono text-[11px] font-semibold tracking-[0.08em] text-text-muted">
            СТАТУС
          </span>
          <div className="flex items-start gap-3">
            <span className="mt-0.5 grid h-7 w-7 place-items-center rounded-full bg-success/15">
              <Unlock className="h-3.5 w-3.5 text-success" />
            </span>
            <span className="text-[13px] text-text-secondary">Узел открыт</span>
          </div>
          {node.decaying && (
            <div className="flex items-start gap-3">
              <span className="mt-0.5 grid h-7 w-7 place-items-center rounded-full bg-warn/15">
                <AlertCircle className="h-3.5 w-3.5 text-warn" />
              </span>
              <span className="text-[13px] text-text-secondary">
                Прогресс затухает — реши задачу из секции, чтобы поддержать.
              </span>
            </div>
          )}
        </div>
      )}

      {!node.unlocked && (
        <div className="flex flex-col gap-2.5">
          <span className="font-mono text-[11px] font-semibold tracking-[0.08em] text-text-muted">
            ПРОГРЕСС
          </span>
          <div className="h-2 overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full bg-gradient-to-r from-cyan to-accent"
              style={{ width: `${Math.max(0, Math.min(100, node.progress))}%` }}
            />
          </div>
          <div className="flex items-start gap-3">
            <span className="mt-0.5 grid h-7 w-7 place-items-center rounded-full bg-accent/15">
              <TrendingUp className="h-3.5 w-3.5 text-accent-hover" />
            </span>
            <span className="text-[13px] text-text-secondary">
              Решай задачи секции «{sectionLabel(node.section)}», чтобы открыть узел.
            </span>
          </div>
        </div>
      )}
    </aside>
  )
}

function sectionLabel(section: string): string {
  // Бэк присылает enum-строку SECTION_ALGORITHMS / SECTION_SQL / etc.
  const map: Record<string, string> = {
    SECTION_ALGORITHMS: 'Алгоритмы',
    SECTION_SQL: 'SQL',
    SECTION_GO: 'Go',
    SECTION_SYSTEM_DESIGN: 'System Design',
    SECTION_BEHAVIORAL: 'Behavioral',
    algorithms: 'Алгоритмы',
    sql: 'SQL',
    go: 'Go',
    system_design: 'System Design',
    behavioral: 'Behavioral',
  }
  return map[section] ?? section
}

function LegendStrip() {
  return (
    <div className="flex h-14 items-center gap-4 overflow-x-auto border-t border-border bg-surface-1 px-4 sm:gap-8 sm:px-8 lg:px-20">
      <div className="flex items-center gap-2">
        <span className="h-3.5 w-3.5 rounded-full bg-accent" />
        <span className="font-mono text-[12px] text-text-secondary">Открыто</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="h-3.5 w-3.5 rounded-full border-2 border-dashed border-accent-hover bg-bg" />
        <span className="font-mono text-[12px] text-text-secondary">В процессе</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="h-3.5 w-3.5 rounded-full border border-border bg-surface-2" />
        <span className="font-mono text-[12px] text-text-secondary">Закрыто</span>
      </div>
      <div className="flex items-center gap-2">
        <Hexagon className="h-4 w-4 fill-warn text-warn" />
        <span className="font-mono text-[12px] text-text-secondary">Keystone</span>
      </div>
      <div className="flex items-center gap-2">
        <Hexagon className="h-4 w-4 fill-pink text-pink" />
        <span className="font-mono text-[12px] text-text-secondary">Ascendant</span>
      </div>
      <div className="ml-auto flex items-center gap-2 pr-2">
        <Sparkles className="h-3.5 w-3.5 text-text-muted" />
        <span className="font-mono text-[11px] text-text-muted">
          Layout — авто-radial по типу узла
        </span>
      </div>
    </div>
  )
}

export default function AtlasPage() {
  const { data: atlas, isError, isLoading, refetch } = useAtlasQuery()
  const total = atlas?.nodes.length ?? 0
  const unlocked = atlas?.nodes.filter((n) => n.unlocked).length ?? 0
  // Default-выделение: центральный узел, чтобы боковая панель не была
  // пустой при первом открытии.
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const effectiveKey = selectedKey ?? atlas?.center_node ?? null
  const selectedNode =
    atlas && effectiveKey ? atlas.nodes.find((n) => n.key === effectiveKey) ?? null : null

  return (
    <AppShellV2>
      <div className="flex flex-col">
        <HeaderStrip
          unlocked={unlocked}
          total={total}
          isError={isError}
          onRetry={() => void refetch()}
        />
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
            <div className="flex flex-1 items-center justify-center bg-bg p-8">
              <p className="max-w-md text-center text-sm text-text-secondary">
                В атласе пока нет узлов. Реши первую задачу — и сюда придут
                первые навыки.
              </p>
            </div>
          ) : (
            <GraphCanvas
              atlas={atlas}
              selectedKey={effectiveKey}
              onSelect={setSelectedKey}
            />
          )}
          <NodeDetails node={selectedNode} />
        </div>
        <LegendStrip />
      </div>
    </AppShellV2>
  )
}
