// EnglishTabsChrome — top-center tab strip для English-loop поверхностей
// (Reading / Writing / Listening). Mirrors the BoardsTabsChrome pattern:
// renders only when active page ∈ {reading, writing, listening}. App.tsx
// routes via `setPage(...)` so the existing per-page hotkeys (R/W/L) и
// palette entries продолжают работать без изменений — chrome просто
// добавляет visual unification и обнаруживает три surface'а как один
// «English» hub.
//
// 2026-05-12: token-based transitions (was 140ms ease), hairline border
// via var(--hair-2), kbd chip caption-mono 0.08em canonical.
//
// NOTE (foundation Tabs primitive @ ./primitives/Tabs):
// Foundation `Tabs` доступен (variants: underline | segmented), но он не
// покрывает важные особенности этого chrome:
//   - floating pill chrome (rounded 999, blurred backdrop, absolute top-center)
//   - per-tab kbd hint chip (R/W/L) — affordance для существующих hotkeys
//   - Electron WebkitAppRegion: 'no-drag' / 'auto' двухслойная разметка,
//     чтобы drag-region не съедал клики и остальной titlebar оставался drag'able
// Миграция на foundation Tabs сейчас compromise'нула бы UX. Оставляем inline
// до расширения foundation primitive новым `pill` variant + endAdornment slot.
import type { ReactNode } from 'react';

import type { PageId } from './Palette';

// EnglishTab — public alias на подмножество PageId'ов, входящих в hub.
// Используется App.tsx чтобы сузить тип в callback'е onChange.
export type EnglishTab = Extract<PageId, 'reading' | 'writing' | 'listening' | 'speaking' | 'english_overview'>;

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
          background: 'rgba(10, 10, 10, 0.78)',
          border: '1px solid var(--hair-2)',
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
        <TabBtn active={current === 'speaking'} onClick={() => onChange('speaking')} kbd="K">
          Speaking
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
      className="row focus-ring motion-press"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 14px',
        borderRadius: 999,
        background: active ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
        color: active ? 'var(--ink)' : 'var(--ink-60)',
        fontSize: 12,
        fontWeight: 500,
        border: 0,
        cursor: 'pointer',
        transition:
          'background-color var(--motion-dur-small) var(--motion-ease-standard), color var(--motion-dur-small) var(--motion-ease-standard), transform var(--motion-dur-small) var(--motion-ease-standard)',
      }}
      onMouseEnter={(e) => {
        if (!active) {
          e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)';
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
        style={{
          fontFamily: "'JetBrains Mono', ui-monospace, monospace",
          fontSize: 9,
          fontWeight: 600,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          padding: '1px 6px',
          borderRadius: 4,
          border: '1px solid var(--hair)',
          background: 'transparent',
          color: 'var(--ink-40)',
        }}
      >
        {kbd}
      </span>
    </button>
  );
}
