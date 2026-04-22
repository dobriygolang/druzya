// TODO i18n
import { Link } from 'react-router-dom'
import { Check, ArrowLeft } from 'lucide-react'
import { Button } from '../components/Button'

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

function Hero() {
  return (
    <div className="flex flex-col items-center justify-center gap-3.5 px-4 py-8 sm:px-8 lg:px-20 lg:py-10">
      <div className="grid h-24 w-24 place-items-center rounded-full bg-success/20" style={{ boxShadow: 'inset 0 0 0 3px #10B981' }}>
        <Check className="h-14 w-14 text-success" strokeWidth={3} />
      </div>
      <h1 className="font-display text-2xl lg:text-[32px] font-extrabold text-success text-center">Все системы работают</h1>
      <p className="text-sm text-text-secondary">
        Аптайм 99.97% за последние 90 дней · обновлено 23 секунды назад
      </p>
    </div>
  )
}

type Service = { name: string; sub: string; uptime: string; status: 'ok' | 'warn'; bars: Array<'ok' | 'warn'> }

const services: Service[] = [
  { name: 'Web App', sub: 'app.druz9.io', uptime: '100%', status: 'ok', bars: Array.from({ length: 30 }).map(() => 'ok') },
  { name: 'REST API', sub: 'api.druz9.io', uptime: '99.99%', status: 'ok', bars: Array.from({ length: 30 }).map((_, i) => (i === 22 ? 'warn' : 'ok')) },
  { name: 'WebSocket', sub: 'ws.druz9.io', uptime: '99.95%', status: 'ok', bars: Array.from({ length: 30 }).map((_, i) => (i === 8 || i === 18 ? 'warn' : 'ok')) },
  { name: 'PostgreSQL', sub: 'primary db', uptime: '100%', status: 'ok', bars: Array.from({ length: 30 }).map(() => 'ok') },
  { name: 'Redis', sub: 'cache cluster', uptime: '100%', status: 'ok', bars: Array.from({ length: 30 }).map(() => 'ok') },
  { name: 'MinIO', sub: 'object storage', uptime: '99.99%', status: 'ok', bars: Array.from({ length: 30 }).map((_, i) => (i === 14 ? 'warn' : 'ok')) },
  { name: 'Judge0', sub: 'code execution · degraded', uptime: '99.4%', status: 'warn', bars: Array.from({ length: 30 }).map((_, i) => ([5, 6, 7, 19, 25].includes(i) ? 'warn' : 'ok')) },
  { name: 'OpenRouter', sub: 'LLM gateway', uptime: '99.8%', status: 'ok', bars: Array.from({ length: 30 }).map((_, i) => ([11, 24].includes(i) ? 'warn' : 'ok')) },
]

function ServicesList() {
  return (
    <div className="overflow-hidden rounded-2xl bg-surface-2">
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <h3 className="font-display text-base font-bold text-text-primary">Сервисы</h3>
        <span className="rounded-full bg-surface-3 px-2.5 py-0.5 font-mono text-[10px] text-text-muted">
          Refresh in 30s
        </span>
      </div>
      {services.map((s) => (
        <div key={s.name} className="flex flex-col gap-3 border-b border-border/50 px-4 py-3.5 last:border-0 sm:flex-row sm:items-center sm:gap-4 sm:px-6">
          <span className={`h-2.5 w-2.5 rounded-full ${s.status === 'ok' ? 'bg-success' : 'bg-warn'}`} />
          <div className="flex w-44 flex-col">
            <span className="text-sm font-semibold text-text-primary">{s.name}</span>
            <span className="font-mono text-[10px] text-text-muted">{s.sub}</span>
          </div>
          <div className="flex h-6 flex-1 items-center gap-[1px]">
            {s.bars.map((b, i) => (
              <span
                key={i}
                className={`h-6 w-[3px] rounded-sm ${b === 'ok' ? 'bg-success' : 'bg-warn'}`}
              />
            ))}
          </div>
          <div className="flex w-28 flex-col items-end">
            <span className={`font-mono text-sm font-semibold ${s.status === 'ok' ? 'text-success' : 'text-warn'}`}>
              {s.uptime}
            </span>
            <span className="font-mono text-[10px] text-text-muted">uptime 90d</span>
          </div>
        </div>
      ))}
    </div>
  )
}

const incidents = [
  {
    title: 'Judge0 — повышенная задержка выполнения кода',
    body: 'Очередь джобов росла из-за проблем с одним worker-узлом. Узел перезапущен, очередь рассосалась.',
    date: '20 апр 2026',
  },
  {
    title: 'OpenRouter — частичные отказы вызовов LLM',
    body: 'Upstream provider давал 5xx около 8 минут. Переключились на резервный route.',
    date: '12 апр 2026',
  },
  {
    title: 'WebSocket — кратковременные дисконнекты',
    body: 'Релиз ingress контроллера вызвал re-handshake. Откат за 2 минуты.',
    date: '5 апр 2026',
  },
]

function IncidentsCard() {
  return (
    <div className="rounded-2xl bg-surface-2 p-6">
      <h3 className="font-display text-base font-bold text-text-primary">Недавние инциденты</h3>
      <div className="mt-4 flex flex-col gap-3">
        {incidents.map((inc) => (
          <div key={inc.title} className="rounded-[10px] bg-surface-1 p-3.5">
            <div className="flex items-center justify-between">
              <span className="rounded-full bg-success/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-success">
                RESOLVED
              </span>
              <span className="font-mono text-[11px] text-text-muted">{inc.date}</span>
            </div>
            <h4 className="mt-2 font-display text-sm font-bold text-text-primary">{inc.title}</h4>
            <p className="mt-1 text-xs text-text-secondary">{inc.body}</p>
            <div className="mt-3 flex items-center gap-2">
              {['Зарегистрирован', 'Investigation', 'Fix', 'Resolved'].map((step, i) => (
                <div key={step} className="flex flex-1 items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-success" />
                  <span className="font-mono text-[10px] text-text-muted">{step}</span>
                  {i < 3 && <span className="h-px flex-1 bg-border" />}
                </div>
              ))}
            </div>
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
        <Button variant="primary" size="sm">Подписаться</Button>
      </div>
    </div>
  )
}

function MetricsCard() {
  const rows = [
    ['Аптайм 90d', '99.97%'],
    ['Инцидентов', '3'],
    ['Latency p95', '142ms'],
    ['MTTR', '11 мин'],
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

export default function StatusPage() {
  return (
    <div className="min-h-screen bg-bg text-text-primary">
      <TopBar />
      <Hero />
      <div className="flex flex-col gap-5 px-4 pb-6 sm:px-8 lg:px-20 lg:pb-7">
        <ServicesList />
        <IncidentsCard />
        <div className="flex flex-col gap-4 lg:flex-row lg:gap-5">
          <SubscribeCard />
          <MetricsCard />
        </div>
      </div>
    </div>
  )
}
