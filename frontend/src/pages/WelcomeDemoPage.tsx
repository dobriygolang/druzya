import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'

/**
 * Welcome demo stub. TODO: replace with real demo video / interactive tour.
 */
export default function WelcomeDemoPage() {
  useEffect(() => {
    document.body.classList.add('v2')
    return () => document.body.classList.remove('v2')
  }, [])

  return (
    <div className="min-h-screen bg-bg text-text-primary">
      <header className="flex h-[72px] items-center justify-between border-b border-border bg-bg px-4 sm:px-8 lg:px-20">
        <Link to="/welcome" className="flex items-center gap-2 text-sm font-medium text-text-muted hover:text-text-primary">
          <ArrowLeft className="h-4 w-4" /> Назад
        </Link>
      </header>
      <main className="mx-auto flex w-full max-w-[960px] flex-col items-center gap-6 px-4 py-10 sm:py-16">
        <h1 className="text-center font-display text-3xl font-extrabold text-text-primary sm:text-4xl">
          Демо druz9
        </h1>
        <p className="max-w-[640px] text-center text-text-secondary">
          Здесь скоро появится короткое видео-знакомство с платформой.
        </p>
        <div className="grid aspect-video w-full place-items-center overflow-hidden rounded-2xl border border-border bg-surface-1 text-text-muted">
          {/* TODO: embed YouTube/Vimeo player */}
          <span className="font-mono text-sm uppercase tracking-[0.12em]">video coming soon</span>
        </div>
      </main>
    </div>
  )
}
