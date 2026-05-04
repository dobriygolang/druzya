// EnglishTabsChrome — top-center tab strip для English-loop поверхностей
// (Reading / Writing / Listening). Mirrors the BoardsTabsChrome pattern:
// renders only when active page ∈ {reading, writing, listening}. App.tsx
// routes via `setPage(...)` so the existing per-page hotkeys (R/W/L) и
// palette entries продолжают работать без изменений — chrome просто
// добавляет visual unification и обнаруживает три surface'а как один
// «English» hub.
import type { ReactNode } from 'react';

import type { PageId } from './Palette';

// EnglishTab — public alias на подмножество PageId'ов, входящих в hub.
// Используется App.tsx чтобы сузить тип в callback'е onChange.
export type EnglishTab = Extract<PageId, 'reading' | 'writing' | 'listening' | 'english_overview'>;

interface Props {
  current: EnglishTab;
  onChange: (tab: EnglishTab) => void;
}

export function EnglishTabsChrome({ current, onChange }: Props) {
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
        <TabBtn active={current === 'english_overview'} onClick={() => onChange('english_overview')} kbd="·">
          Overview
        </TabBtn>
        <TabBtn active={current === 'reading'} onClick={() => onChange('reading')} kbd="R">
          Reading
        </TabBtn>
        <TabBtn active={current === 'writing'} onClick={() => onChange('writing')} kbd="W">
          Writing
        </TabBtn>
        <TabBtn active={current === 'listening'} onClick={() => onChange('listening')} kbd="L">
          Listening
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
