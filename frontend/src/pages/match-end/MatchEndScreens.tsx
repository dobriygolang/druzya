// MatchEndScreens — three emotion-peak variants for /match/:id/end
// (Wave-10, design-review v4 P0).
//
// Background: the legacy MatchEndPage rendered ALL outcomes through one
// "stat dashboard" template — sober, uniform, didn't celebrate wins or
// soften losses. Design-review verdict: this is the **first emotion
// point** in the product; we lose users who never feel anything here.
//
// Three deliberate variants:
//   WinPromote — rank-up moment. Confetti + EloRing tween + cascading
//                AchievementToasts + tier-up sound cue. Maximum payoff.
//   WinNormal  — solid feedback without overload. EloRing + XPRain
//                ambient + compact stats. No confetti — saved for promote.
//   LossScreen — non-demotivating. AI-coach inline ("вот что выучил")
//                pushing toward next match, NOT wallowing in the loss.
//
// Each screen consumes the existing MatchEndResponse — no backend
// changes needed. Promoted detection is a heuristic: ELO crossed a
// 100-point band threshold (tier_progress backend field will eventually
// own this; for now the heuristic is ELO-after / 100 differs from
// ELO-before / 100).

// Phase-4 ADR-001: ConfettiBurst / XPRain / AchievementCascade removed.
// Quiet-ecosystem rule — match-end shows the ELO delta and verdict; no
// particle effects, no synthesised achievement cascade. EloRing + tier
// label do the heavy lifting.
import { Sparkles, Flame, ChevronRight, Share2, Play } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import type { MatchEndResponse } from '../../lib/queries/matches'
import { Card } from '../../components/Card'
import { EloRing } from '../../components/EloRing'
import { SoundHook } from '../../components/SoundHook'
import { gradientStyleForUser } from '../../lib/avatarGradients'

// ── shared chrome ────────────────────────────────────────────────────────

function PageHeader({
  matchId,
  back,
}: {
  matchId: string
  back: () => void
}) {
  return (
    <div className="flex h-16 items-center justify-between gap-3 border-b border-border bg-surface-1 px-4 sm:px-8">
      <button
        type="button"
        onClick={back}
        className="flex items-center gap-2 text-sm text-text-secondary hover:text-text-primary"
      >
        ← назад в арену
      </button>
      <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-secondary">
        match end
      </span>
      <span className="font-mono text-[11px] text-text-muted">#{matchId}</span>
    </div>
  )
}

function ActionsRow({
  primaryLabel,
  primaryIcon,
  onPrimary,
  secondaryLabel,
  onSecondary,
  username,
}: {
  primaryLabel: string
  primaryIcon: React.ReactNode
  onPrimary: () => void
  secondaryLabel: string
  onSecondary: () => void
  username: string | undefined
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onPrimary}
          className="inline-flex items-center gap-2 rounded-md bg-text-primary hover:bg-text-primary/90 px-5 py-2.5 text-sm font-semibold text-bg"
        >
          {primaryIcon}
          {primaryLabel}
        </button>
        <button
          type="button"
          onClick={onSecondary}
          className="inline-flex items-center gap-2 rounded-md border border-border bg-surface-1 px-4 py-2.5 text-sm text-text-secondary hover:bg-surface-2"
        >
          <Play className="h-4 w-4" /> {secondaryLabel}
        </button>
      </div>
      <button
        type="button"
        className="inline-flex items-center gap-2 rounded-md border border-border bg-surface-1 px-4 py-2.5 text-sm text-text-secondary hover:bg-surface-2"
        title={username ? `Поделиться от @${username}` : 'Поделиться'}
      >
        <Share2 className="h-4 w-4" /> поделиться
      </button>
    </div>
  )
}

// ── shared band: tierBand derivation ─────────────────────────────────────
//
// MatchEndResponse exposes tier (string) but not the numeric band. We
// approximate by flooring lp_total to the nearest 100 — the same
// heuristic we use to detect promotion. Replace with a server-supplied
// band when the proto lands.
function tierBand(lpTotal: number): { min: number; max: number } {
  const min = Math.floor(lpTotal / 100) * 100
  return { min, max: min + 100 }
}

// Detect promotion deterministically from the lp delta: if before/after
// crossed a 100-point boundary, we promoted. Conservative: only counts
// upward crossings (so a loss landing at exactly the boundary doesn't
// trigger a fake promote).
export function detectPromotion(d: MatchEndResponse): boolean {
  const after = d.lp_total
  const before = after - d.lp_delta
  return d.result === 'W' && Math.floor(after / 100) > Math.floor(before / 100)
}

// ── variant 1 · WIN + PROMOTE ────────────────────────────────────────────

export function WinPromote({ data, profile }: { data: MatchEndResponse; profile: { username?: string; display_name?: string } | undefined }) {
  const navigate = useNavigate()
  const initial = (profile?.display_name ?? '?').charAt(0).toUpperCase()
  const before = data.lp_total - data.lp_delta
  const band = tierBand(data.lp_total)

  // Phase-4 ADR-001: synthesized achievement cascade removed alongside the
  // Achievements feature.

  return (
    <div className="relative min-h-[760px] bg-bg">
      {/* Sound cue — placeholder, fires once */}
      <SoundHook cue="tier-up" when />

      <PageHeader matchId={data.id} back={() => navigate('/arena')} />

      <div className="px-4 py-8 sm:px-8 lg:px-20 lg:py-12 max-w-5xl mx-auto">
        {/* Hero band: gradient + tier-up reveal */}
        <div className="rounded-2xl border border-warn/40 bg-warn/10 p-6 sm:p-8 mb-6 text-center">
          <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-warn mb-2">
            ⬆ promote
          </div>
          <h1 className="font-display text-4xl sm:text-5xl lg:text-[64px] font-extrabold leading-[1] mb-3">
            {data.verdict || 'Победа'}
          </h1>
          <p className="text-text-secondary text-sm">
            {data.task}
            {data.sub ? ` · ${data.sub}` : ''}
          </p>
        </div>

        {/* ELO ring + tier label */}
        <div className="flex flex-col items-center gap-4 mb-8">
          <EloRing from={before} to={data.lp_total} tierBand={band} />
          <div className="text-center">
            <div className="font-display text-xl font-bold text-warn">{data.tier}</div>
            {data.next_tier && (
              <div className="font-mono text-[11px] text-text-muted mt-0.5">
                до {data.next_tier} · {Math.round(data.tier_progress)}%
              </div>
            )}
          </div>
        </div>

        {/* Self avatar identity — pinned at bottom for "this happened to YOU" */}
        <div className="flex items-center justify-center gap-3 mb-6">
          <div
            className="grid h-10 w-10 place-items-center rounded-full font-display text-sm font-bold text-white"
            style={gradientStyleForUser(profile?.username)}
          >
            {initial}
          </div>
          <div className="font-mono text-[12px] text-text-secondary">
            @{profile?.username ?? 'you'} · {data.lp_total} ({data.lp_delta >= 0 ? '+' : ''}
            {data.lp_delta})
          </div>
        </div>

        <ActionsRow
          primaryLabel="Следующий матч"
          primaryIcon={<ChevronRight className="h-4 w-4" />}
          onPrimary={() => navigate('/arena')}
          secondaryLabel="Replay"
          onSecondary={() => navigate(`/arena/match/${data.id}?replay=1`)}
          username={profile?.username}
        />
      </div>
    </div>
  )
}

// ── variant 2 · WIN + NORMAL ─────────────────────────────────────────────

export function WinNormal({ data, profile }: { data: MatchEndResponse; profile: { username?: string; display_name?: string } | undefined }) {
  const navigate = useNavigate()
  const before = data.lp_total - data.lp_delta
  const band = tierBand(data.lp_total)

  return (
    <div className="relative min-h-[760px] bg-bg">
      <SoundHook cue="xp-tick" when interval={120} />

      <PageHeader matchId={data.id} back={() => navigate('/arena')} />

      <div className="relative px-4 py-8 sm:px-8 lg:px-20 lg:py-12 max-w-5xl mx-auto">
        <div className="rounded-2xl border border-success/40 bg-gradient-to-br from-success/10 to-surface-1 p-6 sm:p-8 mb-6 text-center">
          <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-success mb-2">
            win
          </div>
          <h1 className="font-display text-3xl sm:text-4xl lg:text-[48px] font-extrabold leading-[1.05] mb-2">
            {data.verdict || 'Победа'}
          </h1>
          <p className="text-text-secondary text-sm">
            {data.task}
            {data.sub ? ` · ${data.sub}` : ''}
          </p>
        </div>

        {/* ELO ring + 4-tile compact stats */}
        <div className="flex flex-col lg:flex-row items-center gap-8 mb-8">
          <EloRing from={before} to={data.lp_total} tierBand={band} />
          <div className="grid flex-1 grid-cols-2 sm:grid-cols-4 gap-3 w-full">
            <Card className="flex-col gap-1 p-4 text-center">
              <span className="font-mono text-[10px] uppercase text-text-muted">время</span>
              <span className="font-display text-2xl font-extrabold tabular-nums">{data.stats.time}</span>
            </Card>
            <Card className="flex-col gap-1 p-4 text-center">
              <span className="font-mono text-[10px] uppercase text-text-muted">tests</span>
              <span className="font-display text-2xl font-extrabold tabular-nums">{data.stats.tests}</span>
            </Card>
            <Card className="flex-col gap-1 p-4 text-center">
              <span className="font-mono text-[10px] uppercase text-text-muted">O(·)</span>
              <span className="font-display text-2xl font-extrabold text-text-secondary">{data.stats.complexity}</span>
            </Card>
            <Card className="flex-col gap-1 p-4 text-center">
              <span className="font-mono text-[10px] uppercase text-text-muted">строк</span>
              <span className="font-display text-2xl font-extrabold tabular-nums">{data.stats.lines}</span>
            </Card>
          </div>
        </div>

        {/* Tier label */}
        <div className="text-center mb-8">
          <div className="font-display text-lg font-bold">{data.tier}</div>
          {data.next_tier && (
            <div className="font-mono text-[11px] text-text-muted mt-0.5">до {data.next_tier} · {Math.round(data.tier_progress)}%</div>
          )}
        </div>

        <ActionsRow
          primaryLabel="Следующий матч"
          primaryIcon={<ChevronRight className="h-4 w-4" />}
          onPrimary={() => navigate('/arena')}
          secondaryLabel="Replay"
          onSecondary={() => navigate(`/arena/match/${data.id}?replay=1`)}
          username={profile?.username}
        />
      </div>
    </div>
  )
}

// ── variant 3 · LOSS ─────────────────────────────────────────────────────

export function LossScreen({ data, profile }: { data: MatchEndResponse; profile: { username?: string; display_name?: string } | undefined }) {
  const navigate = useNavigate()
  const before = data.lp_total - data.lp_delta
  const band = tierBand(data.lp_total)

  // Inline AI-coach insight — derived from observable signals so the
  // user gets ONE concrete takeaway. No real LLM call here; the line
  // is tailored to time vs tests outcome. When the per-match coach
  // endpoint ships, swap this synth for the real narrative.
  const insight = (() => {
    if (data.stats.time && /^[5-9]:|^\d{2}:/.test(data.stats.time)) {
      return 'Ты тратил много времени — вернись к шаблону Two Pointers / Sliding Window и порешай 5 простых задач без таймера.'
    }
    if (data.stats.tests && /^\d+\/\d+$/.test(data.stats.tests)) {
      const [done, total] = data.stats.tests.split('/').map((s) => Number(s) || 0)
      if (total > 0 && done < total) {
        return `Ты прошёл ${done} из ${total} тестов — соперник нашёл edge-case, который ты упустил. Добавь привычку «3 corner-cases перед submit».`
      }
    }
    return 'Соперник был быстрее. Это не про ум — это про шаблон. Вернись к фокус-нодам Atlas.'
  })()

  return (
    <div className="relative min-h-[760px] bg-bg">
      <SoundHook cue="loss" when />

      <PageHeader matchId={data.id} back={() => navigate('/arena')} />

      <div className="px-4 py-8 sm:px-8 lg:px-20 lg:py-12 max-w-5xl mx-auto">
        {/* Hero — softer than win. Danger band but minimal weight. */}
        <div className="rounded-2xl border border-danger/30 bg-gradient-to-br from-danger/10 to-surface-1 p-6 sm:p-8 mb-6 text-center">
          <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-danger mb-2">
            loss
          </div>
          <h1 className="font-display text-3xl sm:text-4xl lg:text-[44px] font-bold leading-[1.05] mb-2">
            {data.verdict || 'В следующий раз'}
          </h1>
          <p className="text-text-secondary text-sm">
            {data.task}
            {data.sub ? ` · ${data.sub}` : ''}
          </p>
        </div>

        {/* ELO ring + tier */}
        <div className="flex flex-col items-center gap-4 mb-6">
          <EloRing from={before} to={data.lp_total} tierBand={band} delay={400} duration={1200} />
          <div className="text-center">
            <div className="font-display text-base font-bold text-text-secondary">{data.tier}</div>
          </div>
        </div>

        {/* AI-coach insight — the emotional pivot from "loss" to "next" */}
        <Card className="flex-col gap-3 border-border-strong bg-text-primary/10 p-5 mb-6">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-text-secondary" />
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-secondary">ai coach · быстрый разбор</span>
          </div>
          <p className="text-[14px] text-text-primary leading-relaxed">{insight}</p>
        </Card>

        {/* Streak preserved? Small dignity gesture */}
        {data.streak_bonus && (
          <Card className="flex items-center gap-3 border-border-strong bg-text-primary/10 p-4 mb-6">
            <Flame className="h-5 w-5 text-text-secondary shrink-0" />
            <div className="text-[13px] text-text-secondary">
              Streak сохранён: <strong className="text-text-secondary">{data.streak_bonus}</strong>
            </div>
          </Card>
        )}

        <ActionsRow
          primaryLabel="Следующий матч — отыграться"
          primaryIcon={<ChevronRight className="h-4 w-4" />}
          onPrimary={() => navigate('/arena')}
          secondaryLabel="Открыть Atlas"
          onSecondary={() => navigate('/atlas')}
          username={profile?.username}
        />
      </div>
    </div>
  )
}
