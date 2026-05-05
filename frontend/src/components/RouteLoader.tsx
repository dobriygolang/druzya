export default function RouteLoader() {
  return (
    <div
      className="fixed inset-0 flex items-center justify-center bg-bg"
      role="status"
      aria-live="polite"
      aria-label="Loading"
    >
      <div className="flex flex-col items-center gap-4">
        <div className="h-12 w-12 animate-spin rounded-full border-2 border-border border-t-text-primary" />
        <span className="text-sm font-medium tracking-wide text-text-muted animate-pulse">
          Loading…
        </span>
      </div>
    </div>
  )
}
