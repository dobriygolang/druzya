// BoardsTabsChrome — top-center «Boards / Code rooms» tabs в строке chrome'а
// (рядом с HONE / ESC HONE). Появляется только когда мы на одной из этих
// двух страниц. Позиционируется absolutely по top:0 страницы и draggable
// region отключён над собой (pointerEvents: auto).
import type { ReactNode } from 'react';

export type BoardsTab = 'shared_boards' | 'editor';

interface Props {
  current: BoardsTab;
  onChange: (tab: BoardsTab) => void;
}

export function BoardsTabsChrome({ current, onChange }: Props) {
  return (
    <div
      style={{
        position: 'absolute',
        top: 18,
        left: 0,
        right: 0,
        display: 'flex',
        justifyContent: 'center',
        zIndex: 12,
        pointerEvents: 'none',
        // Top chrome — drag region (см. App.tsx WebkitAppRegion: 'drag').
        // Tabs живут поверх и должны быть кликабельны.
      }}
    >
      <div
        style={{
          display: 'flex',
          gap: 4,
          padding: 4,
          borderRadius: 999,
          background: 'rgba(10,10,10,0.78)',
          border: '1px solid rgba(255,255,255,0.07)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          pointerEvents: 'auto',
          // Электрон trafficlights / chrome драг — не мешаем кликам,
          // явно отключаем drag-region над контейнером.
          // @ts-expect-error — vendor CSS prop
          WebkitAppRegion: 'no-drag',
        }}
      >
        <TabBtn
          active={current === 'shared_boards'}
          onClick={() => onChange('shared_boards')}
          kbd="B"
        >
          Boards
        </TabBtn>
        <TabBtn active={current === 'editor'} onClick={() => onChange('editor')} kbd="E">
          Code rooms
        </TabBtn>
      </div>
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  kbd,
  children,
}: {
  active: boolean;
  onClick: () => void;
  kbd: string;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="row focus-ring"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 14px',
        borderRadius: 999,
        background: active ? 'rgba(255,255,255,0.08)' : 'transparent',
        color: active ? 'var(--ink)' : 'var(--ink-60)',
        fontSize: 12.5,
        fontWeight: 500,
        border: 'none',
        cursor: 'pointer',
        transition: 'background-color 140ms ease, color 140ms ease',
      }}
      onMouseEnter={(e) => {
        if (!active) {
          e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
          e.currentTarget.style.color = 'var(--ink)';
        }
      }}
      onMouseLeave={(e) => {
        if (!active) {
          e.currentTarget.style.background = 'transparent';
          e.currentTarget.style.color = 'var(--ink-60)';
        }
      }}
    >
      {children}
      <span
        className="mono"
        style={{
          fontSize: 9,
          letterSpacing: '0.04em',
          padding: '1px 5px',
          borderRadius: 4,
          background: 'rgba(255,255,255,0.04)',
          color: 'var(--ink-40)',
        }}
      >
        {kbd}
      </span>
    </button>
  );
}
