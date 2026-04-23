// SysDesignBoard — lazy-loaded host for the Excalidraw whiteboard used
// by the sys_design stage. Kept in its own chunk via the parent's
// React.lazy() so @excalidraw/excalidraw doesn't bloat the main bundle.
//
// @excalidraw/excalidraw is NOT yet in package.json — installing it would
// add ~700KB to deps and is gated behind the Wave-12 backend roll-out
// (sys_design rooms aren't issued yet either). When the orchestrator
// ships, replace the placeholder below with:
//
//   import { Excalidraw } from '@excalidraw/excalidraw'
//   import '@excalidraw/excalidraw/index.css'
//   return <div className="h-[60vh]"><Excalidraw … /></div>
//
// Until then we render an honest placeholder so the cockpit doesn't
// silently look "broken" — the user sees what's coming.

export type SysDesignBoardProps = {
  sessionId: string | null
}

export default function SysDesignBoard({ sessionId }: SysDesignBoardProps) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-surface-1 p-8 text-center min-h-[400px] flex flex-col items-center justify-center">
      <div className="font-mono text-[10px] uppercase tracking-wider text-text-muted mb-2">
        Excalidraw board · sys_design
      </div>
      <div className="font-display text-base font-bold text-text-primary mb-1">
        Доска подключается отдельным чанком
      </div>
      <p className="text-sm text-text-secondary max-w-md">
        Рисуй архитектуру: сервисы, очереди, БД. Объясняй trade-offs голосом.
      </p>
      {sessionId && (
        <div className="mt-3 font-mono text-[10px] text-text-muted">room · {sessionId}</div>
      )}
    </div>
  )
}
