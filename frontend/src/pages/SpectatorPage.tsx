// TODO i18n
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  Eye,
  Scissors,
  Gem,
  FileCode,
  CircleDot,
  Send,
  Play,
} from 'lucide-react'
import { AppShellV2 } from '../components/AppShell'
import { Button } from '../components/Button'
import { Avatar } from '../components/Avatar'
import { WSStatus } from '../components/ws/WSStatus'
import { useChannel } from '../lib/ws'

type ChatMsg = { nick: string; color: string; text: string }

function Banner({ viewers }: { viewers: number }) {
  return (
    <div
      className="flex flex-col gap-3 border-b border-danger px-4 py-3 sm:px-6 lg:h-16 lg:flex-row lg:items-center lg:justify-between lg:px-8 lg:py-0"
      style={{ background: 'rgba(239,68,68,0.15)' }}
    >
      <div className="flex items-center gap-3">
        <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-danger" />
        <span className="rounded-full bg-danger/30 px-2.5 py-0.5 font-mono text-[11px] font-semibold text-danger">
          LIVE
        </span>
        <span className="font-mono text-[12px] text-text-primary">
          Round 2 · BO3 · Diamond Open R16
        </span>
      </div>
      <div className="flex items-center gap-3">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-cyan/15 px-2.5 py-1 font-mono text-[11px] font-semibold text-cyan">
          <Eye className="h-3 w-3" /> {viewers} смотрят
        </span>
        <Button variant="ghost" size="sm" icon={<Scissors className="h-3.5 w-3.5 text-warn" />}>
          Clip last 10s
        </Button>
        <Button variant="ghost" size="sm" icon={<Gem className="h-3.5 w-3.5 text-warn" />} className="border-warn text-warn">
          Поставить
        </Button>
      </div>
    </div>
  )
}

function PlayerHeader({
  nick,
  tier,
  stats,
  gradient,
  mirror,
}: {
  nick: string
  tier: string
  stats: string
  gradient: 'cyan-violet' | 'pink-violet'
  mirror?: boolean
}) {
  return (
    <div className={['flex items-center gap-4', mirror ? 'flex-row-reverse text-right' : ''].join(' ')}>
      <Avatar size="lg" gradient={gradient} initials={nick.charAt(1).toUpperCase()} status="online" />
      <div className="flex flex-col gap-0.5">
        <span className="font-display text-[16px] font-bold text-text-primary">{nick}</span>
        <span className="font-mono text-[11px] text-text-muted">{tier}</span>
        <span className="font-mono text-[11px] text-text-secondary">{stats}</span>
      </div>
    </div>
  )
}

function MatchHeader() {
  return (
    <div className="flex flex-col gap-3 border-b border-border bg-surface-1 px-4 py-3 sm:px-6 lg:h-24 lg:flex-row lg:items-center lg:justify-between lg:px-10 lg:py-0">
      <PlayerHeader
        nick="@alexey"
        tier="Grandmaster · 3 420 LP"
        stats="62 keystrokes/min · 12/15 tests"
        gradient="cyan-violet"
      />
      <div className="flex flex-col items-center gap-1.5">
        <span className="font-mono text-[10px] tracking-[0.12em] text-accent-hover">
          ROUND 2 · LIVE
        </span>
        <span className="font-display text-[28px] font-extrabold leading-none text-text-primary">
          08:42
        </span>
        <div className="flex gap-1.5">
          <span className="h-2 w-5 rounded-full bg-success" />
          <span className="h-2 w-5 rounded-full bg-accent animate-pulse" />
          <span className="h-2 w-5 rounded-full bg-border" />
        </div>
      </div>
      <PlayerHeader
        nick="@vasya"
        tier="Diamond II · 2 980 LP"
        stats="48 keystrokes/min · 8/15 tests"
        gradient="pink-violet"
        mirror
      />
    </div>
  )
}

const CODE_A = [
  'package main',
  '',
  'func twoSum(nums []int, target int) []int {',
  '\tleft, right := 0, len(nums)-1',
  '\tfor left < right {',
  '\t\tsum := nums[left] + nums[right]',
  '\t\tif sum == target {',
  '\t\t\treturn []int{left, right}',
  '\t\t}',
  '\t\tif sum < target {',
  '\t\t\tleft++',
  '\t\t} else {',
  '\t\t\tright--',
  '\t\t}',
]

const CODE_B = [
  'package main',
  '',
  'func twoSum(nums []int, target int) []int {',
  '\tn := len(nums)',
  '\tfor i := 0; i < n; i++ {',
  '\t\tfor j := i + 1; j < n; j++ {',
  '\t\t\tif nums[i]+nums[j] == target {',
  '\t\t\t\treturn []int{i, j}',
  '\t\t\t}',
  '\t\t\t// FAIL: timeout',
  '\t\t}',
  '\t}',
  '\treturn nil',
  '}',
]

function Editor({
  border,
  tab,
  lines,
  highlight,
  failLine,
  typing,
}: {
  border: string
  tab: string
  lines: string[]
  highlight?: number
  failLine?: number
  typing?: boolean
}) {
  return (
    <div className={`flex flex-1 flex-col overflow-hidden rounded-xl border-2 ${border} bg-surface-1`}>
      <div className="flex h-9 items-center gap-2 border-b border-border bg-bg px-3">
        <FileCode className="h-3.5 w-3.5 text-accent-hover" />
        <span className="font-mono text-[12px] text-text-primary">{tab}</span>
        {typing && (
          <span className="ml-auto inline-flex items-center gap-1 font-mono text-[10px] text-success">
            <CircleDot className="h-3 w-3 animate-pulse" />
            typing
          </span>
        )}
      </div>
      <div className="flex flex-1 overflow-hidden">
        <div className="flex w-10 flex-col items-end border-r border-border bg-bg px-2 py-2 font-mono text-[11px] leading-[18px] text-text-muted">
          {lines.map((_, i) => (
            <span
              key={i}
              className={
                i === highlight ? 'text-accent-hover' : i === failLine ? 'text-danger' : ''
              }
            >
              {i + 1}
            </span>
          ))}
        </div>
        <pre className="flex-1 overflow-auto px-3 py-2 font-mono text-[11px] leading-[18px] text-text-secondary">
          {lines.map((line, i) => (
            <div
              key={i}
              className={
                i === highlight
                  ? 'rounded-sm bg-accent/15 px-1 text-text-primary'
                  : i === failLine
                    ? 'rounded-sm bg-danger/15 px-1 text-danger'
                    : ''
              }
            >
              {line || '\u00A0'}
            </div>
          ))}
        </pre>
      </div>
    </div>
  )
}

function ChatCard({ msgs, viewers }: { msgs: ChatMsg[]; viewers: number }) {
  return (
    <div className="flex h-[380px] flex-col gap-2 rounded-xl border border-border bg-surface-2 p-3">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-[13px] font-bold text-text-primary">Чат стрима</h3>
        <span className="rounded-full bg-cyan/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-cyan">
          {viewers}
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-1.5 overflow-y-auto">
        {msgs.slice(-30).map((m, i) => (
          <div key={i} className="flex items-start gap-2">
            <Avatar size="sm" gradient="violet-cyan" initials={m.nick.charAt(1).toUpperCase()} />
            <div className="flex-1">
              <span className={`font-mono text-[11px] font-semibold ${m.color}`}>{m.nick}</span>{' '}
              <span className="text-[11px] text-text-secondary">{m.text}</span>
            </div>
          </div>
        ))}
        <div className="my-1 text-center font-mono text-[10px] italic text-accent-hover">
          @you joined as spectator
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {['🔥', '💪', '😱', '🤯', '👏', '😅'].map((e) => (
          <button
            key={e}
            className="grid h-7 w-7 place-items-center rounded-full bg-surface-3 text-sm hover:bg-surface-1"
          >
            {e}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2 rounded-md border border-border bg-bg px-2.5 py-1.5">
        <input
          className="flex-1 bg-transparent font-sans text-[12px] text-text-primary placeholder:text-text-muted focus:outline-none"
          placeholder="Сообщение..."
        />
        <button className="text-text-muted hover:text-text-primary">
          <Send className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}

function OtherMatchesCard() {
  const m = [
    { p1: '@kirill_dev', p2: '@nastya', viewers: 89 },
    { p1: '@elena', p2: '@petr', viewers: 54 },
    { p1: '@misha', p2: '@artem', viewers: 31 },
  ]
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface-2 p-3">
      <h3 className="font-display text-[13px] font-bold text-text-primary">Другие матчи</h3>
      {m.map((x, i) => (
        <div key={i} className="flex items-center gap-2 rounded-md bg-surface-1 px-2 py-1.5">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-danger" />
          <span className="flex-1 font-mono text-[11px] text-text-primary">
            {x.p1} vs {x.p2}
          </span>
          <span className="font-mono text-[10px] text-text-muted">{x.viewers}</span>
        </div>
      ))}
    </div>
  )
}

function BetCard() {
  return (
    <div className="flex flex-col gap-2.5 rounded-xl bg-gradient-to-br from-accent to-pink p-3.5 shadow-glow">
      <div className="flex items-center justify-between">
        <span className="font-display text-[13px] font-bold text-text-primary">Bet 100 💎</span>
        <Gem className="h-4 w-4 text-warn" />
      </div>
      <div className="flex gap-2">
        <button className="flex-1 rounded-md bg-white/15 px-2 py-2 text-center hover:bg-white/25">
          <div className="font-mono text-[10px] text-white/80">@alexey</div>
          <div className="font-display text-[14px] font-bold text-text-primary">1.4x</div>
        </button>
        <button className="flex-1 rounded-md bg-white/15 px-2 py-2 text-center hover:bg-white/25">
          <div className="font-mono text-[10px] text-warn">Underdog</div>
          <div className="font-display text-[14px] font-bold text-text-primary">@vasya 2.8x</div>
        </button>
      </div>
    </div>
  )
}

function ReplayScrubber() {
  return (
    <div className="hidden h-24 flex-col gap-2 border-t border-border bg-surface-1 px-4 py-4 sm:px-8 lg:flex lg:px-20">
      <div className="flex items-center gap-3">
        <button className="grid h-9 w-9 place-items-center rounded-full bg-accent text-text-primary hover:bg-accent-hover">
          <Play className="h-4 w-4" fill="currentColor" />
        </button>
        <span className="font-mono text-[12px] text-text-primary">
          08:42 / <span className="text-danger">LIVE</span>
        </span>
        <div className="ml-2 flex rounded-md border border-border bg-surface-2">
          {['0.5x', '1x', '2x', '4x'].map((s) => (
            <button
              key={s}
              className={[
                'px-2.5 py-1 font-mono text-[11px] font-semibold',
                s === '1x' ? 'bg-accent text-text-primary' : 'text-text-secondary hover:bg-surface-3',
              ].join(' ')}
            >
              {s}
            </button>
          ))}
        </div>
        <div className="relative ml-4 h-7 flex-1 overflow-hidden rounded-md bg-surface-2">
          <div className="absolute inset-y-0 left-0 w-[72%] bg-gradient-to-r from-cyan to-accent" />
          <div className="absolute inset-y-0 left-[72%] h-full w-1 bg-text-primary" />
          {/* Markers */}
          {[
            { x: '12%', color: 'bg-warn' },
            { x: '28%', color: 'bg-danger' },
            { x: '45%', color: 'bg-cyan' },
            { x: '60%', color: 'border border-text-muted bg-transparent' },
            { x: '95%', color: 'bg-warn' },
          ].map((m, i) => (
            <span
              key={i}
              className={`absolute top-1/2 h-3 w-3 -translate-y-1/2 rounded-full ${m.color}`}
              style={{ left: m.x }}
            />
          ))}
        </div>
      </div>
      <div className="flex justify-between font-mono text-[10px] text-text-muted">
        {['00:00', '02:00', '04:00', '06:00', '08:00', '10:00', '12:00'].map((t) => (
          <span key={t}>{t}</span>
        ))}
      </div>
    </div>
  )
}

const INITIAL_MSGS: ChatMsg[] = [
  { nick: '@dasha', color: 'text-pink', text: 'alexey красавчик, two pointers!' },
  { nick: '@maks', color: 'text-cyan', text: 'vasya brute force, не успеет' },
  { nick: '@kira', color: 'text-warn', text: 'GG если успеет до таймаута' },
  { nick: '@ivan', color: 'text-success', text: 'я бы через hashmap решил' },
]

export default function SpectatorPage() {
  const { matchId } = useParams<{ matchId: string }>()
  const channel = matchId ? `spectator/${matchId}` : ''
  const { lastEvent, data, status } = useChannel<Record<string, unknown>>(channel)

  const [viewers, setViewers] = useState(142)
  const [msgs, setMsgs] = useState<ChatMsg[]>(INITIAL_MSGS)
  const [codeA, setCodeA] = useState<string[]>(CODE_A)
  const [codeB, setCodeB] = useState<string[]>(CODE_B)
  const [highlightA, setHighlightA] = useState<number | undefined>(8)
  const [failB, setFailB] = useState<number | undefined>(9)

  useEffect(() => {
    if (!lastEvent || !data) return
    if (lastEvent === 'viewer_count') {
      setViewers(Number((data as { count?: number }).count) || 0)
    } else if (lastEvent === 'chat_message') {
      const m = data as ChatMsg
      setMsgs((prev) => [...prev, m].slice(-50))
    } else if (lastEvent === 'code_update') {
      const u = data as { side: 'a' | 'b'; lines: string[]; highlight?: number }
      if (u.side === 'a') {
        setCodeA(u.lines)
        setHighlightA(u.highlight)
      } else {
        setCodeB(u.lines)
        setFailB(u.highlight)
      }
    }
  }, [lastEvent, data])

  return (
    <AppShellV2>
      <div className="relative flex min-h-[calc(100vh-64px)] flex-col lg:h-[calc(100vh-72px)]">
        <div className="absolute right-4 top-4 z-10">
          <WSStatus status={status} />
        </div>
        <Banner viewers={viewers} />
        <MatchHeader />
        <div className="flex flex-1 flex-col gap-4 overflow-auto px-4 py-4 sm:px-8 lg:flex-row lg:overflow-hidden lg:px-20">
          <div className="flex flex-1 flex-col gap-4 lg:flex-row">
            <Editor border="border-cyan" tab="alexey.go" lines={codeA} highlight={highlightA} typing />
            <Editor border="border-pink" tab="vasya.go" lines={codeB} failLine={failB} />
          </div>
          <div className="flex w-full flex-col gap-4 overflow-y-auto lg:w-[320px]">
            <ChatCard msgs={msgs} viewers={viewers} />
            <OtherMatchesCard />
            <BetCard />
          </div>
        </div>
        <ReplayScrubber />
      </div>
    </AppShellV2>
  )
}
