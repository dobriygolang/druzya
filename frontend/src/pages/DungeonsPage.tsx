// TODO i18n
import { ArrowRight, Filter, Lock, Crown } from 'lucide-react'
import { AppShellV2 } from '../components/AppShell'
import { Button } from '../components/Button'
import { useDungeonsQuery } from '../lib/queries/dungeons'

function ErrorChip() {
  return (
    <span className="rounded-full bg-danger/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-danger">
      Не удалось загрузить
    </span>
  )
}

type Company = {
  name: string
  initial: string
  color: string
  tasks: number
  sections: number
  hours: number
  progress: number
  tags: string[]
  locked?: boolean
}

const NORMAL: Company[] = [
  { name: 'Avito', initial: 'A', color: '#10B981', tasks: 40, sections: 5, hours: 12, progress: 78, tags: ['Algorithms', 'SQL'] },
  { name: 'VK', initial: 'В', color: '#22D3EE', tasks: 38, sections: 5, hours: 11, progress: 62, tags: ['Algorithms', 'System'] },
  { name: 'Сбер', initial: 'С', color: '#10B981', tasks: 42, sections: 6, hours: 13, progress: 45, tags: ['Java', 'SQL'] },
  { name: 'Wildberries', initial: 'W', color: '#F472B6', tasks: 35, sections: 5, hours: 10, progress: 12, tags: ['Go', 'Concurrency'] },
  { name: 'Mail.ru', initial: 'M', color: '#582CFF', tasks: 36, sections: 5, hours: 10, progress: 0, tags: ['Algorithms'], locked: true },
  { name: 'HH', initial: 'H', color: '#FBBF24', tasks: 30, sections: 4, hours: 8, progress: 0, tags: ['Frontend', 'JS'] },
]

const HARD: Company[] = [
  { name: 'Ozon', initial: 'O', color: '#582CFF', tasks: 60, sections: 6, hours: 18, progress: 32, tags: ['Backend', 'DB'] },
  { name: 'Tinkoff Junior', initial: 'T', color: '#FBBF24', tasks: 55, sections: 6, hours: 16, progress: 28, tags: ['Java', 'Spring'] },
  { name: 'Yandex Practicum', initial: 'Я', color: '#EF4444', tasks: 50, sections: 5, hours: 15, progress: 15, tags: ['Algorithms'] },
  { name: 'Skyeng', initial: 'S', color: '#22D3EE', tasks: 48, sections: 5, hours: 14, progress: 0, tags: ['Python'], locked: true },
]

function CompanyCard({ c, hard }: { c: Company; hard?: boolean }) {
  const chipCls = hard ? 'bg-warn/20 text-warn' : 'bg-success/20 text-success'
  const chipLabel = hard ? 'HARD' : 'NORMAL'
  const borderCls = hard ? 'border-warn/30' : 'border-border'
  return (
    <div className={`flex h-[220px] w-full flex-col gap-2 rounded-xl border ${borderCls} bg-surface-2 p-4`}>
      <div className="flex items-center justify-between">
        <span
          className="grid h-12 w-12 place-items-center rounded-lg font-display text-lg font-extrabold text-text-primary"
          style={{ background: c.color }}
        >
          {c.initial}
        </span>
        <span className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold ${chipCls}`}>
          {chipLabel}
        </span>
      </div>
      <h3 className="font-display text-[16px] font-bold text-text-primary">{c.name}</h3>
      <p className="font-mono text-[11px] text-text-muted">
        {c.tasks} задач · {c.sections} секций · ~{c.hours}ч
      </p>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-black/40">
        <div
          className={`h-full ${hard ? 'bg-warn' : 'bg-success'}`}
          style={{ width: `${c.progress}%` }}
        />
      </div>
      <span className="font-mono text-[11px] text-text-secondary">
        {c.locked ? 'Заблокировано' : `${c.progress}% пройдено`}
      </span>
      <div className="mt-auto flex items-center justify-between">
        <span className="font-mono text-[10px] text-text-muted">✓ {c.tags.join(' · ')}</span>
        {c.locked ? (
          <Lock className="h-4 w-4 text-text-muted" />
        ) : (
          <ArrowRight className="h-4 w-4 text-accent-hover" />
        )}
      </div>
    </div>
  )
}

function BossCard({
  name,
  initial,
  active,
  progress,
  yourLvl,
}: {
  name: string
  initial: string
  active: boolean
  progress: number
  yourLvl: number
}) {
  return (
    <div
      className="flex h-[240px] flex-1 flex-col gap-2 rounded-xl border-2 border-danger p-5"
      style={{
        background: 'linear-gradient(135deg, #1a0510 0%, #1A1A2E 100%)',
        boxShadow: '0 6px 24px rgba(239,68,68,0.40)',
      }}
    >
      <div className="flex items-center justify-between">
        <span
          className="grid h-16 w-16 place-items-center rounded-xl font-display text-2xl font-extrabold text-text-primary"
          style={{ background: 'linear-gradient(135deg, #EF4444 0%, #582CFF 100%)' }}
        >
          {initial}
        </span>
        <span className="rounded-full bg-danger/20 px-2.5 py-0.5 font-mono text-[10px] font-semibold text-danger">
          BOSS · LVL 30
        </span>
      </div>
      <h3 className="font-display text-[22px] font-extrabold text-text-primary">{name}</h3>
      <p className="font-mono text-[11px] text-text-muted">
        Senior Backend track · 80 задач · 4 секции · ~28ч
      </p>
      <div className="flex items-center justify-between rounded-md bg-black/30 px-3 py-2 text-[11px]">
        <span className="font-mono text-warn">Lvl req: 30</span>
        <span className="font-mono text-text-secondary">У тебя: Lvl {yourLvl}</span>
        {active ? (
          <span className="rounded-full bg-success/20 px-2 py-0.5 font-mono text-[10px] font-semibold text-success">
            Активно
          </span>
        ) : (
          <span className="rounded-full bg-danger/20 px-2 py-0.5 font-mono text-[10px] font-semibold text-danger">
            Заблокировано
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 text-[11px]">
        <Crown className="h-4 w-4 text-warn" />
        <span className="text-text-secondary">Reward: Hero Card + Title</span>
      </div>
      {active ? (
        <Button variant="primary" size="sm" className="mt-auto">
          Продолжить · {progress}%
        </Button>
      ) : (
        <Button variant="ghost" size="sm" className="mt-auto" icon={<Lock className="h-3.5 w-3.5" />}>
          Открыть после Lvl 30
        </Button>
      )}
    </div>
  )
}

const TABS = ['Все 12', 'Normal 6', 'Hard 4', 'Boss 2', 'Пройденные', 'Активные']

export default function DungeonsPage() {
  const { data, isError } = useDungeonsQuery()
  const total = data?.total ?? 12
  const totalTasks = data?.total_tasks ?? 480
  const done = data?.done ?? 5
  return (
    <AppShellV2>
      <div className="flex flex-col gap-6 px-4 py-6 sm:px-8 lg:px-20 lg:py-8">
        <div className="flex flex-col items-start gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex flex-col gap-1.5">
            <h1 className="font-display text-2xl lg:text-[32px] font-bold leading-[1.1] text-text-primary">
              Подземелья компаний
            </h1>
            <p className="text-sm text-text-secondary">{total} компаний · {totalTasks} задач</p>
            {isError && <ErrorChip />}
          </div>
          <div className="flex items-center gap-3">
            <span className="rounded-full bg-warn/15 px-3 py-1 font-mono text-[12px] font-semibold text-warn">
              {done} / {total} пройдено
            </span>
            <Button variant="ghost" icon={<Filter className="h-4 w-4" />}>Фильтры</Button>
          </div>
        </div>

        <div className="flex items-center gap-1 overflow-x-auto border-b border-border">
          {TABS.map((t, i) => (
            <button
              key={t}
              className={[
                'px-3 py-2.5 text-sm transition-colors',
                i === 0
                  ? 'border-b-2 border-accent font-semibold text-text-primary'
                  : 'text-text-secondary hover:text-text-primary',
              ].join(' ')}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Tier 1 NORMAL */}
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-success/20 px-2.5 py-0.5 font-mono text-[11px] font-semibold text-success">
              NORMAL
            </span>
            <span className="font-display text-[15px] font-bold text-text-primary">Junior–Middle level</span>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {NORMAL.map((c) => (
              <CompanyCard key={c.name} c={c} />
            ))}
          </div>
        </div>

        {/* Tier 2 HARD */}
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-warn/20 px-2.5 py-0.5 font-mono text-[11px] font-semibold text-warn">
              HARD
            </span>
            <span className="font-display text-[15px] font-bold text-text-primary">Middle–Senior</span>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {HARD.map((c) => (
              <CompanyCard key={c.name} c={c} hard />
            ))}
          </div>
        </div>

        {/* Tier 3 BOSS */}
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-danger/20 px-2.5 py-0.5 font-mono text-[11px] font-semibold text-danger">
              BOSS
            </span>
            <span className="font-display text-[15px] font-bold text-warn">
              Senior+ · Требуется Lvl 30+
            </span>
          </div>
          <div className="flex flex-col gap-4 lg:flex-row">
            <BossCard name="Yandex" initial="Я" active={false} progress={0} yourLvl={24} />
            <BossCard name="Tinkoff" initial="T" active={true} progress={5} yourLvl={24} />
          </div>
        </div>
      </div>
    </AppShellV2>
  )
}
