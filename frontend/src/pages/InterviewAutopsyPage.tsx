// TODO i18n
import { useParams } from 'react-router-dom'
import {
  AlertTriangle,
  CalendarPlus,
  Skull,
  Sparkles,
} from 'lucide-react'
import { AppShellV2 } from '../components/AppShell'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { useInterviewAutopsyQuery } from '../lib/queries/interviewAutopsy'

function ErrorChip() {
  return (
    <span className="rounded-full bg-danger/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-danger">
      Не удалось загрузить
    </span>
  )
}

function Hero({ title, role, date, duration, verdict, verdictSub }: { title: string; role: string; date: string; duration: number; verdict: string; verdictSub: string }) {
  return (
    <div
      className="relative flex flex-col items-start justify-between gap-4 overflow-hidden border-b border-border px-4 py-6 sm:px-6 lg:h-[200px] lg:flex-row lg:items-center lg:gap-0 lg:px-10 lg:py-0"
      style={{ background: 'linear-gradient(135deg, #2A0510 0%, #0A0A0F 100%)' }}
    >
      <div className="flex flex-col gap-3">
        <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-danger/20 px-2.5 py-1 font-mono text-[11px] font-semibold tracking-[0.08em] text-danger">
          <Skull className="h-3 w-3" /> INTERVIEW AUTOPSY · ПОСЛЕ СОБЕСА
        </span>
        <h1 className="font-display text-2xl lg:text-[32px] font-extrabold leading-[1.1] text-text-primary">
          {title}
        </h1>
        <p className="text-[13px] text-text-secondary">
          {role} · {date} · {duration} мин
        </p>
      </div>
      <div className="flex flex-col items-end gap-2">
        <span
          className="rounded-lg border-2 border-danger bg-danger/10 px-4 py-2 font-extrabold tracking-wide text-danger"
          style={{ fontFamily: '"Geist Mono", monospace', fontSize: 18, fontWeight: 800 }}
        >
          {verdict}
        </span>
        <span className="font-mono text-[11px] text-text-muted">{verdictSub}</span>
      </div>
    </div>
  )
}

function TimelineCard({ events }: { events: { time: string; label: string; status: string; color: string }[] }) {
  const colorMap: Record<string, string> = {
    success: 'bg-success/15 text-success',
    warn: 'bg-warn/15 text-warn',
    danger: 'bg-danger/15 text-danger',
  }
  return (
    <Card className="flex-col gap-4 p-6" interactive={false}>
      <h3 className="font-display text-base font-bold text-text-primary">Что произошло</h3>
      <div className="flex flex-col gap-3">
        {events.map((e, i) => (
          <div key={i} className="flex items-center gap-3">
            <span className="w-12 font-mono text-[12px] text-text-muted">{e.time}</span>
            <div className="flex flex-1 items-center justify-between rounded-lg bg-surface-1 px-4 py-3">
              <span className="text-[13px] text-text-secondary">{e.label}</span>
              <span className={`rounded-full px-2.5 py-1 font-mono text-[10px] font-bold ${colorMap[e.color]}`}>
                {e.status}
              </span>
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}

function FailRowsCard({ rows }: { rows: { tag: string; title: string; sub: string; level: string }[] }) {
  return (
    <Card className="flex-col gap-4 border-danger/40 p-6" interactive={false}>
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-5 w-5 text-danger" />
        <h3 className="font-display text-base font-bold text-danger">Где именно потерял</h3>
      </div>
      {rows.map((r, i) => (
        <div key={i} className="flex items-start gap-3 rounded-lg bg-surface-1 p-4">
          <span className="rounded bg-danger/20 px-2 py-1 font-mono text-[10px] font-bold text-danger">
            {r.tag}
          </span>
          <div className="flex flex-1 flex-col">
            <span className="text-[13px] font-semibold text-text-primary">{r.title}</span>
            <span className="text-[12px] text-text-secondary">{r.sub}</span>
          </div>
          <span className="rounded-full bg-danger/20 px-2.5 py-1 font-mono text-[10px] font-bold text-danger">
            {r.level === 'red flag' ? 'красный флаг' : r.level}
          </span>
        </div>
      ))}
    </Card>
  )
}

function VerdictCard({ text }: { text: string }) {
  return (
    <Card className="flex-col gap-3 border-danger/30 bg-gradient-to-br from-danger/40 to-accent/40 p-5" interactive={false}>
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-text-primary" />
        <h3 className="font-display text-base font-bold text-text-primary">
          Что нужно было сказать
        </h3>
      </div>
      <p className="text-[13px] leading-relaxed text-white/90">
        {text}
      </p>
    </Card>
  )
}

function ActionPlanCard({ actions }: { actions: { p: string; text: string }[] }) {
  return (
    <Card className="flex-col gap-3 border-accent/40 p-5" interactive={false}>
      <h3 className="font-display text-base font-bold text-text-primary">План действий</h3>
      {actions.map((a, i) => (
        <div key={i} className="flex items-start gap-2">
          <span
            className={[
              'rounded px-1.5 py-0.5 font-mono text-[10px] font-bold',
              a.p === 'P1' ? 'bg-danger/30 text-danger' : a.p === 'P2' ? 'bg-warn/30 text-warn' : 'bg-cyan/30 text-cyan',
            ].join(' ')}
          >
            {a.p}
          </span>
          <span className="text-[13px] text-text-secondary">{a.text}</span>
        </div>
      ))}
    </Card>
  )
}

function ApplyCard({ weeks }: { weeks: string }) {
  return (
    <Card className="flex-col gap-3 p-5" interactive={false}>
      <h3 className="font-display text-base font-bold text-text-primary">
        Запланировать новую дату
      </h3>
      <p className="text-[12px] text-text-secondary">
        Рекомендуем повторно собеседоваться через {weeks} недель.
      </p>
      <Button variant="primary" size="sm" icon={<CalendarPlus className="h-4 w-4" />}>
        Добавить в календарь
      </Button>
    </Card>
  )
}

const FALLBACK_TIMELINE = [
  { time: '0:08', label: 'Two Sum — оптимально', status: 'PASSED', color: 'success' },
  { time: '0:18', label: 'String parsing — частично', status: 'PARTIAL', color: 'warn' },
  { time: '0:42', label: 'System Design — Twitter feed', status: 'FAILED', color: 'danger' },
  { time: '0:58', label: 'Behavioral — конфликт в команде', status: 'SKIPPED', color: 'danger' },
]
const FALLBACK_FAILURES = [
  { tag: 'SD', title: 'CACHING', sub: 'не упомянул Redis для hot-feed', level: 'critical' },
  { tag: 'BEH', title: 'STAR', sub: 'ответ без структуры (Situation-Task-Action-Result)', level: 'critical' },
  { tag: 'ENG', title: 'ENGAGEMENT', sub: 'не задал ни одного вопроса интервьюеру', level: 'red flag' },
]
const FALLBACK_PLAN = [
  { p: 'P1', text: 'Прорешать 5 system design кейсов (caching focus)' },
  { p: 'P1', text: 'Записать 3 STAR-истории про конфликты' },
  { p: 'P2', text: 'Подготовить 5 умных вопросов интервьюеру' },
  { p: 'P3', text: 'Mock-собес с senior через 7 дней' },
]

export default function InterviewAutopsyPage() {
  const { id } = useParams<{ id: string }>()
  const { data, isError } = useInterviewAutopsyQuery(id)
  return (
    <AppShellV2>
      <Hero
        title={data?.title ?? 'Не взяли в Yandex — разбираем почему'}
        role={data?.role ?? 'Senior Backend'}
        date={data?.date ?? '28 апреля'}
        duration={data?.duration_min ?? 60}
        verdict={data?.verdict ?? 'REJECTED'}
        verdictSub={data?.verdict_sub ?? 'после фидбека HR'}
      />
      {isError && (
        <div className="flex justify-end px-4 py-2">
          <ErrorChip />
        </div>
      )}
      <div className="flex flex-col gap-4 px-4 py-6 sm:px-8 lg:flex-row lg:gap-6 lg:px-20">
        <div className="flex flex-1 flex-col gap-6">
          <TimelineCard events={data?.timeline ?? FALLBACK_TIMELINE} />
          <FailRowsCard rows={data?.failures ?? FALLBACK_FAILURES} />
        </div>
        <div className="flex w-full flex-col gap-4 lg:w-[380px]">
          <VerdictCard text={data?.ai_verdict ?? '«Для горячего feed — Redis Sorted Set с TTL 5 мин, fallback в БД. Для celebrity-аккаунтов переходим на pull-модель, чтобы не флудить миллион очередей при каждом твите».'} />
          <ActionPlanCard actions={data?.action_plan ?? FALLBACK_PLAN} />
          <ApplyCard weeks={data?.next_attempt_weeks ?? '6-8'} />
        </div>
      </div>
    </AppShellV2>
  )
}
