// SettingsTabs — minimal B/W horizontal tab strip for Settings page.
//
// Phase K Wave 15 redesign: вместо continuous-scroll длинного полотна
// разбиваем секции по вкладкам. Inline-стилизация чтобы не тянуть лишний
// CSS-модуль; design язык повторяет TutorTabsChrome (см. memory note
// про consistent tab chrome aesthetic), но без position:absolute —
// это inline-стрип внутри основной страницы.
import type { ReactNode } from 'react';

export interface TabDef<T extends string> {
  id: T;
  label: string;
}

interface Props<T extends string> {
  tabs: ReadonlyArray<TabDef<T>>;
  current: T;
  onChange: (id: T) => void;
}

export function SettingsTabs<T extends string>({ tabs, current, onChange }: Props<T>) {
  return (
    <div
      role="tablist"
      aria-label="Settings sections"
      style={{
        display: 'flex',
        gap: 2,
        // Голый flex-row: без bg/border/blur/padding-окантовки — иначе
        // получается «коробка вокруг коробки» (page → tabs-pill → active-pill).
        // Активный таб сам несёт визуальный вес через свой pill-background.
        flexWrap: 'wrap',
        rowGap: 4,
      }}
    >
      {tabs.map((t) => (
        <TabBtn
          key={t.id}
          active={current === t.id}
          onClick={() => onChange(t.id)}
        >
          {t.label}
        </TabBtn>
      ))}
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      role="tab"
      aria-selected={active}
      aria-pressed={active}
      className="focus-ring"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '7px 14px',
        borderRadius: 8,
        background: active ? 'rgba(255,255,255,0.08)' : 'transparent',
        color: active ? 'var(--ink)' : 'var(--ink-60)',
        fontSize: 13,
        fontWeight: active ? 500 : 400,
        border: 'none',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        fontFamily: 'inherit',
        transition:
          'background-color var(--motion-dur-small) var(--motion-ease-standard),' +
          'color var(--motion-dur-small) var(--motion-ease-standard)',
      }}
      onMouseEnter={(e) => {
        if (!active) {
          e.currentTarget.style.color = 'var(--ink-90)';
        }
      }}
      onMouseLeave={(e) => {
        if (!active) {
          e.currentTarget.style.color = 'var(--ink-60)';
        }
      }}
    >
      {children}
    </button>
  );
}
