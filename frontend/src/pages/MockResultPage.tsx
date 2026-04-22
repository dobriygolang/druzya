// TODO i18n
import { useParams } from 'react-router-dom'
import {
  ArrowLeft,
  Check,
  Download,
  Plus,
  RotateCcw,
  Sparkles,
  X,
} from 'lucide-react'
import { AppShellV2 } from '../components/AppShell'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { useMockReportQuery } from '../lib/queries/mock'

function ErrorChip() {
  return (
    <span className="rounded-full bg-danger/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-danger">
      Не удалось загрузить
    </span>
  )
}

function Header() {
  return (
    <div className="flex h-16 items-center justify-between gap-2 border-b border-border bg-surface-1 px-4 sm:px-8">
      <button className="grid h-9 w-9 place-items-center rounded-md text-text-secondary hover:bg-surface-2">
        <ArrowLeft className="h-5 w-5" />
      </button>
      <span className="font-display text-base font-bold text-text-primary">
        AI Mock Review · Senior Yandex · 28 апр
      </span>
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" icon={<Download className="h-4 w-4" />}>
          Export PDF
        </Button>
        <Button variant="primary" size="sm" icon={<RotateCcw className="h-4 w-4" />}>
          Повторить мок
        </Button>
      </div>
    </div>
  )
}

function Hero({ overall }: { overall: number }) {
  return (
    <div className="relative flex flex-col items-start justify-between gap-4 overflow-hidden border-b border-border bg-gradient-to-r from-surface-3 to-accent px-4 py-6 sm:px-6 lg:h-[200px] lg:flex-row lg:items-center lg:gap-0 lg:px-10 lg:py-0">
      <div className="flex flex-col gap-2">
        <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 font-mono text-[11px] font-semibold tracking-[0.08em] text-text-primary">
          <Sparkles className="h-3 w-3" /> AI MOCK · ЗАВЕРШЁН
        </span>
        <h1 className="font-display text-2xl sm:text-3xl lg:text-[36px] font-extrabold leading-[1.1] text-text-primary">
          Overall: {overall} / 100
        </h1>
        <p className="text-[13px] text-white/80">Готовность к Senior Yandex Backend: {overall}%</p>
      </div>
      <div className="flex flex-col items-end gap-2">
        <span
          className="rounded-lg border-2 border-warn bg-warn/10 px-4 py-2 font-display text-[18px] font-extrabold tracking-wide text-warn"
          style={{ fontFamily: '"Geist Mono", monospace' }}
        >
          STRONG MIDDLE
        </span>
        <span className="font-mono text-[11px] text-white/70">verdict</span>
      </div>
    </div>
  )
}

function SectionCard({
  label,
  value,
  variant,
  comment,
}: {
  label: string
  value: number
  variant: 'success' | 'warn'
  comment: string
}) {
  const color = variant === 'success' ? 'text-success' : 'text-warn'
  const bar = variant === 'success' ? 'bg-success' : 'bg-warn'
  return (
    <Card className="flex-1 flex-col gap-2 p-5" interactive={false}>
      <span className="font-mono text-[11px] font-semibold tracking-[0.08em] text-text-muted">
        {label.toUpperCase()}
      </span>
      <div className="flex items-baseline gap-2">
        <span className={`font-display text-[28px] font-extrabold ${color}`}>{value}</span>
        <span className="text-[12px] text-text-muted">/ 100</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-black/30">
        <div className={`h-full ${bar}`} style={{ width: `${value}%` }} />
      </div>
      <p className="text-[12px] leading-relaxed text-text-secondary">{comment}</p>
    </Card>
  )
}

function StrengthsCard({ items }: { items: string[] }) {
  return (
    <Card className="flex-col gap-3 border-success/40 p-[22px]" interactive={false}>
      <h3 className="font-display text-base font-bold text-success">Сильные стороны</h3>
      {items.map((t, i) => (
        <div key={i} className="flex items-start gap-2">
          <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" />
          <span className="text-[13px] text-text-secondary">{t}</span>
        </div>
      ))}
    </Card>
  )
}

function WeaknessesCard({ items }: { items: string[] }) {
  return (
    <Card className="flex-col gap-3 border-danger/40 p-[22px]" interactive={false}>
      <h3 className="font-display text-base font-bold text-danger">Слабые места</h3>
      {items.map((t, i) => (
        <div key={i} className="flex items-start gap-2">
          <X className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
          <span className="text-[13px] text-text-secondary">{t}</span>
        </div>
      ))}
    </Card>
  )
}

function RecsCard({ items }: { items: { p: string; text: string }[] }) {
  return (
    <Card className="flex-col gap-3 border-accent/40 bg-gradient-to-br from-accent/40 to-pink/30 p-[22px]" interactive={false}>
      <h3 className="font-display text-base font-bold text-text-primary">Рекомендации</h3>
      {items.map((it, i) => (
        <div key={i} className="flex items-start gap-2">
          <span
            className={[
              'rounded px-1.5 py-0.5 font-mono text-[10px] font-bold',
              it.p === 'P1' ? 'bg-danger/30 text-danger' : 'bg-warn/30 text-warn',
            ].join(' ')}
          >
            {it.p}
          </span>
          <span className="text-[13px] text-text-secondary">{it.text}</span>
        </div>
      ))}
    </Card>
  )
}

function StressTimelineCard() {
  const bars = [30, 35, 28, 40, 45, 50, 55, 70, 60, 92, 75, 50]
  return (
    <Card className="flex-col gap-3 p-5" interactive={false}>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-text-primary">Стресс по времени</h3>
        <span className="font-mono text-[11px] text-danger">peak 32:00</span>
      </div>
      <div className="flex h-24 items-end gap-1.5">
        {bars.map((h, i) => (
          <div
            key={i}
            className={[
              'flex-1 rounded-t',
              h > 80 ? 'bg-danger' : h > 60 ? 'bg-warn' : 'bg-cyan/60',
            ].join(' ')}
            style={{ height: `${h}%` }}
          />
        ))}
      </div>
      <div className="flex justify-between font-mono text-[10px] text-text-muted">
        <span>0:00</span>
        <span>30:00</span>
        <span>45:00</span>
      </div>
    </Card>
  )
}

function CompanyScoreCard() {
  const rows = [
    { c: 'Yandex', v: 72 },
    { c: 'Tinkoff', v: 78 },
    { c: 'VK', v: 80 },
    { c: 'Avito', v: 85 },
    { c: 'Сбер', v: 76 },
  ]
  return (
    <Card className="flex-col gap-3 p-5" interactive={false}>
      <h3 className="text-sm font-bold text-text-primary">По компаниям</h3>
      {rows.map((r) => (
        <div key={r.c} className="flex items-center gap-3">
          <span className="w-16 text-[13px] text-text-secondary">{r.c}</span>
          <div className="flex h-1.5 flex-1 overflow-hidden rounded-full bg-black/30">
            <div className="h-full bg-gradient-to-r from-cyan to-accent" style={{ width: `${r.v}%` }} />
          </div>
          <span className="font-mono text-[12px] font-semibold text-text-primary">{r.v}%</span>
        </div>
      ))}
    </Card>
  )
}

function ApplyCard() {
  return (
    <Card className="flex-col gap-3 p-5" interactive={false}>
      <h3 className="font-display text-base font-bold text-text-primary">Применить к плану</h3>
      <p className="text-[12px] text-text-secondary">
        Добавим 4 рекомендации в твой 30-дневный план подготовки.
      </p>
      <Button variant="primary" size="sm" icon={<Plus className="h-4 w-4" />}>
        Добавить в план
      </Button>
    </Card>
  )
}

export default function MockResultPage() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const { data: report, isError } = useMockReportQuery(sessionId)
  const overall = report?.overall_score ?? 72
  const sections = report?.sections ?? {}
  const sec = (key: string, fallback: { score: number; comment: string }) =>
    sections[key] ?? fallback
  const ps = sec('problem_solving', { score: 80, comment: 'Уверенное решение алгоритмов' })
  const cq = sec('code_quality', { score: 65, comment: 'Нейминг и структура хромают' })
  const cm = sec('communication', { score: 75, comment: 'Хорошо думал вслух' })
  const sh = sec('stress_handling', { score: 60, comment: 'Просадка на минуте 32' })
  const strengths = report?.strengths?.length
    ? report.strengths
    : ['Чистая архитектура решения LRU', 'Точная оценка временной сложности', 'Хорошие вопросы по требованиям', 'Уверенно держал ритм диалога']
  const weaknesses = report?.weaknesses?.length
    ? report.weaknesses
    : ['Не упомянул потокобезопасность', 'Слабый анализ trade-offs', 'Поверхностный system design', 'Долго думал перед кодом (4 мин)']
  const recs = report?.recommendations?.length
    ? report.recommendations.map((r, i) => ({ p: i < 2 ? 'P1' : 'P2', text: r.title }))
    : [
        { p: 'P1', text: 'Повтори concurrency patterns в Go' },
        { p: 'P1', text: '5 задач по System Design (Scaling)' },
        { p: 'P2', text: 'Тренируй STAR-формат ответов' },
        { p: 'P2', text: 'Запиши 1 mock-видео для разбора' },
      ]
  return (
    <AppShellV2>
      <Header />
      <Hero overall={overall} />
      <div className="flex flex-col gap-6 px-4 py-6 sm:px-8 lg:px-20 lg:py-8">
        {isError && <ErrorChip />}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <SectionCard label="Problem Solving" value={ps.score} variant={ps.score >= 70 ? 'success' : 'warn'} comment={ps.comment} />
          <SectionCard label="Code Quality" value={cq.score} variant={cq.score >= 70 ? 'success' : 'warn'} comment={cq.comment} />
          <SectionCard label="Communication" value={cm.score} variant={cm.score >= 70 ? 'success' : 'warn'} comment={cm.comment} />
          <SectionCard label="Stress Handling" value={sh.score} variant={sh.score >= 70 ? 'success' : 'warn'} comment={sh.comment} />
        </div>
        <div className="flex flex-col gap-4 lg:flex-row lg:gap-6">
          <div className="flex flex-1 flex-col gap-4">
            <StrengthsCard items={strengths} />
            <WeaknessesCard items={weaknesses} />
            <RecsCard items={recs} />
          </div>
          <div className="flex w-full flex-col gap-4 lg:w-[380px]">
            <StressTimelineCard />
            <CompanyScoreCard />
            <ApplyCard />
          </div>
        </div>
      </div>
    </AppShellV2>
  )
}
