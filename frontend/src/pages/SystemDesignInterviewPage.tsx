// TODO i18n
import { useParams } from 'react-router-dom'
import {
  MousePointer,
  Square,
  Circle,
  Diamond,
  Minus,
  ArrowRight,
  Type,
  Image as ImageIcon,
  ZoomIn,
  Download,
  Send,
  Camera,
  StickyNote,
  Sparkles,
  Check,
  Loader2,
  Mic,
} from 'lucide-react'
import { AppShellV2 } from '../components/AppShell'
import { Button } from '../components/Button'
import { Avatar } from '../components/Avatar'
import { useSysDesignSessionQuery, type SysDesignSession } from '../lib/queries/sysdesign'

function ErrorChip() {
  return (
    <span className="rounded-full bg-danger/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-danger">
      Не удалось загрузить
    </span>
  )
}

function Header() {
  return (
    <div className="flex flex-col gap-3 border-b border-border bg-surface-1 px-4 py-3 sm:px-6 lg:h-16 lg:flex-row lg:items-center lg:justify-between lg:py-0">
      <span className="rounded-full bg-accent/15 px-3 py-1 font-mono text-[11px] font-semibold tracking-[0.08em] text-accent-hover">
        SYSTEM DESIGN · LIVE
      </span>
      <div className="flex flex-col items-center">
        <span className="font-display text-[20px] font-extrabold text-text-primary">
          47:23 <span className="text-text-muted">/ 60:00</span>
        </span>
        <span className="font-mono text-[11px] text-text-muted">Phase 2 · Deep dive</span>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm">Подсказка</Button>
        <Button variant="danger" size="sm">Завершить</Button>
      </div>
    </div>
  )
}

function ProblemCard({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex flex-col gap-2 rounded-xl bg-gradient-to-br from-surface-3 to-accent p-4 shadow-glow">
      <span className="w-fit rounded-full bg-white/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-text-primary">
        ЗАДАЧА
      </span>
      <h2 className="font-display text-[18px] font-bold text-text-primary leading-tight">
        {title}
      </h2>
      <p className="text-[12px] text-white/80">
        {description}
      </p>
    </div>
  )
}

function ReqCard({ rows }: { rows: { ok: boolean; text: string }[] }) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface-2 p-4">
      <h3 className="font-display text-[13px] font-bold text-text-primary">Functional</h3>
      {rows.map((r, i) => (
        <div key={i} className="flex items-center gap-2">
          {r.ok ? (
            <Check className="h-3.5 w-3.5 text-success" />
          ) : (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-warn" />
          )}
          <span className="text-[12px] text-text-secondary">{r.text}</span>
        </div>
      ))}
    </div>
  )
}

function NonFuncCard({ rows }: { rows: { l: string; v: string; tone: string }[] }) {
  const cls = (t: string) =>
    t === 'cyan'
      ? 'bg-cyan/15 text-cyan'
      : t === 'success'
        ? 'bg-success/15 text-success'
        : t === 'warn'
          ? 'bg-warn/15 text-warn'
          : 'bg-pink/15 text-pink'
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface-2 p-4">
      <h3 className="font-display text-[13px] font-bold text-text-primary">Non-functional</h3>
      {rows.map((r, i) => (
        <div key={i} className="flex items-center justify-between">
          <span className="text-[12px] text-text-secondary">{r.l}</span>
          <span className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold ${cls(r.tone)}`}>
            {r.v}
          </span>
        </div>
      ))}
    </div>
  )
}

function ConstraintsCard({ rows }: { rows: { l: string; v: string }[] }) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface-2 p-4">
      <h3 className="font-display text-[13px] font-bold text-text-primary">Constraints</h3>
      {rows.map((r, i) => (
        <div key={i} className="flex items-center justify-between">
          <span className="text-[12px] text-text-secondary">{r.l}</span>
          <span className="font-mono text-[12px] font-semibold text-text-primary">{r.v}</span>
        </div>
      ))}
    </div>
  )
}

function Toolbar() {
  const tools = [MousePointer, Square, Circle, Diamond, Minus, ArrowRight, Type, ImageIcon]
  const colors = ['#582CFF', '#22D3EE', '#F472B6', '#10B981', '#FBBF24', '#EF4444']
  return (
    <div className="flex h-11 items-center gap-2 border-b border-border bg-surface-2 px-3">
      <div className="flex items-center gap-1">
        {tools.map((Icon, i) => (
          <button
            key={i}
            className={[
              'grid h-7 w-7 place-items-center rounded-md',
              i === 0
                ? 'bg-accent text-text-primary'
                : 'text-text-secondary hover:bg-surface-3',
            ].join(' ')}
          >
            <Icon className="h-3.5 w-3.5" />
          </button>
        ))}
      </div>
      <span className="mx-2 h-5 w-px bg-border" />
      <div className="flex items-center gap-1">
        {colors.map((c) => (
          <button
            key={c}
            className="h-4 w-4 rounded-full ring-1 ring-border"
            style={{ background: c }}
          />
        ))}
      </div>
      <div className="ml-auto flex items-center gap-2">
        <button className="grid h-7 w-7 place-items-center rounded-md text-text-secondary hover:bg-surface-3">
          <ZoomIn className="h-3.5 w-3.5" />
        </button>
        <button className="grid h-7 w-7 place-items-center rounded-md text-text-secondary hover:bg-surface-3">
          <Download className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}

type Node = {
  x: number
  y: number
  w: number
  h: number
  label: string
  border: string
  bg?: string
}

const NODES: Node[] = [
  { x: 20, y: 30, w: 130, h: 40, label: 'Mobile Clients', border: 'border-cyan', bg: 'bg-cyan/10' },
  { x: 200, y: 30, w: 130, h: 40, label: 'Load Balancer', border: 'border-accent-hover', bg: 'bg-accent/10' },
  { x: 380, y: 30, w: 130, h: 40, label: 'API Gateway', border: 'border-accent-hover', bg: 'bg-accent/10' },
  { x: 100, y: 120, w: 130, h: 40, label: 'Tweet Service', border: 'border-pink', bg: 'bg-pink/10' },
  { x: 270, y: 120, w: 130, h: 40, label: 'Timeline Service', border: 'border-pink', bg: 'bg-pink/10' },
  { x: 440, y: 120, w: 130, h: 40, label: 'User Service', border: 'border-pink', bg: 'bg-pink/10' },
  { x: 30, y: 220, w: 130, h: 40, label: 'Fanout Worker', border: 'border-warn', bg: 'bg-warn/10' },
  { x: 200, y: 220, w: 130, h: 40, label: 'Redis Cache', border: 'border-warn', bg: 'bg-warn/10' },
  { x: 370, y: 220, w: 130, h: 40, label: 'Kafka', border: 'border-warn', bg: 'bg-warn/10' },
  { x: 30, y: 320, w: 130, h: 40, label: 'PostgreSQL', border: 'border-success', bg: 'bg-success/10' },
  { x: 200, y: 320, w: 130, h: 40, label: 'DynamoDB', border: 'border-success', bg: 'bg-success/10' },
  { x: 370, y: 320, w: 130, h: 40, label: 'S3', border: 'border-success', bg: 'bg-success/10' },
  { x: 540, y: 320, w: 100, h: 40, label: 'CDN', border: 'border-cyan', bg: 'bg-cyan/10' },
]

function CanvasNode({ n }: { n: Node }) {
  return (
    <div
      className={`absolute flex items-center justify-center rounded-md border-2 ${n.border} ${n.bg ?? ''} text-center font-mono text-[11px] font-semibold text-text-primary`}
      style={{ left: n.x, top: n.y, width: n.w, height: n.h }}
    >
      {n.label}
    </div>
  )
}

function Annotation({ x, y, n, text }: { x: number; y: number; n: number; text: string }) {
  return (
    <div
      className="absolute flex items-center gap-1.5 rounded-full bg-surface-1 px-2.5 py-1 font-mono text-[10px] font-semibold text-accent-hover ring-1 ring-accent/40"
      style={{ left: x, top: y }}
    >
      <span className="grid h-4 w-4 place-items-center rounded-full bg-accent text-[9px] text-text-primary">
        {n}
      </span>
      {text}
    </div>
  )
}

function Sticky({ x, y, color, text, rot }: { x: number; y: number; color: string; text: string; rot: number }) {
  return (
    <div
      className="absolute w-[110px] rounded-md p-2 text-[10px] font-semibold text-bg shadow-card"
      style={{ left: x, top: y, background: color, transform: `rotate(${rot}deg)` }}
    >
      {text}
    </div>
  )
}

function ConnLine({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  return (
    <div
      className="absolute bg-border-strong"
      style={{ left: x, top: y, width: w, height: h }}
    />
  )
}

function Canvas() {
  return (
    <div className="flex flex-1 flex-col overflow-hidden rounded-[14px] border border-border bg-surface-1">
      <Toolbar />
      <div className="relative min-h-[600px] flex-1 overflow-auto bg-surface-1 p-5">
        <div
          className="pointer-events-none absolute left-1/2 top-1/2 h-[480px] w-[480px] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-30"
          style={{
            background: 'radial-gradient(circle, #2D1B4D 0%, transparent 70%)',
          }}
        />
        {/* Connection lines (horizontal at row centers, vertical between rows) */}
        <ConnLine x={150} y={50} w={50} h={2} />
        <ConnLine x={330} y={50} w={50} h={2} />
        <ConnLine x={445} y={70} w={2} h={50} />
        <ConnLine x={165} y={140} w={105} h={2} />
        <ConnLine x={400} y={140} w={40} h={2} />
        <ConnLine x={165} y={160} w={2} h={60} />
        <ConnLine x={335} y={160} w={2} h={60} />
        <ConnLine x={505} y={160} w={2} h={60} />
        <ConnLine x={95} y={260} w={2} h={60} />
        <ConnLine x={265} y={260} w={2} h={60} />
        <ConnLine x={435} y={260} w={2} h={60} />
        <ConnLine x={500} y={340} w={40} h={2} />

        {NODES.map((n) => (
          <CanvasNode key={n.label} n={n} />
        ))}

        <Annotation x={20} y={400} n={1} text="POST /tweet" />
        <Annotation x={200} y={400} n={2} text="Fanout to followers" />
        <Annotation x={400} y={400} n={3} text="Cache to Redis" />
        <Annotation x={20} y={440} n={4} text="Read Home Timeline" />

        <Sticky x={580} y={50} color="#FBBF24" text="TODO: rate limit per user" rot={-4} />
        <Sticky x={580} y={150} color="#F472B6" text="READ: hot users → push model" rot={5} />
      </div>
    </div>
  )
}

function AIReviewCard() {
  return (
    <div className="flex flex-col gap-3 rounded-xl bg-gradient-to-br from-accent to-pink p-4 shadow-glow">
      <span className="w-fit rounded-full bg-white/20 px-2 py-0.5 font-mono text-[10px] font-semibold text-text-primary">
        AI РАЗБОР ПО КНОПКЕ
      </span>
      <h3 className="font-display text-[15px] font-bold text-text-primary">
        Отправить скриншот канваса AI
      </h3>
      <p className="text-[11px] text-white/85">
        AI не слушает постоянно — анализ только по запросу. Сэкономили ~$0.40 за сессию.
      </p>
      <button className="inline-flex items-center justify-center gap-2 rounded-md bg-white px-3 py-2.5 text-[13px] font-bold text-bg hover:bg-white/90">
        <Send className="h-4 w-4" /> Отправить разбор · 1 кредит
      </button>
      <div className="flex items-center justify-between font-mono text-[10px] text-white/70">
        <span>осталось 7/10</span>
        <span>последний: 6 мин назад</span>
      </div>
    </div>
  )
}

function InterviewerCard() {
  return (
    <div className="flex h-[240px] flex-col gap-2 rounded-xl border border-border bg-surface-2 p-3">
      <div className="flex items-center gap-2">
        <Avatar size="sm" gradient="violet-cyan" initials="A" status="online" />
        <span className="font-display text-[13px] font-bold text-text-primary">AI Интервьюер</span>
        <span className="ml-auto flex items-center gap-1 font-mono text-[10px] text-success">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" />
          слушает
        </span>
      </div>
      <div className="grid flex-1 place-items-center rounded-lg bg-bg">
        <Mic className="h-10 w-10 text-text-muted" />
      </div>
    </div>
  )
}

function EvalCard({ rows }: { rows: { l: string; v: number; tone: string }[] }) {
  return (
    <div className="flex flex-col gap-2 rounded-xl bg-gradient-to-br from-surface-3 to-surface-2 p-4">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-[13px] font-bold text-text-primary">Live evaluation</h3>
        <span className="font-mono text-[10px] text-text-muted">по последнему разбору</span>
      </div>
      {rows.map((r) => (
        <div key={r.l} className="flex items-center justify-between">
          <span className="text-[12px] text-text-secondary">{r.l}</span>
          <span
            className={[
              'font-display text-[14px] font-bold',
              r.tone === 'success' ? 'text-success' : r.tone === 'cyan' ? 'text-cyan' : 'text-warn',
            ].join(' ')}
          >
            {r.v.toFixed(1)}
          </span>
        </div>
      ))}
    </div>
  )
}

function PhaseTracker({ ph }: { ph: { t: string; s: string }[] }) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface-2 p-4">
      <h3 className="font-display text-[13px] font-bold text-text-primary">Фазы</h3>
      {ph.map((p, i) => (
        <div key={i} className="flex items-center gap-2">
          <span
            className={[
              'h-2 w-2 rounded-full',
              p.s === 'done' ? 'bg-success' : p.s === 'active' ? 'bg-accent animate-pulse' : 'bg-border-strong',
            ].join(' ')}
          />
          <span className="text-[12px] text-text-secondary">{p.t}</span>
        </div>
      ))}
    </div>
  )
}

function QuickActions() {
  return (
    <div className="flex flex-wrap gap-2">
      <button className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2 px-3 py-1.5 text-[11px] text-text-secondary hover:bg-surface-3">
        <Camera className="h-3 w-3" /> Скриншот
      </button>
      <button className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2 px-3 py-1.5 text-[11px] text-text-secondary hover:bg-surface-3">
        <StickyNote className="h-3 w-3" /> Заметка
      </button>
      <button className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2 px-3 py-1.5 text-[11px] text-text-secondary hover:bg-surface-3">
        <Sparkles className="h-3 w-3" /> Hint
      </button>
    </div>
  )
}

const FALLBACK_SESSION: SysDesignSession = {
  id: '',
  problem: { title: 'Спроектируй Twitter Timeline', description: 'Хронологическая лента для 300M DAU. Учти fanout, кеш и реалтайм.' },
  functional: [
    { ok: true, text: 'Публикация твитов (≤280 символов)' },
    { ok: true, text: 'Чтение Home Timeline' },
    { ok: true, text: 'Подписка на пользователей' },
    { ok: true, text: 'Лайки и ретвиты' },
    { ok: false, text: 'Уведомления (push) — обсуждаем' },
  ],
  non_functional: [
    { l: 'Latency p99', v: '< 200ms', tone: 'cyan' },
    { l: 'Доступность', v: '99.95%', tone: 'success' },
    { l: 'Throughput', v: '600k tw/s', tone: 'cyan' },
    { l: 'Read:Write', v: '100:1', tone: 'warn' },
    { l: 'Consistency', v: 'Eventual', tone: 'pink' },
  ],
  constraints: [
    { l: 'DAU', v: '300M' },
    { l: 'Tweets / day', v: '100M' },
    { l: 'Avg followers', v: '200' },
  ],
  evaluation: [
    { l: 'Requirements', v: 9.0, tone: 'success' },
    { l: 'High-level', v: 8.5, tone: 'cyan' },
    { l: 'Deep dive', v: 7.5, tone: 'warn' },
    { l: 'Trade-offs', v: 8.0, tone: 'cyan' },
    { l: 'Communication', v: 9.0, tone: 'success' },
  ],
  phases: [
    { t: 'Requirements', s: 'done' },
    { t: 'High-level design', s: 'done' },
    { t: 'Deep dive', s: 'active' },
    { t: 'Trade-offs', s: 'pending' },
  ],
  ai_credits_used: 3,
  ai_credits_max: 10,
  time_elapsed_sec: 2843,
  time_total_sec: 3600,
  current_phase: 'Phase 2 · Deep dive',
}

export default function SystemDesignInterviewPage() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const { data, isError } = useSysDesignSessionQuery(sessionId)
  const s = data ?? FALLBACK_SESSION
  return (
    <AppShellV2>
      <div className="flex min-h-[calc(100vh-72px)] flex-col">
        <Header />
        {isError && (
          <div className="flex justify-end px-4 py-2">
            <ErrorChip />
          </div>
        )}
        <div className="flex flex-1 flex-col gap-4 px-4 py-3 sm:px-5 lg:flex-row">
          <div className="flex w-full flex-col gap-3 lg:w-[300px]">
            <ProblemCard title={s.problem.title} description={s.problem.description} />
            <ReqCard rows={s.functional} />
            <NonFuncCard rows={s.non_functional} />
            <ConstraintsCard rows={s.constraints} />
          </div>
          <div className="flex flex-1 flex-col">
            <Canvas />
          </div>
          <div className="flex w-full flex-col gap-3 lg:w-[320px]">
            <AIReviewCard />
            <InterviewerCard />
            <EvalCard rows={s.evaluation} />
            <PhaseTracker ph={s.phases} />
            <QuickActions />
          </div>
        </div>
        <div className="hidden">{sessionId}</div>
      </div>
    </AppShellV2>
  )
}
