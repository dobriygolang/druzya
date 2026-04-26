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
import { api } from '../../lib/apiClient'
import { useCanvasDraft } from '../../lib/useCanvasDraft'
import type { ExcalidrawImperativeAPI, BinaryFileData } from '@excalidraw/excalidraw/types'

const SysDesignCanvasInner = lazy(() => import('./_lazy/SysDesignCanvasInner'))

export default function MockCanvasFullscreen() {
  const { attemptId = '' } = useParams<{ attemptId: string }>()
  const { state, update, onSubmittedFromMain } = useCanvasDraft(attemptId, 'fullscreen')
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null)
  const [submittedAt, setSubmittedAt] = useState<number | null>(null)
  const [closeBlocked, setCloseBlocked] = useState(false)
  const [finalised, setFinalised] = useState<boolean | null>(null)
  const restoredAppliedRef = useRef(false)

  // Guard: if the attempt is already submitted (verdict settled), block
  // the editable canvas — the user would otherwise draw into a dead row
  // with no way to submit. Best-effort fetch; on error we let the canvas
  // render (degraded mode is "appears editable" — the same as today).
  useEffect(() => {
    if (!attemptId) return
    let cancelled = false
    void (async () => {
      try {
        const r = await api<{ finalised: boolean }>(`/mock/attempts/${attemptId}/finalised`)
        if (!cancelled) setFinalised(Boolean(r.finalised))
      } catch {
        if (!cancelled) setFinalised(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [attemptId])

  // When the main tab broadcasts 'submitted', flip into a goodbye state
  // and try to close after 3s. window.close() only works when this tab
  // was opened via window.open from the main tab — if the user pasted
  // the URL directly the call is denied silently. We detect that and
  // surface a "Можно закрыть вкладку" hint instead.
  useEffect(() => {
    return onSubmittedFromMain(() => {
      setSubmittedAt(Date.now())
      window.setTimeout(() => {
        try {
          window.close()
          // If close didn't actually take effect, show the manual hint.
          window.setTimeout(() => {
            if (!window.closed) setCloseBlocked(true)
          }, 200)
        } catch {
          setCloseBlocked(true)
        }
      }, 3000)
    })
  }, [onSubmittedFromMain])

  // Apply scene + files from a peer broadcast OR the async-loaded
  // restored draft. updateScene only handles geometry; image files
  // travel through addFiles separately.
  useEffect(() => {
    const ex = apiRef.current
    if (!ex) return
    const remote = state.remote ?? state.restored
    if (!remote) return
    // The restored draft seeds initialData on first mount — only apply
    // it via updateScene if the canvas was already rendered with empty
    // state (Redis fallback path arrives ms AFTER mount).
    if (remote === state.restored && restoredAppliedRef.current) return
    if (remote === state.restored) restoredAppliedRef.current = true
    ex.updateScene({ elements: remote.sceneJSON.elements as never })
    const files = remote.sceneJSON.files
    if (files && typeof files === 'object') {
      const arr = Object.values(files) as BinaryFileData[]
      if (arr.length > 0) ex.addFiles(arr)
    }
  }, [state.remote, state.restored])

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

  if (finalised === true) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-bg text-text-primary">
        <CheckCircle2 className="h-16 w-16 text-success" />
        <h1 className="font-display text-2xl font-extrabold">Этап уже отправлен</h1>
        <p className="max-w-sm text-center text-sm text-text-secondary">
          Эта попытка закрыта. Можешь закрыть вкладку — результат смотри
          на основной странице собеса.
        </p>
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
          {state.serverDraftFailed ? (
            <span className="rounded-md border border-danger/50 bg-danger/10 px-2 py-0.5 text-danger">
              ⚠ автосейв выкл — жми Submit
            </span>
          ) : state.quotaExceeded ? (
            <span className="rounded-md border border-warn/50 bg-warn/10 px-2 py-0.5 text-warn">
              ⚠ локалка переполнена — пишем на сервер
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
                {closeBlocked
                  ? 'Можно закрыть вкладку (✕ или Cmd/Ctrl+W)'
                  : 'Закрываю вкладку…'}
              </span>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
