// Area-picker crosshair overlay — Variant A (CGAssociate freeze).
//
// Системный курсор «заморожен» через CursorHelper (Swift, CGAssociate(0)),
// поэтому viewer'ы при demo-share видят неподвижный курсор там же где он
// был ДО открытия overlay'я. Это и был главный pain-point: раньше viewer
// видел реальный drag прямоугольника.
//
// Внутри overlay'я (stealth, не captured) рисуем СВОЙ виртуальный курсор
// + рамку выделения. Viewer ничего из этого не видит (overlay скрыт
// NSWindowSharingNone). Юзер видит и драгует как обычно.
//
// Координация:
//   1. На mount подписываемся на `onAreaInitialCursor` — main шлёт
//      seed-position системного курсора (тот, на котором его заморозили).
//   2. event.movementX/Y приходят от Chromium даже когда системный курсор
//      детачнут (читается NSEvent.deltaX/Y напрямую). Интегрируем в
//      virtualPos += movement.
//   3. Real pointer-events (mousedown/up) фаерятся под frozen-cursor'ом —
//      используем их КАК TRIGGER'ы для begin/end-drag, но координаты
//      берём из virtualPos (event.clientX/Y устаревшие).
//   4. Esc / right-click cancel; Enter — альтернатива mouseup на случай
//      если юзер хочет завершить выбор клавиатурой.

import { useCallback, useEffect, useRef, useState } from 'react';

import { Kbd } from '../../components/d9';

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

type Drag =
  | { kind: 'idle' }
  | { kind: 'dragging'; startX: number; startY: number };

export function AreaOverlayScreen() {
  // Virtual cursor position в логических pixels viewport'а.
  // Initial value (0, 0) сразу заменится на seed из main.
  const [virtual, setVirtual] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  // Window'у нужны абсолютные screen-coords для seed'а — конвертируем
  // в виртуальные client-coords один раз в onAreaInitialCursor.
  const windowScreenOriginRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const [drag, setDrag] = useState<Drag>({ kind: 'idle' });
  const rootRef = useRef<HTMLDivElement>(null);

  // Seed virtual cursor at overlay open. Main передаёт ABSOLUTE screen
  // coords, мы конвертируем в viewport client coords (overlay = primary
  // display fullscreen → window.screenX/Y дают origin окна).
  useEffect(() => {
    const off = window.druz9.capture.onAreaInitialCursor((pt) => {
      windowScreenOriginRef.current = { x: window.screenX, y: window.screenY };
      setVirtual({
        x: Math.max(0, pt.x - window.screenX),
        y: Math.max(0, pt.y - window.screenY),
      });
    });
    return off;
  }, []);

  // Esc / Enter в одном listener'е. Enter — альтернатива «mouseup»
  // когда юзер хочет завершить selection клавиатурой (handy если
  // freeze-cursor работает не идеально и pointer-events flaky).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        window.druz9.capture.cancelArea();
        return;
      }
      if (e.key === 'Enter' && drag.kind === 'dragging') {
        commitFromState(drag, virtual);
      }
    };
    window.addEventListener('keydown', onKey);
    rootRef.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [drag, virtual]);

  // Pointer-move: при freeze cursor'е clientX/Y стоит, но movementX/Y
  // приходит из NSEvent.deltaX/Y — интегрируем поверх virtual.
  const onPointerMove = useCallback((e: React.PointerEvent) => {
    setVirtual((cur) => {
      const nx = clamp(cur.x + e.movementX, 0, window.innerWidth);
      const ny = clamp(cur.y + e.movementY, 0, window.innerHeight);
      return { x: nx, y: ny };
    });
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button === 2) {
        window.druz9.capture.cancelArea();
        return;
      }
      // Click pos из события не используем — он stale из-за frozen
      // cursor'а. Берём текущий virtual.
      setDrag({ kind: 'dragging', startX: virtual.x, startY: virtual.y });
    },
    [virtual],
  );

  const onPointerUp = useCallback(() => {
    if (drag.kind !== 'dragging') return;
    commitFromState(drag, virtual);
  }, [drag, virtual]);

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    window.druz9.capture.cancelArea();
  };

  const rect =
    drag.kind === 'dragging' ? normalize(drag.startX, drag.startY, virtual.x, virtual.y) : null;

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
        // cursor: 'none' прячет системный курсор пока pointer внутри
        // overlay'я. Это второй слой защиты помимо CGAssociate'а — даже
        // если CursorHelper binary не нашёлся (state=unavailable), CSS
        // hide уберёт курсор хотя бы для viewer'ов чьи захватчики
        // экрана уважают macOS' [NSCursor hide].
        cursor: 'none',
        background: 'transparent',
        outline: 'none',
        userSelect: 'none',
      }}
    >
      {/* Dimmed backdrop */}
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

      {/* Selection outline */}
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

          {/* Size readout */}
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

      {/* Virtual cursor — наш собственный crosshair sprite. Рисуется
          поверх backdrop'а, под выделением (pointer-events: none так
          что не перехватывает наши же mouse-events). */}
      <VirtualCursor x={virtual.x} y={virtual.y} />

      {/* Hint bar */}
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

function commitFromState(drag: Drag, virtual: { x: number; y: number }): void {
  if (drag.kind !== 'dragging') return;
  const rect = normalize(drag.startX, drag.startY, virtual.x, virtual.y);
  if (rect.width < 4 || rect.height < 4) {
    window.druz9.capture.cancelArea();
    return;
  }
  window.druz9.capture.commitArea(rect);
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function normalize(x1: number, y1: number, x2: number, y2: number): Rect {
  const x = Math.min(x1, x2);
  const y = Math.min(y1, y2);
  const width = Math.abs(x2 - x1);
  const height = Math.abs(y2 - y1);
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
}

/**
 * Crosshair-style cursor sprite. Стилизован под d9 / accent — viewer
 * никогда не увидит (overlay stealth), это чисто визуальная подсказка
 * юзеру где сейчас «виртуальный» курсор.
 */
function VirtualCursor({ x, y }: { x: number; y: number }) {
  const SIZE = 22;
  const HALF = SIZE / 2;
  return (
    <div
      style={{
        position: 'absolute',
        left: x - HALF,
        top: y - HALF,
        width: SIZE,
        height: SIZE,
        pointerEvents: 'none',
        zIndex: 10,
      }}
    >
      {/* Horizontal line */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: HALF - 0.5,
          width: SIZE,
          height: 1,
          background: 'var(--d9-accent-hi)',
          boxShadow: '0 0 4px var(--d9-accent-glow)',
        }}
      />
      {/* Vertical line */}
      <div
        style={{
          position: 'absolute',
          left: HALF - 0.5,
          top: 0,
          width: 1,
          height: SIZE,
          background: 'var(--d9-accent-hi)',
          boxShadow: '0 0 4px var(--d9-accent-glow)',
        }}
      />
      {/* Center dot */}
      <div
        style={{
          position: 'absolute',
          left: HALF - 2,
          top: HALF - 2,
          width: 4,
          height: 4,
          borderRadius: '50%',
          background: 'var(--d9-ink)',
          border: '1px solid var(--d9-accent-hi)',
        }}
      />
    </div>
  );
}
