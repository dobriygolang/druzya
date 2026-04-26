// DraggableToolbar — переиспользуемый floating-toolbar в Hone-стиле.
//
// Позиционирование:
//   - pos.x / pos.y хранят координаты ЛЕВОГО ВЕРХНЕГО угла toolbar'а
//     в viewport-pixels. Без `translate(-50%)` — раньше был баг: при
//     collapse'е toolbar центрировался вокруг старого pos.x, но full-width
//     resided around что-то другое; в результате expand из левого края
//     кидал toolbar за экран влево. Left-edge anchor устраняет эту
//     путаницу — позиция всегда означает «где у нас левый край».
//   - На первом mount'е default — горизонтально по центру окна.
//   - Drag в любом направлении. Clamp использует РЕАЛЬНУЮ ширину
//     toolbar'а (через ResizeObserver на root-эл-те), чтобы при
//     collapse/expand обе стороны не выезжали за viewport.
//
// Collapse:
//   - Кнопка-chevron сжимает toolbar до handle+chevron-button (~64px).
//   - Анимация max-width 240ms.
//   - localStorage хранит и pos, и collapsed-state (по storageKey).
//   - При expand'е, если правый край вылезет за окно, pos.x сдвигается
//     влево чтобы поместиться (math compensation, без визуального скачка).
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

interface DraggableToolbarProps {
  storageKey: string;
  /** Default позиция в пикселях относительно viewport'а (left-edge). */
  defaultPos?: { x: number; y: number };
  children: ReactNode;
}

interface Pos {
  x: number;
  y: number;
}

const HANDLE_SIZE = 24;
const DEFAULT_TOP = 70;
const COLLAPSED_WIDTH = 64;

export function DraggableToolbar({ storageKey, defaultPos, children }: DraggableToolbarProps) {
  // v3 — формат снова поменялся (с center-anchor на left-anchor).
  // Бамп ключа one-time'ом инвалидирует stale pos'ы из старых билдов
  // (которые могли загнать toolbar за левый край).
  const fullKey = `${storageKey}:v3`;

  const computeDefault = useCallback((): Pos => {
    if (defaultPos) return defaultPos;
    if (typeof window === 'undefined') return { x: 0, y: 0 };
    // Default — горизонтально по центру (предполагая ~360px ширину
    // expanded toolbar'а, дефолт-X ставит её центр в центр окна).
    return { x: Math.max(0, window.innerWidth / 2 - 180), y: DEFAULT_TOP };
  }, [defaultPos]);

  const [pos, setPos] = useState<Pos>(() => {
    if (typeof window === 'undefined') return { x: 0, y: 0 };
    try {
      const raw = window.localStorage.getItem(fullKey);
      if (raw) {
        const parsed = JSON.parse(raw) as Pos;
        if (Number.isFinite(parsed.x) && Number.isFinite(parsed.y)) {
          // Defensive bounds на случай ресайза окна между сессиями.
          const w = window.innerWidth;
          const h = window.innerHeight;
          return {
            x: Math.max(0, Math.min(parsed.x, w - 80)),
            y: Math.max(0, Math.min(parsed.y, h - 60)),
          };
        }
      }
    } catch {
      /* ignore */
    }
    return computeDefault();
  });

  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(`${storageKey}:collapsed`) === '1';
  });

  // Persist position + collapsed.
  useEffect(() => {
    try {
      window.localStorage.setItem(fullKey, JSON.stringify(pos));
    } catch {
      /* ignore */
    }
  }, [fullKey, pos]);
  useEffect(() => {
    try {
      window.localStorage.setItem(`${storageKey}:collapsed`, collapsed ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [storageKey, collapsed]);

  // Реальная ширина root-эл-та — нужна для точного clamp'а на drag'е и
  // компенсации overflow при expand'е.
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState<number>(() => (collapsed ? COLLAPSED_WIDTH : 360));

  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = entry.contentRect.width + 14; // +padding
        if (w > 0) setWidth(w);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // При expand'е (collapsed → false) проверяем что toolbar не вылезет за
  // правый край. Если вылезет — сдвигаем pos.x влево. Анимация max-width
  // в это время плавно расширяет toolbar — pos.x подвигается одновременно,
  // выглядит как «toolbar отползает чтоб поместиться».
  useEffect(() => {
    if (collapsed) return;
    // Аппроксимация expanded-ширины (точное значение появится после
    // ResizeObserver tick'а, но к тому моменту transition уже почти
    // отыграл — корректировка должна быть upfront).
    const expandedW = Math.max(width, 320);
    setPos((cur) => {
      const w = window.innerWidth;
      if (cur.x + expandedW > w - 8) {
        return { ...cur, x: Math.max(0, w - expandedW - 8) };
      }
      return cur;
    });
  }, [collapsed, width]);

  // Clamp on viewport resize.
  useEffect(() => {
    const onResize = () => {
      setPos((cur) => {
        const w = window.innerWidth;
        const h = window.innerHeight;
        return {
          x: Math.max(0, Math.min(cur.x, w - width - 8)),
          y: Math.max(0, Math.min(cur.y, h - 60)),
        };
      });
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [width]);

  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);

  const onHandleDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: pos.x,
      origY: pos.y,
    };
    document.body.style.userSelect = 'none';
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      const w = window.innerWidth;
      const h = window.innerHeight;
      // Используем РЕАЛЬНУЮ ширину для clamp'а — раньше был константный
      // bound 40, который пропускал toolbar за стену в expanded-режиме
      // и блокировал лишнее в collapsed.
      setPos({
        x: Math.max(0, Math.min(d.origX + dx, w - width - 8)),
        y: Math.max(0, Math.min(d.origY + dy, h - 50)),
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
  }, [width]);

  const onHandleDoubleClick = () => {
    setPos(computeDefault());
  };

  return (
    <div
      ref={rootRef}
      style={{
        position: 'fixed',
        // Pos — координата ЛЕВОГО ВЕРХНЕГО угла. Без translate(-50%):
        // collapse/expand'ы остаются в предсказуемых границах.
        left: pos.x,
        top: pos.y,
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
        maxWidth: collapsed ? COLLAPSED_WIDTH : 720,
        overflow: 'hidden',
        transition:
          'max-width 240ms cubic-bezier(0.2, 0.7, 0.2, 1),' +
          'padding 240ms cubic-bezier(0.2, 0.7, 0.2, 1)',
      }}
    >
      <button
        type="button"
        onMouseDown={onHandleDown}
        onDoubleClick={onHandleDoubleClick}
        title="Drag to move (double-click to reset position)"
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
          flexShrink: 0,
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
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        title={collapsed ? 'Expand toolbar' : 'Collapse toolbar'}
        style={{
          width: 20,
          height: 24,
          display: 'grid',
          placeItems: 'center',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          color: 'var(--ink-40)',
          borderRadius: 6,
          padding: 0,
          marginRight: 4,
          flexShrink: 0,
          transition: 'color 140ms ease',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = 'var(--ink)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = 'var(--ink-40)';
        }}
      >
        <svg
          width={10}
          height={10}
          viewBox="0 0 10 10"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.6}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            transform: collapsed ? 'rotate(0deg)' : 'rotate(180deg)',
            transition: 'transform 240ms cubic-bezier(0.2, 0.7, 0.2, 1)',
          }}
        >
          <polyline points="3 2 7 5 3 8" />
        </svg>
      </button>
      <span
        aria-hidden
        style={{
          width: 1,
          height: 18,
          background: 'rgba(255,255,255,0.08)',
          margin: '0 4px 0 0',
          flexShrink: 0,
          opacity: collapsed ? 0 : 1,
          transition: 'opacity 200ms ease',
        }}
      />
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          opacity: collapsed ? 0 : 1,
          pointerEvents: collapsed ? 'none' : 'auto',
          transition: 'opacity 180ms ease',
        }}
      >
        {children}
      </div>
    </div>
  );
}
