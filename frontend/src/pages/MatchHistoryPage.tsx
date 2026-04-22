// TODO i18n
import { Share2, Play, Sparkles, ArrowRight } from 'lucide-react'
import { AppShellV2 } from '../components/AppShell'
import { Button } from '../components/Button'
import { Avatar } from '../components/Avatar'
import { useMatchHistoryQuery, type MatchSummary } from '../lib/queries/matches'

function ErrorChip() {
  return (
    <span className="rounded-full bg-danger/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-danger">
      Не удалось загрузить
    </span>
  )
}

type Match = {
  user: string
  result: 'W' | 'L'
  lp: number
  task: string
  time: string
  initial: string
  selected?: boolean
}

const MATCHES: Match[] = [
  { user: '@kirill_dev', result: 'W', lp: 18, task: 'Two Sum', time: '5 мин назад', initial: 'K', selected: true },
  { user: '@nastya', result: 'L', lp: -12, task: 'Median Sorted', time: '1 ч назад', initial: 'N' },
  { user: '@alexey', result: 'W', lp: 24, task: 'Search Rotated', time: '3 ч назад', initial: 'A' },
  { user: '@vasya', result: 'W', lp: 16, task: 'Longest Substring', time: '5 ч назад', initial: 'V' },
  { user: '@oleg', result: 'L', lp: -8, task: 'Word Break', time: 'вчера', initial: 'O' },
  { user: '@denis', result: 'W', lp: 14, task: 'Course Schedule', time: 'вчера', initial: 'D' },
  { user: '@lera', result: 'W', lp: 20, task: 'Trie', time: '2 дня назад', initial: 'L' },
  { user: '@misha', result: 'L', lp: -10, task: 'Edit Distance', time: '2 дня назад', initial: 'M' },
]

const FILTERS = ['Все режимы', 'Сезон 4', 'Победы', 'Поражения']

function HeaderRow({ wins, losses, avgLp, isError }: { wins: number; losses: number; avgLp: number; isError: boolean }) {
  return (
    <div className="flex flex-col items-start gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div className="flex flex-col gap-1.5">
        <h1 className="font-display text-2xl lg:text-[32px] font-bold leading-[1.1] text-text-primary">История матчей</h1>
        <p className="text-sm text-text-secondary">{wins} побед · {losses} поражений · средний LP +{avgLp} за матч</p>
        {isError && <ErrorChip />}
      </div>
      <div className="flex items-center gap-2">
        {FILTERS.map((f, i) => (
          <button
            key={f}
            className={
              i === 0
                ? 'rounded-full border border-accent bg-accent/15 px-3 py-1.5 text-xs font-semibold text-accent-hover'
                : 'rounded-full border border-border bg-surface-2 px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary'
            }
          >
            {f}
          </button>
        ))}
      </div>
    </div>
  )
}

function MatchListRow({ m }: { m: Match | (MatchSummary & { selected?: boolean }) }) {
  return (
    <div
      className={`flex items-center gap-3 px-4 py-3 ${m.selected ? 'bg-surface-3' : 'hover:bg-surface-3/50'}`}
    >
      <span className={`h-10 w-1 rounded-full ${m.result === 'W' ? 'bg-success' : 'bg-danger'}`} />
      <Avatar size="md" gradient={m.result === 'W' ? 'success-cyan' : 'pink-red'} initials={m.initial} className="!w-9 !h-9" />
      <div className="flex flex-1 flex-col gap-0.5">
        <span className="text-sm font-semibold text-text-primary">{m.user}</span>
        <span className="text-[11px] text-text-muted">{m.task}</span>
      </div>
      <div className="flex flex-col items-end gap-0.5">
        <span
          className={`rounded-full px-2 py-0.5 font-mono text-[11px] font-semibold ${m.result === 'W' ? 'bg-success/15 text-success' : 'bg-danger/15 text-danger'}`}
        >
          {m.lp > 0 ? `+${m.lp}` : m.lp} LP
        </span>
        <span className="text-[10px] text-text-muted">{m.time}</span>
      </div>
    </div>
  )
}

function MatchList({ matches, selectedId }: { matches: (MatchSummary & { selected?: boolean })[]; selectedId?: string }) {
  return (
    <div className="flex w-full flex-col overflow-hidden rounded-2xl bg-surface-2 lg:w-[480px]">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <span className="font-display text-sm font-bold text-text-primary">Последние</span>
        <button className="font-mono text-[11px] text-text-muted hover:text-text-secondary">по дате ▾</button>
      </div>
      <div className="flex flex-col">
        {matches.map((m, i) => (
          <MatchListRow key={i} m={{ ...m, selected: m.id === selectedId }} />
        ))}
      </div>
      <div className="border-t border-border px-4 py-3 text-center">
        <button className="text-xs text-accent-hover hover:underline">Загрузить ещё</button>
      </div>
    </div>
  )
}

function SummaryBar() {
  return (
    <div className="flex flex-col gap-4 border-b border-border bg-surface-1 px-4 py-3 sm:px-5 lg:h-[76px] lg:flex-row lg:items-center lg:justify-between lg:py-0">
      <div className="flex items-center gap-3">
        <span className="rounded-md bg-success/15 px-2 py-1 font-mono text-[11px] font-bold text-success">WIN</span>
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-bold text-text-primary">vs @kirill_dev</span>
          <span className="text-[11px] text-text-muted">Two Sum · Easy · 5 мин назад</span>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-4 lg:gap-7">
        <div className="flex flex-col items-center"><span className="font-display text-base font-bold text-success">+18</span><span className="text-[10px] text-text-muted">LP</span></div>
        <div className="flex flex-col items-center"><span className="font-display text-base font-bold text-text-primary">4:21</span><span className="text-[10px] text-text-muted">ваш time</span></div>
        <div className="flex flex-col items-center"><span className="font-display text-base font-bold text-text-primary">5:08</span><span className="text-[10px] text-text-muted">его time</span></div>
        <div className="flex flex-col items-center"><span className="font-display text-base font-bold text-success">15/15</span><span className="text-[10px] text-text-muted">tests</span></div>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" icon={<Play className="h-3.5 w-3.5" />}>Replay</Button>
        <Button variant="ghost" size="sm" icon={<Share2 className="h-3.5 w-3.5" />}>Поделиться</Button>
      </div>
    </div>
  )
}

const TABS = [
  { label: 'Diff', active: true },
  { label: 'Твой код', active: false },
  { label: 'Его код', active: false },
  { label: 'AI разбор', active: false, sparkles: true },
]

function TabStrip() {
  return (
    <div className="flex h-11 items-center border-b border-border bg-surface-2 px-3">
      {TABS.map((t) => (
        <button
          key={t.label}
          className={
            t.active
              ? 'flex items-center gap-1.5 border-b-2 border-accent px-4 py-2.5 text-sm font-semibold text-accent-hover'
              : 'flex items-center gap-1.5 px-4 py-2.5 text-sm text-text-secondary hover:text-text-primary'
          }
        >
          {t.sparkles && <Sparkles className="h-3.5 w-3.5 text-pink" />}
          {t.label}
        </button>
      ))}
    </div>
  )
}

const YOUR_CODE = [
  'func twoSum(nums []int, target int) []int {',
  '    seen := make(map[int]int)',
  '    for i, n := range nums {',
  '        if j, ok := seen[target-n]; ok {',
  '            return []int{j, i}',
  '        }',
  '        seen[n] = i',
  '    }',
  '    return nil',
  '}',
]
const YOUR_HIGHLIGHT = [3, 4]

const HIS_CODE = [
  'func twoSum(nums []int, target int) []int {',
  '    for i := 0; i < len(nums); i++ {',
  '        for j := i + 1; j < len(nums); j++ {',
  '            if nums[i]+nums[j] == target {',
  '                return []int{i, j}',
  '            }',
  '        }',
  '    }',
  '    return nil',
  '}',
]
const HIS_HIGHLIGHT = [1, 2]

function CodePane({ side, code, highlight, lines, complexity }: { side: 'win' | 'lose'; code: string[]; highlight: number[]; lines: string; complexity: string }) {
  const isWin = side === 'win'
  return (
    <div className="flex flex-1 flex-col border-b border-border last:border-b-0 lg:border-b-0 lg:border-r lg:last:border-r-0">
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <span
          className={`rounded-md px-2 py-0.5 font-mono text-[11px] font-bold ${isWin ? 'bg-success/15 text-success' : 'bg-danger/15 text-danger'}`}
        >
          {isWin ? 'твой' : 'его'}
        </span>
        <span className="font-mono text-[10px] text-text-muted">{isWin ? '@you' : '@kirill_dev'}</span>
      </div>
      <div className="flex-1 overflow-auto bg-bg p-3">
        <pre className="font-mono text-[12px] leading-[1.6] text-text-secondary">
          {code.map((line, i) => (
            <div
              key={i}
              className="px-2"
              style={
                highlight.includes(i)
                  ? { backgroundColor: isWin ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)' }
                  : undefined
              }
            >
              <span className="mr-3 inline-block w-5 text-right text-text-muted">{i + 1}</span>
              {line}
            </div>
          ))}
        </pre>
      </div>
      <div className="border-t border-border bg-surface-1 px-4 py-2 font-mono text-[11px] text-text-muted">
        {lines} · {complexity}{isWin ? ' · MIT' : ''}
      </div>
    </div>
  )
}

function DiffBody() {
  return (
    <div className="flex flex-1 flex-col overflow-hidden lg:flex-row">
      <CodePane side="win" code={YOUR_CODE} highlight={YOUR_HIGHLIGHT} lines="10 строк" complexity="O(n)" />
      <CodePane side="lose" code={HIS_CODE} highlight={HIS_HIGHLIGHT} lines="9 строк" complexity="O(n²)" />
    </div>
  )
}

function AIBanner() {
  return (
    <div className="flex items-center justify-between gap-4 bg-gradient-to-r from-accent to-pink px-5 py-3">
      <div className="flex items-center gap-3">
        <Sparkles className="h-5 w-5 text-text-primary" />
        <p className="text-sm text-white/90">
          <span className="font-semibold text-text-primary">AI:</span> ты обогнал hash map → O(n), он застрял в брутфорсе O(n²) — рост в 4 раза при n=1000.
        </p>
      </div>
      <button className="inline-flex items-center gap-1.5 rounded-md bg-white/20 px-3 py-1.5 text-xs font-semibold text-text-primary hover:bg-white/30">
        Подробный разбор <ArrowRight className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

function DetailPane() {
  return (
    <div className="flex flex-1 flex-col overflow-hidden rounded-2xl bg-surface-2">
      <SummaryBar />
      <TabStrip />
      <DiffBody />
      <AIBanner />
    </div>
  )
}

export default function MatchHistoryPage() {
  const { data, isError } = useMatchHistoryQuery()
  const matches = (data?.matches ?? MATCHES) as (MatchSummary & { selected?: boolean })[]
  return (
    <AppShellV2>
      <div className="flex flex-col gap-6 px-4 py-6 sm:px-8 lg:px-20 lg:py-8">
        <HeaderRow wins={data?.total_wins ?? 284} losses={data?.total_losses ?? 176} avgLp={data?.avg_lp ?? 2.4} isError={isError} />
        <div className="flex flex-col gap-4 lg:h-[720px] lg:flex-row lg:gap-6">
          <MatchList matches={matches} selectedId={data?.selected_id ?? 'm1'} />
          <DetailPane />
        </div>
      </div>
    </AppShellV2>
  )
}
