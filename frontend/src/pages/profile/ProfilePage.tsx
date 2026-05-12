// ProfilePage — pivot 2026-05-02 redesign.
//
// Старая страница строилась под arena rating system (GPS / Vessel / Lv /
// matches / brones). После pivot 2026-05-01 arena/lobby/rating выпилены —
// эти carды стали мёртвой UX'ой («у тебя 0 матчей и Lv 24 ни от чего»).
//
// Новая identity: AI-coach + free tutor-toolkit + mock prep. Profile —
// «дашборд подготовки»:
//   1. Header: имя, аватар, member-since, settings link
//   2. Active study mode (general / dev / ml / english / go) с CTA сменить
//   3. AI-tutors — adopted персоны со ссылкой на чат
//   4. Quick links — /mock, /tasks, /atlas, /codex
//   5. Weekly report
//
// Старые компоненты ProfileHeader/ProfileOverview/ProfilePanels оставлены
// в директории как legacy (могут пригодиться при реактивации какой-нибудь
// части); ничего нового на них не вешаем.

import { useTranslation } from 'react-i18next'
import { useParams, Link } from 'react-router-dom'
import {
  ArrowRight,
  BookOpen,
  Brain,
  ListChecks,
  Map as MapIcon,
  Settings as SettingsIcon,
  Sparkles,
  Target,
} from 'lucide-react'

import { AppShellV2 } from '../../components/AppShell'
import { Button } from '../../components/Button'
import { DataBackupCard } from '../../components/DataBackupCard'
import { TutorRoleToggle } from '../../components/TutorRoleToggle'
import { ErrorBoundary } from '../../components/ErrorBoundary'
import { DataLoader } from '../../components/DataLoader'
import {
  useProfileQuery,
  usePublicProfileQuery,
  type Profile,
  type PublicProfile,
} from '../../lib/queries/profile'
import { useActiveStudyModeQuery, type ActiveTrack } from '../../lib/queries/honeSettings'
import {
  useMyAITutorThreadsQuery,
  useAITutorPersonasQuery,
  type AITutorPersona,
} from '../../lib/queries/aiTutor'
import {
  useMyTutorsQuery,
  usePendingInvitesForMeQuery,
  useAcceptInviteMutation,
} from '../../lib/queries/tutor'
import { ApiError } from '../../lib/apiClient'

const TRACK_LABELS: Record<ActiveTrack, { label: string; hint: string }> = {
  general: {
    label: 'General',
    hint: 'Без фильтра по треку — видишь весь контент Hone и атласа.',
  },
  dev: {
    label: 'Dev (Go senior)',
    hint: 'Подготовка к собесу на senior Go-разработчика. Algorithms, system design, distributed.',
  },
  english: {
    label: 'English',
    hint: 'Speaking + writing для tech-собесов. Clarity / accuracy / range / fluency.',
  },
  go: {
    label: 'Go deep',
    hint: 'Sub-mode для senior Go-разрабов: runtime, scheduler, GC, profiling, distributed.',
  },
}

// ── states ─────────────────────────────────────────────────────────────────

function ProfileSkeleton() {
  return (
    <AppShellV2>
      <div className="mx-auto w-full max-w-4xl animate-pulse px-4 py-10 sm:px-8 sm:py-14">
        <div className="h-24 w-24 rounded-full bg-surface-2" />
        <div className="mt-5 h-7 w-48 rounded bg-surface-2" />
        <div className="mt-2 h-4 w-72 rounded bg-surface-2" />
        <div className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2">
          <div className="h-44 rounded-xl bg-surface-2" />
          <div className="h-44 rounded-xl bg-surface-2" />
          <div className="h-44 rounded-xl bg-surface-2 sm:col-span-2" />
        </div>
      </div>
    </AppShellV2>
  )
}

function ProfileError({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation('profile')
  return (
    <AppShellV2>
      <div className="mx-auto max-w-md px-6 py-16 text-center">
        <p className="text-text-secondary">{t('error_load') ?? 'Не удалось загрузить профиль.'}</p>
        <Button variant="primary" onClick={onRetry} className="mt-4">
          {t('retry') ?? 'Повторить'}
        </Button>
      </div>
    </AppShellV2>
  )
}

function ProfileNotFound({ username }: { username: string }) {
  return (
    <AppShellV2>
      <div className="mx-auto max-w-md px-6 py-16 text-center">
        <h1 className="font-display text-2xl font-bold">@{username} не найден</h1>
        <p className="mt-2 text-sm text-text-secondary">Возможно, юзернейм изменился.</p>
        <Link to="/atlas" className="mt-6 inline-block">
          <Button variant="primary">К Atlas</Button>
        </Link>
      </div>
    </AppShellV2>
  )
}

// ── page ───────────────────────────────────────────────────────────────────

export default function ProfilePage() {
  const params = useParams<{ username?: string }>()
  const isOwn = !params.username
  const ownQuery = useProfileQuery()
  const publicQuery = usePublicProfileQuery(isOwn ? undefined : params.username)
  const active = isOwn ? ownQuery : publicQuery

  // 404 special-case must short-circuit before DataLoader's generic
  // error branch — "пользователь не существует" — это не «попробуй
  // позже», а другой UX.
  if (!isOwn && active.isError) {
    const status = (active.error as ApiError | null)?.status
    if (status === 404) {
      return <ProfileNotFound username={params.username ?? ''} />
    }
  }

  // Bridge `active` to DataLoader: оба запроса возвращают совместимый
  // shape (data/isLoading/isError/refetch), но TS не выводит union type
  // из тернарного оператора. DataLoader ожидает QueryState<T> с одним
  // типом — берём Profile | PublicProfile.
  const loaderState = {
    data: active.data as Profile | PublicProfile | undefined,
    isLoading: active.isLoading,
    isError: active.isError,
    error: active.error,
    refetch: () => active.refetch(),
  }

  return (
    <ErrorBoundary section="Профиль">
      <DataLoader<Profile | PublicProfile>
        state={loaderState}
        section="Профиль"
        skeleton={<ProfileSkeleton />}
        errorContent={(_e, retry) => <ProfileError onRetry={retry} />}
      >
        {(data) => {
          const username = data.username
          const displayName = data.display_name ?? username
          const avatarUrl = (data as Profile).avatar_url ?? ''
          const createdAt = isOwn ? (data as Profile).created_at : undefined
          return (
            <AppShellV2>
              <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-4 py-10 sm:px-8 sm:py-14">
                <Header
                  username={username}
                  displayName={displayName}
                  avatarUrl={avatarUrl}
                  createdAt={createdAt}
                  isOwn={isOwn}
                />
                {isOwn ? <OwnProfileBody /> : <PublicProfileBody username={username} />}
              </div>
            </AppShellV2>
          )
        }}
      </DataLoader>
    </ErrorBoundary>
  )
}

// ── header ─────────────────────────────────────────────────────────────────

function Header({
  username,
  displayName,
  avatarUrl,
  createdAt,
  isOwn,
}: {
  username: string
  displayName: string
  avatarUrl?: string
  createdAt?: string
  isOwn: boolean
}) {
  const initial = (displayName || username).slice(0, 1).toUpperCase()
  const memberSince = createdAt ? formatMonthYear(createdAt) : null
  return (
    <header className="flex flex-col items-start gap-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-5">
        <div className="grid h-20 w-20 shrink-0 place-items-center rounded-full bg-surface-2 font-display text-3xl font-extrabold text-text-primary">
          {avatarUrl ? (
            <img src={avatarUrl} alt={displayName} className="h-full w-full rounded-full object-cover" />
          ) : (
            initial
          )}
        </div>
        <div>
          <h1 className="font-display text-3xl font-bold leading-tight">@{username}</h1>
          <div className="mt-1 text-[14px] text-text-secondary">
            {displayName !== username && <>{displayName}</>}
            {displayName !== username && memberSince && <> · </>}
            {memberSince && <>в druz9 с {memberSince}</>}
          </div>
        </div>
      </div>
      {isOwn && (
        <Link to="/settings">
          <Button variant="ghost" size="sm" icon={<SettingsIcon className="h-4 w-4" />}>
            Настройки
          </Button>
        </Link>
      )}
    </header>
  )
}

// ── own profile body ───────────────────────────────────────────────────────

function OwnProfileBody() {
  const trackQ = useActiveStudyModeQuery()
  const activeTrack = trackQ.data?.activeTrack ?? 'general'

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <ErrorBoundary section="Pending invites">
          <PendingInvitesCard />
        </ErrorBoundary>
        <ActiveTrackCard track={activeTrack} />
        <ErrorBoundary section="AI-coach'и">
          <AITutorsCard />
        </ErrorBoundary>
        <ErrorBoundary section="Human-туторы">
          <HumanTutorsCard />
        </ErrorBoundary>
        <QuickLinksCard />
        <WeeklyReportCard />
      </div>
      {/* Stream D (2026-05-12) — tutor mode role toggle. Free, self-serve.
          On → unlocks /tutor in the AppShell nav. */}
      <TutorRoleToggle />
      {/* R8 prep + Phase A 2026-05-12: data backup/restore — gives юзеру
          portable backup пока backend persistence не подключен. */}
      <DataBackupCard />
    </div>
  )
}

function PublicProfileBody({ username }: { username: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface-1 p-6 text-[14px] text-text-secondary">
      Это публичная страница профиля @{username}. Полная статистика и подготовка
      доступны только владельцу.
    </div>
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
        {icon && <span className="text-text-secondary">{icon}</span>}
        <h2 className="font-display text-base font-bold leading-tight">{title}</h2>
      </header>
      {children}
    </section>
  )
}

function ActiveTrackCard({ track }: { track: ActiveTrack }) {
  const meta = TRACK_LABELS[track]
  return (
    <Card icon={<Target className="h-4 w-4" />} title="Активный режим подготовки">
      <div className="flex flex-col gap-2">
        <div>
          <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
            mode
          </span>
          <div className="font-display text-2xl font-bold leading-tight">{meta.label}</div>
        </div>
        <p className="text-[13px] leading-relaxed text-text-secondary">{meta.hint}</p>
        <p className="text-[12px] text-text-muted">
          Сменить можно в Hone или прямо в settings — это влияет на подсветку
          узлов в Atlas, фильтр TaskBoard и какой AI-coach по умолчанию подсажен
          к pill'ам на /atlas.
        </p>
      </div>
    </Card>
  )
}

function AITutorsCard() {
  const threadsQ = useMyAITutorThreadsQuery()
  const personasQ = useAITutorPersonasQuery()
  const personas: AITutorPersona[] = personasQ.data?.items ?? []
  const threads = threadsQ.data?.items ?? []
  const adopted = threads
    .map((t) => personas.find((p) => p.id === t.persona_id))
    .filter((p): p is AITutorPersona => Boolean(p))

  return (
    <Card icon={<Brain className="h-4 w-4" />} title="AI-coach'и">
      {threadsQ.isPending || personasQ.isPending ? (
        <div className="text-[12px] text-text-muted">загружаю…</div>
      ) : adopted.length === 0 ? (
        <div className="space-y-2">
          <p className="text-[13px] text-text-secondary">
            Ты ещё не подключил ни одного AI-coach'а. Они умеют отвечать с памятью
            твоих прошлых разговоров — не «ещё один чат», а персональный coach
            по треку.
          </p>
          <p className="text-[12px] text-text-muted">
            Подключаются автоматически при первом клике на coach-pill в Atlas
            или MockResult.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {adopted.map((p) => (
            <li
              key={p.id}
              className="flex items-center justify-between gap-3 rounded-md bg-surface-2 px-3 py-2"
            >
              <div className="min-w-0">
                <div className="truncate text-[13px] font-medium text-text-primary">
                  {p.display_name}
                </div>
                <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
                  {p.scope_track_kind}
                </div>
              </div>
              <Link
                to={`/tutor/ai/${encodeURIComponent(p.slug)}`}
                className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-secondary hover:text-text-primary"
              >
                открыть →
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function PendingInvitesCard() {
  const q = usePendingInvitesForMeQuery()
  const accept = useAcceptInviteMutation()
  const items = q.data?.items ?? []
  if (q.isPending || items.length === 0) return null
  return (
    <Card icon={<Sparkles className="h-4 w-4" />} title="Тебя пригласили" className="sm:col-span-2">
      <p className="text-[13px] text-text-secondary">
        Туторы хотят с тобой работать. После accept'а assignments будут попадать
        в Hone TaskBoard, а сессии — в Calendar.
      </p>
      <ul className="flex flex-col gap-2">
        {items.map((inv) => {
          const name = inv.tutor_display_name?.trim() || inv.tutor_username || inv.tutor_id.slice(0, 8)
          const initial = (inv.tutor_display_name || inv.tutor_username || '?').slice(0, 1).toUpperCase()
          return (
            <li
              key={inv.id}
              className="relative flex items-center gap-3 rounded-md border border-border-strong bg-surface-2/60 px-3 py-2"
            >
              <span
                aria-hidden="true"
                style={{
                  position: 'absolute',
                  left: 0,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  width: 1.5,
                  height: 24,
                  background: 'var(--red)',
                }}
              />
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface-2 text-[12px] font-bold text-text-primary">
                {inv.tutor_display_avatar ? (
                  <img src={inv.tutor_display_avatar} alt={name} className="h-full w-full rounded-full object-cover" />
                ) : (
                  initial
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium text-text-primary">{name}</div>
                {inv.tutor_username && (
                  <div className="font-mono text-[10px] text-text-muted">@{inv.tutor_username}</div>
                )}
                {inv.note && (
                  <div className="mt-0.5 truncate text-[11.5px] text-text-secondary">«{inv.note}»</div>
                )}
              </div>
              <Button
                size="sm"
                disabled={accept.isPending}
                onClick={() => {
                  accept.mutate(inv.code)
                }}
              >
                {accept.isPending ? '…' : 'Принять'}
              </Button>
            </li>
          )
        })}
      </ul>
      {accept.isError && (
        <span className="text-[12px]" style={{ color: 'var(--red)' }}>
          {accept.error instanceof ApiError ? accept.error.body : 'Не удалось принять'}
        </span>
      )}
    </Card>
  )
}

function HumanTutorsCard() {
  const tutorsQ = useMyTutorsQuery()
  const items = tutorsQ.data?.items ?? []
  // ListMyTutors включает AI-тутор-relationships (для adopted персон). Они
  // уже отдельно показаны в AITutorsCard — отфильтруем через username
  // префикс 'ai-tutor::'. Display-info прилетает с backend (proto.display_*).
  const humans = items.filter((r) => !(r.display_username ?? '').startsWith('ai-tutor::'))
  return (
    <Card title="Human-туторы">
      {tutorsQ.isPending ? (
        <div className="text-[12px] text-text-muted">загружаю…</div>
      ) : humans.length === 0 ? (
        <div className="space-y-2">
          <p className="text-[13px] text-text-secondary">
            У тебя пока нет связки с human-тутором. Получил invite-ссылку — открой
            её, чтобы accept'нуть relationship.
          </p>
          <p className="text-[12px] text-text-muted">
            После accept'а ассайнменты от тутора будут автоматически попадать в
            твой Hone TaskBoard, а сессии — в Calendar.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {humans.map((r) => {
            // Defensive: tutor_id might be undefined in stale cache rows;
            // fallback to '?' avoids the .slice() crash that previously
            // threw to ErrorBoundary.
            const tutorIdShort = (r.tutor_id ?? '').slice(0, 8) || '?'
            const name = r.display_name?.trim() || r.display_username || tutorIdShort
            const username = r.display_username ?? ''
            const initial = ((r.display_name || r.display_username || '?') || '?').slice(0, 1).toUpperCase()
            return (
              <li
                key={r.id}
                className="flex items-center gap-3 rounded-md bg-surface-2 px-3 py-2"
              >
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface-2 text-[12px] font-bold text-text-primary">
                  {r.display_avatar_url ? (
                    <img
                      src={r.display_avatar_url}
                      alt={name}
                      className="h-full w-full rounded-full object-cover"
                    />
                  ) : (
                    initial
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium text-text-primary">{name}</div>
                  {username && (
                    <div className="font-mono text-[10px] text-text-muted">@{username}</div>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}

function QuickLinksCard() {
  const links: { to: string; label: string; hint: string; icon: React.ReactNode }[] = [
    {
      to: '/mock',
      label: 'Mock-собес',
      hint: 'Взять mock с AI-интервьюером по выбранной компании.',
      icon: <Sparkles className="h-4 w-4" />,
    },
    {
      to: '/tasks',
      label: 'TaskBoard',
      hint: 'Assignments от тутора + AI-coach + ручные.',
      icon: <ListChecks className="h-4 w-4" />,
    },
    {
      to: '/atlas',
      label: 'Atlas',
      hint: 'Карта тем для подготовки + прогресс.',
      icon: <MapIcon className="h-4 w-4" />,
    },
    {
      to: '/codex',
      label: 'Codex',
      hint: 'Curated reading library.',
      icon: <BookOpen className="h-4 w-4" />,
    },
  ]
  return (
    <Card title="Куда дальше" className="sm:col-span-2">
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {links.map((l) => (
          <li key={l.to}>
            <Link
              to={l.to}
              style={{
                transition:
                  'background-color var(--motion-dur-small) var(--motion-ease-standard)',
              }}
              className="group flex items-start gap-3 rounded-md border border-border bg-surface-2 px-3 py-2.5 hover:bg-surface-2/80"
            >
              <span className="mt-0.5 text-text-secondary group-hover:text-text-primary">{l.icon}</span>
              <span className="flex-1">
                <span className="block text-[13px] font-medium text-text-primary">{l.label}</span>
                <span className="block text-[11.5px] text-text-muted">{l.hint}</span>
              </span>
              <ArrowRight className="mt-1 h-3.5 w-3.5 text-text-muted group-hover:text-text-primary" />
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  )
}

function WeeklyReportCard() {
  return (
    <Card title="Weekly report" className="sm:col-span-2">
      <p className="text-[13px] leading-relaxed text-text-secondary">
        Сводка за неделю — focus минуты, mock'и, weak spots, прогресс по треку.
        Для долгосрочной траектории.
      </p>
      <Link to="/profile/weekly">
        <Button variant="ghost" size="sm" iconRight={<ArrowRight className="h-3.5 w-3.5" />}>
          Открыть Weekly
        </Button>
      </Link>
    </Card>
  )
}

// ── helpers ────────────────────────────────────────────────────────────────

function formatMonthYear(iso: string): string | null {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })
}
