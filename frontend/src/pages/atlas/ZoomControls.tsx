// ZoomControls — extracted from AtlasPage.tsx in WAVE-11.
//
// Floating zoom-in / zoom-out / reset stack at the canvas top-right.
// Pure dumb component — owner manages scale state.

import { ZoomIn, ZoomOut, Maximize2 } from 'lucide-react'

export function ZoomControls({
  scale,
  setScale,
  reset,
}: {
  scale: number
  setScale: (s: number) => void
  reset: () => void
}) {
  return (
    <div className="absolute right-4 top-4 z-20 flex flex-col gap-1 rounded-md border border-border bg-surface-1/90 p-1 backdrop-blur">
      <button
        type="button"
        onClick={() => setScale(Math.min(2, scale + 0.15))}
        aria-label="Zoom in"
        className="rounded p-1.5 text-text-secondary hover:bg-surface-2"
      >
        <ZoomIn className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => setScale(Math.max(0.5, scale - 0.15))}
        aria-label="Zoom out"
        className="rounded p-1.5 text-text-secondary hover:bg-surface-2"
      >
        <ZoomOut className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={reset}
        aria-label="Reset view"
        className="rounded p-1.5 text-text-secondary hover:bg-surface-2"
      >
        <Maximize2 className="h-4 w-4" />
      </button>
    </div>
  )
}
