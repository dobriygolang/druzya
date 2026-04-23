import { ReactNode, useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Bell, Menu, Search, X, Sun, Moon, Languages, User, LogOut, Settings, Users, HelpCircle, Shield, CalendarDays, Sparkles } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { MobileBottomNav } from './MobileBottomNav'
import { Avatar } from './Avatar'
import { DegradedBanner } from './global-error/DegradedBanner'
import { NotificationsBell } from './notifications/NotificationsBell'
import { NotificationsDrawer } from './notifications/NotificationsDrawer'
import { cn } from '../lib/cn'
import { useTheme, getEffectiveTheme } from '../lib/theme'
import { changeLanguage, currentLanguage, LANG_LIST, type Lang } from '../lib/i18n'
import { useAdminDashboardQuery } from '../lib/queries/admin'
import { useUnreadCountQuery } from '../lib/queries/notifications'
import { logoutCurrentSession } from '../lib/queries/auth'

// Главная навигация — только 6 ключевых разделов. Остальное (Друзья, Помощь,
// Настройки, Выход) уехало в user-menu под аватаром, чтобы header не был
// перегружен (раньше было 8 nav-items + 5 кнопок справа = 13 элементов).
function useNavItems() {
  const { t } = useTranslation('common')
  return [
    // WAVE-13 IA refactor:
    //   - /daily убран, kata теперь живёт как таб внутри /arena (см. ArenaPage).
    //   - /podcasts merged into /codex (вкладка внутри Codex).
    //   - /vacancies + /slots — promoted в top-nav (раньше прятались в user-menu).
    // Порядок зафиксирован в WAVE-13 spec: 7 элементов на 1920 desktop.
    { to: '/sanctum', label: t('nav.sanctum') },
    { to: '/arena', label: t('nav.arena') },
    { to: '/atlas', label: t('nav.atlas') },
    { to: '/codex', label: t('nav.codex') },
    { to: '/vacancies', label: t('nav.vacancies') },
    { to: '/slots', label: t('nav.slots') },
    { to: '/guild', label: t('nav.guild') },
  ] as const
}

function Logo() {
  return (
    <Link to="/sanctum" className="flex items-center gap-2.5">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-gradient-to-br from-accent to-cyan font-display text-lg font-extrabold text-text-primary">
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

function ThemeToggleButton() {
  const { toggle, theme } = useTheme()
  const effective = theme === 'auto' ? getEffectiveTheme() : (theme as 'dark' | 'light')
  const Icon = effective === 'dark' ? Sun : Moon
  return (
    <button
      type="button"
      onClick={toggle}
      className="grid h-9 w-9 place-items-center rounded-md text-text-secondary hover:bg-surface-2"
      aria-label="Toggle theme"
      title="Toggle theme"
    >
      <Icon className="h-5 w-5" />
    </button>
  )
}

// LanguageToggleButton — dropdown со всеми 4 языками (RU/EN/KZ/UA).
// Выбор персистится в localStorage внутри changeLanguage → languageChanged
// listener в lib/i18n.ts. Закрытие по клику снаружи и по Escape.
function LanguageToggleButton() {
  const [, setTick] = useState(0)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const lang = currentLanguage()
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
    void changeLanguage(next).then(() => {
      setTick((x) => x + 1)
      setOpen(false)
    })
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
  // WAVE-13 IA refactor — user-menu облегчён:
  //   - Podcasts удалён (теперь таб внутри /codex).
  //   - Weekly удалён (теперь таб внутри /profile).
  //   - Vacancies удалён (теперь top-nav entry).
  // В меню остались персональные разделы и админка.
  // Wave-13: «Copilot» surfaced here with a NEW badge. Header nav already
  // has 7 entries (Sanctum/Arena/Atlas/Кодекс/Вакансии/Слоты/Гильдия) so
  // adding a 8th would overflow on tablet — we use the user-menu instead
  // and rely on the NEW badge + the /welcome promo banner for discovery.
  const items: { to: string; label: string; icon: typeof User; badge?: 'new' }[] = [
    { to: '/copilot', label: 'Copilot', icon: Sparkles, badge: 'new' },
    { to: '/profile', label: t('nav.profile'), icon: User },
    { to: '/cohorts', label: t('nav.cohorts'), icon: CalendarDays },
    { to: '/settings', label: t('nav.settings'), icon: Settings },
    { to: '/friends', label: t('nav.friends'), icon: Users },
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
              style={{ background: 'linear-gradient(135deg, rgb(124,92,255), rgb(76,139,255))' }}
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

function TopNav({ onOpenNotifications, unreadCount }: { onOpenNotifications: () => void; unreadCount: number }) {
  const { t } = useTranslation('common')
  const NAV_ITEMS = useNavItems()
  const [menuOpen, setMenuOpen] = useState(false)
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const userMenuRef = useRef<HTMLDivElement>(null)

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
        <div className="hidden h-9 w-[240px] items-center gap-2 rounded-md border border-border bg-surface-2 px-3 lg:flex">
          <Search className="h-4 w-4 shrink-0 text-text-muted" />
          <span className="truncate font-sans text-[13px] text-text-muted">{t('labels.search_placeholder')}</span>
        </div>
        <button
          type="button"
          className="grid h-9 w-9 place-items-center rounded-md text-text-secondary hover:bg-surface-2 lg:hidden"
          aria-label="Search"
        >
          <Search className="h-5 w-5" />
        </button>
        <ThemeToggleButton />
        <LanguageToggleButton />
        <NotificationsBell unreadCount={unreadCount} onClick={onOpenNotifications} />
        {/* Avatar + dropdown — кликабельный, открывает user-menu */}
        <div ref={userMenuRef} className="relative">
          <button
            type="button"
            onClick={() => setUserMenuOpen((v) => !v)}
            className="grid h-9 w-9 place-items-center rounded-full transition hover:ring-2 hover:ring-accent/40"
            aria-label="User menu"
            aria-expanded={userMenuOpen}
          >
            <Avatar size="md" gradient="pink-violet" initials="Д" />
          </button>
          {userMenuOpen && <UserMenu onClose={() => setUserMenuOpen(false)} />}
        </div>
        <button
          type="button"
          className="grid h-9 w-9 place-items-center rounded-md text-text-secondary hover:bg-surface-2 lg:hidden"
          aria-label="Menu"
          onClick={() => setMenuOpen(true)}
        >
          <Menu className="h-5 w-5" />
        </button>
      </div>
      {menuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true">
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
              <NavItem to="/friends" label={t('nav.friends')} onClick={() => setMenuOpen(false)} />
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
      Сессия истекла, переавторизуйтесь.
    </div>
  )
}

export function AppShellV2({ children }: { children: ReactNode }) {
  const location = useLocation()
  const reduced = useReducedMotion()
  const [notifOpen, setNotifOpen] = useState(false)
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

  // Reset scroll on route change.
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
  }, [location.pathname])

  const motionProps = reduced
    ? {}
    : {
        initial: { opacity: 0, y: 12 },
        animate: { opacity: 1, y: 0 },
        exit: { opacity: 0, y: -12 },
        transition: { duration: 0.25, ease: 'easeOut' as const },
      }

  return (
    <div className="min-h-screen bg-bg text-text-primary">
      {/* Wave-11 global error chrome — sticky degraded banner at the very
          top of the page. Mounts when the apiClient routes a 5xx through
          degradedBus.report(). Renders nothing in the happy path. */}
      <DegradedBanner />
      <TopNav onOpenNotifications={() => setNotifOpen(true)} unreadCount={unreadCount} />
      <NotificationsDrawer open={notifOpen} onClose={() => setNotifOpen(false)} />
      <SessionExpiredToast />
      <AnimatePresence mode="wait">
        <motion.main
          key={location.pathname}
          {...motionProps}
          // Reserve space at the bottom for the mobile bottom-nav so
          // the FAB doesn't cover content. 72px = 64 nav + 8 FAB-overflow,
          // plus the iPhone safe-area inset. Class is sm:pb-0 because the
          // bar itself is hidden on sm+ breakpoints.
          style={{ paddingBottom: 'calc(72px + env(safe-area-inset-bottom, 0px))' }}
          className="sm:!pb-0"
        >
          {children}
        </motion.main>
      </AnimatePresence>
      <MobileBottomNav unreadCount={unreadCount} />
    </div>
  )
}
