// CopilotPromoBanner — in-product promo strip for the new Copilot product
// (Wave-13, design from /Users/sedorofeevd/Downloads/_export/Druz9 Banners.html
// banner #3 "Промо-полоса 1440×140 · встраивается в основной сайт").
//
// Mounted on /welcome (above the hero) to drive Copilot discovery from the
// public-facing entry. Self-contained — no router dependency for SSR.
//
// Anti-fallback: if /copilot route is not yet wired (download link "ссылка
// пока нету" per user), the CTAs deliberately link to /copilot — clicking
// will land on the landing page (which itself links to download). Until the
// real .dmg is hosted, the landing's primary download button is a no-op anchor.

import { Link } from 'react-router-dom'
import { Download, ArrowRight } from 'lucide-react'
import { cn } from '../lib/cn'

export type CopilotPromoBannerProps = {
  /** Pass `compact` for the in-app placement (Sanctum / header-aware pages).
   *  Default `hero` for /welcome. */
  variant?: 'hero' | 'compact'
  className?: string
}

export function CopilotPromoBanner({ variant = 'hero', className }: CopilotPromoBannerProps) {
  const isCompact = variant === 'compact'
  return (
    <Link
      to="/copilot"
      className={cn(
        'group relative flex items-center gap-4 overflow-hidden rounded-2xl border border-accent/30 transition-colors hover:border-accent/50',
        isCompact ? 'px-4 py-3 sm:gap-5' : 'px-5 py-4 sm:px-7 sm:py-5 sm:gap-6',
        className,
      )}
      style={{
        background:
          'linear-gradient(135deg, rgba(124,92,255,0.14) 0%, rgba(76,139,255,0.08) 100%)',
      }}
    >
      {/* Decorative radial glow — masked to right side. Pure CSS, no image. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -right-32 -top-32 h-80 w-80 rounded-full"
        style={{
          background:
            'radial-gradient(circle, rgba(124,92,255,0.32) 0%, transparent 60%)',
        }}
      />

      {/* "9" mark — matches druz9 brand mark from header but uses gradient
          mark (white "9" on accent→cyan gradient) — same primitive used in
          AppShell Logo. */}
      <span
        aria-hidden="true"
        className={cn(
          'relative grid shrink-0 place-items-center rounded-xl font-display font-extrabold text-white shadow-glow',
          isCompact ? 'h-10 w-10 text-lg' : 'h-12 w-12 text-xl sm:h-14 sm:w-14 sm:text-2xl',
        )}
        style={{
          background: 'linear-gradient(135deg, rgb(124,92,255) 0%, rgb(76,139,255) 100%)',
        }}
      >
        9
      </span>

      <div className="relative flex min-w-0 flex-1 flex-col">
        <span className="inline-flex w-fit items-center gap-1.5 rounded-md bg-accent/15 px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-accent-hover">
          новое · copilot
        </span>
        <span
          className={cn(
            'mt-1 truncate font-display font-bold text-text-primary',
            isCompact ? 'text-[15px]' : 'text-[16px] sm:text-[18px]',
          )}
        >
          Невидимый AI-напарник для macOS
        </span>
        {!isCompact && (
          <span className="mt-0.5 hidden truncate text-[12px] text-text-secondary sm:block sm:text-[13px]">
            Ответ за 1.2 с, исчезает на демо, ключи в Keychain. 24 MB · Notarized.
          </span>
        )}
      </div>

      {/* CTA cluster — different shape per variant */}
      <div className="relative flex shrink-0 items-center gap-2">
        {!isCompact && (
          <span className="hidden items-center gap-1.5 rounded-md border border-border bg-bg/40 px-3 py-2 font-semibold text-[13px] text-text-secondary sm:inline-flex">
            <Download className="h-3.5 w-3.5" />
            .dmg · 24 MB
          </span>
        )}
        <span
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md px-3 py-2 font-semibold text-white shadow-glow transition-transform group-hover:translate-x-0.5',
            isCompact ? 'text-[12px]' : 'text-[13px]',
          )}
          style={{
            background: 'linear-gradient(135deg, rgb(124,92,255) 0%, rgb(76,139,255) 100%)',
          }}
        >
          {isCompact ? 'Открыть' : 'Подробнее'}
          <ArrowRight className="h-3.5 w-3.5" />
        </span>
      </div>
    </Link>
  )
}
