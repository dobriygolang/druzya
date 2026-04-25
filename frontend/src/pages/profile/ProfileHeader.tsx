import { Share2, UserPlus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Button } from '../../components/Button'
import { cn } from '../../lib/cn'
import { useRatingMeQuery } from '../../lib/queries/rating'
import { useStreakQuery } from '../../lib/queries/daily'
import {
  PROFILE_TABS_OWN,
  PROFILE_TABS_PUBLIC,
  type ProfileTab,
  type ProfileViewModel,
} from './viewModel'

export function Hero({ vm }: { vm: ProfileViewModel }) {
  const { t } = useTranslation('profile')
  const { data: rating } = useRatingMeQuery()
  const { data: streak } = useStreakQuery()
  const algo = rating?.ratings?.find((r) => r.section === 'algorithms')
  const matches = algo?.matches_count ?? 0
  const streakCur = streak?.current ?? 0
  return (
    <div
      className="relative flex flex-col items-start justify-between gap-5 border-b border-border bg-surface-1 px-4 py-6 sm:px-8 lg:flex-row lg:items-center lg:gap-0 lg:px-10 lg:py-0"
      style={{ minHeight: 220 }}
    >
      <div className="flex flex-col items-start gap-5 sm:flex-row sm:items-center sm:gap-6">
        <div
          className="grid shrink-0 place-items-center rounded-full bg-surface-2 font-display text-4xl font-extrabold text-text-primary ring-1 ring-border-strong"
          style={{ width: 96, height: 96 }}
          aria-label="avatar"
        >
          {vm.initial}
        </div>
        <div className="flex flex-col gap-2">
          <h1 className="font-display text-3xl font-bold leading-none text-text-primary sm:text-4xl lg:text-[38px]">@{vm.username}</h1>
          <p className="text-sm text-text-secondary">{t('since', { display: vm.display })}</p>
          <div className="mt-2 flex flex-wrap items-center gap-4 lg:gap-6">
            <HeroStat label={t('rank')} value={vm.title} sub={`Lv ${vm.level}`} />
            <HeroStat label={t('gps')} value={`${vm.globalPowerScore}`} sub={t('matches', { count: matches })} />
            {vm.isOwn && <HeroStat label={t('streak')} value={`${streakCur} 🔥`} sub={t('days')} />}
            <HeroStat label={t('class')} value={vm.charClass} sub={vm.careerStage} />
          </div>
        </div>
      </div>
      <div className="flex w-full flex-row gap-2 lg:w-auto lg:flex-col">
        <Button variant="ghost" icon={<Share2 className="h-4 w-4" />}>
          {t('share')}
        </Button>
        {!vm.isOwn && (
          <Button variant="primary" icon={<UserPlus className="h-4 w-4" />}>
            {t('add_friend')}
          </Button>
        )}
      </div>
    </div>
  )
}

function HeroStat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="flex flex-col">
      <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-muted">{label}</span>
      <span className="font-display text-base font-bold text-text-primary">{value}</span>
      <span className="font-mono text-[11px] text-text-secondary">{sub}</span>
    </div>
  )
}

export function ProfileTabBar({ tab, setTab, isOwn }: { tab: ProfileTab; setTab: (t: ProfileTab) => void; isOwn: boolean }) {
  const { t: tt } = useTranslation('profile')
  const tabKey: Record<ProfileTab, string> = {
    Overview: 'tabs.overview',
    Matches: 'tabs.matches',
    Achievements: 'tabs.achievements',
    Cohorts: 'tabs.cohorts',
    Stats: 'tabs.stats',
    Bookings: 'tabs.bookings',
  }
  const tabs = isOwn ? PROFILE_TABS_OWN : PROFILE_TABS_PUBLIC
  return (
    <div className="flex h-[56px] items-center gap-1 overflow-x-auto border-b border-border bg-bg px-4 sm:px-8 lg:px-10">
      {tabs.map((tname) => {
        const active = tab === tname
        return (
          <button
            key={tname}
            onClick={() => setTab(tname)}
            className={cn(
              'relative h-full px-4 text-sm font-semibold transition-colors',
              active
                ? 'bg-surface-2 text-text-primary after:absolute after:inset-x-3 after:bottom-0 after:h-px after:bg-text-primary'
                : 'text-text-secondary hover:text-text-primary',
            )}
          >
            {tt(tabKey[tname])}
          </button>
        )
      })}
      {/* WAVE-13 — Weekly is a sibling page (/profile/weekly) rather than an
          in-state tab, but lives in the same tab strip for IA consistency.
          Rendering it as a <Link> so React Router handles the navigation
          while it visually matches the other tabs. */}
      {isOwn && (
        <Link
          to="/profile/weekly"
          className="relative h-full px-4 text-sm font-semibold text-text-secondary transition-colors hover:text-text-primary inline-flex items-center"
        >
          Weekly
        </Link>
      )}
    </div>
  )
}
