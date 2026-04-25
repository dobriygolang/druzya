// SysDesignCanvasInner — heavy Excalidraw mount, lazy-loaded so the
// @excalidraw/excalidraw bundle (~700KB) doesn't ship in the main chunk.
//
// Single-user only — NO Yjs / collab. Mock interview is solo by design.
// Theme + UI overrides mirror WhiteboardSharePage.tsx so the surface
// reads as native druz9 dark.

import { useEffect } from 'react'
import { Excalidraw } from '@excalidraw/excalidraw'
import type { ExcalidrawImperativeAPI, ExcalidrawInitialDataState } from '@excalidraw/excalidraw/types'
import '@excalidraw/excalidraw/index.css'

export type SysDesignCanvasInnerProps = {
  onAPI?: (api: ExcalidrawImperativeAPI) => void
  // When set the canvas is rendered read-only with the given scene as initial
  // data — used in the post-submit review path so the user sees their saved
  // diagram without re-uploading. Pass elements/files exactly as returned by
  // the live editor's `getSceneElements()` / `getFiles()`.
  initialData?: ExcalidrawInitialDataState | null
  viewModeEnabled?: boolean
}

export default function SysDesignCanvasInner({
  onAPI,
  initialData,
  viewModeEnabled,
}: SysDesignCanvasInnerProps) {
  // Inject the dark-mode + filter overrides once per mount. Same selector
  // namespace as the standalone whiteboard page so styles compose cleanly
  // when both routes coexist in dev.
  useEffect(() => {
    const id = 'hone-excalidraw-mount-web-styles'
    if (document.getElementById(id)) return
    const el = document.createElement('style')
    el.id = id
    el.textContent = `
.hone-excalidraw-mount-web .excalidraw {
  --color-canvas-background: #000;
  --theme-filter: invert(100%) hue-rotate(180deg) !important;
}
.hone-excalidraw-mount-web .excalidraw .layer-ui__wrapper__top-right,
.hone-excalidraw-mount-web .excalidraw .scroll-back-to-content,
.hone-excalidraw-mount-web .excalidraw .help-icon {
  display: none !important;
}
`
    document.head.appendChild(el)
  }, [])

  return (
    <div
      className="hone-excalidraw-mount-web"
      style={{ position: 'absolute', inset: 0 }}
    >
      <Excalidraw
        theme="dark"
        viewModeEnabled={viewModeEnabled}
        initialData={initialData ?? undefined}
        excalidrawAPI={(api) => {
          onAPI?.(api)
          requestAnimationFrame(() => {
            try {
              api.refresh()
            } catch {
              /* ignore */
            }
          })
          window.setTimeout(() => {
            try {
              api.refresh()
            } catch {
              /* ignore */
            }
          }, 100)
        }}
        UIOptions={{
          canvasActions: { saveToActiveFile: false, loadScene: false, export: false },
        }}
      />
    </div>
  )
}
