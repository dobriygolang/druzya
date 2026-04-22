// TODO i18n
import { useParams } from 'react-router-dom'
import {
  ArrowLeft,
  FileCode,
  Flame,
  Play,
  RotateCcw,
  Share2,
  Star,
  Eye,
} from 'lucide-react'
import { AppShellV2 } from '../components/AppShell'
import { Button } from '../components/Button'
import { useMockReplayQuery, type ReplayEvent } from '../lib/queries/replay'

function ErrorChip() {
  return (
    <span className="rounded-full bg-danger/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-danger">
      Не удалось загрузить
    </span>
  )
}

function Header() {
  return (
    <div className="flex flex-col gap-3 border-b border-border bg-surface-1 px-4 py-3 sm:flex-row sm:h-16 sm:items-center sm:justify-between sm:px-8 sm:py-0">
      <div className="flex items-center gap-3">
        <button className="grid h-9 w-9 place-items-center rounded-md text-text-secondary hover:bg-surface-2">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <span className="font-display text-sm font-bold text-text-primary">
          Replay · LRU Cache · 28 апр
        </span>
        <span className="rounded-full bg-cyan/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-cyan">
          PASSED
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" icon={<Share2 className="h-4 w-4" />}>
          Поделиться
        </Button>
        <Button variant="primary" size="sm" icon={<RotateCcw className="h-4 w-4" />}>
          Реванш
        </Button>
      </div>
    </div>
  )
}

function CodePlayback({ frameLabel }: { frameLabel: string }) {
  const lines = [
    'package main',
    '',
    'import "container/list"',
    '',
    'type entry struct { key, val int }',
    '',
    'type LRUCache struct {',
    '    cap   int',
    '    data  map[int]*list.Element',
    '    order *list.List',
    '}',
    '',
    'func New(cap int) *LRUCache {',
    '    return &LRUCache{cap: cap,',
    '        data: map[int]*list.Element{},',
    '        order: list.New()}',
    '}',
    '',
    'func (c *LRUCache) Get(k int) int {',
    '    if e, ok := c.data[k]; ok {',
    '        c.order.MoveToFront(e)',
    '        return e.Value.(*entry).val',
    '    }',
  ]
  const annotations: Record<number, { color: string; text: string }> = {
    4: { color: 'bg-cyan/20 text-cyan', text: '>> 0:08' },
    7: { color: 'bg-warn/20 text-warn', text: 'paused 28s' },
    13: { color: 'bg-accent/20 text-accent-hover', text: 'return' },
  }
  return (
    <div className="flex flex-1 flex-col">
      <div className="flex h-11 items-center justify-between border-b border-border px-4">
        <div className="flex items-center gap-2.5">
          <FileCode className="h-4 w-4 text-text-secondary" />
          <span className="font-mono text-[13px] text-text-primary">solution.go</span>
        </div>
        <span className="font-mono text-[11px] text-text-muted">{frameLabel}</span>
      </div>
      <div className="flex flex-1 overflow-auto bg-surface-1">
        <div className="flex flex-col items-end px-3 py-3 font-mono text-[12px] text-text-muted select-none">
          {lines.map((_, i) => (
            <span key={i} className={i === 11 ? 'text-accent-hover font-semibold' : ''}>
              {i + 1}
            </span>
          ))}
        </div>
        <div className="flex flex-1 flex-col py-3 pr-4 font-mono text-[12px] text-text-secondary">
          {lines.map((line, i) => {
            const a = annotations[i]
            const isCursor = i === 11
            const isStrike = i === 17
            return (
              <div key={i} className="relative flex items-center gap-2">
                <pre
                  className={[
                    'whitespace-pre',
                    isCursor ? 'bg-accent/15 text-text-primary -mx-2 px-2 rounded' : '',
                    isStrike ? 'line-through text-danger' : '',
                  ].join(' ')}
                >
                  {line || ' '}
                </pre>
                {isCursor && <span className="inline-block h-4 w-0.5 animate-pulse bg-cyan" />}
                {a && (
                  <span className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-bold ${a.color}`}>
                    {a.text}
                  </span>
                )}
                {isStrike && (
                  <span className="rounded bg-danger/20 px-1.5 py-0.5 font-mono text-[10px] font-bold text-danger">
                    ↻ wrong order
                  </span>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function EventsSidebar({ events }: { events: ReplayEvent[] }) {
  const colorMap: Record<string, string> = {
    cyan: 'bg-cyan',
    warn: 'bg-warn',
    accent: 'bg-accent',
    danger: 'bg-danger',
    success: 'bg-success',
    pink: 'bg-pink',
  }
  return (
    <div className="flex w-full flex-col bg-surface-2 border-t border-border lg:w-[360px] lg:border-l lg:border-t-0">
      <div className="flex gap-1 border-b border-border px-3 pt-3">
        {['EVENTS', 'TYPING', 'TESTS', 'AI INSIGHT'].map((t, i) => (
          <button
            key={t}
            className={[
              'rounded-t-md px-3 py-2 font-mono text-[11px] font-semibold',
              i === 0
                ? 'bg-surface-1 text-text-primary'
                : 'text-text-muted hover:text-text-secondary',
            ].join(' ')}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="flex flex-1 flex-col gap-3 overflow-auto p-4">
        {events.map((e, i) => (
          <div key={i} className="flex items-start gap-3 rounded-lg bg-surface-1 p-3">
            <span className={`mt-1.5 h-2 w-2 rounded-full ${colorMap[e.color] ?? 'bg-cyan'}`} />
            <div className="flex flex-1 flex-col">
              <span className="text-[13px] font-semibold text-text-primary">{e.label}</span>
              <span className="font-mono text-[11px] text-text-muted">{e.sub}</span>
            </div>
            <span className="font-mono text-[11px] text-text-muted">{e.time}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function Scrubber() {
  const markers = [
    { left: '8%', color: 'bg-cyan' },
    { left: '18%', color: 'bg-warn' },
    { left: '36%', color: 'bg-success' },
    { left: '52%', color: 'bg-danger' },
    { left: '68%', color: 'bg-accent' },
    { left: '88%', color: 'bg-warn', star: true },
  ]
  return (
    <div className="flex h-auto flex-col gap-3 border-t border-border bg-surface-1 px-4 py-4 sm:px-6 lg:h-[130px]">
      <div className="flex flex-wrap items-center gap-3 sm:gap-4">
        <button className="grid h-10 w-10 place-items-center rounded-full bg-accent text-text-primary shadow-glow hover:bg-accent-hover">
          <Play className="h-4 w-4" />
        </button>
        <span className="font-mono text-[13px] text-text-primary">
          1:42 <span className="text-text-muted">/ 4:21</span>
        </span>
        <div className="flex rounded-md bg-surface-2 p-0.5">
          {['0.5x', '1x', '1.5x', '2x'].map((s) => (
            <button
              key={s}
              className={[
                'rounded px-2.5 py-1 font-mono text-[11px] font-semibold',
                s === '1x' ? 'bg-accent text-text-primary' : 'text-text-secondary',
              ].join(' ')}
            >
              {s}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Eye className="h-4 w-4 text-success" />
          <span className="text-[12px] text-text-secondary">Show ghost</span>
          <span className="h-4 w-7 rounded-full bg-success/40 p-0.5">
            <span className="block h-3 w-3 translate-x-3 rounded-full bg-success" />
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Flame className="h-4 w-4 text-text-muted" />
          <span className="text-[12px] text-text-muted">Heatmap</span>
          <span className="h-4 w-7 rounded-full bg-border p-0.5">
            <span className="block h-3 w-3 rounded-full bg-text-muted" />
          </span>
        </div>
      </div>
      <div className="relative">
        <div className="relative h-8 overflow-hidden rounded-full bg-black/40">
          <div className="absolute inset-y-0 left-0 w-[40%] bg-gradient-to-r from-accent to-accent-hover" />
          <div className="absolute inset-y-0 left-[40%] w-0.5 bg-text-primary" />
          {markers.map((m, i) => (
            <div
              key={i}
              className={`absolute top-1.5 h-5 w-1.5 rounded-sm ${m.color}`}
              style={{ left: m.left }}
            >
              {m.star && <Star className="absolute -top-3 left-1/2 h-3 w-3 -translate-x-1/2 text-warn" />}
            </div>
          ))}
        </div>
        <div className="mt-1.5 flex justify-between font-mono text-[10px] text-text-muted">
          <span>0:00</span>
          <span>1:00</span>
          <span>2:00</span>
          <span>3:00</span>
          <span>4:21</span>
        </div>
      </div>
    </div>
  )
}

const FALLBACK_EVENTS: ReplayEvent[] = [
  { id: 'e1', color: 'cyan', label: 'Start typing', sub: 'lru.go open', time: '0:08' },
  { id: 'e2', color: 'warn', label: 'Long pause', sub: '28s thinking', time: '0:34' },
  { id: 'e3', color: 'accent', label: 'Refactor', sub: 'extracted helper', time: '1:12' },
  { id: 'e4', color: 'danger', label: 'Test fail', sub: 'eviction order', time: '1:42' },
  { id: 'e5', color: 'success', label: 'Test pass', sub: '15/15 ok', time: '2:55' },
  { id: 'e6', color: 'pink', label: 'Submit', sub: 'final answer', time: '4:21' },
]

export default function MockReplayPage() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const { data, isError } = useMockReplayQuery(sessionId)
  const events = data?.events ?? FALLBACK_EVENTS
  const frameLabel = data ? `Frame ${data.current_frame} / ${data.total_frames}` : 'Frame 142 / 287'
  return (
    <AppShellV2>
      <Header />
      <div className="flex flex-col gap-4 px-4 py-4 sm:px-6 lg:px-8">
        {isError && <ErrorChip />}
        <div className="flex h-auto flex-col overflow-hidden rounded-[14px] border border-border bg-surface-1 lg:h-[580px] lg:flex-row">
          <CodePlayback frameLabel={frameLabel} />
          <EventsSidebar events={events} />
        </div>
        <div className="overflow-hidden rounded-[14px] border border-border">
          <Scrubber />
        </div>
      </div>
    </AppShellV2>
  )
}
