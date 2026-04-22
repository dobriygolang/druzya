import { useParams } from 'react-router-dom'
import { Check, Gem, Trophy } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { AppShellV2 } from '../components/AppShell'
import { Button } from '../components/Button'
import { Avatar } from '../components/Avatar'
import { useTournamentQuery } from '../lib/queries/tournament'

function ErrorChip() {
  const { t } = useTranslation('pages')
  return (
    <span className="rounded-full bg-danger/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-danger">
      {t('common.load_failed')}
    </span>
  )
}

function Hero({ name, tier, format, prizePool, finalsIn }: { name: string; tier: string; format: string; prizePool: number; finalsIn: string }) {
  const { t } = useTranslation('pages')
  return (
    <div
      className="flex h-auto flex-col items-start justify-between gap-4 px-4 py-6 sm:px-8 lg:h-[200px] lg:flex-row lg:items-center lg:gap-0 lg:px-20 lg:py-8"
      style={{
        background: 'linear-gradient(135deg, #2D1B4D 0%, #F472B6 100%)',
      }}
    >
      <div className="flex flex-col gap-2">
        <span className="w-fit rounded-full bg-warn/20 px-3 py-1 font-mono text-[11px] font-semibold tracking-[0.08em] text-warn">
          {tier}
        </span>
        <h1 className="font-display text-3xl sm:text-4xl lg:text-[36px] font-extrabold leading-tight text-text-primary">
          {name}
        </h1>
        <p className="font-mono text-[12px] text-white/80">
          {format}
        </p>
      </div>
      <div className="flex flex-col items-center">
        <span className="font-display text-4xl sm:text-5xl lg:text-[56px] font-extrabold leading-none text-warn">
          {prizePool.toLocaleString('ru-RU')}
        </span>
        <span className="mt-2 flex items-center gap-1 font-mono text-[12px] text-white/85">
          <Gem className="h-3.5 w-3.5" /> {t('tournament.prize_pool')}
        </span>
      </div>
      <div className="flex flex-col items-end gap-3">
        <div className="rounded-xl border border-white/20 bg-black/30 px-4 py-3 text-right">
          <span className="block font-mono text-[10px] tracking-[0.12em] text-white/70">
            {t('tournament.finals_start')}
          </span>
          <span className="font-display text-[22px] font-extrabold text-text-primary">
            {finalsIn}
          </span>
        </div>
        <Button variant="ghost" icon={<Check className="h-4 w-4 text-success" />} className="border-success text-success">
          {t('tournament.registered')}
        </Button>
      </div>
    </div>
  )
}

const ROUND_TABS = ['R16', 'QF', 'SF', 'FINAL']

function FilterStrip() {
  const { t } = useTranslation('pages')
  return (
    <div className="flex h-auto flex-col gap-3 border-b border-border bg-surface-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-8 sm:py-0 lg:h-14 lg:px-20">
      <div className="flex items-center gap-2">
        {ROUND_TABS.map((r, i) => (
          <button
            key={r}
            className={[
              'rounded-full px-3.5 py-1.5 font-mono text-[11px] font-semibold',
              i === 0
                ? 'bg-accent text-text-primary'
                : 'bg-surface-2 text-text-secondary hover:bg-surface-3',
            ].join(' ')}
          >
            {r}
          </button>
        ))}
      </div>
      <span className="font-mono text-[12px] text-text-muted">
        {t('tournament.participants', { n: 16, m: 8 })} ·{' '}
        <a className="text-accent-hover hover:underline" href="#">
          {t('tournament.rules')}
        </a>
      </span>
    </div>
  )
}

type MatchProps = {
  p1: string
  p2: string
  s1?: number
  s2?: number
  live?: boolean
  yours?: boolean
  tbd?: boolean
}

function Match({ p1, p2, s1, s2, live, yours, tbd }: MatchProps) {
  const { t } = useTranslation('pages')
  const borderCls = yours ? 'border-accent' : 'border-border'
  return (
    <div className={`flex flex-col gap-1 rounded-[10px] border bg-surface-1 p-2 ${borderCls}`}>
      {yours && (
        <span className="self-start rounded-full bg-accent px-1.5 py-0 font-mono text-[9px] font-semibold text-text-primary">
          {t('tournament.your_match')}
        </span>
      )}
      <div className="flex items-center gap-2">
        <Avatar size="sm" gradient="violet-cyan" initials={p1.charAt(1).toUpperCase()} />
        <span className="flex-1 font-mono text-[11px] text-text-primary">{p1}</span>
        {!tbd && (
          <span
            className={[
              'rounded px-1.5 py-0 font-mono text-[10px] font-semibold',
              (s1 ?? 0) > (s2 ?? 0) ? 'bg-success/20 text-success' : 'bg-surface-2 text-text-muted',
            ].join(' ')}
          >
            {s1}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Avatar size="sm" gradient="pink-violet" initials={p2.charAt(1).toUpperCase()} />
        <span className="flex-1 font-mono text-[11px] text-text-primary">{p2}</span>
        {live && (
          <span className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-danger" />
            <span className="font-mono text-[9px] font-semibold text-danger">{t('tournament.live')}</span>
          </span>
        )}
        {!tbd && (
          <span
            className={[
              'rounded px-1.5 py-0 font-mono text-[10px] font-semibold',
              (s2 ?? 0) > (s1 ?? 0) ? 'bg-success/20 text-success' : 'bg-surface-2 text-text-muted',
            ].join(' ')}
          >
            {s2}
          </span>
        )}
      </div>
    </div>
  )
}

function Bracket({ r16, qf, sf }: { r16: MatchProps[]; qf: MatchProps[]; sf: MatchProps[] }) {
  return (
    <div className="flex flex-1 gap-4 overflow-x-auto rounded-2xl bg-surface-2 p-4 lg:p-7">
      <div className="flex w-[200px] flex-shrink-0 flex-col gap-3 lg:flex-1">
        <span className="font-mono text-[11px] font-semibold tracking-[0.08em] text-text-muted">
          R16
        </span>
        {r16.map((m, i) => (
          <Match key={i} {...m} />
        ))}
      </div>
      <div className="flex w-2 flex-col items-center justify-around">
        <span className="h-1 w-2 bg-border" />
      </div>
      <div className="flex w-[200px] flex-shrink-0 flex-col justify-around gap-3 lg:flex-1">
        <span className="font-mono text-[11px] font-semibold tracking-[0.08em] text-text-muted">
          QF
        </span>
        {qf.map((m, i) => (
          <Match key={i} {...m} />
        ))}
      </div>
      <div className="flex w-[200px] flex-shrink-0 flex-col justify-around gap-3 lg:flex-1">
        <span className="font-mono text-[11px] font-semibold tracking-[0.08em] text-text-muted">
          SF
        </span>
        {sf.map((m, i) => (
          <Match key={i} {...m} />
        ))}
      </div>
      <div className="flex w-[200px] flex-shrink-0 flex-col justify-center gap-3 lg:flex-1">
        <span className="font-mono text-[11px] font-semibold tracking-[0.08em] text-warn">
          FINAL
        </span>
        <div
          className="flex h-[100px] flex-col justify-center gap-1 rounded-[10px] border border-warn p-3"
          style={{ background: 'linear-gradient(135deg, #FBBF24 0%, #F472B6 100%)' }}
        >
          <span className="font-display text-[11px] font-extrabold text-bg">FINAL</span>
          <span className="font-mono text-[11px] text-bg">TBD vs TBD</span>
          <Trophy className="ml-auto h-5 w-5 text-bg" />
        </div>
      </div>
    </div>
  )
}

function NextMatchCard({ opponent, when }: { opponent: string; when: string }) {
  const { t } = useTranslation('pages')
  return (
    <div className="flex flex-col gap-3 rounded-xl bg-accent p-5 shadow-glow">
      <span className="w-fit rounded-full bg-white/20 px-2 py-0.5 font-mono text-[10px] font-semibold text-text-primary">
        {t('tournament.next_match')}
      </span>
      <div className="flex items-center justify-around">
        <div className="flex flex-col items-center gap-1.5">
          <Avatar size="lg" gradient="pink-violet" initials={opponent.charAt(1).toUpperCase()} />
          <span className="font-mono text-[11px] text-text-primary">{opponent}</span>
        </div>
        <span className="font-display text-[20px] font-extrabold text-text-primary">VS</span>
        <div className="flex flex-col items-center gap-1.5">
          <Avatar size="lg" gradient="cyan-violet" initials="Y" />
          <span className="font-mono text-[11px] text-text-primary">@you</span>
        </div>
      </div>
      <span className="text-center font-mono text-[12px] text-white/85">
        {when}
      </span>
    </div>
  )
}

function PredictionsCard({ rows }: { rows: { label: string; odds: string[]; yours?: boolean }[] }) {
  const { t } = useTranslation('pages')
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface-2 p-5">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-[14px] font-bold text-text-primary">{t('tournament.predictions')}</h3>
        <span className="inline-flex items-center gap-1 rounded-full bg-warn/20 px-2 py-0.5 font-mono text-[10px] font-semibold text-warn">
          Bet <Gem className="h-3 w-3" />
        </span>
      </div>
      {rows.map((r) => (
        <div key={r.label} className="flex flex-col gap-1.5">
          <span className="font-mono text-[11px] text-text-muted">{r.label}</span>
          <div className="flex gap-2">
            {r.odds.map((o, i) => (
              <button
                key={o}
                className={[
                  'flex-1 rounded-md bg-surface-3 px-2 py-1.5 font-mono text-[11px] font-semibold text-text-secondary hover:bg-surface-1',
                  r.yours && i === 0 ? 'border border-accent text-accent-hover' : '',
                ].join(' ')}
              >
                {o}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function StandingsCard({ rows }: { rows: { rank: number; name: string; score: string; you?: boolean }[] }) {
  const { t } = useTranslation('pages')
  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-border bg-surface-2 p-5">
      <h3 className="font-display text-[14px] font-bold text-text-primary">{t('tournament.top_predictors')}</h3>
      {rows.map((r) => (
        <div
          key={r.rank}
          className={[
            'flex items-center gap-2.5 rounded-md px-2 py-1.5',
            r.you ? 'bg-accent/15' : '',
          ].join(' ')}
        >
          <span className="grid h-6 w-6 place-items-center rounded-full bg-surface-3 font-display text-[11px] font-bold text-text-primary">
            {r.rank}
          </span>
          <span className="flex-1 font-mono text-[12px] text-text-primary">{r.name}</span>
          <span className="font-mono text-[11px] font-semibold text-warn">{r.score}</span>
        </div>
      ))}
    </div>
  )
}

const FALLBACK_R16: MatchProps[] = [
  { p1: '@alexey', p2: '@dmitry', s1: 2, s2: 0 },
  { p1: '@kirill_dev', p2: '@you', s1: 1, s2: 1, live: true, yours: true },
  { p1: '@nastya', p2: '@misha', s1: 2, s2: 1 },
  { p1: '@vasya', p2: '@artem', s1: 0, s2: 2 },
  { p1: '@elena', p2: '@petr', s1: 2, s2: 0 },
  { p1: '@ivan', p2: '@sergey', s1: 1, s2: 2 },
  { p1: '@olga', p2: '@gleb', s1: 2, s2: 1 },
  { p1: '@yana', p2: '@boris', s1: 0, s2: 2 },
]
const FALLBACK_QF: MatchProps[] = [
  { p1: '@alexey', p2: 'TBD', tbd: true },
  { p1: 'TBD', p2: 'TBD', tbd: true },
  { p1: '@elena', p2: 'TBD', tbd: true },
  { p1: '@olga', p2: 'TBD', tbd: true },
]
const FALLBACK_SF: MatchProps[] = [
  { p1: 'TBD', p2: 'TBD', tbd: true },
  { p1: 'TBD', p2: 'TBD', tbd: true },
]

export default function TournamentPage() {
  const { id } = useParams<{ id: string }>()
  const { data, isError } = useTournamentQuery(id)
  const r16 = data?.bracket?.r16 ?? FALLBACK_R16
  const qf = data?.bracket?.qf ?? FALLBACK_QF
  const sf = data?.bracket?.sf ?? FALLBACK_SF
  const nextOpponent = data?.next_match?.opponent ?? '@kirill_dev'
  const nextWhen = data?.next_match?.in ?? 'Через 2ч 14м · BO3'
  const predictions = data?.predictions ?? [
    { label: '@kirill vs @you', odds: ['@kirill 1.4x', '@you 2.8x'], yours: true },
  ]
  const standings = data?.standings ?? [
    { rank: 1, name: '@oracle_max', score: '+820 💎' },
  ]
  return (
    <AppShellV2>
      <div className="flex flex-col">
        <Hero
          name={data?.name ?? 'Dragonfire Open'}
          tier={data?.tier ?? 'WEEKLY CUP · DIAMOND TIER'}
          format={data?.format ?? 'Round of 16 · Single Elimination · BO3'}
          prizePool={data?.prize_pool ?? 50000}
          finalsIn={data?.finals_in ?? '02:14:38'}
        />
        {isError && (
          <div className="flex justify-end px-4 py-2">
            <ErrorChip />
          </div>
        )}
        <FilterStrip />
        <div className="flex flex-col gap-4 px-4 py-6 sm:px-8 lg:flex-row lg:gap-6 lg:px-20">
          <Bracket r16={r16} qf={qf} sf={sf} />
          <div className="flex w-full flex-col gap-4 lg:w-[360px]">
            <NextMatchCard opponent={nextOpponent} when={nextWhen} />
            <PredictionsCard rows={predictions} />
            <StandingsCard rows={standings} />
          </div>
        </div>
        <div className="hidden">{id}</div>
      </div>
    </AppShellV2>
  )
}
