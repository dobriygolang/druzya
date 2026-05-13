// TodayPage — landing для авторизованного юзера.
//
// Today — это «ты пришёл, вот что делать»: hero с приветствием + 4 cards
// с конкретными действиями (mock / coach insight / pending assignments /
// weak spots).
//
// Cards читают live data:
//   - DailyBrief (intelligence) — headline + первая recommendation
//   - Insights stream (top-1 severe) — atomic insight с lever-кнопкой
//   - Pending assignments (через aiTutor + tutor; пока считаем threads
//     как proxy для подключенных coach'ей, full assignments-from-tutor
//     query отдельной волной)
//   - Atlas weak spots — top-3 из useAtlasQuery + inline coach pill
//
// Errors / empty / degraded: каждая card обрабатывает свой failure mode
// независимо; degraded intelligence не валит page.

import { useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  ArrowRight,
  Brain,
  Loader2,
  Map as MapIcon,
  Sparkles,
  Target,
} from 'lucide-react'

import { AppShellV2 } from '../components/AppShell'
import { Button } from '../components/Button'
import { AICoachPill } from '../components/AICoachPill'
import { GoalReadinessCard } from '../components/GoalReadinessCard'
import { GoalWizardModal } from '../components/GoalWizardModal'
import { DailyPlanCard } from '../components/DailyPlanCard'
import { ActivityFeed } from '../components/ActivityFeed'
import { ProactiveInsightsBanner } from '../components/ProactiveInsightsBanner'
import { CueSessionsSection } from '../components/CueSessionsSection'
import { StreakChip } from '../components/StreakChip'
import { TrajectoryCard } from '../components/TrajectoryCard'
import { MilestonesCard } from '../components/MilestonesCard'
import { MyTutorsCard } from '../components/MyTutorsCard'
import { WeeklySnapshotCard } from '../components/WeeklySnapshotCard'
import { ErrorBoundary } from '../components/ErrorBoundary'
import { useProfileQuery } from '../lib/queries/profile'
import { useActiveStudyModeQuery, type ActiveTrack } from '../lib/queries/honeSettings'
import { useDailyBriefQuery, normalizeSeverity } from '../lib/queries/intelligence'
import { useInsightsQuery } from '../lib/queries/insights'
import { useAtlasQuery } from '../lib/queries/profile'
import { useGoal } from '../lib/useGoal'
import { useState } from 'react'

// Section в атласе → AI-coach persona slug. Display-name всегда role-only
function pickPersonaFor(section: string, activeTrack: ActiveTrack): {
  slug: string
  name: string
} {
  if (activeTrack === 'go') return { slug: 'go-coach', name: 'go coach' }
  if (activeTrack === 'ml') return { slug: 'ml-coach', name: 'ml coach' }
  if (activeTrack === 'english') return { slug: 'english-coach', name: 'english coach' }
  switch (section) {
    case 'system_design':
      return { slug: 'sysdesign-guru', name: 'sysdesign coach' }
    case 'sql':
    case 'databases':
      return { slug: 'sql-mentor', name: 'sql coach' }
    default:
      return { slug: 'algo-coach', name: 'algo coach' }
  }
}

const TRACK_LABELS: Record<ActiveTrack, string> = {
  general: 'general',
  dev: 'dev (Go senior)',
  ml: 'ml engineering',
  english: 'english',
  go: 'go deep',
}

export default function TodayPage() {
  const profileQ = useProfileQuery()
  const trackQ = useActiveStudyModeQuery()
  const username = profileQ.data?.username ?? ''
  const activeTrack: ActiveTrack = trackQ.data?.activeTrack ?? 'general'
  const goal = useGoal()
  const [goalWizardOpen, setGoalWizardOpen] = useState(false)

  const today = useMemo(() => {
    const d = new Date()
    return d.toLocaleDateString('ru-RU', {
      day: 'numeric',
      month: 'long',
      weekday: 'long',
    })
  }, [])

  return (
    <AppShellV2>
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-10 sm:px-8 sm:py-14">
        <Hero username={username} today={today} activeTrack={activeTrack} />

        {/* F4 (Phase C) proactive insights banner — top-1 active insight
            из detectInsights() (event-driven over F2 goal + F5 activity +
            F9 diagnostic). Coach «говорит сам»: «3 дня без активности»,
            «Streak 5 дней», «Дедлайн через 14 дн, readiness 35%». 24h
            dismiss persistence. Null если ни одного активного insight. */}
        <ProactiveInsightsBanner />

        {/* F3 (Phase B) readiness card — always at top. Goal-aware: no-goal
            state CTA → wizard or diagnostic; has-goal state → readiness %
            + factors + weeks-to-target. Computed deterministically на
            localStorage data (F2 goal + F9 quiz answers), без backend. */}
        <GoalReadinessCard goal={goal} onSetGoal={() => setGoalWizardOpen(true)} />

        {/* T6 (Phase K 2026-05-12) — student-side tutor social proof.
            Subtle one-line-per-tutor card; hidden when zero active tutors.
            Privacy-aware: aggregate counts only, no other-student names. */}
        <MyTutorsCard />

        {/* F7 (Phase C) daily plan card — 3-5 goal-driven actions based на
            current readiness + weakest area + budget. Cached per-date via
            localStorage; refresh-button инвалидирует. */}
        <DailyPlanCard />

        {/* F2 Phase B/C — weekly milestones roadmap. Hidden when no goal.
            Collapsed by default (current + 2 ahead); expand to show all. */}
        <MilestonesCard />

        {/* R6 (Phase D 2026-05-12) weekly snapshot — 4-cell mini-summary
            (count / hours / top-kind / mini-mock). Hidden когда activity
            пуст. Backend swap-able later. */}
        <WeeklySnapshotCard />

        {/* R3 (Phase D) progress-twin trajectory card — 30d sparkline +
            week-vs-week delta + verdict. Активируется когда есть activity;
            пустой state — placeholder с CTA. */}
        <TrajectoryCard />

        {/* F5 (Phase C) activity feed — manual log button + breakdown last
            7d + history. Каждый log повышает F3 readiness через
            computeActivityBoost(), создавая видимый goal-driven loop. */}
        <ActivityFeed />

        {/* F10 (Phase C) Cue sessions — manual log button + recent list +
            weak-stage badges. Без real Cue Electron ingestion juзер может
            залогировать собес/mock вручную; CoachMemoryCard latestCue +
            F4 insights автоматически подхватывают. */}
        <CueSessionsSection />

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <ErrorBoundary section="Mock card">
            <NextMockCard />
          </ErrorBoundary>
          <ErrorBoundary section="Coach insight">
            <CoachInsightCard />
          </ErrorBoundary>
          <ErrorBoundary section="Daily brief">
            <DailyBriefCard />
          </ErrorBoundary>
          <ErrorBoundary section="Atlas weak spots">
            <AtlasWeakSpotsCard activeTrack={activeTrack} />
          </ErrorBoundary>
        </div>

        {goalWizardOpen && (
          <GoalWizardModal initial={goal} onClose={() => setGoalWizardOpen(false)} />
        )}
      </div>
    </AppShellV2>
  )
}

function Hero({
  username,
  today,
  activeTrack,
}: {
  username: string
  today: string
  activeTrack: ActiveTrack
}) {
  return (
    <header className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-muted">
          {today}
        </span>
        <StreakChip />
      </div>
      <h1 className="font-display text-3xl font-bold leading-tight">
        {username ? `Привет, @${username}` : 'Today'}
      </h1>
      <p className="text-[14px] text-text-secondary">
        Активный режим: <b>{TRACK_LABELS[activeTrack]}</b>. Сменить можно в Hone
        или на <Link to="/profile" className="underline">профиле</Link>.
      </p>
    </header>
  )
}

// ── cards ──────────────────────────────────────────────────────────────────

function Card({
  icon,
  title,
  children,
  className = '',
}: {
  icon?: React.ReactNode
  title: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <section
      className={`flex flex-col gap-3 rounded-xl border border-border bg-surface-1 p-5 ${className}`}
    >
      <header className="flex items-center gap-2">
        {icon && <span className="text-accent">{icon}</span>}
        <h2 className="font-display text-base font-bold leading-tight">{title}</h2>
      </header>
      {children}
    </section>
  )
}

function NextMockCard() {
  return (
    <Card icon={<Sparkles className="h-4 w-4" />} title="Mock-собес">
      <p className="text-[13px] leading-relaxed text-text-secondary">
        Самый прямой путь проверить себя — пройти AI-mock с интервьюером по
        конкретной компании. На каждой секции — оценка, в конце сводный отчёт.
      </p>
      <Link to="/mock">
        <Button
          variant="primary"
          size="sm"
          icon={<Target className="h-4 w-4" />}
          iconRight={<ArrowRight className="h-4 w-4" />}
          className="self-start"
        >
          Начать mock
        </Button>
      </Link>
    </Card>
  )
}

function DailyBriefCard() {
  const q = useDailyBriefQuery()
  return (
    <Card icon={<Brain className="h-4 w-4" />} title="Daily brief">
      {q.isPending ? (
        <div className="flex items-center gap-2 text-[12px] text-text-muted">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Генерирую…
        </div>
      ) : q.isError || !q.data ? (
        <p className="text-[13px] text-text-muted">
          Coach сейчас offline — daily brief недоступен. Это нормально без
          OpenRouter ключа в dev'е.
        </p>
      ) : (
        <BriefBody data={q.data} />
      )}
    </Card>
  )
}

function BriefBody({ data }: { data: ReturnType<typeof useDailyBriefQuery>['data'] }) {
  if (!data) return null
  const sev = normalizeSeverity(data.severity)
  const sevColor =
    sev === 'critical' ? 'text-danger'
      : sev === 'warn' ? 'text-warn'
        : sev === 'nudge' ? 'text-accent'
          : 'text-text-muted'
  const top = data.recommendations?.[0]
  return (
    <div className="flex flex-col gap-2">
      <div className={`font-mono text-[10px] uppercase tracking-[0.08em] ${sevColor}`}>
        severity: {sev}
      </div>
      <div className="text-[14px] font-medium text-text-primary">{data.headline}</div>
      {data.narrative && (
        <p className="text-[13px] leading-relaxed text-text-secondary">{data.narrative}</p>
      )}
      {top && (
        <div className="rounded-md border border-border bg-surface-2 p-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
            top recommendation · {top.kind}
          </div>
          <div className="mt-1 text-[13px] font-medium text-text-primary">{top.title}</div>
          <p className="mt-1 text-[12px] text-text-secondary">{top.rationale}</p>
        </div>
      )}
    </div>
  )
}

function CoachInsightCard() {
  const q = useInsightsQuery('today', 1)
  return (
    <Card icon={<Sparkles className="h-4 w-4" />} title="AI-coach insight">
      {q.isPending ? (
        <div className="flex items-center gap-2 text-[12px] text-text-muted">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Загружаю…
        </div>
      ) : q.isError || !q.data || q.data.items.length === 0 ? (
        <p className="text-[13px] text-text-muted">
          Свежих insight'ов нет. Они появляются после mock'ов и focus-сессий —
          реализуй пару подряд и coach подгонит наблюдения.
        </p>
      ) : (
        (() => {
          const top = q.data.items[0]
          return (
            <div className="flex flex-col gap-2">
              <div className="text-[14px] font-medium text-text-primary">{top.headline}</div>
              <p className="text-[13px] leading-relaxed text-text-secondary">{top.evidence}</p>
              <div className="rounded-md bg-surface-2 p-2 text-[12px] text-text-primary">
                <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
                  lever:
                </span>{' '}
                {top.lever}
              </div>
              {top.deep_link && (
                <Link
                  to={top.deep_link}
                  className="inline-flex items-center gap-1 self-start font-mono text-[11px] uppercase tracking-[0.08em] text-text-secondary hover:text-text-primary"
                >
                  открыть <ArrowRight className="h-3 w-3" />
                </Link>
              )}
            </div>
          )
        })()
      )}
    </Card>
  )
}

function AtlasWeakSpotsCard({ activeTrack }: { activeTrack: ActiveTrack }) {
  const q = useAtlasQuery()
  const navigate = useNavigate()

  // Top-3 weak: lowest progress > 0 (исключаем locked/never_started). Если
  // прогресс везде 0 — берём первые 3 по sort_order чтобы дать чему-то
  // ткнуть. Атлас может быть пустым на первом запуске — рендерим CTA.
  const weak = useMemo(() => {
    const nodes = q.data?.nodes ?? []
    if (nodes.length === 0) return []
    const withProgress = nodes
      .filter((n) => (n.progress ?? 0) > 0 && (n.progress ?? 0) < 80)
      .sort((a, b) => (a.progress ?? 0) - (b.progress ?? 0))
    if (withProgress.length >= 3) return withProgress.slice(0, 3)
    return [...withProgress, ...nodes.filter((n) => !withProgress.includes(n))].slice(0, 3)
  }, [q.data])

  return (
    <Card icon={<MapIcon className="h-4 w-4" />} title="Слабые узлы">
      {q.isPending ? (
        <div className="flex items-center gap-2 text-[12px] text-text-muted">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Загружаю атлас…
        </div>
      ) : weak.length === 0 ? (
        <div className="space-y-2">
          <p className="text-[13px] text-text-secondary">
            Атлас пуст или ты только начал. Открой полный граф чтобы увидеть карту тем.
          </p>
          <Button
            size="sm"
            variant="ghost"
            iconRight={<ArrowRight className="h-3.5 w-3.5" />}
            onClick={() => navigate('/atlas/explore')}
          >
            Открыть Atlas
          </Button>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {weak.map((n) => {
            const persona = pickPersonaFor(n.section, activeTrack)
            const pct = n.progress ?? 0
            const ctx = `Студент работает над узлом «${n.title}» (${n.section}). Прогресс ${pct}%. Объясни что важно знать чтобы closed gap.`
            return (
              <li
                key={n.key}
                className="flex flex-col gap-1.5 rounded-md bg-surface-2 px-3 py-2.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[13px] font-medium text-text-primary">{n.title}</span>
                  <span className="font-mono text-[11px] tabular-nums text-text-secondary">
                    {pct}%
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    to={`/mock?focus=${encodeURIComponent(n.key)}&section=${encodeURIComponent(n.section)}&title=${encodeURIComponent(n.title)}`}
                    className="inline-flex items-center gap-1 rounded-full border border-accent/40 bg-accent/5 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-accent hover:bg-accent/10"
                  >
                    <Target className="h-3 w-3" /> mock
                  </Link>
                  <AICoachPill
                    personaSlug={persona.slug}
                    coachName={persona.name}
                    contextNote={ctx}
                    label="coach"
                  />
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}
