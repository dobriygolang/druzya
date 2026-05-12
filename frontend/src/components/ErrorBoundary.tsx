// ErrorBoundary — CI1 (Phase A 2026-05-12) baseline error containment.
//
// Цель: единичный page-level crash не валит весь app. React'ovy
// error-boundary semantics (try/catch для render-time errors). Async errors
// (fetch / promise) НЕ ловятся здесь — для них есть DataLoader.
//
// Usage:
//   <ErrorBoundary section="Coach memory" onRetry={() => refetch()}>
//     <CoachMemoryCard ... />
//   </ErrorBoundary>

import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'

interface Props {
  /** Human-readable section name (shown в fallback UI). */
  section?: string
  /** Optional retry callback (e.g. refetch). Если предоставлен, кнопка
   * «Retry» вызывает её + сбрасывает error state. */
  onRetry?: () => void
  /** Custom fallback (overrides default). */
  fallback?: (error: Error, retry: () => void) => ReactNode
  children: ReactNode
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // В development — full stack в console; в production — sentry-style hook
    // здесь же после backend ship.
    if (typeof console !== 'undefined') {
      console.error('[ErrorBoundary]', this.props.section, error, info.componentStack)
    }
  }

  retry = () => {
    this.setState({ error: null })
    this.props.onRetry?.()
  }

  render() {
    if (this.state.error) {
      if (this.props.fallback) {
        return this.props.fallback(this.state.error, this.retry)
      }
      return (
        <section
          role="alert"
          className="relative flex flex-col gap-2 rounded-xl border border-border bg-surface-1 p-4"
        >
          <span
            aria-hidden
            className="absolute left-0 top-0 h-full w-[1.5px] rounded-l-xl"
            style={{ background: '#FF3B30' }}
          />
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-text-primary" />
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-primary">
              {this.props.section ?? 'Секция'} упала
            </span>
          </div>
          <p className="text-[12.5px] leading-relaxed text-text-secondary">
            {this.state.error.message || 'Неизвестная ошибка'}
          </p>
          <button
            type="button"
            onClick={this.retry}
            className="inline-flex items-center gap-1.5 self-start rounded-md border border-border bg-surface-2 px-3 py-1.5 text-[12px] font-semibold text-text-primary transition-colors hover:border-border-strong"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Перезагрузить секцию
          </button>
        </section>
      )
    }
    return this.props.children
  }
}
