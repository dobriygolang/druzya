// WeeklyReportPage — /report.
//
// Все агрегаты (XP, секции, weekly compare, streak, stress narrative)
// приходят с бэка через useWeeklyReportQuery → /api/v1/profile/me/report.
// Backend держит 5-min Redis-кеш + инвалидацию по событиям MatchCompleted/
// XPGained, см. profile/infra/report_cache.go.
import { Brain, Headphones } from 'lucide-react'
import { AppShellV2 } from '../components/AppShell'
import { useWeeklyReportQuery, type WeeklyReport } from '../lib/queries/weekly'

function ErrorChip() {
  return (
    <span className="rounded-full bg-danger/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-danger">
      Не удалось загрузить
    </span>
  )
}

function HeaderRow({
  period,
  actions,
  isError,
}: {
  period: string
  actions: number
  isError: boolean
}) {
  return (
    <div className="flex flex-col items-start gap-4 px-4 pt-6 sm:px-8 lg:flex-row lg:items-end lg:justify-between lg:px-20 lg:pt-8">
      <div className="flex flex-col gap-1.5">
        <h1 className="font-display text-2xl lg:text-[32px] font-bold leading-[1.1] text-text-primary">
          Weekly AI Report
        </h1>
        <p className="text-sm text-text-secondary">
          {period} · {actions} действий · скользящий 7-дневный агрегат
        </p>
        {isError && <ErrorChip />}
      </div>
      {/*
        Dead "Прошлая неделя" dropdown + "Экспорт" кнопки удалены (anti-fake:
        не рендерим интерактив, пока backend не поддерживает).
        Вернём когда:
          - GET /profile/report/{week_iso} появится (week-selector backend),
          - POST /profile/report/export отдаёт CSV/PDF blob.
        Трекается: killer-stats post-Wave-5 session.
      */}
    </div>
  )
}

function MetricCard({
  label,
  chip,
  chipColor,
  big,
  bigColor,
  sub,
}: {
  label: string
  chip?: string
  chipColor?: string
  big: string
  bigColor: string
  sub: string
}) {
  return (
    <div className="flex h-[130px] flex-1 flex-col gap-2 rounded-2xl bg-surface-2 p-5">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[11px] font-semibold tracking-[0.08em] text-text-muted">
          {label}
        </span>
        {chip && (
          <span className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-bold ${chipColor}`}>
            {chip}
          </span>
        )}
      </div>
      <span className={`font-display text-2xl lg:text-[32px] font-extrabold ${bigColor}`}>{big}</span>
      <span className="text-[11px] text-text-muted">{sub}</span>
    </div>
  )
}

function StatsRow({ stats }: { stats: WeeklyReport['stats'] }) {
  const isPositive = (delta: string) => delta.startsWith('+') && delta !== '+0%'
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <MetricCard
        label="ОБЩИЙ XP"
        chip={stats.xp.delta}
        chipColor={isPositive(stats.xp.delta) ? 'bg-success/15 text-success' : 'bg-danger/15 text-danger'}
        big={stats.xp.value}
        bigColor="text-accent-hover"
        sub="за 7 дней"
      />
      <MetricCard
        label="МАТЧЕЙ"
        chip={stats.matches.delta}
        chipColor={isPositive(stats.matches.delta) ? 'bg-success/15 text-success' : 'bg-danger/15 text-danger'}
        big={stats.matches.value}
        bigColor="text-text-primary"
        sub={`${stats.matches.wins} W · ${stats.matches.losses} L`}
      />
      <MetricCard label="СТРИК" big={stats.streak.value} bigColor="text-warn" sub={`лучшая ${stats.streak.best}`} />
      <MetricCard
        label="СРЕДНИЙ LP/МАТЧ"
        big={stats.avg_lp.value}
        bigColor="text-success"
        sub={stats.avg_lp.total}
      />
    </div>
  )
}

const DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

const LEVEL_BG = ['bg-surface-1', 'bg-accent/20', 'bg-accent/40', 'bg-accent', 'bg-accent-hover']

// DailyBarChart — честный 7-столбиковый chart активности по дням. Раньше
// WeeklyReportPage раздувал 7 значений в фейковый 7×24 heatmap через
// эвристику «если час 9..22 то base иначе base-1», что — чистый анти-
// фолбек: бэк ЧАСОВ не знает. Возвращаем реальный вид, который точно
// отражает полученные данные. 7×24 hour-of-day агрегация появится, когда
// в profile.ReportView добавят HourlyHeatmap[7][24] (post-Wave-5 session).
function DailyBarChart({ daily }: { daily: number[] }) {
  const max = Math.max(1, ...daily)
  return (
    <div className="flex flex-col gap-5 rounded-2xl bg-surface-2 p-7">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg font-bold text-text-primary">Активность по дням</h2>
        <span className="font-mono text-[11px] text-text-muted">7 дней</span>
      </div>
      <div className="flex items-end justify-between gap-2 h-[160px]">
        {DAYS.map((d, i) => {
          const v = daily[i] ?? 0
          const pct = v === 0 ? 4 : Math.max(8, Math.round((v / max) * 100))
          const level = v === 0 ? 0 : Math.min(4, Math.max(1, Math.round((v / max) * 4)))
          return (
            <div key={d} className="flex flex-1 flex-col items-center gap-2">
              <div className="flex h-full w-full items-end">
                <div
                  className={`w-full rounded-t-md ${LEVEL_BG[level]} transition-all`}
                  style={{ height: `${pct}%` }}
                  title={`${d}: ${v} действий`}
                />
              </div>
              <span className="font-mono text-[11px] text-text-muted">{d}</span>
              <span className="font-mono text-[10px] text-text-primary">{v}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function StrongSections({ rows }: { rows: WeeklyReport['strong_sections'] }) {
  if (rows.length === 0) {
    return (
      <div className="flex flex-col gap-3 rounded-2xl border border-success bg-surface-2 p-5">
        <h3 className="font-display text-sm font-bold text-text-primary">Сильные секции</h3>
        <p className="text-[12px] text-text-muted">Пока нет данных — сыграй несколько матчей.</p>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-success bg-surface-2 p-5">
      <h3 className="font-display text-sm font-bold text-text-primary">Сильные секции</h3>
      {rows.map((r) => (
        <div key={r.id + r.name} className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-full bg-success/20 font-display text-sm font-bold text-success">
            {r.id}
          </span>
          <div className="flex flex-1 flex-col">
            <span className="text-sm font-semibold text-text-primary">{r.name}</span>
            <span className="text-[11px] text-text-muted">{r.sub}</span>
          </div>
          <span className="font-mono text-sm font-bold text-success">{r.xp}</span>
        </div>
      ))}
    </div>
  )
}

function WeakSections({ rows }: { rows: WeeklyReport['weak_sections'] }) {
  if (rows.length === 0) {
    return (
      <div className="flex flex-col gap-3 rounded-2xl border border-danger bg-surface-2 p-5">
        <h3 className="font-display text-sm font-bold text-text-primary">Слабые секции</h3>
        <p className="text-[12px] text-text-muted">Слабых секций нет — отличная неделя.</p>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-danger bg-surface-2 p-5">
      <h3 className="font-display text-sm font-bold text-text-primary">Слабые секции</h3>
      {rows.map((r) => (
        <div key={r.id + r.name} className="flex items-center gap-3">
          <span
            className={`grid h-9 w-9 place-items-center rounded-full font-display text-sm font-bold ${
              r.tone === 'danger' ? 'bg-danger/20 text-danger' : 'bg-warn/20 text-warn'
            }`}
          >
            {r.id}
          </span>
          <div className="flex flex-1 flex-col">
            <span className="text-sm font-semibold text-text-primary">{r.name}</span>
            <span className="text-[11px] text-text-muted">{r.sub}</span>
          </div>
          <span className={`font-mono text-sm font-bold ${r.tone === 'danger' ? 'text-danger' : 'text-warn'}`}>
            {r.xp}
          </span>
        </div>
      ))}
    </div>
  )
}

function StressPattern({ text }: { text: string }) {
  if (!text) return null
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-accent-hover bg-gradient-to-br from-accent/20 to-pink/20 p-5">
      <div className="flex items-center gap-2">
        <Brain className="h-4 w-4 text-pink" />
        <h3 className="font-display text-sm font-bold text-text-primary">Психологический паттерн</h3>
      </div>
      <p className="text-xs leading-relaxed text-text-secondary">{text}</p>
    </div>
  )
}

function ActionsCard({ rows }: { rows: WeeklyReport['actions'] }) {
  if (rows.length === 0) {
    return (
      <div className="flex flex-col gap-3 rounded-2xl border border-accent bg-surface-2 p-5">
        <h3 className="font-display text-sm font-bold text-text-primary">Действия на следующую неделю</h3>
        <p className="text-[12px] text-text-muted">Рекомендации появятся после ближайших матчей.</p>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-accent bg-surface-2 p-5">
      <h3 className="font-display text-sm font-bold text-text-primary">
        {rows.length} действия на следующую неделю
      </h3>
      {rows.map((r, i) => (
        <div key={i} className="flex items-start gap-2 border-b border-border pb-2 last:border-0">
          <span
            className={`mt-0.5 rounded px-1.5 py-0.5 font-mono text-[10px] font-bold ${
              r.p === 'P1' ? 'bg-danger/15 text-danger' : 'bg-warn/15 text-warn'
            }`}
          >
            {r.p}
          </span>
          <div className="flex flex-1 flex-col">
            <span className="text-xs font-semibold text-text-primary">{r.text}</span>
            {r.sub && <span className="text-[11px] text-text-muted">{r.sub}</span>}
          </div>
        </div>
      ))}
    </div>
  )
}

function PodcastCard({ podcast }: { podcast: WeeklyReport['podcast'] }) {
  if (!podcast.title) return null
  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-surface-2 p-5">
      <h3 className="font-display text-sm font-bold text-text-primary">Подкаст недели</h3>
      <div className="flex items-center gap-3">
        <div className="grid h-12 w-12 place-items-center rounded-md bg-gradient-to-br from-pink to-accent">
          <Headphones className="h-5 w-5 text-text-primary" />
        </div>
        <div className="flex flex-1 flex-col">
          <span className="text-xs font-semibold text-text-primary">
            {podcast.title} · {podcast.duration}
          </span>
          <span className="text-[11px] text-text-muted">{podcast.sub}</span>
        </div>
      </div>
    </div>
  )
}

function CompareWeeks({ rows }: { rows: WeeklyReport['compare_weeks'] }) {
  if (rows.length === 0) return null
  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-surface-2 p-5">
      <h3 className="font-display text-sm font-bold text-text-primary">Последние 4 недели</h3>
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-3">
          <span className="w-8 font-mono text-[11px] text-text-muted">{r.label}</span>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-1">
            <div
              className="h-full rounded-full bg-gradient-to-r from-cyan to-accent"
              style={{ width: r.w }}
            />
          </div>
          <span className="w-14 text-right font-mono text-[11px] text-text-secondary">{r.xp}</span>
        </div>
      ))}
    </div>
  )
}

const EMPTY_STATS: WeeklyReport['stats'] = {
  xp: { value: '0', delta: '0%' },
  matches: { value: '0', wins: 0, losses: 0, delta: '0%' },
  streak: { value: '0', best: 0 },
  avg_lp: { value: '+0.0', total: '+0 lp всего' },
}

export default function WeeklyReportPage() {
  const { data, isError, isLoading } = useWeeklyReportQuery()
  // Loading skeleton — нули вместо хардкода, чтобы фронт не врал, пока бэк
  // отвечает. После готового запроса — рендерим реальные значения.
  const stats = data?.stats ?? EMPTY_STATS
  const period = data?.period ?? (isLoading ? '…' : '—')
  const actions = data?.actions_count ?? 0
  return (
    <AppShellV2>
      <HeaderRow period={period} actions={actions} isError={isError} />
      <div className="flex flex-col gap-6 px-4 pb-6 pt-6 sm:px-8 lg:px-20 lg:pb-7">
        <StatsRow stats={stats} />
        <DailyBarChart daily={data?.heatmap ?? []} />
        <div className="flex flex-col gap-4 lg:flex-row lg:gap-6">
          <div className="flex flex-1 flex-col gap-5">
            <StrongSections rows={data?.strong_sections ?? []} />
            <WeakSections rows={data?.weak_sections ?? []} />
            <StressPattern text={data?.stress_pattern ?? ''} />
          </div>
          <div className="flex w-full flex-col gap-5 lg:w-[360px]">
            <ActionsCard rows={data?.actions ?? []} />
            <PodcastCard podcast={data?.podcast ?? { title: '', duration: '', sub: '' }} />
            <CompareWeeks rows={data?.compare_weeks ?? []} />
          </div>
        </div>
      </div>
    </AppShellV2>
  )
}
