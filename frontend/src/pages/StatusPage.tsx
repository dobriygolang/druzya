// StatusPage — public uptime / transparency surface.
//
// Replaces the apigen-era hard-coded service grid + dated "20 апр 2026"
// incident list with live data from GET /api/v1/status (public endpoint).
//
// Refetches every 30s — same TTL as the server-side Redis cache, so the
// browser sees the freshest snapshot the moment it expires upstream.
// TODO i18n
import { Link } from 'react-router-dom'
import { Check, ArrowLeft, AlertTriangle, AlertCircle } from 'lucide-react'
import { Button } from '../components/Button'
import { useStatusPageQuery, type StatusServiceState, type StatusIncident } from '../lib/queries/status'

function TopBar() {
  return (
    <div className="flex h-auto items-center justify-between gap-3 border-b border-border bg-surface-1 px-4 py-3 sm:px-7 lg:h-14 lg:py-0">
      <div className="flex items-center gap-2.5">
        <span className="grid h-7 w-7 place-items-center rounded-md bg-gradient-to-br from-accent to-cyan font-display text-sm font-extrabold text-text-primary">
          9
        </span>
        <span className="font-display text-base font-bold text-text-primary">druz9 status</span>
        <span className="rounded-full bg-surface-3 px-1.5 py-0.5 font-mono text-[9px] text-text-muted">
          v3.2
        </span>
      </div>
      <Link to="/sanctum">
        <Button variant="ghost" size="sm" icon={<ArrowLeft className="h-3.5 w-3.5" />}>
          На главную
        </Button>
      </Link>
    </div>
  )
}

function Hero({
  status,
  uptime90d,
  generatedAt,
}: {
  status: 'operational' | 'degraded' | 'down' | string
  uptime90d: string
  generatedAt: string
}) {
  const cfg = heroConfigForStatus(status)
  const seconds = secondsAgo(generatedAt)
  return (
    <div className="flex flex-col items-center justify-center gap-3.5 px-4 py-8 sm:px-8 lg:px-20 lg:py-10">
      <div className={`grid h-24 w-24 place-items-center rounded-full ${cfg.bg}`} style={{ boxShadow: `inset 0 0 0 3px ${cfg.ring}` }}>
        {cfg.icon}
      </div>
      <h1 className={`font-display text-2xl lg:text-[32px] font-extrabold ${cfg.text} text-center`}>{cfg.title}</h1>
      <p className="text-sm text-text-secondary">
        Аптайм {uptime90d} за последние 90 дней · обновлено {seconds === null ? '—' : `${seconds} ${pluralizeSeconds(seconds)} назад`}
      </p>
    </div>
  )
}

function heroConfigForStatus(s: string) {
  switch (s) {
    case 'operational':
      return {
        bg: 'bg-success/20',
        ring: '#10B981',
        text: 'text-success',
        title: 'Все системы работают',
        icon: <Check className="h-14 w-14 text-success" strokeWidth={3} />,
      }
    case 'degraded':
      return {
        bg: 'bg-warn/20',
        ring: '#F59E0B',
        text: 'text-warn',
        title: 'Частичная деградация',
        icon: <AlertTriangle className="h-14 w-14 text-warn" strokeWidth={3} />,
      }
    case 'down':
    default:
      return {
        bg: 'bg-danger/20',
        ring: '#EF4444',
        text: 'text-danger',
        title: 'Перебои в работе',
        icon: <AlertCircle className="h-14 w-14 text-danger" strokeWidth={3} />,
      }
  }
}

function ServicesList({ services }: { services: StatusServiceState[] }) {
  // We render a fixed number of "history bars" per service: 30 dummy bars
  // because we don't yet expose a per-day history series. Bars all show as
  // ok unless the current state is degraded/down — in which case the most
  // recent ~5 bars flip color, matching the visual mockup. When the
  // backend grows a real bucketed history this is the place to plug it in.
  return (
    <div className="overflow-hidden rounded-2xl bg-surface-2">
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <h3 className="font-display text-base font-bold text-text-primary">Сервисы</h3>
        <span className="rounded-full bg-surface-3 px-2.5 py-0.5 font-mono text-[10px] text-text-muted">
          Refresh in 30s
        </span>
      </div>
      {services.length === 0 && (
        <div className="px-6 py-10 text-center font-mono text-sm text-text-muted">
          Нет данных о сервисах
        </div>
      )}
      {services.map((s) => {
        const bars = buildSparkBars(s.status)
        return (
          <div
            key={s.slug || s.name}
            className="flex flex-col gap-3 border-b border-border/50 px-4 py-3.5 last:border-0 sm:flex-row sm:items-center sm:gap-4 sm:px-6"
          >
            <span
              className={`h-2.5 w-2.5 rounded-full ${
                s.status === 'operational' ? 'bg-success' : s.status === 'degraded' ? 'bg-warn' : 'bg-danger'
              }`}
            />
            <div className="flex w-44 flex-col">
              <span className="text-sm font-semibold text-text-primary">{s.name}</span>
              <span className="font-mono text-[10px] text-text-muted">
                {s.slug}
                {typeof s.latency_ms === 'number' && s.latency_ms > 0 ? ` · ${s.latency_ms} ms` : ''}
              </span>
            </div>
            <div className="flex h-6 flex-1 items-center gap-[1px]">
              {bars.map((b, i) => (
                <span
                  key={i}
                  className={`h-6 w-[3px] rounded-sm ${
                    b === 'ok' ? 'bg-success' : b === 'degraded' ? 'bg-warn' : 'bg-danger'
                  }`}
                />
              ))}
            </div>
            <div className="flex w-28 flex-col items-end">
              <span
                className={`font-mono text-sm font-semibold ${
                  s.status === 'operational' ? 'text-success' : s.status === 'degraded' ? 'text-warn' : 'text-danger'
                }`}
              >
                {s.uptime_30d}
              </span>
              <span className="font-mono text-[10px] text-text-muted">uptime 30d</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function buildSparkBars(status: string): Array<'ok' | 'degraded' | 'down'> {
  const total = 30
  const out: Array<'ok' | 'degraded' | 'down'> = []
  for (let i = 0; i < total; i++) out.push('ok')
  if (status === 'degraded') {
    for (let i = total - 5; i < total; i++) out[i] = 'degraded'
  } else if (status === 'down') {
    for (let i = total - 3; i < total; i++) out[i] = 'down'
  }
  return out
}

function IncidentsCard({ incidents }: { incidents: StatusIncident[] }) {
  return (
    <div className="rounded-2xl bg-surface-2 p-6">
      <h3 className="font-display text-base font-bold text-text-primary">Недавние инциденты</h3>
      {incidents.length === 0 && (
        <div className="mt-4 rounded-[10px] bg-surface-1 p-4 text-center font-mono text-sm text-text-muted">
          Инцидентов не зарегистрировано.
        </div>
      )}
      <div className="mt-4 flex flex-col gap-3">
        {incidents.map((inc) => {
          const resolved = inc.ended_at !== null && inc.ended_at !== undefined && inc.ended_at !== ''
          return (
            <div key={inc.id} className="rounded-[10px] bg-surface-1 p-3.5">
              <div className="flex items-center justify-between">
                <span
                  className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold ${
                    resolved ? 'bg-success/15 text-success' : severityChip(inc.severity)
                  }`}
                >
                  {resolved ? 'RESOLVED' : (inc.severity || 'open').toUpperCase()}
                </span>
                <span className="font-mono text-[11px] text-text-muted">
                  {new Date(inc.started_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })}
                </span>
              </div>
              <h4 className="mt-2 font-display text-sm font-bold text-text-primary">{inc.title}</h4>
              {inc.description && <p className="mt-1 text-xs text-text-secondary">{inc.description}</p>}
              {inc.affected_services.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {inc.affected_services.map((s) => (
                    <span key={s} className="rounded-full bg-surface-3 px-2 py-0.5 font-mono text-[10px] text-text-muted">
                      {s}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function severityChip(sev: string): string {
  switch (sev) {
    case 'critical':
      return 'bg-danger/15 text-danger'
    case 'major':
      return 'bg-warn/15 text-warn'
    case 'minor':
    default:
      return 'bg-cyan/15 text-cyan'
  }
}

function secondsAgo(iso: string): number | null {
  if (!iso) return null
  const ts = new Date(iso).getTime()
  if (Number.isNaN(ts)) return null
  return Math.max(0, Math.round((Date.now() - ts) / 1000))
}

function pluralizeSeconds(n: number): string {
  // Лёгкая ru-pluralization: 1 секунду, 2-4 секунды, 5+ секунд.
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return 'секунду'
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'секунды'
  return 'секунд'
}

function MetricsCard({ uptime90d, incidentCount }: { uptime90d: string; incidentCount: number }) {
  const rows: Array<[string, string]> = [
    ['Аптайм 90d', uptime90d],
    ['Инцидентов', String(incidentCount)],
  ]
  return (
    <div className="flex-1 rounded-2xl bg-surface-2 p-6">
      <h3 className="font-display text-base font-bold text-text-primary">Метрики 90 дней</h3>
      <div className="mt-4 flex flex-col gap-3">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between border-b border-border pb-2 last:border-0">
            <span className="text-sm text-text-secondary">{k}</span>
            <span className="font-mono text-sm font-semibold text-text-primary">{v}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function SubscribeCard() {
  return (
    <div className="flex-1 rounded-2xl bg-surface-2 p-6">
      <h3 className="font-display text-base font-bold text-text-primary">Подписаться на обновления</h3>
      <p className="mt-1 text-xs text-text-secondary">Письмо при каждом инциденте и его resolve.</p>
      <div className="mt-4 flex gap-2">
        <input
          className="flex-1 rounded-md border border-border bg-surface-1 px-3 py-2 font-mono text-xs text-text-primary placeholder:text-text-muted"
          placeholder="you@example.com"
        />
        <Button variant="primary" size="sm">
          Подписаться
        </Button>
      </div>
    </div>
  )
}

export default function StatusPage() {
  const { data, isPending, error } = useStatusPageQuery()

  if (isPending) {
    return (
      <div className="min-h-screen bg-bg text-text-primary">
        <TopBar />
        <div className="mx-auto flex max-w-3xl flex-col items-center gap-4 px-4 py-16">
          <div className="h-24 w-24 animate-pulse rounded-full bg-surface-2" />
          <div className="h-6 w-64 animate-pulse rounded bg-surface-2" />
          <div className="h-4 w-48 animate-pulse rounded bg-surface-2" />
          <div className="mt-6 h-64 w-full animate-pulse rounded-2xl bg-surface-2" />
        </div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-bg text-text-primary">
        <TopBar />
        <div className="mx-auto flex max-w-3xl flex-col items-center gap-4 px-4 py-16 text-center">
          <AlertCircle className="h-14 w-14 text-danger" />
          <h1 className="font-display text-2xl font-extrabold text-text-primary">Сервис недоступен</h1>
          <p className="text-sm text-text-secondary">Не удалось загрузить страницу статуса. Попробуйте позже.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-bg text-text-primary">
      <TopBar />
      <Hero status={data.overall_status} uptime90d={data.uptime_90d} generatedAt={data.generated_at} />
      <div className="flex flex-col gap-5 px-4 pb-6 sm:px-8 lg:px-20 lg:pb-7">
        <ServicesList services={data.services} />
        <IncidentsCard incidents={data.incidents} />
        <div className="flex flex-col gap-4 lg:flex-row lg:gap-5">
          <SubscribeCard />
          <MetricsCard uptime90d={data.uptime_90d} incidentCount={data.incidents.length} />
        </div>
      </div>
    </div>
  )
}
