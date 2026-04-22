// TODO i18n
import { useParams } from 'react-router-dom'
import { MessageCircle, HelpCircle, Flag, FileCode } from 'lucide-react'
import { AppShellV2 } from '../components/AppShell'
import { Button } from '../components/Button'
import { Avatar } from '../components/Avatar'
import { useArenaMatchQuery } from '../lib/queries/arena'

function ErrorChip() {
  return (
    <span className="rounded-full bg-danger/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-danger">
      Не удалось загрузить
    </span>
  )
}

function TeamPlayer({
  nick,
  tier,
  chip,
  chipTone,
  gradient,
  mirror = false,
}: {
  nick: string
  tier: string
  chip: string
  chipTone: 'success' | 'warn' | 'danger' | 'cyan'
  gradient: 'cyan-violet' | 'pink-violet' | 'pink-red' | 'success-cyan'
  mirror?: boolean
}) {
  const chipCls =
    chipTone === 'success'
      ? 'bg-success/20 text-success'
      : chipTone === 'warn'
        ? 'bg-warn/20 text-warn'
        : chipTone === 'danger'
          ? 'bg-danger/20 text-danger'
          : 'bg-cyan/20 text-cyan'
  return (
    <div
      className={[
        'flex items-center gap-2 rounded-[10px] bg-surface-2 p-2',
        mirror ? 'flex-row-reverse' : '',
      ].join(' ')}
    >
      <Avatar size="md" gradient={gradient} initials={nick.charAt(1).toUpperCase()} status="online" />
      <div className={['flex flex-col gap-0.5', mirror ? 'items-end' : ''].join(' ')}>
        <span className="font-display text-[13px] font-bold text-text-primary">{nick}</span>
        <span className="font-mono text-[10px] text-text-muted">{tier}</span>
      </div>
      <span className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold ${chipCls}`}>
        {chip}
      </span>
    </div>
  )
}

function MatchHeader() {
  return (
    <div className="flex flex-col gap-3 border-b border-border bg-surface-1 px-4 py-3 sm:px-6 lg:h-[100px] lg:flex-row lg:items-center lg:justify-between lg:px-10 lg:py-0">
      <div className="flex items-center gap-2">
        <TeamPlayer nick="@you" tier="Diamond III · 2840" chip="12/15" chipTone="success" gradient="cyan-violet" />
        <TeamPlayer nick="@nastya" tier="Diamond IV · 2610" chip="8/15" chipTone="warn" gradient="success-cyan" />
      </div>
      <div className="flex flex-col items-center gap-1">
        <span className="font-mono text-[11px] font-semibold tracking-[0.12em] text-accent-hover">
          RANKED 2V2 · ROUND 1
        </span>
        <span className="font-display text-3xl font-extrabold leading-none text-text-primary lg:text-[36px]">
          12:43
        </span>
        <span className="font-mono text-[11px] text-text-muted">Бой команд · BO3</span>
      </div>
      <div className="flex items-center gap-2">
        <TeamPlayer nick="@kirill_dev" tier="Diamond II · 2980" chip="14/15" chipTone="cyan" gradient="pink-violet" mirror />
        <TeamPlayer nick="@vasya" tier="Platinum I · 2310" chip="6/15" chipTone="warn" gradient="pink-red" mirror />
      </div>
    </div>
  )
}

const GO_CODE_A = [
  'package main',
  '',
  'func findMedianSortedArrays(a, b []int) float64 {',
  '\tif len(a) > len(b) {',
  '\t\ta, b = b, a',
  '\t}',
  '\tlo, hi := 0, len(a)',
  '\tfor lo <= hi {',
  '\t\ti := (lo + hi) / 2',
  '\t\tj := (len(a)+len(b)+1)/2 - i',
]

const GO_CODE_B = [
  'package main',
  '',
  'func topoSort(g [][]int) []int {',
  '\tn := len(g)',
  '\tin := make([]int, n)',
  '\tfor _, e := range g {',
  '\t\tin[e[1]]++',
  '\t}',
  '\tq := []int{}',
  '\tres := make([]int, 0, n)',
]

function AssignmentStrip({
  label,
  title,
  tags,
  chip,
  chipTone,
  progress,
}: {
  label: string
  title: string
  tags: string[]
  chip: string
  chipTone: 'success' | 'warn'
  progress: number
}) {
  const chipCls = chipTone === 'success' ? 'bg-success/20 text-success' : 'bg-warn/20 text-warn'
  const barCls = chipTone === 'success' ? 'bg-success' : 'bg-warn'
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex flex-col gap-1.5">
        <span className="font-mono text-[11px] font-semibold tracking-[0.08em] text-cyan">{label}</span>
        <h3 className="font-display text-[17px] font-bold text-text-primary">{title}</h3>
        <div className="flex flex-wrap gap-1.5">
          {tags.map((t, i) => (
            <span
              key={t}
              className={
                i === 0
                  ? 'rounded-full bg-pink/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-pink'
                  : i === 1
                    ? 'rounded-full bg-cyan/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-cyan'
                    : 'rounded-full bg-accent/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-accent-hover'
              }
            >
              {t}
            </span>
          ))}
        </div>
      </div>
      <div className="flex min-w-[120px] flex-col items-end gap-2">
        <span className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold ${chipCls}`}>
          {chip}
        </span>
        <div className="h-1.5 w-[110px] overflow-hidden rounded-full bg-black/40">
          <div className={`h-full ${barCls}`} style={{ width: `${progress}%` }} />
        </div>
      </div>
    </div>
  )
}

function MiniEditor({ tabName, lines, highlight }: { tabName: string; lines: string[]; highlight: number }) {
  return (
    <div className="flex flex-col overflow-hidden rounded-lg bg-surface-1">
      <div className="flex h-9 items-center gap-2 border-b border-border bg-bg px-3">
        <FileCode className="h-3.5 w-3.5 text-accent-hover" />
        <span className="font-mono text-[11px] text-text-primary">{tabName}</span>
      </div>
      <div className="flex overflow-hidden">
        <div className="flex w-8 flex-col items-end border-r border-border bg-bg px-2 py-2 font-mono text-[11px] leading-[18px] text-text-muted">
          {lines.map((_, i) => (
            <span key={i}>{i + 1}</span>
          ))}
        </div>
        <pre className="flex-1 overflow-x-auto px-3 py-2 font-mono text-[11px] leading-[18px] text-text-secondary">
          {lines.map((line, i) => (
            <div
              key={i}
              className={i === highlight ? 'rounded-sm bg-accent/15 px-1 text-text-primary' : ''}
            >
              {line || '\u00A0'}
            </div>
          ))}
        </pre>
      </div>
    </div>
  )
}

function Pane({
  borderColor,
  label,
  title,
  tags,
  chip,
  chipTone,
  progress,
  tabName,
  lines,
  highlight,
}: {
  borderColor: string
  label: string
  title: string
  tags: string[]
  chip: string
  chipTone: 'success' | 'warn'
  progress: number
  tabName: string
  lines: string[]
  highlight: number
}) {
  return (
    <div
      className={`flex flex-1 flex-col gap-3.5 rounded-[14px] border-2 ${borderColor} bg-surface-2 p-3.5`}
    >
      <AssignmentStrip
        label={label}
        title={title}
        tags={tags}
        chip={chip}
        chipTone={chipTone}
        progress={progress}
      />
      <MiniEditor tabName={tabName} lines={lines} highlight={highlight} />
    </div>
  )
}

function BottomBar() {
  return (
    <div className="flex flex-col gap-4 border-t border-border bg-surface-1 px-4 py-3 sm:px-6 lg:h-20 lg:flex-row lg:items-center lg:justify-between lg:px-8">
      <div className="flex items-center gap-3">
        <span className="grid h-9 w-9 place-items-center rounded-full bg-cyan/15">
          <MessageCircle className="h-4 w-4 text-cyan" />
        </span>
        <div className="flex flex-col gap-0.5">
          <span className="text-[13px] text-text-primary">
            <span className="font-semibold text-accent-hover">@nastya:</span> я застряла на DFS, помоги!
          </span>
          <span className="font-mono text-[11px] text-text-muted">только что</span>
        </div>
        <Button variant="ghost" size="sm" className="ml-2">
          Открыть чат
        </Button>
      </div>
      <div className="flex items-center gap-5">
        <div className="flex flex-col items-center gap-0.5">
          <span className="font-mono text-[10px] tracking-[0.12em] text-text-muted">TEAM SCORE</span>
          <span className="font-display text-[22px] font-extrabold text-success">20 / 30</span>
        </div>
        <span className="font-mono text-xs text-text-muted">vs</span>
        <div className="flex flex-col items-center gap-0.5">
          <span className="font-mono text-[10px] tracking-[0.12em] text-text-muted">ENEMY</span>
          <span className="font-display text-[22px] font-extrabold text-danger">14 / 30</span>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Button variant="primary" icon={<HelpCircle className="h-4 w-4" />}>
          Помочь @nastya
        </Button>
        <Button variant="ghost" icon={<Flag className="h-4 w-4" />}>
          Сдаться
        </Button>
      </div>
    </div>
  )
}

export default function Arena2v2Page() {
  const { matchId } = useParams<{ matchId: string }>()
  const { data: match, isError } = useArenaMatchQuery(matchId)
  const taskATitle = match?.task?.title ?? 'Median of Two Arrays'
  const taskBTitle = 'Topological Sort'
  return (
    <AppShellV2>
      <div className="flex min-h-[calc(100vh-64px)] flex-col lg:h-[calc(100vh-72px)]">
        {isError && (
          <div className="flex justify-end px-4 py-2">
            <ErrorChip />
          </div>
        )}
        <MatchHeader />
        <div className="flex flex-1 flex-col gap-4 overflow-auto px-4 py-4 sm:px-6 lg:flex-row lg:overflow-hidden lg:px-8">
          <Pane
            borderColor="border-cyan"
            label="ЗАДАЧА A · @you"
            title={taskATitle}
            tags={['Hard', 'Binary Search', '1200 XP']}
            chip="12/15 ✓"
            chipTone="success"
            progress={80}
            tabName="median.go"
            lines={GO_CODE_A}
            highlight={7}
          />
          <Pane
            borderColor="border-success"
            label="ЗАДАЧА B · @nastya"
            title={taskBTitle}
            tags={['Medium', 'Graph', '900 XP']}
            chip="8/15 ⚙"
            chipTone="warn"
            progress={53}
            tabName="topo.go"
            lines={GO_CODE_B}
            highlight={5}
          />
        </div>
        <BottomBar />
        <div className="hidden">{matchId}</div>
      </div>
    </AppShellV2>
  )
}
