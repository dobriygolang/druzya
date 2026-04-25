import { ArrowLeft, ArrowRight, Share2, Play, Trophy, Sparkles } from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { AppShellV2 } from '../components/AppShell'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { Avatar } from '../components/Avatar'
import { useMatchEndQuery } from '../lib/queries/matches'
import { useProfileQuery } from '../lib/queries/profile'
import { EmptyState } from '../components/EmptyState'
// Wave-10 (design-review v4) — emotion-peak variants. We dispatch by
// verdict (loss / win+promote / win+normal) AND only when data has
// landed. Loading → EmptyState skeleton. Error → EmptyState with retry.
// The legacy inline render below stays as a guarded fallback for
// `?legacy=1` (debugging) but the dispatch below is the new default.
import { WinPromote, WinNormal, LossScreen, detectPromotion } from './match-end/MatchEndScreens'

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
  const navigate = useNavigate()
  const { matchId } = useParams<{ matchId: string }>()
  const { data: profile } = useProfileQuery()
  const { data, isError, isLoading, refetch } = useMatchEndQuery(matchId, profile?.id)

  // Wave-10 dispatch — three emotion-peak variants. Loading + error use
  // the canonical <EmptyState />. Use `?legacy=1` to fall through to the
  // legacy inline renderer below for debugging.
  const useLegacy = typeof window !== 'undefined' && window.location.search.includes('legacy=1')
  if (!useLegacy) {
    if (isLoading) {
      return (
        <AppShellV2>
          <EmptyState variant="loading" skeletonLayout="single-card" />
        </AppShellV2>
      )
    }
    if (isError || !data) {
      return (
        <AppShellV2>
          <EmptyState
            variant="error"
            title="Не удалось загрузить итог матча"
            cta={{ label: 'Повторить', onClick: () => refetch() }}
            secondaryCta={{ label: 'В арену', onClick: () => navigate('/arena') }}
          />
        </AppShellV2>
      )
    }
    if (data.result === 'L') {
      return <LossScreen data={data} profile={profile} />
    }
    if (detectPromotion(data)) {
      return <WinPromote data={data} profile={profile} />
    }
    return <WinNormal data={data} profile={profile} />
  }
  // ── legacy renderer (kept for ?legacy=1) ────────────────────────────

  // Loading skeleton — без хардкода. Пока ждём бэк, показываем нули и
  // плейсхолдеры. Бэк отдаёт enriched-поля только для finished-матчей; для
  // active/searching фронт получит нули и юзер увидит "—".
  const stats = data?.stats ?? { time: '—', tests: '—', complexity: '—', lines: '—' }
  const xp = data?.xp ?? { total: 0, breakdown: [], level: 0, progress: 0, next_level_xp: 0, progress_pct: 0 }
  const lpDelta = data?.lp_delta ?? 0
  const lpTotal = data?.lp_total ?? 0
  const tier = data?.tier ?? '—'
  const nextTier = data?.next_tier ?? ''
  const isWin = data?.result === 'W'
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
          <span className="font-mono text-xs text-text-muted">{t('match_end.match')} #{matchId ?? '—'}</span>
        </div>
      </div>

      <div
        className="relative h-auto overflow-hidden rotate-180 lg:h-[280px]"
        style={{
          background: isWin
            ? 'linear-gradient(180deg, rgba(16,185,129,1) 0%, rgba(16,185,129,0.4) 100%)'
            : 'linear-gradient(180deg, rgba(239,68,68,1) 0%, rgba(239,68,68,0.4) 100%)',
        }}
      >
        <div className="absolute inset-0 -rotate-180 px-4 py-6 sm:px-8 lg:px-20 lg:py-10 flex flex-col items-start justify-between gap-6 lg:flex-row lg:items-center lg:gap-0">
          <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:gap-6">
            <div className={`flex flex-col items-center gap-2 rounded-lg ${isWin ? 'bg-success/40' : 'bg-danger/40'} px-4 py-6 backdrop-blur`}>
              <Trophy className="h-6 w-6 text-text-primary" />
              <span className="font-mono text-[11px] font-bold tracking-[0.12em] text-text-primary">{t('match_end.win')}</span>
              <span className="font-display text-lg font-bold text-text-primary">{lpDelta >= 0 ? '+' : ''}{lpDelta} LP</span>
            </div>
            <div className="flex flex-col gap-2">
              <h1 className="font-display text-3xl sm:text-4xl lg:text-[56px] font-extrabold leading-[1] text-text-primary">
                {isLoading ? '…' : (data?.verdict ?? '')}
              </h1>
              <p className="text-sm text-white/80">
                {data?.task ?? ''}{data?.sub ? ` · ${data.sub}` : ''}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-6 rounded-2xl bg-black/25 p-6 backdrop-blur">
            <Avatar size="xl" gradient="violet-cyan" initials={(profile?.display_name ?? 'Д').charAt(0).toUpperCase()} />
            <span className="font-display text-[38px] font-extrabold text-text-primary">{isWin ? 'WIN' : 'LOSS'}</span>
            <div className="opacity-60">
              <Avatar size="xl" gradient="pink-red" initials="?" />
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-6 px-4 py-8 sm:px-8 lg:px-8" style={{ paddingTop: 80 }}>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard label={t('match_end.stats_time')} value={stats.time} color="text-text-secondary" />
          <StatCard label={t('match_end.stats_tests')} value={stats.tests} color="text-success" />
          <StatCard label={t('match_end.stats_complexity')} value={stats.complexity} color="text-text-primary" />
          <StatCard label={t('match_end.stats_lines')} value={stats.lines} color="text-warn" />
        </div>

        <div className="flex flex-col gap-4 lg:flex-row">
          <Card className="flex-1 flex-col gap-4 p-6 bg-surface-2 border border-border-strong border-border-strong">
            <div className="flex items-center justify-between">
              <span className="font-display text-2xl font-extrabold text-text-primary">+ {xp.total} XP</span>
              <Sparkles className="h-5 w-5 text-text-primary" />
            </div>
            {xp.breakdown.length === 0 && !isLoading && (
              <span className="text-sm text-white/60">{t('match_end.no_xp_breakdown', 'XP начислится после завершения матча')}</span>
            )}
            {xp.breakdown.map((r) => (
              <div key={r.l} className="flex items-center justify-between text-sm">
                <span className="text-white/80">{r.l}</span>
                <span className="font-mono font-semibold text-text-primary">{r.v}</span>
              </div>
            ))}
            {profile && (
              <>
                <div className="h-2 overflow-hidden rounded-full bg-black/30">
                  <div
                    className="h-full rounded-full bg-text-primary"
                    style={{
                      width:
                        profile.xp_to_next > 0
                          ? `${Math.min(100, Math.round((profile.xp / profile.xp_to_next) * 100))}%`
                          : '0%',
                    }}
                  />
                </div>
                <div className="flex justify-between text-[11px] text-white/70">
                  <span>
                    Lvl {profile.level} · {profile.xp.toLocaleString('ru-RU')} / {profile.xp_to_next.toLocaleString('ru-RU')}
                  </span>
                  <span>Lvl {profile.level + 1}</span>
                </div>
              </>
            )}
          </Card>

          <Card className="flex-1 flex-col gap-4 p-6">
            <div className="flex items-center justify-between">
              <span className="font-display text-2xl font-extrabold text-text-primary">{lpTotal.toLocaleString('ru-RU')} LP</span>
              <span className={`font-mono font-bold ${lpDelta >= 0 ? 'text-success' : 'text-danger'}`}>
                {lpDelta >= 0 ? '+' : ''}{lpDelta}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-black/30">
              <div className="h-full rounded-full bg-text-primary" style={{ width: `${Math.min(100, Math.max(0, lpTotal % 100))}%` }} />
            </div>
            <div className="flex justify-between text-[11px] text-text-muted">
              <span>{tier}</span>
              <span>{nextTier}</span>
            </div>
            {data?.streak_bonus && (
              <div className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2">
                <span className="font-mono text-[11px] font-bold text-warn">{data.streak_bonus}</span>
              </div>
            )}
          </Card>
        </div>

        {/* Code-comparison panel deferred — submission code is not yet
            persisted per arena_match. Once arena_submissions ships, render
            data.your_code / data.their_code here. Skipping the placeholder
            block keeps /match-end production-clean. */}

        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="primary"
            icon={<Swords className="h-4 w-4" />}
            onClick={() => navigate('/arena')}
          >
            {t('match_end.rematch')}
          </Button>
          <Button
            variant="ghost"
            icon={<Play className="h-4 w-4" />}
            onClick={() => matchId && navigate(`/arena/match/${matchId}?replay=1`)}
          >
            {t('match_end.replay')}
          </Button>
          <Button variant="ghost" icon={<Share2 className="h-4 w-4" />}>{t('match_end.share')}</Button>
          <button
            className="ml-auto text-sm font-semibold text-text-primary hover:text-text-primary"
            onClick={() => navigate('/arena')}
          >
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
