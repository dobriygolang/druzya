import { ReactNode, useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Bell, Menu, Search, X, Sun, Moon, Languages } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { Avatar } from './Avatar'
import { cn } from '../lib/cn'
import { useTheme, getEffectiveTheme } from '../lib/theme'
import { toggleLanguage, currentLanguage } from '../lib/i18n'

function useNavItems() {
  const { t } = useTranslation('common')
  return [
    { to: '/v2/sanctum', label: t('nav.sanctum') },
    { to: '/v2/arena', label: t('nav.arena') },
    { to: '/v2/kata', label: t('nav.kata') },
    { to: '/v2/guild', label: t('nav.guild') },
    { to: '/v2/atlas', label: t('nav.atlas') },
    { to: '/v2/codex', label: t('nav.codex') },
    { to: '/friends', label: t('nav.friends') },
    { to: '/help', label: t('nav.help') },
  ] as const
}

function Logo() {
  return (
    <Link to="/v2/sanctum" className="flex items-center gap-2.5">
      <span className="grid h-8 w-8 place-items-center rounded-md bg-gradient-to-br from-accent to-cyan font-display text-lg font-extrabold text-text-primary">
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

function LanguageToggleButton() {
  const [, setTick] = useState(0)
  const lang = currentLanguage()
  const onClick = () => {
    void toggleLanguage().then(() => setTick((x) => x + 1))
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className="hidden h-9 items-center gap-1.5 rounded-md px-2.5 text-text-secondary hover:bg-surface-2 sm:flex"
      aria-label="Toggle language"
      title="Toggle language"
    >
      <Languages className="h-4 w-4" />
      <span className="font-mono text-[12px] font-semibold uppercase">{lang}</span>
    </button>
  )
}

function TopNav() {
  const { t } = useTranslation('common')
  const NAV_ITEMS = useNavItems()
  const [menuOpen, setMenuOpen] = useState(false)
  return (
    <header className="flex h-[64px] items-center justify-between border-b border-border bg-bg px-4 sm:px-6 lg:h-[72px] lg:px-8">
      <div className="flex items-center gap-4 lg:gap-10">
        <Logo />
        <nav className="hidden items-center gap-1 lg:flex">
          {NAV_ITEMS.map((item) => (
            <NavItem key={item.to} {...item} />
          ))}
        </nav>
      </div>
      <div className="flex items-center gap-2 sm:gap-3 lg:gap-4">
        <div className="hidden h-9 w-[280px] items-center gap-2 rounded-md border border-border bg-surface-2 px-3.5 md:flex">
          <Search className="h-4 w-4 text-text-muted" />
          <span className="font-sans text-[13px] text-text-muted">{t('labels.search_placeholder')}</span>
        </div>
        <button
          type="button"
          className="grid h-9 w-9 place-items-center rounded-md text-text-secondary hover:bg-surface-2 md:hidden"
          aria-label="Search"
        >
          <Search className="h-5 w-5" />
        </button>
        <ThemeToggleButton />
        <LanguageToggleButton />
        <button
          type="button"
          className="hidden h-9 w-9 place-items-center rounded-md text-text-secondary hover:bg-surface-2 sm:grid"
          aria-label="Notifications"
        >
          <Bell className="h-5 w-5" />
        </button>
        <Avatar size="md" gradient="pink-violet" initials="Д" />
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
            </nav>
          </div>
        </div>
      )}
    </header>
  )
}

export function AppShellV2({ children }: { children: ReactNode }) {
  const location = useLocation()
  const reduced = useReducedMotion()

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
      <TopNav />
      <AnimatePresence mode="wait">
        <motion.main key={location.pathname} {...motionProps}>
          {children}
        </motion.main>
      </AnimatePresence>
    </div>
  )
}
