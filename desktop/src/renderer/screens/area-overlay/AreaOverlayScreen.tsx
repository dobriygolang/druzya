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

import { Kbd } from '../../components/d9';

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
      className="d9-root"
      style={{
        position: 'fixed',
        inset: 0,
        cursor: 'crosshair',
        background: 'transparent',
        outline: 'none',
        userSelect: 'none',
      }}
    >
      {/* Dimmed backdrop — design/windows.jsx AreaOverlay scrim */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'oklch(0.05 0.01 280 / 0.55)',
          backdropFilter: 'saturate(0.7)',
          WebkitBackdropFilter: 'saturate(0.7)',
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

      {/* Selection outline + corner handles */}
      {rect && (
        <div
          style={{
            position: 'absolute',
            left: rect.x,
            top: rect.y,
            width: rect.width,
            height: rect.height,
            border: '1px solid var(--d9-accent-hi)',
            boxShadow: '0 0 24px -2px var(--d9-accent-glow)',
            pointerEvents: 'none',
          }}
        >
          {[[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y], i) => (
            <span
              key={i}
              style={{
                position: 'absolute',
                left: x ? 'auto' : -3,
                right: x ? -3 : 'auto',
                top: y ? 'auto' : -3,
                bottom: y ? -3 : 'auto',
                width: 7,
                height: 7,
                background: 'var(--d9-ink)',
                border: '1px solid var(--d9-accent-hi)',
              }}
            />
          ))}

          {/* Size readout above selection */}
          <span
            style={{
              position: 'absolute',
              top: -26,
              left: 0,
              fontFamily: 'var(--d9-font-mono)',
              fontSize: 10.5,
              color: 'var(--d9-ink)',
              background: 'rgba(10, 10, 10, 0.85)',
              padding: '3px 6px',
              borderRadius: 4,
              letterSpacing: '0.02em',
              border: '0.5px solid var(--d9-hairline-b)',
            }}
          >
            {rect.width} × {rect.height}
          </span>
        </div>
      )}

      {/* Hint bar — design/windows.jsx AreaOverlay bottom pill */}
      <div
        style={{
          position: 'absolute',
          left: '50%',
          bottom: 24,
          transform: 'translateX(-50%)',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '8px 14px',
          borderRadius: 999,
          background: 'rgba(10, 10, 10, 0.85)',
          backdropFilter: 'var(--d9-glass-blur)',
          WebkitBackdropFilter: 'var(--d9-glass-blur)' as unknown as string,
          boxShadow: 'var(--d9-shadow-pop)',
          border: '0.5px solid var(--d9-hairline-b)',
          fontSize: 12,
          color: 'var(--d9-ink-dim)',
          letterSpacing: '-0.005em',
          pointerEvents: 'none',
        } as React.CSSProperties}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span
            style={{
              width: 5,
              height: 5,
              borderRadius: '50%',
              background: 'var(--d9-accent-hi)',
              boxShadow: '0 0 6px var(--d9-accent-glow)',
            }}
          />
          Выдели область
        </span>
        <span style={{ width: 1, height: 12, background: 'var(--d9-hairline)' }} />
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Kbd size="sm">⏎</Kbd> отправить
        </span>
        <span style={{ width: 1, height: 12, background: 'var(--d9-hairline)' }} />
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Kbd size="sm">Esc</Kbd> отмена
        </span>
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
