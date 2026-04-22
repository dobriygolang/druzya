// TODO i18n
import { Skull, Lightbulb, CheckCircle2 } from 'lucide-react'
import { AppShellV2 } from '../components/AppShell'
import { Button } from '../components/Button'
import { Card } from '../components/Card'

const lines = [
  'func twoSum(nums []int, target int) []int {',
  '    if len(nums) < 2 { return nil }',
  '    m := make(map[int]int)',
  '    for i, n := range nums {',
  '        complement := target - n',
  '        // looking for complement',
  '        _ = complement',
  '        // ...',
  '    }',
  '    m[nums[0]] = 0 // ← подозрительно',
  '    for i := 1; i < len(nums); i++ {',
  '        c := target - nums[i]',
  '        if j, ok := m[c]; ok {',
  '            return []int{j, i}',
  '        }',
  '        m[nums[i]] = i',
  '    }',
  '    return nil',
  '}',
]

function PageHeader() {
  return (
    <div className="flex flex-col items-start gap-4 px-4 pb-4 pt-6 sm:px-8 lg:flex-row lg:items-end lg:justify-between lg:px-20 lg:pb-6 lg:pt-8">
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-2xl lg:text-[28px] font-extrabold text-text-primary">
          🪦 Necromancy Mode
        </h1>
        <p className="text-sm text-text-secondary">
          Подними мёртвое решение, найди где оно пало. +XP за каждый найденный баг.
        </p>
      </div>
      <div className="flex items-center gap-3">
        <span className="rounded-full bg-warn/15 px-3 py-1 font-mono text-xs font-semibold text-warn">
          127 / 412 раскрыто
        </span>
        <button className="rounded-md border border-border bg-surface-1 px-3 py-1.5 font-mono text-xs text-text-secondary">
          Hard ▾
        </button>
      </div>
    </div>
  )
}

function CorpseCard() {
  return (
    <div className="flex flex-1 flex-col overflow-hidden rounded-[14px] border-2 border-danger bg-surface-1">
      <div
        className="flex items-center justify-between px-6 py-3.5"
        style={{ background: '#2A0510' }}
      >
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-full bg-danger/20">
            <Skull className="h-5 w-5 text-danger" />
          </span>
          <div className="flex flex-col">
            <h3 className="font-display text-base font-bold text-text-primary">
              Мёртвое решение #847
            </h3>
            <span className="font-mono text-[11px] text-text-muted">
              Anonymous · Two Sum · 23 минуты жизни
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-danger/20 px-2.5 py-0.5 font-mono text-[11px] font-semibold text-danger">
            FAIL · Test #14
          </span>
          <span className="rounded-full bg-warn/15 px-2.5 py-0.5 font-mono text-[11px] font-semibold text-warn">
            Reward: +250 XP
          </span>
        </div>
      </div>
      <div className="flex flex-1">
        <div className="flex w-12 flex-col border-r border-border bg-surface-2 py-3 text-right">
          {lines.map((_, i) => (
            <span key={i} className="px-3 font-mono text-[11px] text-text-muted">
              {i + 1}
            </span>
          ))}
        </div>
        <div className="flex flex-1 flex-col py-3">
          {lines.map((line, i) => (
            <code
              key={i}
              className="cursor-pointer whitespace-pre px-4 font-mono text-[12px] text-text-secondary hover:bg-danger/10 hover:text-text-primary"
            >
              {line}
            </code>
          ))}
        </div>
      </div>
      <div className="flex h-16 items-center justify-between border-t border-border bg-surface-2 px-5">
        <div className="flex items-center gap-3">
          <span className="text-sm text-text-secondary">Кликни на строку с багом</span>
          <span className="rounded-full bg-surface-3 px-2.5 py-0.5 font-mono text-[11px] text-text-muted">
            попытка 1/3
          </span>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" icon={<Lightbulb className="h-3.5 w-3.5" />}>
            Подсказка (-50 XP)
          </Button>
          <Button variant="primary" size="sm" icon={<CheckCircle2 className="h-3.5 w-3.5" />}>
            Подтвердить выбор
          </Button>
        </div>
      </div>
    </div>
  )
}

function TestCard() {
  return (
    <Card className="flex-col gap-3 border-danger/40 p-5" interactive={false}>
      <h3 className="font-display text-sm font-bold text-text-primary">Тест который убил</h3>
      <pre className="overflow-hidden rounded-lg bg-surface-2 p-3 font-mono text-[11px] text-text-secondary">
{`Input:    [3,3], target=6
Expected: [0,1]
Got:      [0,0]  ← mismatch`}
      </pre>
    </Card>
  )
}

function BountyCard() {
  const rows = [
    ['1-я попытка', '+250 XP', 'text-success'],
    ['2-я попытка', '+150 XP', 'text-warn'],
    ['3-я попытка', '+50 XP', 'text-text-secondary'],
    ['Не угадал', '0 XP', 'text-danger'],
  ]
  return (
    <div className="rounded-xl border border-border bg-gradient-to-br from-danger/15 to-accent/15 p-5">
      <h3 className="font-display text-sm font-bold text-text-primary">Bug Bounty</h3>
      {rows.map(([k, v, c]) => (
        <div key={k} className="mt-3 flex items-center justify-between">
          <span className="text-xs text-text-secondary">{k}</span>
          <span className={`font-mono text-xs font-semibold ${c}`}>{v}</span>
        </div>
      ))}
    </div>
  )
}

function RankCard() {
  return (
    <Card className="flex-col gap-3 p-5" interactive={false}>
      <h3 className="font-display text-sm font-bold text-text-primary">Necromancer Rank</h3>
      <div className="flex items-baseline gap-2">
        <span className="font-display text-[40px] font-extrabold text-warn">127</span>
        <span className="font-mono text-xs text-text-muted">раскрытых багов</span>
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex justify-between font-mono text-[11px] text-text-muted">
          <span>Грейв-диггер</span>
          <span>Ритуалист</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-surface-2">
          <div className="h-full w-[42%] rounded-full bg-gradient-to-r from-warn to-pink" />
        </div>
        <span className="text-[11px] text-text-muted">73 до следующего ранга</span>
      </div>
    </Card>
  )
}

function RecentFinds() {
  const items = [
    ['#846', 'off-by-one', '+250'],
    ['#831', 'race condition', '+150'],
    ['#812', 'null deref', '+250'],
    ['#799', 'wrong base case', '+50'],
    ['#788', 'integer overflow', '+250'],
  ]
  return (
    <Card className="flex-col gap-3 p-5" interactive={false}>
      <h3 className="font-display text-sm font-bold text-text-primary">Мои находки</h3>
      {items.map(([id, name, xp]) => (
        <div key={id} className="flex items-center gap-2.5 border-b border-border pb-2 last:border-0">
          <Skull className="h-4 w-4 text-text-muted" />
          <div className="flex flex-1 flex-col">
            <span className="text-[12px] font-semibold text-text-primary">{id}</span>
            <span className="font-mono text-[10px] text-text-muted">{name}</span>
          </div>
          <span className="font-mono text-[11px] font-semibold text-warn">{xp}</span>
        </div>
      ))}
    </Card>
  )
}

export default function NecromancyPage() {
  return (
    <AppShellV2>
      <PageHeader />
      <div className="flex flex-col gap-4 px-4 pb-6 sm:px-8 lg:flex-row lg:gap-6 lg:px-20 lg:pb-7">
        <div className="flex w-full flex-col gap-4 lg:w-[280px]">
          <RecentFinds />
        </div>
        <div className="flex flex-1 flex-col">
          <CorpseCard />
        </div>
        <div className="flex w-full flex-col gap-4 lg:w-[360px]">
          <TestCard />
          <BountyCard />
          <RankCard />
        </div>
      </div>
    </AppShellV2>
  )
}
