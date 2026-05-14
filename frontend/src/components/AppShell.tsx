import { ReactNode, useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Bell, Menu, Search, X, Languages, User, LogOut, Settings, HelpCircle, Shield } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { MobileBottomNav } from './MobileBottomNav'
import { Palette } from './Palette'
import { QuickLogModal } from './QuickLogModal'
import { Avatar } from './Avatar'
import { DegradedBanner } from './global-error/DegradedBanner'
import { NotificationsBell } from './notifications/NotificationsBell'
import { NotificationsDrawer } from './notifications/NotificationsDrawer'
import { cn } from '../lib/cn'
import { changeLanguage, currentLanguage, LANG_LIST, type Lang } from '../lib/i18n'
import { useAdminDashboardQuery } from '../lib/queries/admin'
import { useUnreadCountQuery } from '../lib/queries/notifications'
import { useProfileQuery, useUpdateSettingsMutation } from '../lib/queries/profile'
import { useActiveStudyModeQuery } from '../lib/queries/honeSettings'
import { logoutCurrentSession } from '../lib/queries/auth'
import { SkipToContent } from './a11y/SkipToContent'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { useMotion } from '../lib/motion-presets'

// Главная навигация — только 6 ключевых разделов. Остальное (Друзья, Помощь,
// Настройки, Выход) уехало в user-menu под аватаром, чтобы header не был
// перегружен (раньше было 8 nav-items + 5 кнопок справа = 13 элементов).
//
// Это совпадает с identity.md: tutor mode — role toggle, не отдельное
// приложение, не paywall.
function useNavItems() {
  const profile = useProfileQuery()
  const settings = useActiveStudyModeQuery()
  const isTutor = Boolean(profile.data?.tutor_mode_enabled)
  const isEnglishActive = Boolean(settings.data?.englishActive)
  const base = [
    { to: '/today', label: 'Today' },
    { to: '/atlas', label: 'Atlas' },
    { to: '/mock', label: 'Mock' },
    { to: '/insights', label: 'Insights' },
    ...(isTutor ? [{ to: '/tutor', label: 'Tutor' }] : []),
    { to: '/codex', label: 'Codex' },
    ...(isEnglishActive ? [{ to: '/lingua', label: 'Lingua' }] : []),
  ]
  return base
}

function Logo() {
  return (
    <Link to="/today" className="flex items-center gap-2.5">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-surface-2 border border-border-strong font-display text-lg font-extrabold text-text-primary">
        9
      </span>
      <span className="font-display text-lg font-bold text-text-primary">druz9</span>
    </Link>
  )
}

function NavItem({ to, label, onClick }: { to: string; label: string; onClick?: () => void }) {
  const { pathname } = useLocation()
  const reduced = useReducedMotion()
  const active = pathname === to || pathname.startsWith(`${to}/`)
  return (
    <motion.div
      whileHover={reduced ? undefined : { scale: 1.02 }}
      whileTap={reduced ? undefined : { scale: 0.98 }}
    >
      <Link
        to={to}
        onClick={onClick}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'block rounded-md px-3.5 py-2 text-sm transition-colors',
          active
            ? 'bg-surface-2 font-semibold text-text-primary'
            : 'font-medium text-text-secondary hover:bg-surface-2 hover:text-text-primary',
        )}
      >
        {label}
      </Link>
    </motion.div>
  )
}


// LanguageToggleButton — dropdown RU/EN (только эти две локали в проекте,
// Phase K Wave 16 removed legacy KZ/UA). Выбор персистится в localStorage
// внутри changeLanguage → languageChanged listener в lib/i18n.ts + пишется
// в backend через useUpdateSettingsMutation. Закрытие по клику снаружи и по Escape.
function LanguageToggleButton() {
  const [, setTick] = useState(0)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const lang = currentLanguage()
  const updateSettings = useUpdateSettingsMutation()
  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  const pick = (next: Lang) => {
    if (next === lang) {
      setOpen(false)
      return
    }
    // Switch i18next immediately, then write users.locale so LLM (coach /
    // mock / copilot) answers in the same language on the next call.
    void changeLanguage(next).then(() => {
      setTick((x) => x + 1)
      setOpen(false)
    })
    updateSettings.mutate({ locale: next })
  }
  const current = LANG_LIST.find((l) => l.code === lang) ?? LANG_LIST[0]
  return (
    <div ref={ref} className="relative hidden sm:block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-9 items-center gap-1.5 rounded-md px-2.5 text-text-secondary hover:bg-surface-2"
        aria-label="Select language"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Select language"
      >
        <Languages className="h-4 w-4" />
        <span className="text-base leading-none">{current.flag}</span>
        <span className="font-mono text-[12px] font-semibold uppercase">{current.code}</span>
      </button>
      {open && (
        <div
          className="absolute right-0 top-full z-50 mt-2 flex w-44 flex-col rounded-lg border border-border bg-surface-1 p-1.5 shadow-card"
          role="menu"
        >
          {LANG_LIST.map((opt) => {
            const active = opt.code === lang
            return (
              <button
                key={opt.code}
                type="button"
                onClick={() => pick(opt.code)}
                role="menuitem"
                className={cn(
                  'flex items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm transition-colors',
                  active
                    ? 'bg-surface-2 font-semibold text-text-primary'
                    : 'text-text-secondary hover:bg-surface-2 hover:text-text-primary',
                )}
              >
                <span className="text-base leading-none">{opt.flag}</span>
                <span className="flex-1 truncate">{opt.label}</span>
                <span className="font-mono text-[10px] uppercase opacity-60">{opt.code}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// UserMenu — выпадающее меню под аватаром: профиль, настройки, друзья,
// уведомления, помощь, админка (если роль admin), выход. Раньше эти
// разделы лежали в основном nav и захламляли его.
function UserMenu({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation('common')
  const navigate = useNavigate()
  // Admin-gate: пробим /admin/dashboard — если backend вернул 403, юзер не
  // админ → скрываем пункт. Запрос кэшируется TanStack-ом (см. adminQueryKeys
  // + ADMIN_DASHBOARD_STALE_MS), поэтому один fetch за сессию на всех, кто
  // открывает меню. На 401 apiClient уже редиректит на /welcome, сюда не
  // дойдём. Остальные ошибки трактуем как «не админ» (fail-closed для UI).
  const admin = useAdminDashboardQuery()
  const adminStatus = (admin.error as { status?: number } | null)?.status
  const isAdmin = !admin.isError && admin.isSuccess && adminStatus !== 403
  // User-menu (under avatar) — персональные разделы вне top-nav.
  const items: { to: string; label: string; icon: typeof User; badge?: 'new' }[] = [
    { to: '/profile', label: t('nav.profile'), icon: User },
    { to: '/settings', label: t('nav.settings'), icon: Settings },
    { to: '/notifications', label: t('nav.notifications'), icon: Bell },
    { to: '/help', label: t('nav.help'), icon: HelpCircle },
    ...(isAdmin ? [{ to: '/admin', label: t('nav.admin'), icon: Shield }] : []),
  ]
  function handleLogout() {
    // Best-effort server-side revocation. Failures are swallowed inside
    // logoutCurrentSession (network down, refresh token already gone) — what
    // matters is that local tokens get cleared and the user lands on /welcome.
    void logoutCurrentSession().finally(() => {
      onClose()
      navigate('/welcome')
    })
  }
  return (
    <div
      className="absolute right-0 top-full z-50 mt-2 flex w-56 flex-col rounded-lg border border-border bg-surface-1 p-1.5 shadow-card"
      role="menu"
    >
      {items.map((it) => (
        <Link
          key={it.to}
          to={it.to}
          onClick={onClose}
          className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary"
          role="menuitem"
        >
          <it.icon className="h-4 w-4 shrink-0" />
          <span className="flex-1 truncate">{it.label}</span>
          {it.badge === 'new' && (
            <span
              className="rounded-md px-1.5 py-0.5 font-mono text-[9px] font-bold tracking-wider text-white"
              style={{ background: '#FF3B30' }}
            >
              NEW
            </span>
          )}
        </Link>
      ))}
      <div className="my-1 border-t border-border" />
      <button
        type="button"
        onClick={handleLogout}
        className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary"
        role="menuitem"
      >
        <LogOut className="h-4 w-4 shrink-0" />
        <span>{t('nav.logout')}</span>
      </button>
    </div>
  )
}

function TopNav({ onOpenNotifications, unreadCount, onOpenPalette }: {
  onOpenNotifications: () => void
  unreadCount: number
  onOpenPalette: () => void
}) {
  const { t } = useTranslation('common')
  const NAV_ITEMS = useNavItems()
  const [menuOpen, setMenuOpen] = useState(false)
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const userMenuRef = useRef<HTMLDivElement>(null)
  const menuTrapRef = useFocusTrap(menuOpen)

  // Закрываем user-menu по клику снаружи.
  useEffect(() => {
    if (!userMenuOpen) return
    const onClick = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [userMenuOpen])

  return (
    <header className="sticky top-0 z-40 flex h-[64px] items-center justify-between border-b border-border bg-bg px-4 sm:px-6 lg:h-[72px] lg:px-8">
      <div className="flex min-w-0 items-center gap-4 lg:gap-8">
        <Logo />
        <nav className="hidden items-center gap-1 lg:flex">
          {NAV_ITEMS.map((item) => (
            <NavItem key={item.to} {...item} />
          ))}
        </nav>
      </div>
      <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
        <button
          type="button"
          onClick={onOpenPalette}
          className="hidden h-9 w-[240px] items-center gap-2 rounded-md border border-border bg-surface-2 px-3 text-left transition-colors hover:border-border-strong lg:flex"
          aria-label={t('labels.search_placeholder')}
          title="⌘K"
        >
          <Search className="h-4 w-4 shrink-0 text-text-muted" />
          <span className="flex-1 truncate font-sans text-[13px] text-text-muted">
            {t('labels.search_placeholder')}
          </span>
          <span className="font-mono text-[10px] text-text-muted">⌘K</span>
        </button>
        <button
          type="button"
          onClick={onOpenPalette}
          className="grid h-9 w-9 place-items-center rounded-md text-text-secondary hover:bg-surface-2 lg:hidden"
          aria-label="Open command palette"
        >
          <Search className="h-5 w-5" />
        </button>
        {/* Light theme killed CI4 2026-05-11 + finalised Phase J 2026-05-12
            (B/W only forever — see memory/feedback_color_rule.md).
            ThemeToggleButton removed from header — dark-only across surfaces. */}
        <LanguageToggleButton />
        <NotificationsBell unreadCount={unreadCount} onClick={onOpenNotifications} />
        {/* Avatar + dropdown — кликабельный, открывает user-menu */}
        <div ref={userMenuRef} className="relative">
          <button
            type="button"
            onClick={() => setUserMenuOpen((v) => !v)}
            className="grid h-9 w-9 place-items-center rounded-full transition hover:ring-2 hover:ring-text-primary/40/40"
            aria-label="User menu"
            aria-expanded={userMenuOpen}
          >
            <Avatar size="md" gradient="pink-violet" initials={t('user_menu.avatar_initials', { defaultValue: 'D' })} />
          </button>
          {userMenuOpen && <UserMenu onClose={() => setUserMenuOpen(false)} />}
        </div>
        <button
          type="button"
          className="grid h-9 w-9 place-items-center rounded-md text-text-secondary hover:bg-surface-2 lg:hidden"
          aria-label="Menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(true)}
        >
          <Menu className="h-5 w-5" />
        </button>
      </div>
      {menuOpen && (
        <div ref={menuTrapRef} className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setMenuOpen(false)}
          />
          <div className="absolute right-0 top-0 flex h-full w-[280px] flex-col gap-2 border-l border-border bg-surface-1 p-4">
            <div className="mb-2 flex items-center justify-between">
              <Logo />
              <button
                type="button"
                className="grid h-9 w-9 place-items-center rounded-md text-text-secondary hover:bg-surface-2"
                aria-label="Close menu"
                onClick={() => setMenuOpen(false)}
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <nav className="flex flex-col gap-1">
              {NAV_ITEMS.map((item) => (
                <NavItem key={item.to} {...item} onClick={() => setMenuOpen(false)} />
              ))}
              <div className="my-2 border-t border-border" />
              <NavItem to="/profile" label={t('nav.profile')} onClick={() => setMenuOpen(false)} />
              <NavItem to="/settings" label={t('nav.settings')} onClick={() => setMenuOpen(false)} />
              <NavItem to="/notifications" label={t('nav.notifications')} onClick={() => setMenuOpen(false)} />
              <NavItem to="/help" label={t('nav.help')} onClick={() => setMenuOpen(false)} />
            </nav>
          </div>
        </div>
      )}
    </header>
  )
}

// SessionExpiredToast — крошечный inline-тост, реагирующий на событие
// `druz9:session-expired`, которое эмитит apiClient после неуспешного refresh.
// Показывается короткое время и поверх редиректа (на случай, если редирект
// тормозит из-за in-flight нав-перехода).
function SessionExpiredToast() {
  const { t } = useTranslation('auth')
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    function onExpired() {
      setVisible(true)
      window.setTimeout(() => setVisible(false), 4000)
    }
    window.addEventListener('druz9:session-expired', onExpired as EventListener)
    return () => window.removeEventListener('druz9:session-expired', onExpired as EventListener)
  }, [])
  if (!visible) return null
  return (
    <div
      role="status"
      className="fixed left-1/2 top-4 z-[60] -translate-x-1/2 rounded-lg border border-warn/60 bg-surface-1 px-4 py-2 text-sm text-text-primary shadow-card"
    >
      {t('error.session_expired')}
    </div>
  )
}

export function AppShellV2({ children }: { children: ReactNode }) {
  const location = useLocation()
  const [notifOpen, setNotifOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [quickLogOpen, setQuickLogOpen] = useState(false)
  // Unread count drives both the header bell badge and the mobile-nav profile
  // tab badge. The hook polls every 60s and degrades to 0 on errors so a
  // backend outage doesn't surface a misleading count.
  const unread = useUnreadCountQuery()
  const unreadCount = unread.data?.count ?? 0

  // Body class enables v2 design tokens & Inter font globally for the page.
  useEffect(() => {
    document.body.classList.add('v2')
    return () => document.body.classList.remove('v2')
  }, [])

  useEffect(() => {
    void import('../lib/queries/installs').then(({ recordWebInstallOnce }) => {
      void recordWebInstallOnce()
    })
  }, [])

  // Profile data carries the user_id we attach to all subsequent events
  // (backend pulls it from auth middleware anyway — this is purely so
  // future client-side enrichment can be user-scoped).
  const profileForAnalytics = useProfileQuery()
  useEffect(() => {
    const uid = profileForAnalytics.data?.id
    if (!uid) return
    void import('../lib/analytics').then(({ analytics }) => {
      analytics.init({ userId: uid })
    })
  }, [profileForAnalytics.data?.id])

  // Reset scroll on route change — но только когда нет hash. Если есть
  // location.hash (e.g. /today#activity из insight CTA), позволяем
  // hash-scroll эффекту обработать (scrollIntoView с smooth).
  useEffect(() => {
    if (!location.hash) {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
    }
  }, [location.pathname, location.hash])

  // Hash-scroll: когда юзер navigates на /today#activity (insight CTA / app
  // links), плавно scroll к anchor + tiny outline pulse чтобы attention
  // landed правильно. Anti-fallback: если element не найден, тихо игнорируем
  // — не симулируем scroll к top.
  useEffect(() => {
    if (!location.hash) return
    const id = location.hash.slice(1)
    // Wait one tick чтобы page контент успел отрендериться.
    const t = setTimeout(() => {
      const el = document.getElementById(id)
      if (!el) return
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      // Pulse outline 1.2s — без accent color, просто border highlight.
      el.classList.add('hash-pulse')
      setTimeout(() => el.classList.remove('hash-pulse'), 1200)
    }, 80)
    return () => clearTimeout(t)
  }, [location.pathname, location.hash])

  // Cmd+K (Ctrl+K on Linux/Win) toggles the command palette. Mirrors the
  // Hone shortcut so muscle memory transfers between web and desktop.
  // Cmd+L opens QuickLog для одно-click activity log из любого page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey
      // Skip когда юзер печатает в textarea / input — Cmd+L там используется
      // браузером для отображения URL (если focus вне editable, наш handler
      // первый и preventDefault'нёт это поведение).
      const target = e.target as HTMLElement | null
      const editable =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable
      if (isMod && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((p) => !p)
      } else if (isMod && e.key.toLowerCase() === 'l' && !editable) {
        e.preventDefault()
        setQuickLogOpen((p) => !p)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // v2 page transition — large/emphasized in, medium/accelerate out. Reuses
  // design-token durations (--motion-dur-*) and ease curves so every route
  // transition feels the same as modal/drawer/popover anims. useMotion
  // handles prefers-reduced-motion internally.
  const motionProps = useMotion('pageTransition')

  return (
    <div className="min-h-screen bg-bg text-text-primary">
      {/* a11y: keyboard-only skip-link, first focusable element on the page. */}
      <SkipToContent />
      {/* Wave-11 global error chrome — sticky degraded banner at the very
          top of the page. Mounts when the apiClient routes a 5xx through
          degradedBus.report(). Renders nothing in the happy path. */}
      <DegradedBanner />
      <TopNav
        onOpenNotifications={() => setNotifOpen(true)}
        unreadCount={unreadCount}
        onOpenPalette={() => setPaletteOpen(true)}
      />
      <NotificationsDrawer open={notifOpen} onClose={() => setNotifOpen(false)} />
      {paletteOpen && <Palette onClose={() => setPaletteOpen(false)} />}
      {quickLogOpen && <QuickLogModal onClose={() => setQuickLogOpen(false)} />}
      <SessionExpiredToast />
      <AnimatePresence mode="wait">
        <motion.main
          key={location.pathname}
          id="main"
          tabIndex={-1}
          {...motionProps}
          // Reserve space at the bottom for the mobile bottom-nav so
          // the FAB doesn't cover content. 72px = 64 nav + 8 FAB-overflow,
          // plus the iPhone safe-area inset. Class is sm:pb-0 because the
          // bar itself is hidden on sm+ breakpoints.
          style={{ paddingBottom: 'calc(72px + env(safe-area-inset-bottom, 0px))' }}
          className="sm:!pb-0 focus:outline-none"
        >
          {children}
        </motion.main>
      </AnimatePresence>
      <MobileBottomNav unreadCount={unreadCount} />
    </div>
  )
}
