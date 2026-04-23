// TODO i18n
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Mic, MicOff, Flag, Send, RotateCcw } from 'lucide-react'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { Avatar } from '../components/Avatar'
import { WSStatus } from '../components/ws/WSStatus'
import { useChannel } from '../lib/ws'

type LogEvent = { c: string; t: string; time: string }

function CrisisBanner({ incident }: { incident: { title: string; severity: string; remainingSec: number; sinceSec: number } | null }) {
  const fmt = (s: number) => {
    if (s <= 0) return '—'
    const m = Math.floor(s / 60)
    const sec = s % 60
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
  }
  return (
    <div
      className="flex h-auto flex-col gap-3 px-4 py-3 sm:px-6 lg:h-20 lg:flex-row lg:items-center lg:justify-between lg:px-8 lg:py-0"
      style={{ background: 'linear-gradient(90deg, #2A0510 0%, rgba(239,68,68,0.95) 100%)' }}
    >
      <div className="flex items-center gap-3">
        <span className="h-3 w-3 animate-pulse rounded-full bg-danger" />
        <div className="flex flex-col">
          <span className="font-display text-base font-bold text-text-primary">
            {incident?.title ?? '🚨 Инцидент'}
          </span>
          <span className="font-mono text-[11px] text-white/80">
            {incident ? `${incident.severity} · ${Math.floor(incident.sinceSec / 60)}m since incident` : '—'}
          </span>
        </div>
      </div>
      <div className="font-display text-3xl font-extrabold text-text-primary">
        {incident ? `ОСТАЛОСЬ ${fmt(incident.remainingSec)}` : '—'}
      </div>
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" icon={<Mic className="h-3.5 w-3.5" />}>
          Voice room
        </Button>
        <Button variant="danger" size="sm" icon={<Flag className="h-3.5 w-3.5" />}>
          Сдаться
        </Button>
      </div>
    </div>
  )
}

function IncidentDescription({ incident }: { incident: { headline: string; description: string } | null }) {
  return (
    <div className="flex flex-col gap-1 border-b border-border bg-surface-1 px-4 py-4 sm:px-6 lg:px-8">
      <h2 className="font-display text-base font-bold text-text-primary">
        {incident?.headline ?? 'Загрузка инцидента…'}
      </h2>
      <p className="text-xs text-text-secondary">
        {incident?.description ?? 'Нет данных'}
      </p>
    </div>
  )
}

type Member = {
  name: string
  role: string
  task: string
  progress: number
  status: string
  active?: boolean
  initials: string
  gradient: 'violet-cyan' | 'pink-violet' | 'success-cyan' | 'cyan-violet'
}

// TODO(api): GET /api/v1/warroom/{incidentId}/team — состав команды + live статусы.
// До появления эндпоинта список пуст; member_status WS-events и так дополняют его.
const members: Member[] = []

function MemberCard({ m }: { m: Member }) {
  return (
    <div
      className={`flex flex-col gap-3 rounded-[12px] border bg-surface-2 p-3.5 ${
        m.active ? 'border-accent' : 'border-border'
      }`}
    >
      <div className="flex items-center gap-2.5">
        <Avatar size="sm" gradient={m.gradient} initials={m.initials} status="online" />
        <span className="flex-1 text-[13px] font-semibold text-text-primary">{m.name}</span>
        <span className="h-2 w-2 animate-pulse rounded-full bg-success" />
      </div>
      <span className="w-fit rounded-full bg-accent/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-accent-hover">
        {m.role}
      </span>
      <p className="text-[11px] text-text-secondary">{m.task}</p>
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
        <div className="h-full rounded-full bg-cyan" style={{ width: `${m.progress}%` }} />
      </div>
      <span className="font-mono text-[10px] text-text-muted">{m.status}</span>
    </div>
  )
}

function LeftTeam({ liveMembers }: { liveMembers: Member[] }) {
  return (
    <div className="flex w-full flex-col gap-4 border-b border-border bg-surface-1 p-4 lg:w-[320px] lg:border-b-0 lg:border-r">
      <h3 className="font-mono text-[11px] font-semibold tracking-[0.08em] text-text-muted">
        ВАША КОМАНДА ({liveMembers.length})
      </h3>
      {liveMembers.length === 0 ? (
        <span className="px-1 py-3 text-center font-mono text-[11px] text-text-muted">Нет данных</span>
      ) : (
        liveMembers.map((m) => <MemberCard key={m.name} m={m} />)
      )}
    </div>
  )
}

const codeLines = [
  'func CheckoutHandler(w http.ResponseWriter, r *http.Request) {',
  '    userID := getUser(r)',
  '    cart, err := db.LoadCart(userID)',
  '    if err != nil { http.Error(w, err.Error(), 500); return }',
  '',
  '    items := []Item{}',
  '    for _, id := range cart.ItemIDs {',
  '        item, err := db.GetItem(id) // ← N+1',
  '        if err != nil { continue }',
  '        price, _ := db.GetPrice(item.SKU) // ← N+1',
  '        tax, _ := db.GetTax(item.SKU) // ← N+1',
  '        promo, _ := db.GetPromo(item.SKU, userID) // ← N+1',
  '        items = append(items, item.WithPrice(price, tax, promo))',
  '    }',
  '',
  '    total := computeTotal(items)',
  '    json.NewEncoder(w).Encode(map[string]any{"items": items, "total": total})',
  '}',
]

function CenterWorkspace({ score }: { score: { errorRate: number; label: string } }) {
  // TODO(api): открытые «доски» война (code/sql/whiteboard/metrics) должны
  // приходить из WS — у каждой свой owner. Пока — статический набор без ников.
  const tabs = [
    { name: 'Code', active: true },
    { name: 'SQL' },
    { name: 'Whiteboard', dot: true },
    { name: 'Metrics' },
  ]
  return (
    <div className="flex flex-1 flex-col">
      <div className="flex h-10 items-center gap-1 border-b border-border bg-surface-1 px-4">
        {tabs.map((t, i) => (
          <button
            key={i}
            className={`flex items-center gap-2 rounded-md px-3 py-1.5 font-mono text-[11px] ${
              t.active ? 'bg-surface-2 text-text-primary' : 'text-text-secondary hover:bg-surface-2'
            }`}
          >
            {t.name}
            {t.dot && <span className="h-1.5 w-1.5 rounded-full bg-danger" />}
          </button>
        ))}
      </div>
      <div className="flex flex-1 overflow-auto">
        <div className="flex w-12 flex-col border-r border-border bg-surface-2 py-3 text-right">
          {codeLines.map((_, i) => (
            <span key={i} className="px-3 font-mono text-[11px] text-text-muted">
              {i + 1}
            </span>
          ))}
        </div>
        <div className="flex flex-1 flex-col py-3">
          {codeLines.map((line, i) => {
            const hl = i >= 7 && i <= 11
            return (
              <code
                key={i}
                className={`whitespace-pre px-4 font-mono text-[12px] ${
                  hl ? 'bg-danger/10 text-text-primary' : 'text-text-secondary'
                }`}
              >
                {line || ' '}
              </code>
            )
          })}
        </div>
      </div>
      <div className="flex h-14 items-center justify-between border-t border-border bg-surface-1 px-4">
        <div className="flex gap-2">
          <Button variant="danger" size="sm" icon={<Send className="h-3.5 w-3.5" />}>
            Hotfix Push
          </Button>
          <Button variant="ghost" size="sm" icon={<RotateCcw className="h-3.5 w-3.5" />}>
            Rollback
          </Button>
        </div>
        <span className="rounded-full bg-warn/15 px-3 py-1 font-mono text-xs font-semibold text-warn">
          {score.label}: 80% → {score.errorRate}%
        </span>
      </div>
    </div>
  )
}

function RightComms({ logs }: { logs: LogEvent[] }) {
  return (
    <div className="flex w-full flex-col gap-4 border-t border-border bg-surface-1 p-4 lg:w-[320px] lg:border-l lg:border-t-0">
      <div className="rounded-xl border border-border bg-gradient-to-br from-accent/30 to-danger/30 p-4">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[11px] font-semibold text-text-primary">VOICE</span>
          <button className="grid h-7 w-7 place-items-center rounded-full bg-white/10 text-text-primary">
            <MicOff className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="mt-3 flex -space-x-1.5">
          {(['violet-cyan', 'pink-violet', 'cyan-violet', 'success-cyan'] as const).map((g, i) => (
            <Avatar key={i} size="sm" gradient={g} initials={['Я', 'Н', 'К', 'М'][i]} />
          ))}
        </div>
      </div>
      <Card className="flex-col gap-2 p-4" interactive={false}>
        <h3 className="font-mono text-[11px] font-semibold tracking-[0.08em] text-text-muted">
          ЛОГ ИНЦИДЕНТА
        </h3>
        {logs.length === 0 && (
          <span className="px-1 py-2 font-mono text-[11px] text-text-muted">Нет событий</span>
        )}
        {logs.slice(-12).map((l, i) => (
          <div key={i} className="flex items-start gap-2 border-b border-border pb-1.5 last:border-0">
            <span className={`mt-1 h-1.5 w-1.5 rounded-full ${l.c}`} />
            <span className="flex-1 font-mono text-[10px] text-text-secondary">{l.t}</span>
            <span className="font-mono text-[10px] text-text-muted">{l.time}</span>
          </div>
        ))}
      </Card>
      <Card className="flex-col gap-2 border-warn/40 p-4" interactive={false}>
        <h3 className="font-display text-sm font-bold text-warn">Награда за победу</h3>
        <div className="flex justify-between text-xs">
          <span className="text-text-secondary">Гильдия</span>
          <span className="font-mono text-warn">+1500 SP</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-text-secondary">Ты</span>
          <span className="font-mono text-warn">+800 XP</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-text-secondary">Бейдж</span>
          <span className="font-mono text-warn">«Firefighter»</span>
        </div>
      </Card>
    </div>
  )
}

// Лог пуст до прихода WS-events log_event. Anti-fallback: никаких выдуманных строк.
const INITIAL_LOGS: LogEvent[] = []

export default function WarRoomPage() {
  const { incidentId } = useParams<{ incidentId: string }>()
  const channel = `warroom/${incidentId ?? 'current'}`
  const { lastEvent, data, status } = useChannel<Record<string, unknown>>(channel)

  const [logs, setLogs] = useState<LogEvent[]>(INITIAL_LOGS)
  const [liveMembers, setLiveMembers] = useState<Member[]>(members)
  const [score, setScore] = useState({ errorRate: 12, label: 'API errors' })

  useEffect(() => {
    if (!lastEvent || !data) return
    if (lastEvent === 'log_event') {
      const e = data as { color?: string; text?: string; time?: string }
      setLogs((prev) =>
        [...prev, { c: e.color ?? 'bg-cyan', t: e.text ?? '', time: e.time ?? 'now' }].slice(-50),
      )
    } else if (lastEvent === 'member_status') {
      const u = data as { name: string; progress: number; status: string }
      setLiveMembers((prev) =>
        prev.map((m) => (m.name === u.name ? { ...m, progress: u.progress, status: u.status } : m)),
      )
    } else if (lastEvent === 'score_update') {
      const u = data as { errorRate: number; label?: string }
      setScore({ errorRate: u.errorRate, label: u.label ?? 'API errors' })
    }
  }, [lastEvent, data])

  return (
    <div className="relative min-h-screen bg-bg text-text-primary">
      <div className="absolute right-4 top-4 z-20">
        <WSStatus status={status} />
      </div>
      {/* TODO(api): GET /api/v1/warroom/{incidentId} → headline/description/severity/timer */}
      <CrisisBanner incident={null} />
      <IncidentDescription incident={null} />
      <div className="flex flex-col lg:h-[calc(100vh-80px-92px)] lg:flex-row">
        <LeftTeam liveMembers={liveMembers} />
        <CenterWorkspace score={score} />
        <RightComms logs={logs} />
      </div>
    </div>
  )
}
