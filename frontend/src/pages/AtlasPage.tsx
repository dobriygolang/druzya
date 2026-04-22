// TODO i18n
import {
  Sparkles,
  RotateCcw,
  ChevronDown,
  TrendingUp,
  Eye,
  Unlock,
  Check,
  Zap,
  Hexagon,
} from 'lucide-react'
import { AppShellV2 } from '../components/AppShell'
import { Button } from '../components/Button'
import { useAtlasQuery } from '../lib/queries/profile'

const HEX_CLIP = 'polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)'

function HeaderStrip() {
  const { data: atlas, isError } = useAtlasQuery()
  const total = atlas?.nodes?.length ?? 0
  const unlocked = atlas?.nodes?.filter((n) => n.unlocked).length ?? 0
  return (
    <div className="flex flex-col items-start gap-4 border-b border-border bg-surface-1 px-4 py-4 sm:px-8 lg:flex-row lg:items-center lg:justify-between lg:px-20 lg:py-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-bold leading-[1.1] text-text-primary lg:text-[28px]">
          Skill Tree
        </h1>
        <p className="font-mono text-xs text-text-muted">
          {isError ? 'Не удалось загрузить' : `${unlocked} / ${total || 156} узлов открыто · Сезон 4`}
        </p>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-md border border-accent/40 bg-accent/15 px-3.5 py-2 text-[13px] font-semibold text-text-primary hover:bg-accent/25"
        >
          Все категории <ChevronDown className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-3.5 py-2 text-[13px] text-text-secondary hover:bg-surface-3 hover:text-text-primary"
        >
          Доступные
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-3.5 py-2 text-[13px] text-text-secondary hover:bg-surface-3 hover:text-text-primary"
        >
          Скрыть открытые
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-warn/40 bg-warn/15 px-3 py-1.5 font-mono text-[12px] font-semibold text-warn">
          <Sparkles className="h-3.5 w-3.5" /> 12 очков
        </span>
        <Button
          variant="ghost"
          icon={<RotateCcw className="h-3.5 w-3.5" />}
          className="h-9 px-3.5 text-[13px]"
        >
          Сбросить дерево
        </Button>
      </div>
    </div>
  )
}

type NodeState = 'unlocked' | 'available' | 'locked'

function SmallNode({
  top,
  left,
  state,
}: {
  top: number
  left: number
  state: NodeState
}) {
  const base =
    'absolute rounded-full transition-all'
  const stateCls =
    state === 'unlocked'
      ? 'bg-accent shadow-glow border-2 border-accent-hover'
      : state === 'available'
        ? 'border-2 border-dashed border-accent-hover bg-bg'
        : 'border border-border bg-surface-1'
  return (
    <div
      className={`${base} ${stateCls}`}
      style={{ top, left, width: 36, height: 36 }}
    />
  )
}

function Hex({
  top,
  left,
  size,
  fill,
  border,
  label,
  labelClass,
}: {
  top: number
  left: number
  size: number
  fill?: string
  border?: string
  label?: string
  labelClass?: string
}) {
  return (
    <div
      className={`absolute grid place-items-center font-display font-bold text-text-primary ${fill ?? ''} ${border ?? ''}`}
      style={{
        top,
        left,
        width: size,
        height: size,
        clipPath: HEX_CLIP,
      }}
    >
      {label && (
        <span className={labelClass ?? 'font-mono text-[10px] tracking-[0.08em]'}>
          {label}
        </span>
      )}
    </div>
  )
}

function ConnectionLine({
  top,
  left,
  width,
  rotate,
  color = 'bg-border',
  thickness = 2,
}: {
  top: number
  left: number
  width: number
  rotate: number
  color?: string
  thickness?: number
}) {
  return (
    <div
      className={`absolute origin-left ${color}`}
      style={{
        top,
        left,
        width,
        height: thickness,
        transform: `rotate(${rotate}deg)`,
      }}
    />
  )
}

function FloatingLabel({
  top,
  left,
  text,
  color = 'text-text-muted',
}: {
  top: number
  left: number
  text: string
  color?: string
}) {
  return (
    <span
      className={`absolute font-mono text-[11px] tracking-[0.04em] ${color}`}
      style={{ top, left }}
    >
      {text}
    </span>
  )
}

function Canvas() {
  // Center of canvas roughly at (480, 350)
  // Layout coordinates are top-left of each node.
  return (
    <div
      className="relative flex-1 overflow-auto bg-bg"
      style={{ minHeight: 720, padding: 40 }}
    >
      {/* Radial gradient backdrop */}
      <div
        className="pointer-events-none absolute"
        style={{
          width: 800,
          height: 800,
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          background:
            'radial-gradient(ellipse at center, #2D1B4D 0%, transparent 70%)',
          opacity: 0.7,
        }}
      />

      {/* Connection lines (drawn first, behind nodes) */}
      {/* center (516, 314) hex 72 -> midpoint (552, 350)
          We'll route from approx (552, 350) to keystone centers. */}

      {/* Center -> ALGO (top) */}
      <ConnectionLine top={210} left={552} width={130} rotate={-90} color="bg-accent" thickness={3} />
      {/* Center -> DATA (right-top) */}
      <ConnectionLine top={310} left={552} width={170} rotate={-30} color="bg-accent" thickness={3} />
      {/* Center -> STR (right-bot) */}
      <ConnectionLine top={370} left={552} width={170} rotate={30} color="bg-border" thickness={2} />
      {/* Center -> MATH (bottom) */}
      <ConnectionLine top={386} left={552} width={130} rotate={90} color="bg-border" thickness={2} />
      {/* Center -> GRAPH (left) */}
      <ConnectionLine top={350} left={552} width={200} rotate={180} color="bg-accent" thickness={3} />
      {/* Center -> DP (left-top) */}
      <ConnectionLine top={310} left={552} width={170} rotate={-150} color="bg-border" thickness={2} />

      {/* Sub branches from keystones to small nodes (a few accent for unlocked paths) */}
      <ConnectionLine top={170} left={540} width={70} rotate={-50} color="bg-accent/60" thickness={2} />
      <ConnectionLine top={170} left={580} width={70} rotate={-130} color="bg-border" thickness={2} />
      <ConnectionLine top={250} left={690} width={80} rotate={-20} color="bg-accent/60" thickness={2} />
      <ConnectionLine top={400} left={690} width={80} rotate={20} color="bg-border" thickness={2} />
      <ConnectionLine top={460} left={540} width={70} rotate={50} color="bg-border" thickness={2} />
      <ConnectionLine top={460} left={560} width={70} rotate={130} color="bg-border" thickness={2} />
      <ConnectionLine top={350} left={300} width={80} rotate={-20} color="bg-accent/60" thickness={2} />
      <ConnectionLine top={350} left={300} width={80} rotate={20} color="bg-border" thickness={2} />
      <ConnectionLine top={250} left={350} width={80} rotate={20} color="bg-border" thickness={2} />

      {/* ROOT center hex */}
      <Hex
        top={314}
        left={516}
        size={72}
        fill="bg-accent shadow-glow"
        label="ROOT"
        labelClass="font-display text-[11px] font-extrabold tracking-[0.1em]"
      />

      {/* Keystones (48x48) */}
      {/* ALGO top */}
      <Hex top={150} left={528} size={48} fill="bg-warn/90" label="ALGO" labelClass="font-mono text-[9px] font-bold text-bg tracking-[0.08em]" />
      {/* DATA right-top */}
      <Hex top={230} left={680} size={48} fill="bg-accent" label="DATA" labelClass="font-mono text-[9px] font-bold tracking-[0.08em]" />
      {/* STR right-bot */}
      <Hex top={420} left={680} size={48} border="border-2 border-accent-hover" label="STR" labelClass="font-mono text-[9px] font-bold text-accent-hover tracking-[0.08em]" />
      {/* MATH bottom */}
      <Hex top={500} left={528} size={48} border="border border-border bg-surface-2" label="MATH" labelClass="font-mono text-[9px] font-bold text-text-muted tracking-[0.08em]" />
      {/* GRAPH left */}
      <Hex top={328} left={250} size={48} fill="bg-warn/90" label="GRAPH" labelClass="font-mono text-[9px] font-bold text-bg tracking-[0.08em]" />
      {/* DP left-top */}
      <Hex top={230} left={350} size={48} border="border border-border bg-surface-2" label="DP" labelClass="font-mono text-[9px] font-bold text-text-muted tracking-[0.08em]" />

      {/* Small ellipse nodes 36x36 (~22 of them) */}
      {/* around ALGO (top) */}
      <SmallNode top={90} left={500} state="unlocked" />
      <SmallNode top={90} left={580} state="available" />
      <SmallNode top={70} left={540} state="unlocked" />
      <SmallNode top={150} left={460} state="unlocked" />
      <SmallNode top={150} left={620} state="available" />

      {/* around DATA */}
      <SmallNode top={180} left={750} state="unlocked" />
      <SmallNode top={240} left={770} state="unlocked" />
      <SmallNode top={310} left={760} state="available" />
      <SmallNode top={210} left={620} state="unlocked" />

      {/* around STR */}
      <SmallNode top={420} left={770} state="locked" />
      <SmallNode top={490} left={750} state="locked" />
      <SmallNode top={400} left={620} state="available" />

      {/* around MATH */}
      <SmallNode top={580} left={500} state="locked" />
      <SmallNode top={580} left={580} state="locked" />
      <SmallNode top={500} left={460} state="locked" />
      <SmallNode top={500} left={620} state="locked" />

      {/* around GRAPH */}
      <SmallNode top={290} left={190} state="unlocked" />
      <SmallNode top={350} left={170} state="unlocked" />
      <SmallNode top={420} left={200} state="available" />
      <SmallNode top={328} left={330} state="unlocked" />

      {/* around DP */}
      <SmallNode top={170} left={320} state="locked" />
      <SmallNode top={170} left={400} state="locked" />
      <SmallNode top={250} left={290} state="available" />

      {/* Floating Geist Mono labels */}
      <FloatingLabel top={60} left={420} text="Sliding Window Sage" color="text-accent-hover" />
      <FloatingLabel top={130} left={620} text="Two Pointers Adept" color="text-text-secondary" />
      <FloatingLabel top={170} left={770} text="BFS Specialist" color="text-text-muted" />
      <FloatingLabel top={500} left={770} text="Memoization Master" color="text-text-muted" />
      <FloatingLabel top={460} left={620} text="Binary Search Pro" color="text-text-secondary" />
      <FloatingLabel top={620} left={500} text="Trie Builder" color="text-text-muted" />
      <FloatingLabel top={260} left={140} text="Number Theorist" color="text-text-muted" />
      <FloatingLabel top={140} left={300} text="KMP Initiate" color="text-text-muted" />
    </div>
  )
}

function NodeDetails() {
  return (
    <aside className="flex w-full shrink-0 flex-col gap-5 border-t border-border bg-surface-1 p-6 lg:w-[380px] lg:border-l lg:border-t-0">
      <div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-cyan/15 px-2.5 py-1 font-mono text-[11px] font-semibold tracking-[0.08em] text-cyan">
          NOTABLE
        </span>
      </div>

      <div className="flex flex-col gap-1">
        <h2 className="font-display text-[24px] font-bold leading-tight text-text-primary">
          Sliding Window Sage
        </h2>
        <span className="font-mono text-xs text-text-muted">
          Algorithms · Tier 3
        </span>
      </div>

      <div className="rounded-lg bg-surface-2 p-4 text-[13px] leading-relaxed text-text-secondary">
        Раскрывает мастерство техники скользящего окна. Ты начинаешь видеть
        окна там, где раньше писал вложенные циклы — задачи на подстроки и
        подмассивы решаются на 40% быстрее, а сложность падает с O(n²) до O(n).
      </div>

      <div className="flex flex-col gap-2.5">
        <span className="font-mono text-[11px] font-semibold tracking-[0.08em] text-text-muted">
          ЭФФЕКТЫ
        </span>
        <div className="flex items-start gap-3">
          <span className="mt-0.5 grid h-7 w-7 place-items-center rounded-full bg-success/15">
            <TrendingUp className="h-3.5 w-3.5 text-success" />
          </span>
          <span className="text-[13px] text-text-secondary">
            +25% скорости на задачах с подмассивами
          </span>
        </div>
        <div className="flex items-start gap-3">
          <span className="mt-0.5 grid h-7 w-7 place-items-center rounded-full bg-cyan/15">
            <Eye className="h-3.5 w-3.5 text-cyan" />
          </span>
          <span className="text-[13px] text-text-secondary">
            Подсветка паттерна окна в редакторе кода
          </span>
        </div>
        <div className="flex items-start gap-3">
          <span className="mt-0.5 grid h-7 w-7 place-items-center rounded-full bg-accent/15">
            <Unlock className="h-3.5 w-3.5 text-accent-hover" />
          </span>
          <span className="text-[13px] text-text-secondary">
            Открывает 8 продвинутых задач по теме
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-2.5">
        <span className="font-mono text-[11px] font-semibold tracking-[0.08em] text-text-muted">
          ПРЕДУСЛОВИЯ
        </span>
        <div className="flex flex-wrap gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-success/40 bg-success/10 px-2.5 py-1 text-[12px] font-medium text-success">
            <Check className="h-3 w-3" /> Two Pointers
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-success/40 bg-success/10 px-2.5 py-1 text-[12px] font-medium text-success">
            <Check className="h-3 w-3" /> Array Basics
          </span>
        </div>
      </div>

      <div className="mt-auto flex flex-col gap-3 rounded-lg bg-surface-2 p-4">
        <div className="flex items-center justify-between">
          <span className="text-[13px] text-text-secondary">Стоимость</span>
          <span className="font-mono text-[13px] font-semibold text-warn">
            3 очка
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[13px] text-text-secondary">У тебя</span>
          <span className="font-mono text-[13px] font-semibold text-text-primary">
            12 очков
          </span>
        </div>
        <Button
          variant="primary"
          icon={<Zap className="h-4 w-4" />}
          className="mt-1 w-full justify-center py-3 text-sm shadow-glow"
        >
          Вложить очко
        </Button>
      </div>
    </aside>
  )
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
        <span className="font-mono text-[12px] text-text-secondary">Доступно</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="h-3.5 w-3.5 rounded-full border border-border bg-surface-2" />
        <span className="font-mono text-[12px] text-text-secondary">Закрыто</span>
      </div>
      <div className="flex items-center gap-2">
        <Hexagon className="h-4 w-4 fill-warn text-warn" />
        <span className="font-mono text-[12px] text-text-secondary">Keystone</span>
      </div>
    </div>
  )
}

export default function AtlasPage() {
  return (
    <AppShellV2>
      <div className="flex flex-col">
        <HeaderStrip />
        <div className="flex flex-col lg:flex-row">
          <Canvas />
          <NodeDetails />
        </div>
        <LegendStrip />
      </div>
    </AppShellV2>
  )
}
