// TODO i18n
// TODO(api): GET /api/v1/obituaries/{submissionId} → {
//   author, died_at, eulogy, lifetime_min, tests_passed, tests_total,
//   complexity, code_lines, fix_explanation, fix_code, metrics, views_count
// }. Сейчас вся страница рендерит заглушки/пусто, чтобы не показывать
// фейкового @dima с выдуманным "23 минуты".
import { ArrowLeft, Eye, Send, Link2, Share2, Skull } from 'lucide-react'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { Avatar } from '../components/Avatar'

const goLines = [
  'func twoSum(nums []int, target int) []int {',
  '    result := []int{}',
  '    for i, n := range nums {',
  '        for j := i + 1; j < len(nums); j++ {',
  '            if nums[j] == target-n {',
  '                result = append(result, i, j)',
  '                return result // ☠ here it died',
  '            }',
  '        } // никогда не дойдёт',
  '    }',
  '    return result',
  '}',
]

function TopBar() {
  return (
    <div className="flex h-16 items-center justify-between gap-3 border-b border-border bg-surface-1 px-4 sm:px-6">
      <Button variant="ghost" size="sm" icon={<ArrowLeft className="h-4 w-4" />}>
        Назад
      </Button>
      <div className="flex items-center gap-2 font-mono text-xs text-text-muted">
        <Eye className="h-3.5 w-3.5" />
        <span>2 134 просмотров · обновляется live</span>
      </div>
      <Button variant="primary" size="sm" icon={<Share2 className="h-3.5 w-3.5" />}>
        Шерить
      </Button>
    </div>
  )
}

function Hero() {
  return (
    <div
      className="flex justify-center px-4 py-8 sm:px-8 lg:px-20 lg:py-14"
      style={{
        background:
          'linear-gradient(180deg, #1a0510 0%, #0A0A0F 50%, #1a0510 100%)',
      }}
    >
      <div
        className="flex w-full max-w-[720px] flex-col items-center gap-6 rounded-2xl border-2 border-danger p-6 sm:p-8 lg:gap-7 lg:p-12"
        style={{ background: '#0A0A14', boxShadow: '0 30px 80px rgba(239,68,68,0.6)' }}
      >
        <span className="font-mono text-sm tracking-[0.2em] text-danger">✦ ✦ ✦</span>
        <span className="italic text-text-secondary">Здесь покоится решение</span>
        <h1 className="font-display text-2xl lg:text-[28px] font-extrabold text-text-primary">@dima</h1>
        <span className="font-mono text-xs text-text-muted">22 апреля 2026 · 14:32</span>
        <div className="h-px w-full bg-border" />
        <p className="max-w-[600px] text-center italic text-text-secondary">
          Пало от O(n²) сложности и забытого edge case... Прожило 23 минуты — храбро, но
          недостаточно умно...
        </p>
        <div className="h-px w-full bg-border" />
        <div className="flex w-full flex-wrap justify-center gap-6 lg:gap-8">
          <div className="flex flex-col items-center gap-1">
            <span className="font-display text-2xl font-bold text-danger">23м</span>
            <span className="font-mono text-[11px] text-text-muted">прожило</span>
          </div>
          <div className="flex flex-col items-center gap-1">
            <span className="font-display text-2xl font-bold text-warn">8/15</span>
            <span className="font-mono text-[11px] text-text-muted">тестов</span>
          </div>
          <div className="flex flex-col items-center gap-1">
            <span className="font-display text-2xl font-bold text-danger">O(n²)</span>
            <span className="font-mono text-[11px] text-text-muted">complexity</span>
          </div>
        </div>
        <span className="font-mono text-xs tracking-[0.15em] text-danger">
          ✦ Requiescat In Pace ✦
        </span>
      </div>
    </div>
  )
}

function DiffCard() {
  return (
    <Card className="flex-col gap-0 p-0" interactive={false}>
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <h3 className="font-display text-base font-bold text-text-primary">Что убило</h3>
        <span className="rounded-full bg-danger/15 px-2.5 py-0.5 font-mono text-[11px] font-semibold text-danger">
          edge case
        </span>
      </div>
      <div className="flex">
        <div className="flex w-12 flex-col border-r border-border bg-surface-2 py-3 text-right">
          {Array.from({ length: 12 }).map((_, i) => (
            <span
              key={i}
              className={`px-3 font-mono text-[11px] ${
                i === 6 ? 'bg-danger/20 text-danger' : 'text-text-muted'
              }`}
            >
              {i + 1}
            </span>
          ))}
        </div>
        <div className="flex flex-1 flex-col py-3">
          {goLines.map((line, i) => {
            const highlight = i === 2 || i === 6
            return (
              <code
                key={i}
                className={`whitespace-pre px-4 font-mono text-[12px] ${
                  highlight ? 'bg-danger/15 text-text-primary' : 'text-text-secondary'
                }`}
              >
                {line}
              </code>
            )
          })}
        </div>
      </div>
      <div className="flex items-center justify-between border-t border-border px-5 py-3">
        <span className="font-mono text-xs text-text-muted">
          Линии 3-7 · O(n²) loop · 5000+ inputs
        </span>
        <span className="rounded-full bg-danger/15 px-2.5 py-0.5 font-mono text-[11px] font-semibold text-danger">
          Test #14 · 2.3s timeout
        </span>
      </div>
    </Card>
  )
}

function FixCard() {
  return (
    <div className="rounded-xl border border-accent-hover bg-gradient-to-br from-accent/15 to-pink/15 p-6">
      <h3 className="font-display text-base font-bold text-text-primary">
        Что нужно было сделать
      </h3>
      <p className="mt-2 max-w-[560px] text-sm text-text-secondary">
        Использовать hash map для O(n) lookup. Один проход — и победа. Сложность падает с
        квадратичной до линейной.
      </p>
      <pre className="mt-4 overflow-hidden rounded-lg bg-surface-1 p-4 font-mono text-[12px] text-cyan">
{`m := map[int]int{}
for i, n := range nums {
    if j, ok := m[target-n]; ok { return []int{j, i} }
    m[n] = i
}`}
      </pre>
      <Button variant="primary" size="sm" className="mt-5">
        Попробовать снова
      </Button>
    </div>
  )
}

function StatsCard() {
  const rows = [
    ['Время жизни', '23 минуты'],
    ['Submissions', '3'],
    ['Тестов прошло', '8/15'],
    ['Memory', '12.4 MB'],
    ['Прич. смерти', 'TLE on #14'],
  ]
  return (
    <Card className="flex-col gap-3 p-5" interactive={false}>
      <h3 className="font-display text-base font-bold text-text-primary">Метрики смерти</h3>
      {rows.map(([k, v]) => (
        <div key={k} className="flex justify-between border-b border-border pb-2 last:border-0">
          <span className="text-xs text-text-muted">{k}</span>
          <span className="font-mono text-xs text-text-primary">{v}</span>
        </div>
      ))}
    </Card>
  )
}

function SharePreviewCard() {
  return (
    <Card className="flex-col gap-3 p-5" interactive={false}>
      <h3 className="font-display text-base font-bold text-text-primary">Поделиться</h3>
      <div className="flex items-center gap-3 rounded-lg border border-border bg-surface-2 p-3">
        <Avatar size="sm" gradient="pink-violet" initials="Д" />
        <div className="flex flex-1 flex-col">
          <span className="text-xs font-semibold text-text-primary">@dima</span>
          <span className="text-[11px] text-text-muted">пало от O(n²)</span>
        </div>
        <span className="rounded-full bg-accent/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-accent-hover">
          druz9
        </span>
      </div>
      <div className="grid grid-cols-4 gap-2">
        <button className="grid place-items-center rounded-md border border-border bg-surface-2 py-2 text-cyan hover:bg-surface-3">
          <Share2 className="h-4 w-4" />
        </button>
        <button className="grid place-items-center rounded-md border border-border bg-surface-2 py-2 text-cyan hover:bg-surface-3">
          <Send className="h-4 w-4" />
        </button>
        <button className="grid place-items-center rounded-md border border-border bg-surface-2 py-2 text-pink hover:bg-surface-3">
          <Share2 className="h-4 w-4" />
        </button>
        <button className="grid place-items-center rounded-md border border-border bg-surface-2 py-2 text-text-secondary hover:bg-surface-3">
          <Link2 className="h-4 w-4" />
        </button>
      </div>
    </Card>
  )
}

// TODO(api): GET /api/v1/obituaries/recent — последние «надгробия» сообщества.
function OtherObituaries() {
  return (
    <Card className="flex-col gap-3 p-5" interactive={false}>
      <h3 className="font-display text-base font-bold text-text-primary">Другие могилки</h3>
      <div className="flex items-center gap-3 py-2">
        <Skull className="h-4 w-4 text-text-muted" />
        <span className="text-[11px] text-text-muted">Нет данных</span>
      </div>
    </Card>
  )
}

export default function CodeObituaryPage() {
  return (
    <div className="min-h-screen bg-bg text-text-primary">
      <TopBar />
      <Hero />
      <div className="flex flex-col gap-4 px-4 py-6 sm:px-8 lg:flex-row lg:gap-6 lg:px-20 lg:py-7">
        <div className="flex flex-1 flex-col gap-6">
          <DiffCard />
          <FixCard />
        </div>
        <div className="flex w-full flex-col gap-6 lg:w-[380px]">
          <StatsCard />
          <SharePreviewCard />
          <OtherObituaries />
        </div>
      </div>
    </div>
  )
}
