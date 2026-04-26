// MockCanvasFullscreen — standalone "большая доска" tab.
//
// Opened from SysDesignCanvas via `window.open('/mock/canvas/{attemptId}')`.
// Renders ONLY the Excalidraw surface — no NFR / Context fields, no
// Submit button. Submit lives on the main /mock/pipeline tab where the
// candidate also fills in the side-panes and reads the verdict; this
// tab is the equivalent of the excalidraw.com link interviewers paste
// during a real call.
//
// Persistence:
//   - localStorage (via useCanvasDraft) — accidental tab close keeps
//     the drawing for 24h.
//   - BroadcastChannel — main tab gets every edit live so when the user
//     hits Submit there, it has the freshest scene.
//
// Lifecycle:
//   - On mount: restore latest draft (this tab OR the main tab — they
//     share a localStorage key).
//   - On every Excalidraw onChange: broadcast + debounced localStorage.
//   - On 'submitted' broadcast from main: show "✓ отправлено" and auto-
//     close after 3s.

import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { CheckCircle2, Loader2 } from 'lucide-react'
import { useCanvasDraft } from '../../lib/useCanvasDraft'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'

const SysDesignCanvasInner = lazy(() => import('./_lazy/SysDesignCanvasInner'))

export default function MockCanvasFullscreen() {
  const { attemptId = '' } = useParams<{ attemptId: string }>()
  const { state, update, onSubmittedFromMain } = useCanvasDraft(attemptId, 'fullscreen')
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null)
  const [submittedAt, setSubmittedAt] = useState<number | null>(null)

  // When the main tab broadcasts 'submitted', flip into a goodbye
  // state and close after 3s.
  useEffect(() => {
    return onSubmittedFromMain(() => {
      setSubmittedAt(Date.now())
      window.setTimeout(() => {
        try {
          window.close()
        } catch {
          /* ignore — popup-blocked or top-level navigation */
        }
      }, 3000)
    })
  }, [onSubmittedFromMain])

  // When the OTHER tab edits, push the new scene into Excalidraw. We
  // rely on `restored` for the very first paint, then `remote` for live
  // syncs from the main tab (rare — usually edits flow this → main).
  useEffect(() => {
    if (!state.remote) return
    const api = apiRef.current
    if (!api) return
    api.updateScene({
      elements: state.remote.sceneJSON.elements as never,
    })
  }, [state.remote])

  const initialData = state.restored
    ? ({
        elements: state.restored.sceneJSON.elements ?? [],
        files: state.restored.sceneJSON.files ?? {},
      } as never)
    : null

  if (!attemptId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg text-text-muted">
        Не указан attempt id.
      </div>
    )
  }

  return (
    <div className="flex min-h-screen flex-col bg-black text-text-primary">
      <header className="flex h-12 items-center justify-between border-b border-border bg-bg px-4">
        <div className="flex items-center gap-3">
          <span className="grid h-6 w-6 place-items-center rounded-md bg-surface-2 border border-border-strong font-display text-xs font-extrabold text-text-primary">
            9
          </span>
          <span className="font-display text-sm font-bold">druz9 · доска</span>
          <span className="rounded-full bg-surface-3 px-2 py-0.5 font-mono text-[9px] text-text-muted">
            system design
          </span>
        </div>
        <div className="flex items-center gap-3 font-mono text-[11px] text-text-muted">
          {state.quotaExceeded ? (
            <span className="rounded-md border border-warn/50 bg-warn/10 px-2 py-0.5 text-warn">
              ⚠ автосейв выкл — мало места
            </span>
          ) : (
            <span className="text-text-secondary">автосейв · 24ч</span>
          )}
          <span>
            submit на основной вкладке →
          </span>
        </div>
      </header>

      <main className="relative flex-1 overflow-hidden">
        <Suspense
          fallback={
            <div className="absolute inset-0 flex items-center justify-center text-text-secondary">
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              <span className="text-sm">Загрузка канваса…</span>
            </div>
          }
        >
          <SysDesignCanvasInner
            onAPI={(api) => {
              apiRef.current = api
            }}
            initialData={initialData}
            onChange={(elements, _appState, files) => {
              update({
                sceneJSON: {
                  elements: elements as unknown[],
                  files: (files ?? {}) as Record<string, unknown>,
                },
                // NFR/Context live on the main tab — copy through the
                // last known values from the restored draft so we don't
                // wipe them when this tab broadcasts.
                nonFunctionalMD: state.remote?.nonFunctionalMD ?? state.restored?.nonFunctionalMD ?? '',
                contextMD: state.remote?.contextMD ?? state.restored?.contextMD ?? '',
              })
            }}
          />
        </Suspense>

        {submittedAt !== null && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-bg/80 backdrop-blur-sm">
            <div className="flex flex-col items-center gap-3 rounded-lg border border-success bg-success/10 px-6 py-5 text-success">
              <CheckCircle2 className="h-10 w-10" />
              <span className="font-display text-lg font-bold">Отправлено</span>
              <span className="font-mono text-xs text-text-secondary">
                Закрываю вкладку…
              </span>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
