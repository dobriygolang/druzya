// MobileBottomNav — fixed bottom-bar with 4 tabs + central FAB for the
// «launch ranked match» CTA (Wave-10, design-review v5).
//
// Replaces the hamburger-slide-over anti-pattern on phones. Native
// users (iOS / Android) expect a bottom-bar — Instagram, Twitter,
// Telegram, etc. — so this is the conventional shape, not a custom
// metaphor we have to teach.
//
// Layout: 5 columns. Left two = tabs 0-1, centre = FAB slot, right two
// = tabs 2-3. The FAB visually overflows the bar by -32px (y), so its
// drop-shadow ring (4px solid bg) cuts a hole back into the bar — a
// well-known Material/Apple bottom-bar trick.
//
// Hide-rules (HIDE_ON regex list):
//   /arena/match/{id}        — live editor needs the full screen
//   /onboarding/*            — guided flow shouldn't have escape hatches
//   /voice-mock/*            — mic active, tap by mistake breaks the call
//   /auth/* / /login         — unauth user, tabs go nowhere
// Default: show.
//
// Safe-area: paddingBottom uses env(safe-area-inset-bottom) so the bar
// stays above the iPhone home indicator.

import { Home, Map as MapIcon, User, Play, Loader2 } from 'lucide-react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../lib/cn'

const TABS = [
  { to: '/arena', icon: Home, label: 'home' },
  { to: '/atlas', icon: MapIcon, label: 'atlas' },
  { to: '/profile', icon: User, label: 'profile' },
] as const

// Order matters — we use prefix match. Add new immersive routes here
// rather than negating in JSX (less likely to drift).
const HIDE_ON: RegExp[] = [
  /^\/arena\/match\/[^/]+$/, // live editor (NOT /end which keeps the bar)
  /^\/onboarding(\/|$)/,
  /^\/voice-mock(\/|$)/,
  /^\/auth(\/|$)/,
  /^\/login$/,
  /^\/welcome(\/|$)/,
  /^\/match\/[^/]+\/end$/, // emotion-peak owns the chrome
]

export type MobileBottomNavProps = {
  /** Show text labels under each icon. Off-by-default for narrow (≤414)
   *  screens where space is tight. */
  showLabels?: boolean
  /** Notification badge on the Profile tab. Default 0. */
  unreadCount?: number
}

// Matchmaking status — minimal placeholder until a real useMatchmaker
// hook lands. The FAB tap navigates to /arena where the existing match-
// finding UI takes over; matchmaking-while-idle UX (countdown, cancel)
// is a follow-up wire when the hook ships.
type MmStatus = 'idle' | 'matchmaking'

export function MobileBottomNav({ showLabels = false, unreadCount = 0 }: MobileBottomNavProps) {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const { t } = useTranslation('wave10')
  const [status, setStatus] = useState<MmStatus>('idle')
  const [elapsed, setElapsed] = useState(0)

  // Local elapsed counter — until useMatchmaker exists, the FAB plays a
  // 3-second visual loading state then navigates. Honest: this is a UX
  // affordance, not a real matchmaking call.
  useEffect(() => {
    if (status !== 'matchmaking') {
      setElapsed(0)
      return
    }
    const id = window.setInterval(() => setElapsed((s) => s + 1), 1000)
    return () => window.clearInterval(id)
  }, [status])

  if (HIDE_ON.some((re) => re.test(pathname))) return null

  const onFab = () => {
    if ('vibrate' in navigator) {
      try {
        navigator.vibrate(12)
      } catch {
        /* permissions denied — ignore */
      }
    }
    if (status === 'matchmaking') {
      setStatus('idle')
      return
    }
    setStatus('matchmaking')
    // Defer route change so the spinner has a frame to render.
    window.setTimeout(() => {
      setStatus('idle')
      navigate('/arena?launch=1')
    }, 1200)
  }

  return (
    <nav
      role="navigation"
      aria-label="Mobile bottom navigation"
      className={cn(
        'fixed inset-x-0 bottom-0 z-40 border-t border-border bg-bg/95 backdrop-blur',
        'supports-[backdrop-filter]:bg-bg/80',
        // Visible only on narrow viewports — desktop has its own header nav.
        'sm:hidden',
      )}
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      {/* FAB — overflows up so its bg-shadow ring cuts a clean hole */}
      <div className="absolute left-1/2 -top-8 -translate-x-1/2">
        <FabButton
          status={status}
          elapsed={elapsed}
          onClick={onFab}
          ariaIdle={t('mobileNav.matchAria')}
          ariaMm={(time) => t('mobileNav.matchmakingAria', { time })}
        />
      </div>

      {/* Phase-2: dropped the redundant Sanctum tab. Layout is now
          [home] [atlas] [FAB] [profile] across a 5-col grid (one column
          left blank to keep the FAB visually centered). */}
      <div className="grid grid-cols-5 items-center pt-2 pb-1.5">
        {TABS.slice(0, 2).map((t) => (
          <Tab key={t.to} {...t} showLabels={showLabels} />
        ))}
        {/* Centre column reserved for the FAB. */}
        <div aria-hidden="true" className={cn('flex justify-center', showLabels && 'pt-4')}>
          {showLabels && (
            <span className="font-mono text-[9px] uppercase tracking-wider text-text-muted">{t('mobileNav.match')}</span>
          )}
        </div>
        <div aria-hidden="true" />
        <Tab {...TABS[2]} showLabels={showLabels} badge={unreadCount} unreadAria={t('mobileNav.unread', { count: unreadCount })} />
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
      end={to === '/arena'}
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
                isActive ? 'bg-text-primary-hover' : 'bg-transparent',
              )}
              aria-hidden="true"
            />
          )}
        </>
      )}
    </NavLink>
  )
}

function FabButton({
  status,
  elapsed,
  onClick,
  ariaIdle,
  ariaMm,
}: {
  status: MmStatus
  elapsed: number
  onClick: () => void
  ariaIdle: string
  ariaMm: (time: string) => string
}) {
  const mm = status === 'matchmaking'
  const mmss = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={mm ? ariaMm(mmss) : ariaIdle}
      className={cn(
        'grid h-16 w-16 place-items-center rounded-full select-none transition-all duration-200',
        'shadow-[0_0_0_4px_rgb(var(--color-bg))]',
        'active:scale-[0.93]',
        mm
          ? 'bg-gradient-to-br from-cyan to-accent shadow-[0_10px_30px_rgba(34,211,238,0.45),0_0_0_4px_rgb(var(--color-bg))]'
          : 'bg-surface-2 border border-border-strong shadow-[0_10px_30px_rgba(88,44,255,0.5),0_0_0_4px_rgb(var(--color-bg))]',
      )}
    >
      {mm ? (
        <span className="relative grid place-items-center">
          <Loader2 className="absolute h-10 w-10 animate-spin text-white/90" strokeWidth={2} />
          <span className="relative font-mono text-[10px] font-bold tabular-nums text-white">{mmss}</span>
        </span>
      ) : (
        <Play className="h-7 w-7 fill-white text-white" />
      )}
    </button>
  )
}
