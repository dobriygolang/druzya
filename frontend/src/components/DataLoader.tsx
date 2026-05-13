// Цель: единый UX контракт для async data:
//   - loading → skeleton (height-stable, не «Loading…» строка)
//   - error → red 1.5px stripe + retry button (если onRetry дан)
//   - empty (data === null/undefined OR empty fn returns true) → empty CTA
//   - data → render children(data)
//
// Это thin wrapper над react-query state. Не подменяет ErrorBoundary
// (он для render-time crashes); DataLoader — для async/fetch.
//
// Usage:
//   <DataLoader
//     state={query}
//     section="Coach memory"
//     skeleton={<MemorySkeleton />}
//     empty={(d) => d.events.length === 0}
//     emptyContent={<MemoryEmpty />}
//   >
//     {(data) => <CoachMemoryCard data={data} />}
//   </DataLoader>

import type { ReactNode } from 'react'
import { AlertCircle, RefreshCw } from 'lucide-react'

interface QueryState<T> {
  data?: T
  isLoading?: boolean
  isPending?: boolean
  isError?: boolean
  error?: unknown
  refetch?: () => unknown
}

interface Props<T> {
  /** Query result или any object с loading/error/data shape. */
  state: QueryState<T>
  /** Section name (shown в error/empty). */
  section?: string
  /** Skeleton component для loading state. Если не дано — invisible placeholder. */
  skeleton?: ReactNode
  /** Predicate: вернуть true если data считается empty. По умолчанию `data == null`. */
  empty?: (data: T) => boolean
  /** Empty state content. */
  emptyContent?: ReactNode
  /** Custom error renderer. */
  errorContent?: (error: unknown, retry: () => void) => ReactNode
  /** Children — render-prop с data. */
  children: (data: T) => ReactNode
}

export function DataLoader<T>({
  state,
  section,
  skeleton,
  empty,
  emptyContent,
  errorContent,
  children,
}: Props<T>) {
  const loading = state.isLoading ?? state.isPending ?? false
  const error = state.isError ?? false

  if (loading) {
    return <>{skeleton ?? <DefaultSkeleton />}</>
  }
  if (error) {
    const retry = () => state.refetch?.()
    if (errorContent) return <>{errorContent(state.error, retry)}</>
    return (
      <section
        role="alert"
        className="relative flex items-start gap-3 rounded-xl border border-border bg-surface-1 p-4"
      >
        <span
          aria-hidden
          className="absolute left-0 top-0 h-full w-[1.5px] rounded-l-xl"
          style={{ background: '#FF3B30' }}
        />
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-text-primary" />
        <div className="flex flex-1 flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-primary">
            {section ?? 'Секция'} · ошибка
          </span>
          <p className="text-[12.5px] text-text-secondary">
            {state.error instanceof Error ? state.error.message : 'Не удалось загрузить'}
          </p>
          {state.refetch && (
            <button
              type="button"
              onClick={retry}
              className="mt-1 inline-flex items-center gap-1.5 self-start rounded-md border border-border bg-surface-2 px-3 py-1.5 text-[12px] font-semibold text-text-primary transition-colors hover:border-border-strong"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Попробовать снова
            </button>
          )}
        </div>
      </section>
    )
  }
  const data = state.data
  if (data === undefined || data === null) {
    return <>{emptyContent ?? null}</>
  }
  if (empty && empty(data)) {
    return <>{emptyContent ?? null}</>
  }
  return <>{children(data)}</>
}

function DefaultSkeleton() {
  return (
    <div
      role="status"
      aria-label="Загрузка"
      className="flex flex-col gap-2 rounded-xl border border-border bg-surface-1 p-4"
    >
      <div className="h-3 w-1/3 animate-pulse rounded bg-surface-2" />
      <div className="h-3 w-2/3 animate-pulse rounded bg-surface-2" />
      <div className="h-3 w-1/2 animate-pulse rounded bg-surface-2" />
    </div>
  )
}
