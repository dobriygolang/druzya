import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams, Link } from 'react-router-dom'
import { AppShellV2 } from '../../components/AppShell'
import { Button } from '../../components/Button'
import {
  useProfileQuery,
  usePublicProfileQuery,
  type Profile,
  type PublicProfile,
} from '../../lib/queries/profile'
import { useRatingMeQuery } from '../../lib/queries/rating'
import { ApiError } from '../../lib/apiClient'
import { Hero, ProfileTabBar } from './ProfileHeader'
import {
  AchievementsCard,
  CohortCard,
  Leaderboard,
  SkillsCard,
} from './ProfileOverview'
import {
  AchievementsPanel,
  CohortsPanel,
  MatchesPanel,
  StatsPanel,
} from './ProfilePanels'
import { BookingsPanel } from './BookingsPanel'
import { toViewModel, type ProfileTab } from './viewModel'

// ── states ─────────────────────────────────────────────────────────────────

function ProfileSkeleton() {
  return (
    <AppShellV2>
      <div
        className="px-4 py-6 sm:px-8 lg:px-10"
        style={{ minHeight: 220, background: 'linear-gradient(135deg, #582CFF 0%, #F472B6 50%, #22D3EE 100%)' }}
        aria-busy="true"
        aria-label="loading profile"
      >
        <div className="h-24 w-24 animate-pulse rounded-full bg-white/20" />
        <div className="mt-4 h-6 w-40 animate-pulse rounded bg-white/20" />
        <div className="mt-2 h-4 w-64 animate-pulse rounded bg-white/15" />
      </div>
      <div className="flex flex-col gap-6 px-4 py-6 sm:px-8 lg:flex-row lg:px-10 lg:py-8">
        <div className="h-72 w-full animate-pulse rounded-xl bg-surface-2 lg:w-[380px]" />
        <div className="h-72 flex-1 animate-pulse rounded-xl bg-surface-2" />
      </div>
    </AppShellV2>
  )
}

function ProfileError({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation('profile')
  return (
    <AppShellV2>
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-4 p-8">
        <h2 className="font-display text-xl font-bold text-text-primary">
          {t('error_title')}
        </h2>
        <p className="max-w-md text-center text-sm text-text-secondary">{t('load_failed')}</p>
        <Button variant="primary" onClick={onRetry}>
          {t('retry')}
        </Button>
      </div>
    </AppShellV2>
  )
}

function ProfileNotFound({ username }: { username: string }) {
  const { t } = useTranslation('profile')
  return (
    <AppShellV2>
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-4 p-8">
        <h2 className="font-display text-xl font-bold text-text-primary">
          {t('not_found_title')}
        </h2>
        <p className="max-w-md text-center text-sm text-text-secondary">@{username}</p>
        <Link to="/sanctum">
          <Button variant="primary">{t('back_to_sanctum')}</Button>
        </Link>
      </div>
    </AppShellV2>
  )
}

// ── page ───────────────────────────────────────────────────────────────────

export default function ProfilePage() {
  const params = useParams<{ username?: string }>()
  const isOwn = !params.username
  const [tab, setTab] = useState<ProfileTab>('Overview')

  const ownQuery = useProfileQuery()
  const publicQuery = usePublicProfileQuery(isOwn ? undefined : params.username)
  const { data: rating } = useRatingMeQuery()

  const active = isOwn ? ownQuery : publicQuery

  if (active.isLoading) return <ProfileSkeleton />
  if (active.isError) {
    const status = (active.error as ApiError | null)?.status
    if (!isOwn && status === 404) {
      return <ProfileNotFound username={params.username ?? ''} />
    }
    return <ProfileError onRetry={() => active.refetch()} />
  }

  const vm = toViewModel({
    isOwn,
    own: isOwn ? (ownQuery.data as Profile | undefined) : undefined,
    pub: !isOwn ? (publicQuery.data as PublicProfile | undefined) : undefined,
    fallbackScore: rating?.global_power_score,
  })
  if (!vm) return <ProfileSkeleton />

  return (
    <AppShellV2>
      <Hero vm={vm} />
      <ProfileTabBar tab={tab} setTab={setTab} isOwn={isOwn} />
      <div className="px-4 py-6 sm:px-8 lg:px-10 lg:py-8">
        {tab === 'Overview' && (
          <div className="flex flex-col gap-6 lg:flex-row">
            <div className="flex w-full shrink-0 flex-col gap-5 lg:w-[380px]">
              <SkillsCard />
              {isOwn && <AchievementsCard />}
              <CohortCard />
            </div>
            <div className="flex min-w-0 flex-1 flex-col">
              <Leaderboard />
            </div>
          </div>
        )}
        {tab === 'Matches' && <MatchesPanel />}
        {tab === 'Achievements' && <AchievementsPanel />}
        {tab === 'Cohorts' && <CohortsPanel />}
        {tab === 'Stats' && <StatsPanel ownProfile={isOwn ? (ownQuery.data as Profile | undefined) : undefined} />}
        {tab === 'Bookings' && isOwn && <BookingsPanel />}
      </div>
    </AppShellV2>
  )
}
