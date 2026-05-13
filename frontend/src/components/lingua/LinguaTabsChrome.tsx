// LinguaTabsChrome — top-tab strip для /lingua sub-routes.
//
// B/W minimal: 5 tabs (Overview / Reading / Writing / Listening / Speaking).
// Active-tab подсветка через useLocation. Mobile responsive (flex-wrap).
import { Link, useLocation } from 'react-router-dom'

import { cn } from '../../lib/cn'

interface Tab {
  to: string
  label: string
}

const TABS: Tab[] = [
  { to: '/lingua', label: 'Overview' },
  { to: '/lingua/reading', label: 'Reading' },
  { to: '/lingua/writing', label: 'Writing' },
  { to: '/lingua/listening', label: 'Listening' },
  { to: '/lingua/speaking', label: 'Speaking' },
]

export function LinguaTabsChrome() {
  const { pathname } = useLocation()
  // Pathname matching: Overview = exact /lingua. Остальные — startsWith
  // (так чтобы nested router-state не сбрасывал active highlight).
  const isActive = (to: string) => {
    if (to === '/lingua') return pathname === '/lingua'
    return pathname === to || pathname.startsWith(`${to}/`)
  }
  return (
    <div className="border-b border-border bg-bg">
      <nav
        aria-label="Lingua sections"
        className="mx-auto flex max-w-6xl flex-wrap items-center gap-1 px-4 py-2.5 sm:px-6 lg:px-8"
      >
        {TABS.map((tab) => {
          const active = isActive(tab.to)
          return (
            <Link
              key={tab.to}
              to={tab.to}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'rounded-md px-3 py-1.5 text-[13px] transition-colors',
                active
                  ? 'bg-surface-2 font-semibold text-text-primary'
                  : 'font-medium text-text-secondary hover:bg-surface-2 hover:text-text-primary',
              )}
            >
              {tab.label}
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
