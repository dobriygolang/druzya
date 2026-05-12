// TutorTabsChrome — top-center tab strip для tutor-related surfaces
// (Assignments / Calendar). Mirrors EnglishTabsChrome / BoardsTabsChrome.
// Hotkeys A / M остаются работать напрямую — chrome это visual hub
// indicator, не отдельная страница.
//
// NOTE (foundation Tabs primitive @ ./primitives/Tabs):
// Foundation `Tabs` доступен (variants: underline | segmented), но не
// покрывает floating-pill chrome semantics этого компонента (rounded 999,
// blurred backdrop, absolute top-center, per-tab kbd chip, Electron
// WebkitAppRegion двухслойную разметку). Миграция сейчас compromise'нула
// бы UX. Оставляем inline до расширения foundation primitive новым `pill`
// variant + endAdornment slot.
import type { ReactNode } from 'react';

import type { PageId } from './Palette';

export type TutorTab = Extract<PageId, 'assignments' | 'calendar'>;

interface Props {
  current: TutorTab;
  onChange: (tab: TutorTab) => void;
}

export function TutorTabsChrome({ current, onChange }: Props) {
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
          // @ts-expect-error — Electron-specific CSS prop
          WebkitAppRegion: 'no-drag',
        }}
      >
        <TabBtn active={current === 'assignments'} onClick={() => onChange('assignments')} kbd="A">
          Tasks
        </TabBtn>
        <TabBtn active={current === 'calendar'} onClick={() => onChange('calendar')} kbd="M">
          Calendar
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
      role="tab"
      aria-selected={active}
      aria-pressed={active}
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
        transition: 'background-color var(--motion-dur-small) var(--motion-ease-standard), color var(--motion-dur-small) var(--motion-ease-standard)',
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
