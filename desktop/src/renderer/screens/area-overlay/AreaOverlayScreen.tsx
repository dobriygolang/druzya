// Area-picker crosshair overlay.
//
// Fills the primary display. Pointer-down begins a rect, pointer-up
// commits. Escape or right-click cancels. The entire surface is outside
// the selected rect is dimmed (so the chosen area pops). This is the
// same interaction pattern users know from macOS ⌘⇧4.
//
// Runs in the special 'area-overlay' window. All geometry is reported in
// CSS pixels within this window's coordinate space — which equals the
// primary display's logical pixels because the window matches its bounds.

import { useEffect, useRef, useState } from 'react';

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

type Drag =
  | { kind: 'idle' }
  | { kind: 'dragging'; startX: number; startY: number; curX: number; curY: number };

export function AreaOverlayScreen() {
  const [drag, setDrag] = useState<Drag>({ kind: 'idle' });
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') window.druz9.capture.cancelArea();
    };
    window.addEventListener('keydown', onKey);
    // Grab focus so Escape works immediately.
    rootRef.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button === 2) {
      window.druz9.capture.cancelArea();
      return;
    }
    setDrag({ kind: 'dragging', startX: e.clientX, startY: e.clientY, curX: e.clientX, curY: e.clientY });
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (drag.kind !== 'dragging') return;
    setDrag({ ...drag, curX: e.clientX, curY: e.clientY });
  };
  const onPointerUp = () => {
    if (drag.kind !== 'dragging') return;
    const rect = normalize(drag);
    if (rect.width < 4 || rect.height < 4) {
      window.druz9.capture.cancelArea();
      return;
    }
    // Scale to device pixels — the screenshot helper expects display-space rects
    // in logical pixels too, so no conversion needed here. If a 2x HiDPI issue
    // appears, move the scaling into main/capture/screenshot.ts.
    window.druz9.capture.commitArea(rect);
  };
  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    window.druz9.capture.cancelArea();
  };

  const rect = drag.kind === 'dragging' ? normalize(drag) : null;

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onContextMenu={onContextMenu}
      style={{
        position: 'fixed',
        inset: 0,
        cursor: 'crosshair',
        // A very faint backdrop makes the overlay's presence obvious
        // without obscuring the underlying screen. The "hole" over the
        // selection is rendered via a clip-path on the backdrop layer.
        background: 'transparent',
        outline: 'none',
        userSelect: 'none',
      }}
    >
      {/* Dimmed backdrop with a cut-out over the selection */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.35)',
          clipPath: rect
            ? `polygon(
                0 0, 100% 0, 100% 100%, 0 100%, 0 0,
                ${rect.x}px ${rect.y}px,
                ${rect.x}px ${rect.y + rect.height}px,
                ${rect.x + rect.width}px ${rect.y + rect.height}px,
                ${rect.x + rect.width}px ${rect.y}px,
                ${rect.x}px ${rect.y}px
              )`
            : undefined,
        }}
      />

      {/* Selection outline */}
      {rect && (
        <div
          style={{
            position: 'absolute',
            left: rect.x,
            top: rect.y,
            width: rect.width,
            height: rect.height,
            border: '1.5px solid var(--d-accent)',
            boxShadow: '0 0 0 1px rgba(124, 92, 255, 0.25)',
            pointerEvents: 'none',
          }}
        />
      )}

      {/* Size readout near cursor */}
      {rect && (
        <div
          style={{
            position: 'absolute',
            left: rect.x + rect.width + 8,
            top: rect.y + rect.height + 8,
            padding: '4px 8px',
            background: 'var(--d-bg-1)',
            color: 'var(--d-text)',
            border: '1px solid var(--d-line)',
            borderRadius: 4,
            fontSize: 11,
            fontFamily: 'var(--f-mono)',
            pointerEvents: 'none',
            boxShadow: 'var(--s-window)',
          }}
        >
          {rect.width}×{rect.height}
        </div>
      )}

      {/* Hint bar */}
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: 24,
          transform: 'translateX(-50%)',
          padding: '6px 12px',
          background: 'var(--d-bg-1)',
          border: '1px solid var(--d-line)',
          borderRadius: 999,
          fontSize: 11,
          color: 'var(--d-text-2)',
          boxShadow: 'var(--s-window)',
          pointerEvents: 'none',
        }}
      >
        Выдели область · <span style={{ fontFamily: 'var(--f-mono)' }}>Esc</span> — отмена
      </div>
    </div>
  );
}

function normalize(d: { startX: number; startY: number; curX: number; curY: number }): Rect {
  const x = Math.min(d.startX, d.curX);
  const y = Math.min(d.startY, d.curY);
  const width = Math.abs(d.curX - d.startX);
  const height = Math.abs(d.curY - d.startY);
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
}
