// /atlas — PoE2-inspired skill-progress tracker (entry/orchestrator).
//
// WAVE-11: extracted from a 1602-line monolithic AtlasPage into a focused
// dispatcher. Owns the v=2 feature flag, the query, the filter state and
// the surface decision. Delegates rendering to:
//   · AtlasCanvasLegacy   — the radial spoke renderer (default v1)
//   · AtlasV2Surface      — desktop canvas-v2 / mobile roadmap (flag-gated)
//   · AtlasDrawer         — right-side node detail
//   · AtlasFilters        — search + chips
//   · AtlasListMode       — list view (alternate to canvas)
//
// Behaviour identical to pre-split version. The fullscreen modal animation
// for mobile got polished per at-app.jsx (slide-from-bottom + backdrop fade).

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertCircle,
  ArrowRight,
  LayoutGrid,
  List,
  RotateCcw,
  Sparkles,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { AppShellV2 } from '../../components/AppShell'
import { Button } from '../../components/Button'
import { useAtlasQuery, type Atlas } from '../../lib/queries/profile'
import { AtlasCanvas } from '../../components/atlas/AtlasCanvas'
import { AtlasMobileRoadmap } from '../../components/atlas/AtlasMobileRoadmap'
import { AtlasDrawer } from './AtlasDrawer'
import { AtlasFilters } from './AtlasFilters'
import { AtlasListMode } from './AtlasListMode'
import {
  CATEGORIES,
  GraphCanvas,
  type NodeState,
  nodeState,
} from './AtlasCanvasLegacy'

// v2 feature-flag — opt-in via `?v=2` URL param OR localStorage key.
function useAtlasV2Flag(): [boolean, (v: boolean) => void] {
  const read = useCallback((): boolean => {
    if (typeof window === 'undefined') return false
    try {
      const url = new URLSearchParams(window.location.search)
      if (url.get('v') === '2') return true
      return window.localStorage.getItem('druz9.atlas.v2') === '1'
    } catch {
      return false
    }
  }, [])
  const [on, setOn] = useState<boolean>(read)
  useEffect(() => {
    const onPop = () => setOn(read())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [read])
  const set = useCallback((v: boolean) => {
    try {
      window.localStorage.setItem('druz9.atlas.v2', v ? '1' : '0')
    } catch {
      /* noop */
    }
    setOn(v)
  }, [])
  return [on, set]
}

function useIsMobile(): boolean {
  const [m, setM] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    return window.matchMedia('(max-width: 640px)').matches
  })
  useEffect(() => {
    if (typeof window === 'undefined') return
    const mq = window.matchMedia('(max-width: 640px)')
    const handler = (e: MediaQueryListEvent) => setM(e.matches)
    mq.addEventListener?.('change', handler)
    return () => mq.removeEventListener?.('change', handler)
  }, [])
  return m
}

function AtlasV2Toggle({ on, onToggle }: { on: boolean; onToggle: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onToggle(!on)}
      className="rounded-md border border-border bg-bg-secondary px-2 py-1 font-mono text-[11px] text-text-secondary hover:text-text-primary"
      aria-label="Toggle atlas v2 layout"
    >
      atlas {on ? 'v2 ✓' : 'v1'}
    </button>
  )
}

function shouldShowV2Toggle(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const url = new URLSearchParams(window.location.search)
    if (url.get('v2-debug') === '1') return true
  } catch {
    /* noop */
  }
  return import.meta.env?.DEV === true
}

// AtlasV2Surface — picks desktop canvas vs mobile roadmap based on viewport.
// On mobile provides a polished fullscreen-modal escape hatch (per at-app.jsx
// spec): slide-from-bottom 240ms cubic-bezier + backdrop fade 160ms.
function AtlasV2Surface({
  atlas,
  selectedKey,
  onSelect,
}: {
  atlas: Atlas
  selectedKey: string | null
  onSelect: (k: string) => void
}) {
  const isMobile = useIsMobile()
  const [fullscreen, setFullscreen] = useState(false)
  const [animateIn, setAnimateIn] = useState(false)
  const { t } = useTranslation('wave10')

  // Drive the slide-in / fade-in once the modal mounts. On unmount we just
  // drop the DOM — reduced-motion users can opt-out via prefers-reduced-motion
  // on the Tailwind transition (motion-reduce:transition-none).
  useEffect(() => {
    if (!fullscreen) {
      setAnimateIn(false)
      return
    }
    const id = window.requestAnimationFrame(() => setAnimateIn(true))
    return () => window.cancelAnimationFrame(id)
  }, [fullscreen])

  if (isMobile) {
    return (
      <div className="flex flex-1 flex-col">
        <AtlasMobileRoadmap
          nodes={atlas.nodes}
          centerNodeKey={atlas.center_node}
          selectedKey={selectedKey}
          onSelectNode={onSelect}
          onOpenFullMap={() => setFullscreen(true)}
        />
        {fullscreen && (
          <div className="fixed inset-0 z-50 flex flex-col">
            {/* backdrop fade-in 160ms */}
            <div
              className={`absolute inset-0 bg-black transition-opacity duration-200 ease-out motion-reduce:transition-none ${
                animateIn ? 'opacity-60' : 'opacity-0'
              }`}
              onClick={() => setFullscreen(false)}
              role="presentation"
            />
            {/* sheet · slide-from-bottom 240ms cubic-bezier(0.2,0.8,0.2,1) */}
            <div
              className="relative mt-auto flex h-full max-h-full flex-col bg-bg motion-reduce:transition-none"
              style={{
                transform: animateIn ? 'translateY(0)' : 'translateY(100%)',
                transition: 'transform 240ms cubic-bezier(0.2, 0.8, 0.2, 1)',
              }}
            >
              <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
                <button
                  type="button"
                  onClick={() => setFullscreen(false)}
                  className="flex items-center gap-1.5 rounded-md border border-border bg-surface-1 px-2.5 py-1.5 font-mono text-[11px] text-text-secondary hover:bg-surface-2"
                  aria-label={t('atlas.close')}
                >
                  <span>←</span> {t('atlas.close')}
                </button>
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-accent-hover">
                  ◆ atlas · full map
                </span>
                <span className="w-[68px]" aria-hidden />
              </div>
              <div className="flex-1 overflow-auto">
                <AtlasCanvas
                  nodes={atlas.nodes}
                  edges={atlas.edges}
                  centerNodeKey={atlas.center_node}
                  selectedKey={selectedKey}
                  onSelectNode={onSelect}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }
  return (
    <div className="flex flex-1 items-stretch justify-center bg-bg p-4">
      <AtlasCanvas
        nodes={atlas.nodes}
        edges={atlas.edges}
        centerNodeKey={atlas.center_node}
        selectedKey={selectedKey}
        onSelectNode={onSelect}
      />
    </div>
  )
}

// ── HeaderStrip / GraphSkeleton / EmptyProgressCTA / LegendStrip
function HeaderStrip({
  unlocked,
  total,
  isError,
  onRetry,
  viewMode,
  onViewModeChange,
}: {
  unlocked: number
  total: number
  isError: boolean
  onRetry: () => void
  viewMode: 'graph' | 'list'
  onViewModeChange: (v: 'graph' | 'list') => void
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
        <div className="flex items-center gap-0.5 rounded-md border border-border bg-bg p-0.5">
          <button
            type="button"
            onClick={() => onViewModeChange('graph')}
            aria-label="Graph view"
            aria-pressed={viewMode === 'graph'}
            className={`rounded p-1.5 transition-colors ${
              viewMode === 'graph'
                ? 'bg-accent/20 text-accent-hover'
                : 'text-text-muted hover:text-text-secondary'
            }`}
          >
            <LayoutGrid className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onViewModeChange('list')}
            aria-label="List view"
            aria-pressed={viewMode === 'list'}
            className={`rounded p-1.5 transition-colors ${
              viewMode === 'list'
                ? 'bg-accent/20 text-accent-hover'
                : 'text-text-muted hover:text-text-secondary'
            }`}
          >
            <List className="h-3.5 w-3.5" />
          </button>
        </div>
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
  const [v2On, setV2On] = useAtlasV2Flag()
  const showV2Toggle = useMemo(() => shouldShowV2Toggle(), [])
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<string>('all')
  const [status, setStatus] = useState<NodeState | 'all'>('all')
  const [viewMode, setViewMode] = useState<'graph' | 'list'>('graph')

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
          viewMode={viewMode}
          onViewModeChange={setViewMode}
        />
        {showV2Toggle && (
          <div className="flex justify-end px-4 pt-2">
            <AtlasV2Toggle on={v2On} onToggle={setV2On} />
          </div>
        )}
        {!isLoading && !isError && atlas && atlas.nodes.length > 0 && (
          <AtlasFilters
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
              {renderSurface(atlas, selectedKey, setSelectedKey, highlightKeys, viewMode, v2On)}
            </div>
          ) : (
            renderSurface(atlas, selectedKey, setSelectedKey, highlightKeys, viewMode, v2On)
          )}
        </div>
        <LegendStrip />
      </div>
      {selectedNode && atlas && (
        <AtlasDrawer
          atlas={atlas}
          node={selectedNode}
          onClose={() => setSelectedKey(null)}
          onSelectNeighbour={(k) => setSelectedKey(k)}
        />
      )}
    </AppShellV2>
  )
}

function renderSurface(
  atlas: Atlas,
  selectedKey: string | null,
  setSelectedKey: (k: string | null) => void,
  highlightKeys: Set<string> | null,
  viewMode: 'graph' | 'list',
  v2On: boolean,
) {
  if (viewMode === 'list') {
    return (
      <AtlasListMode
        atlas={atlas}
        selectedKey={selectedKey}
        onSelect={(k) => setSelectedKey(k)}
        highlightKeys={highlightKeys}
      />
    )
  }
  if (v2On) {
    return (
      <AtlasV2Surface atlas={atlas} selectedKey={selectedKey} onSelect={(k) => setSelectedKey(k)} />
    )
  }
  return (
    <GraphCanvas
      atlas={atlas}
      selectedKey={selectedKey}
      onSelect={(k) => setSelectedKey(k)}
      highlightKeys={highlightKeys}
    />
  )
}
