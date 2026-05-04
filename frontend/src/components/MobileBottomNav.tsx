// MobileBottomNav — fixed bottom-bar with 3 tabs (atlas / tasks /
// profile). Replaces hamburger-slide-over anti-pattern on phones. Pivot
// 2026-05-01 убрал FAB и arena-related tabs.
//
// Hide-rules (HIDE_ON regex list):
//   /onboarding/*  — guided flow shouldn't have escape hatches
//   /voice-mock/*  — mic active, tap by mistake breaks the call
//   /auth/* /login /welcome — unauth user, tabs go nowhere
//   /mock/{id}     — immersive session
// Default: show.
//
// Safe-area: paddingBottom uses env(safe-area-inset-bottom) so the bar
// stays above the iPhone home indicator.

import { Home, Map as MapIcon, User } from 'lucide-react'
import { NavLink, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { cn } from '../lib/cn'

// Pivot 2026-05-01: arena выпилен. Home → /atlas (главный landing для
// авторизованного юзера, см RootRedirect в App.tsx). Insights / Tasks
// добавлены на mobile навигацию вместо отсутствующего «home».
const TABS = [
  { to: '/atlas', icon: MapIcon, label: 'atlas' },
  { to: '/tasks', icon: Home, label: 'tasks' },
  { to: '/profile', icon: User, label: 'profile' },
] as const

// Order matters — we use prefix match. Add new immersive routes here
// rather than negating in JSX (less likely to drift).
const HIDE_ON: RegExp[] = [
  /^\/onboarding(\/|$)/,
  /^\/voice-mock(\/|$)/,
  /^\/auth(\/|$)/,
  /^\/login$/,
  /^\/welcome(\/|$)/,
  /^\/mock\/[^/]+/, // mock session pages — immersive
]

export type MobileBottomNavProps = {
  /** Show text labels under each icon. Off-by-default for narrow (≤414)
   *  screens where space is tight. */
  showLabels?: boolean
  /** Notification badge on the Profile tab. Default 0. */
  unreadCount?: number
}

export function MobileBottomNav({ showLabels = false, unreadCount = 0 }: MobileBottomNavProps) {
  const { pathname } = useLocation()
  const { t } = useTranslation('wave10')

  if (HIDE_ON.some((re) => re.test(pathname))) return null

  return (
    <nav
      role="navigation"
      aria-label="Mobile bottom navigation"
      className={cn(
        'fixed inset-x-0 bottom-0 z-40 border-t border-border bg-bg/95 backdrop-blur',
        'supports-[backdrop-filter]:bg-bg/80',
        'sm:hidden',
      )}
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      {/* Pivot 2026-05-01: arena/matchmaking-FAB выпилен. Простой 3-tab
          layout: atlas / tasks / profile. */}
      <div className="grid grid-cols-3 items-center pt-2 pb-1.5">
        <Tab {...TABS[0]} showLabels={showLabels} />
        <Tab {...TABS[1]} showLabels={showLabels} />
        <Tab
          {...TABS[2]}
          showLabels={showLabels}
          badge={unreadCount}
          unreadAria={t('mobileNav.unread', { count: unreadCount })}
        />
      </div>
    </nav>
  )
}

function Tab({
  to,
  icon: Icon,
  label,
  showLabels,
  badge,
  unreadAria,
}: {
  to: string
  icon: typeof Home
  label: string
  showLabels?: boolean
  badge?: number
  unreadAria?: string
}) {
  return (
    <NavLink
      to={to}
      end={to === '/atlas'}
      onClick={() => {
        if ('vibrate' in navigator) {
          try {
            navigator.vibrate(8)
          } catch {
            /* noop */
          }
        }
      }}
      className={({ isActive }) =>
        cn(
          'relative flex flex-col items-center gap-0.5 py-1 select-none transition-transform duration-[120ms]',
          'active:scale-[0.92]',
          isActive ? 'text-text-primary' : 'text-text-muted',
        )
      }
    >
      {({ isActive }) => (
        <>
          <div className="relative">
            <Icon className={showLabels ? 'h-6 w-6' : 'h-[22px] w-[22px]'} strokeWidth={2} />
            {!!badge && (
              <span
                className={cn(
                  'absolute -top-1 -right-2 grid place-items-center rounded-full bg-danger',
                  'font-mono font-bold text-white ring-2 ring-bg tabular-nums',
                  'h-[15px] min-w-[15px] px-1 text-[8px]',
                )}
                aria-label={unreadAria ?? String(badge)}
              >
                {badge > 99 ? '99+' : badge}
              </span>
            )}
          </div>
          {showLabels ? (
            <span
              className={cn(
                'font-mono text-[9px] uppercase tracking-wider',
                isActive && 'font-semibold',
              )}
            >
              {label}
            </span>
          ) : (
            <span
              className={cn(
                'h-1 w-1 rounded-full',
                isActive ? 'bg-text-primary' : 'bg-transparent',
              )}
              aria-hidden="true"
            />
          )}
        </>
      )}
    </NavLink>
  )
}

