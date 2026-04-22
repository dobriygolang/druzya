import { ArrowLeft, ArrowRight, Share2, Play, Trophy, Sparkles } from 'lucide-react'
import { useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { AppShellV2 } from '../components/AppShell'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { Avatar } from '../components/Avatar'
import { useMatchEndQuery } from '../lib/queries/matches'

function ErrorChip() {
  const { t } = useTranslation('pages')
  return (
    <span className="rounded-full bg-danger/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-danger">
      {t('common.load_failed')}
    </span>
  )
}

function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <Card className="flex-1 flex-col gap-2 p-5">
      <span className="font-mono text-[11px] font-semibold tracking-[0.08em] text-text-muted">{label}</span>
      <span className={`font-display text-3xl font-extrabold ${color}`}>{value}</span>
    </Card>
  )
}

export default function MatchEndPage() {
  const { t } = useTranslation('pages')
  const { matchId } = useParams<{ matchId: string }>()
  const { data, isError } = useMatchEndQuery(matchId)
  const stats = data?.stats ?? { time: '4:21', tests: '15/15', complexity: 'O(n)', lines: '10' }
  const xp = data?.xp ?? { total: 240, breakdown: [{ l: 'Победа в матче', v: '+120' }, { l: 'Под 5 минут', v: '+80' }, { l: 'Все тесты с 1 раза', v: '+40' }], level: 24, progress: 6800, next_level_xp: 10000, progress_pct: 68 }
  const lpDelta = data?.lp_delta ?? 18
  const lpTotal = data?.lp_total ?? 2858
  const tier = data?.tier ?? 'Diamond III'
  const nextTier = data?.next_tier ?? 'Diamond II · 482 LP'
  return (
    <AppShellV2>
      <div className="flex h-16 items-center justify-between gap-3 border-b border-border bg-surface-1 px-4 sm:px-8">
        <button className="flex items-center gap-2 text-sm text-text-secondary hover:text-text-primary">
          <ArrowLeft className="h-4 w-4" /> {t('match_end.back')}
        </button>
        <span className="font-mono text-[12px] font-semibold tracking-[0.12em] text-text-secondary">
          {t('match_end.header')}
        </span>
        <div className="flex items-center gap-4">
          {isError && <ErrorChip />}
          <button className="text-text-secondary hover:text-text-primary"><Share2 className="h-4 w-4" /></button>
          <span className="font-mono text-xs text-text-muted">{t('match_end.match')} #{matchId ?? '4821'}</span>
        </div>
      </div>

      <div className="relative h-auto overflow-hidden rotate-180 lg:h-[280px]" style={{ background: 'linear-gradient(180deg, rgba(16,185,129,1) 0%, rgba(16,185,129,0.4) 100%)' }}>
        <div className="absolute inset-0 -rotate-180 px-4 py-6 sm:px-8 lg:px-20 lg:py-10 flex flex-col items-start justify-between gap-6 lg:flex-row lg:items-center lg:gap-0">
          <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:gap-6">
            <div className="flex flex-col items-center gap-2 rounded-lg bg-success/40 px-4 py-6 backdrop-blur">
              <Trophy className="h-6 w-6 text-text-primary" />
              <span className="font-mono text-[11px] font-bold tracking-[0.12em] text-text-primary">{t('match_end.win')}</span>
              <span className="font-display text-lg font-bold text-text-primary">+{lpDelta} LP</span>
            </div>
            <div className="flex flex-col gap-2">
              <h1 className="font-display text-3xl sm:text-4xl lg:text-[56px] font-extrabold leading-[1] text-text-primary">
                {data?.verdict ?? t('match_end.verdict_default')}
              </h1>
              <p className="text-sm text-white/80">
                {data?.task ?? t('match_end.task_default')} · {data?.sub ?? t('match_end.sub_default')}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-6 rounded-2xl bg-black/25 p-6 backdrop-blur">
            <Avatar size="xl" gradient="violet-cyan" initials="Д" />
            <span className="font-display text-[38px] font-extrabold text-text-primary">WIN</span>
            <div className="opacity-60">
              <Avatar size="xl" gradient="pink-red" initials="K" />
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-6 px-4 py-8 sm:px-8 lg:px-8" style={{ paddingTop: 80 }}>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard label={t('match_end.stats_time')} value={stats.time} color="text-cyan" />
          <StatCard label={t('match_end.stats_tests')} value={stats.tests} color="text-success" />
          <StatCard label={t('match_end.stats_complexity')} value={stats.complexity} color="text-accent-hover" />
          <StatCard label={t('match_end.stats_lines')} value={stats.lines} color="text-warn" />
        </div>

        <div className="flex flex-col gap-4 lg:flex-row">
          <Card className="flex-1 flex-col gap-4 p-6 bg-gradient-to-br from-accent to-pink border-accent/40 shadow-glow">
            <div className="flex items-center justify-between">
              <span className="font-display text-2xl font-extrabold text-text-primary">+ {xp.total} XP</span>
              <Sparkles className="h-5 w-5 text-text-primary" />
            </div>
            {xp.breakdown.map((r) => (
              <div key={r.l} className="flex items-center justify-between text-sm">
                <span className="text-white/80">{r.l}</span>
                <span className="font-mono font-semibold text-text-primary">{r.v}</span>
              </div>
            ))}
            <div className="h-2 overflow-hidden rounded-full bg-black/30">
              <div className="h-full rounded-full bg-text-primary" style={{ width: `${xp.progress_pct}%` }} />
            </div>
            <div className="flex justify-between text-[11px] text-white/70">
              <span>Lvl {xp.level} · {xp.progress.toLocaleString('ru-RU')} / {xp.next_level_xp.toLocaleString('ru-RU')}</span>
              <span>Lvl {xp.level + 1}</span>
            </div>
          </Card>

          <Card className="flex-1 flex-col gap-4 p-6">
            <div className="flex items-center justify-between">
              <span className="font-display text-2xl font-extrabold text-text-primary">{lpTotal.toLocaleString('ru-RU')} LP</span>
              <span className="font-mono font-bold text-success">+{lpDelta}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-black/30">
              <div className="h-full w-[78%] rounded-full bg-gradient-to-r from-cyan to-accent" />
            </div>
            <div className="flex justify-between text-[11px] text-text-muted">
              <span>{tier}</span>
              <span>{nextTier}</span>
            </div>
            <div className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2">
              <span className="font-mono text-[11px] font-bold text-warn">{data?.streak_bonus ?? '5-WIN STREAK · +100 XP'}</span>
            </div>
          </Card>
        </div>

        <Card className="h-auto bg-surface-2 p-0 lg:h-[240px]">
          <div className="grid grid-cols-1 divide-y divide-border lg:grid-cols-2 lg:divide-x lg:divide-y-0 h-full">
            <div className="flex flex-col gap-2 p-5">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[11px] font-semibold text-success">{data?.your_label ?? '@you · O(n)'}</span>
                <span className="font-mono text-[10px] text-text-muted">{data?.your_meta ?? '10 lines'}</span>
              </div>
              <pre className="flex-1 overflow-hidden rounded-md bg-bg p-3 font-mono text-[11px] leading-relaxed text-text-secondary">
{data?.your_code ?? `func median(a, b []int) float64 {
  i, j := 0, 0
  m := make([]int, 0, len(a)+len(b))
  for i < len(a) && j < len(b) {
    if a[i] < b[j] { m = append(m,a[i]); i++
    } else { m = append(m,b[j]); j++ }
  }
  ...
}`}
              </pre>
            </div>
            <div className="flex flex-col gap-2 p-5">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[11px] font-semibold text-danger">{data?.their_label ?? '@kirill_dev · O(n²)'}</span>
                <span className="font-mono text-[10px] text-text-muted">{data?.their_meta ?? '28 lines · TLE'}</span>
              </div>
              <pre className="flex-1 overflow-hidden rounded-md bg-bg p-3 font-mono text-[11px] leading-relaxed text-text-secondary">
{data?.their_code ?? `func median(a, b []int) float64 {
  all := append([]int{}, a...)
  for _, x := range b { all = append(all, x) }
  for i := range all {
    for j := i+1; j < len(all); j++ {
      if all[i] > all[j] { all[i],all[j]=all[j],all[i] }
    }
  }
  ...
}`}
              </pre>
            </div>
          </div>
        </Card>

        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" icon={<Swords className="h-4 w-4" />}>{t('match_end.rematch')}</Button>
          <Button variant="ghost" icon={<Play className="h-4 w-4" />}>{t('match_end.replay')}</Button>
          <Button variant="ghost" icon={<Share2 className="h-4 w-4" />}>{t('match_end.share')}</Button>
          <button className="ml-auto text-sm font-semibold text-accent-hover hover:text-accent">
            {t('match_end.next_match')} <ArrowRight className="inline h-4 w-4" />
          </button>
        </div>
      </div>
    </AppShellV2>
  )
}

function Swords(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={props.className}>
      <path d="M14.5 17.5 3 6V3h3l11.5 11.5" /><path d="M13 19l6-6" /><path d="M16 16l4 4" /><path d="M19 21l2-2" /><path d="M9.5 17.5 21 6V3h-3L6.5 14.5" />
    </svg>
  )
}
