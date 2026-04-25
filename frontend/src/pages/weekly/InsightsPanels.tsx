import { Brain, Trophy } from 'lucide-react'
import { motion } from 'framer-motion'
import type { AchievementBrief, PercentileView } from '../../lib/queries/profile'
import { relativeFromNow } from './utils'

// ============================================================================
// 5. <PercentileGauge label value /> — SVG semi-circle
// ============================================================================

function PercentileGauge({ label, value }: { label: string; value: number }) {
  const v = Math.max(0, Math.min(100, value))
  // Top X% где X = 100 - percentile (то есть «лучше тебя только X%»).
  const topX = 100 - v
  // Цвет: top 25 → success, top 50 → accent, иначе warn.
  const color = topX <= 25 ? 'rgb(var(--color-success))' : topX <= 50 ? 'rgb(var(--color-accent))' : 'rgb(var(--color-warn))'

  // Arc: полукруг радиуса R, от (-R, 0) до (R, 0), центр в (0, 0).
  // Заливка от 0 до v/100 — рисуем path через большую дугу.
  const R = 70
  const W = 180
  const H = 110
  const cx = W / 2
  const cy = 90

  // Угол в радианах: t∈[0..1] → угол π → 0 (слева направо).
  const angle = Math.PI * (1 - v / 100)
  const x = cx + R * Math.cos(angle)
  const y = cy - R * Math.sin(angle)
  const largeArc = v > 50 ? 1 : 0

  // Background semi-circle (всегда дуга 180°).
  const bgPath = `M ${cx - R} ${cy} A ${R} ${R} 0 0 1 ${cx + R} ${cy}`
  // Foreground path до текущей точки.
  const fgPath = `M ${cx - R} ${cy} A ${R} ${R} 0 ${largeArc} 1 ${x} ${y}`

  return (
    <div className="flex flex-1 flex-col items-center gap-2 rounded-2xl bg-surface-2 p-5">
      <span className="font-mono text-[11px] font-semibold tracking-[0.08em] text-text-muted">
        {label.toUpperCase()}
      </span>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-[200px]">
        <path d={bgPath} stroke="rgb(var(--color-surface-1))" strokeWidth={14} fill="none" strokeLinecap="round" />
        <motion.path
          d={fgPath}
          stroke={color}
          strokeWidth={14}
          fill="none"
          strokeLinecap="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
        />
        <text x={cx} y={cy - 18} textAnchor="middle" className="fill-text-primary font-display text-[22px] font-extrabold">
          {v}%
        </text>
        <text x={cx} y={cy - 2} textAnchor="middle" className="fill-text-muted font-mono text-[10px]">
          percentile
        </text>
      </svg>
      <span className="text-[12px] text-text-secondary">
        Top <span className="font-bold" style={{ color }}>{topX}%</span> {label.toLowerCase()}
      </span>
    </div>
  )
}

export function PercentileRow({ percentiles }: { percentiles: PercentileView }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-display text-lg font-bold text-text-primary">Где ты на лестнице</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <PercentileGauge label="Tier" value={percentiles.in_tier} />
        <PercentileGauge label="Friends" value={percentiles.in_friends} />
        <PercentileGauge label="Globally" value={percentiles.in_global} />
      </div>
    </section>
  )
}

// ============================================================================
// 6. AI Insight
// ============================================================================

export function AiInsight({ text }: { text: string }) {
  // Anti-fallback policy (Phase B): empty insight = backend deliberately
  // returned "" (OPENROUTER_API_KEY missing OR upstream errored). НИКОГДА
  // не рендерим placeholder — секция должна полностью исчезать.
  if (!text.trim()) return null
  // Делим на 2 параграфа: либо по двойному \n\n, либо пополам по точке.
  const paragraphs = text.includes('\n\n')
    ? text.split('\n\n').slice(0, 2)
    : [text]
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-border-strong bg-surface-2 p-5 sm:p-7">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <Brain className="h-5 w-5 text-text-secondary" />
          <h3 className="font-display text-lg font-bold text-text-primary">AI insight недели</h3>
        </div>
        <p className="font-mono text-[10px] uppercase tracking-wide text-text-muted">
          Сгенерировано Claude Sonnet 4
        </p>
      </div>
      {paragraphs.map((p, i) => (
        <p key={i} className="text-sm leading-relaxed text-text-secondary">
          {p.trim()}
        </p>
      ))}
    </section>
  )
}

// ============================================================================
// 7. <AchievementCard a={achievement} /> + grid
// ============================================================================

const TIER_STYLES: Record<string, string> = {
  bronze: 'bg-warn/15 text-warn border-warn/30',
  silver: 'bg-text-muted/15 text-text-secondary border-text-muted/30',
  gold: 'bg-warn/20 text-warn border-warn/50',
  platinum: 'bg-text-primary/10 text-text-secondary border-border-strong',
  diamond: 'bg-text-primary/10 text-text-secondary border-border-strong',
}

function AchievementCard({ a }: { a: AchievementBrief }) {
  const tierCls = TIER_STYLES[a.tier] ?? 'bg-surface-1 text-text-muted border-border'
  return (
    <div className="flex flex-col gap-2 rounded-xl bg-surface-2 p-4 ring-1 ring-border">
      <div className="flex items-center gap-2">
        <Trophy className="h-4 w-4 text-warn" />
        <span className={`rounded-full border px-2 py-0.5 font-mono text-[10px] font-bold uppercase ${tierCls}`}>
          {a.tier || '—'}
        </span>
      </div>
      <span className="text-sm font-semibold text-text-primary">{a.title}</span>
      <span className="text-[11px] text-text-muted">{relativeFromNow(a.unlocked_at)}</span>
    </div>
  )
}

export function AchievementsGrid({ items }: { items: AchievementBrief[] }) {
  return (
    <section className="flex flex-col gap-4 rounded-2xl bg-surface-2 p-5 sm:p-7">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg font-bold text-text-primary">Разблокировано на этой неделе</h2>
        <span className="font-mono text-[11px] text-text-muted">{items.length}</span>
      </div>
      {items.length === 0 ? (
        <div className="grid place-items-center rounded-xl bg-surface-1 py-10 text-center">
          <span className="text-sm text-text-muted">Ничего нового — играй активнее.</span>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {items.map((a) => (
            <AchievementCard key={a.code} a={a} />
          ))}
        </div>
      )}
    </section>
  )
}
