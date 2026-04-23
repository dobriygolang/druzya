// ShareActionFooter — druz9 brand mark + «Хочу попробовать» CTA → onboarding.
// Скрывается, когда страницу открыл сам автор (heuristic в parent: ?own=1
// либо localStorage flag). Это «conversion footer» — единственная точка
// входа из публичного шер-вью в продукт.

import { Link } from 'react-router-dom'

export function ShareActionFooter({ showCta = true }: { showCta?: boolean }) {
  return (
    <footer className="mt-4 flex flex-col items-center gap-5 border-t border-border pt-8 sm:flex-row sm:justify-between">
      <Link to="/" className="flex items-center gap-2.5">
        <span className="grid h-9 w-9 place-items-center rounded-md bg-gradient-to-br from-pink to-cyan font-display text-lg font-extrabold text-white">
          9
        </span>
        <div className="flex flex-col">
          <span className="font-display text-base font-bold text-text-primary">druz9</span>
          <span className="font-mono text-[10px] text-text-muted">
            ranked-практика для разработчиков
          </span>
        </div>
      </Link>
      {showCta && (
        <Link
          to="/onboarding/welcome"
          className="inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-pink to-cyan px-5 py-2.5 font-display text-sm font-bold text-white shadow-lg shadow-pink/20 transition-transform hover:scale-[1.02]"
        >
          Хочу попробовать →
        </Link>
      )}
    </footer>
  )
}

export default ShareActionFooter
