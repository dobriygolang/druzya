// Today — bookkeeping module. R10 cleanup 2026-05-05:
// `page === 'today'` рендерит TaskBoardPage (см App.tsx ~line 855), и весь
// 1164-line TodayPage UI стал orphan'ом ещё на focus-refactor (apr 2026,
// см memory/project_redesign_2026_04). Файл свернут до тип-shape'а, чтобы
// startFocus callback'у было что подписать. При возврате surface'а —
// восстановить из git history.

// F2 (2026-05-12) — primary goal section. Self-contained; consumed wherever
// «today» surface'а нужен goal-aware блок. Goal-create flow живёт в web —
// здесь только edit и просмотр. Hidden когда no active goal — anti-fallback
// CTA отправляет юзера в web /profile.

import React, { useState } from 'react';

import { useGoalStore, daysUntil, formatGoalLong } from '../stores/goal';
import { GoalEditModal } from '../components/GoalEditModal';

export interface StartFocusArgs {
  planItemId?: string;
  pinnedTitle?: string;
}

const monoFont = '"JetBrains Mono", ui-monospace, monospace';

// TodayGoalSection — drop-in card. Sticks at top of any Today-like surface.
// Hidden state когда no goal: показывает CTA «Поставь цель в web /profile».
export const TodayGoalSection: React.FC = () => {
  const goal = useGoalStore((s) => s.active);
  const loaded = useGoalStore((s) => s.loaded);
  const [editOpen, setEditOpen] = useState(false);

  if (!loaded && !goal) {
    // First-mount silent — store ещё hydrate'ит, не показываем skeleton
    // чтобы не флипать UI.
    return null;
  }

  if (!goal) {
    return (
      <section style={cardEmpty}>
        <div style={labelRow}>
          <span style={labelMono}>goal</span>
        </div>
        <p style={emptyText}>
          Поставь цель в <span style={accentText}>web /profile</span> — она
          будет видна здесь и в Coach. Hone не делает full wizard, чтобы не
          дублировать UI; цель one-source-of-truth.
        </p>
      </section>
    );
  }

  const { title, deadline } = formatGoalLong(goal);
  const dN = daysUntil(goal.target_date);
  // B/W rule: 1.5px red stripe ONLY когда deadline < 14 days AND > 0.
  const urgent = dN !== null && dN > 0 && dN < 14;

  return (
    <>
      <section
        style={cardActive}
        role="button"
        tabIndex={0}
        onClick={() => setEditOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setEditOpen(true);
          }
        }}
        title="Click to edit goal"
      >
        {urgent && <span aria-hidden style={urgentStripe} />}
        <div style={labelRow}>
          <span style={labelMono}>goal</span>
          <span style={{ ...labelMono, opacity: 0.5 }}>click to edit</span>
        </div>
        <h2 style={titleStyle}>{title}</h2>
        {deadline && (
          <div style={{ ...subStyle, color: urgent ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.5)' }}>
            {deadline}
          </div>
        )}
      </section>
      {editOpen && <GoalEditModal goal={goal} onClose={() => setEditOpen(false)} />}
    </>
  );
};

const cardBase: React.CSSProperties = {
  position: 'relative',
  background: '#0a0a0a',
  border: '1px solid rgba(255,255,255,0.07)',
  borderRadius: 12,
  padding: 20,
  overflow: 'hidden',
  fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif',
  color: 'rgba(255,255,255,0.92)',
};

const cardActive: React.CSSProperties = {
  ...cardBase,
  cursor: 'pointer',
};

const cardEmpty: React.CSSProperties = {
  ...cardBase,
};

const urgentStripe: React.CSSProperties = {
  position: 'absolute',
  top: 0,
  left: 0,
  right: 0,
  height: 1.5,
  background: '#FF3B30',
};

const labelRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginBottom: 8,
};

const labelMono: React.CSSProperties = {
  fontFamily: monoFont,
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  color: 'rgba(255,255,255,0.5)',
};

const titleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 18,
  fontWeight: 600,
  letterSpacing: '-0.01em',
};

const subStyle: React.CSSProperties = {
  marginTop: 4,
  fontSize: 12,
  fontFamily: monoFont,
};

const emptyText: React.CSSProperties = {
  margin: 0,
  fontSize: 13,
  lineHeight: 1.55,
  color: 'rgba(255,255,255,0.7)',
};

const accentText: React.CSSProperties = {
  fontFamily: monoFont,
  fontSize: 12,
  color: 'rgba(255,255,255,0.92)',
};
