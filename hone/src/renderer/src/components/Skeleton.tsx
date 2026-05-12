// Skeleton — loading placeholders в b/w aesthetic Hone'а.
//
// Использует `.shimmer` класс из globals.css (linear-gradient через
// rgba(255,255,255,0.04→0.08→0.04), animation 1.4s ease-in-out infinite).
// Reduced-motion media query в globals.css сам отключает animation для
// accessibility — тут ничего не делаем.
//
// Variants:
//   - <SkeletonLine width={...}/> — одна строка text-уровня
//   - <SkeletonCard/> — карточка с paddings
//   - <PageSkeleton/> — full-page placeholder для Suspense fallback
//     lazy-pages. Геометрия: top header bar + 3 ряда карточек.
import React from 'react';

export interface SkeletonLineProps {
  width?: number | string;
  height?: number;
  style?: React.CSSProperties;
}

export function SkeletonLine({ width = '100%', height = 12, style }: SkeletonLineProps): React.ReactElement {
  return (
    <div
      className="shimmer"
      style={{
        width,
        height,
        borderRadius: 6,
        ...style,
      }}
      aria-hidden
    />
  );
}

export interface SkeletonCardProps {
  height?: number;
  style?: React.CSSProperties;
}

export function SkeletonCard({ height = 96, style }: SkeletonCardProps): React.ReactElement {
  return (
    <div
      className="shimmer"
      style={{
        width: '100%',
        height,
        borderRadius: 10,
        border: '1px solid rgba(255,255,255,0.04)',
        ...style,
      }}
      aria-hidden
    />
  );
}

// PageSkeleton — заполняет всю canvas-area пока lazy chunk грузится. Не
// imitate'ит конкретную page (TaskBoard vs Notes выглядят по-разному), а
// показывает generic «что-то грузится» placeholder в стиле Hone — без
// spinner'а или text «loading…».
export function PageSkeleton(): React.ReactElement {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        padding: '64px 32px 28px',
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
      }}
      aria-busy="true"
      aria-live="polite"
    >
      {/* Header strip */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <SkeletonLine width={120} height={14} />
        <div style={{ flex: 1 }} />
        <SkeletonLine width={64} height={14} />
      </div>
      {/* Content rows */}
      <div style={{ display: 'flex', gap: 16 }}>
        <SkeletonCard style={{ flex: 1 }} height={120} />
        <SkeletonCard style={{ flex: 1 }} height={120} />
        <SkeletonCard style={{ flex: 1 }} height={120} />
      </div>
      <SkeletonCard height={200} />
      <SkeletonCard height={140} />
    </div>
  );
}
