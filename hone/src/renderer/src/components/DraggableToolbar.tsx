// DraggableToolbar — переиспользуемый floating-toolbar в Hone-стиле.
//
// Поведение:
//   - Появляется в default-позиции (по центру снизу, см. defaultPos).
//   - Drag-handle слева («⋮⋮») — захват + перетаскивание мышью.
//   - Координаты persist в localStorage по storageKey.
//   - Возврат в default position через double-click на drag-handle.
//   - На resize окна toolbar остаётся внутри viewport'а (clamp).
//
// Используется и в SharedBoards, и в Editor (code rooms).
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

interface DraggableToolbarProps {
  storageKey: string;
  /** Default позиция в пикселях относительно viewport'а. */
  defaultPos?: { x: number; y: number };
  children: ReactNode;
}

interface Pos {
  x: number;
  y: number;
}

const HANDLE_SIZE = 24;

export function DraggableToolbar({ storageKey, defaultPos, children }: DraggableToolbarProps) {
  // `dragged: false` → центрируем CSS-ом (`left: 50%`) относительно ROODителя
  // секции (canvas-area), что автоматически следует за shrink/expand sidebar'а.
  // Как только юзер дёрнул toolbar — переключаемся в pixel-fixed режим, тогда
  // localStorage хранит абсолютные viewport-coords.
  const [dragged, setDragged] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(`${storageKey}:dragged`) === '1';
  });

  const computeDefault = useCallback((): Pos => {
    if (defaultPos) return defaultPos;
    if (typeof window === 'undefined') return { x: 0, y: 0 };
    return { x: window.innerWidth / 2, y: 80 };
  }, [defaultPos]);

  const [pos, setPos] = useState<Pos>(() => {
    if (typeof window === 'undefined') return { x: 0, y: 0 };
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as Pos;
        if (Number.isFinite(parsed.x) && Number.isFinite(parsed.y)) return parsed;
      }
    } catch {
      /* ignore */
    }
    return computeDefault();
  });

  // Persist position.
  useEffect(() => {
    if (!dragged) return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(pos));
    } catch {
      /* ignore */
    }
  }, [storageKey, pos, dragged]);
  useEffect(() => {
    try {
      window.localStorage.setItem(`${storageKey}:dragged`, dragged ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [storageKey, dragged]);

  // Clamp on viewport resize — toolbar не должен уезжать за края.
  useEffect(() => {
    const onResize = () => {
      setPos((cur) => {
        const w = window.innerWidth;
        const h = window.innerHeight;
        return {
          x: Math.max(40, Math.min(cur.x, w - 40)),
          y: Math.max(40, Math.min(cur.y, h - 40)),
        };
      });
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);

  const onHandleDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // pos хранится в координатах ОТНОСИТЕЛЬНО offsetParent (canvas section),
    // потому что toolbar'у задан position:absolute. Это критично: когда
    // sidebar collapses, section растягивается, но section-relative coords
    // остаются валидны без пересчёта.
    let origX = pos.x;
    let origY = pos.y;
    const toolbarEl = e.currentTarget.parentElement as HTMLElement | null;
    const parent = toolbarEl?.offsetParent as HTMLElement | null;
    if (!dragged && toolbarEl && parent) {
      const tbRect = toolbarEl.getBoundingClientRect();
      const parRect = parent.getBoundingClientRect();
      // Центр toolbar'а в section-relative coords.
      origX = tbRect.left - parRect.left + tbRect.width / 2;
      origY = tbRect.top - parRect.top;
      setDragged(true);
      setPos({ x: origX, y: origY });
    }
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX,
      origY,
    };
    document.body.style.userSelect = 'none';
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      // Clamp по viewport — щедрый bound, не используем parent.rect т.к.
      // не хотим ограничивать движение если canvas-section рос/уменьшался.
      setPos({
        x: Math.max(20, Math.min(d.origX + dx, window.innerWidth - 20)),
        y: Math.max(20, Math.min(d.origY + dy, window.innerHeight - 60)),
      });
    };
    const onUp = () => {
      dragRef.current = null;
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  const onHandleDoubleClick = () => {
    setDragged(false);
    setPos(computeDefault());
  };

  return (
    <div
      style={{
        position: 'absolute',
        // X ВСЕГДА centered — `left: 50%` относительно nearest positioned
        // ancestor (canvas section). Когда sidebar collapses/expands, секция
        // меняется в ширине, и `50%` автоматически recompute'ится → toolbar
        // плавно следует за центром canvas'а.
        // Y can be dragged — после drag'а pos.y хранится в viewport-coord.
        left: '50%',
        top: dragged ? pos.y : 80,
        transform: 'translate(-50%, 0)',
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '6px 6px 6px 2px',
        background: 'rgba(20,20,22,0.78)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 12,
        boxShadow: '0 6px 28px rgba(0,0,0,0.45)',
        zIndex: 30,
      }}
    >
      <button
        type="button"
        onMouseDown={onHandleDown}
        onDoubleClick={onHandleDoubleClick}
        title="Drag to move (double-click to reset)"
        style={{
          width: HANDLE_SIZE,
          height: HANDLE_SIZE + 8,
          display: 'grid',
          placeItems: 'center',
          background: 'transparent',
          border: 'none',
          cursor: dragRef.current ? 'grabbing' : 'grab',
          color: 'var(--ink-40)',
          borderRadius: 6,
          padding: 0,
          marginRight: 2,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = 'var(--ink-60)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = 'var(--ink-40)';
        }}
      >
        <svg width={10} height={16} viewBox="0 0 10 16" fill="currentColor">
          <circle cx="2" cy="3" r="1.2" />
          <circle cx="8" cy="3" r="1.2" />
          <circle cx="2" cy="8" r="1.2" />
          <circle cx="8" cy="8" r="1.2" />
          <circle cx="2" cy="13" r="1.2" />
          <circle cx="8" cy="13" r="1.2" />
        </svg>
      </button>
      <span
        aria-hidden
        style={{
          width: 1,
          height: 18,
          background: 'rgba(255,255,255,0.08)',
          margin: '0 4px 0 0',
        }}
      />
      {children}
    </div>
  );
}
