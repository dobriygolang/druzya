import React from 'react';
import { daysUntil, formatGoalChip } from '../../stores/goal';
import type { MemoryStats, PrimaryGoal } from '../../api/intelligence';
import { type Mode, MODES, dimColor } from './lib/types';
import {
  monoFont,
  headerWrap,
  headerLeft,
  modeBox,
  modeIndicator,
  modeBtn,
  chipStyle,
} from './lib/styles';

interface CoachHeaderProps {
  mode: Mode;
  onModeClick: (m: Mode) => void;
  modeIdx: number;
  exploreWeek?: number;
  memoryStats?: MemoryStats | null;
  goal?: PrimaryGoal | null;
  onGoalClick?: () => void;
}

export const CoachHeader: React.FC<CoachHeaderProps> = ({
  mode,
  onModeClick,
  modeIdx,
  exploreWeek,
  memoryStats,
  goal,
  onGoalClick,
}) => {
  // F2: red stripe только когда deadline < 14 дней AND ещё не прошёл —
  // urgent visual hint. B/W rule: 1.5px red stripe only.
  const dN = daysUntil(goal?.target_date);
  const urgent = goal !== null && goal !== undefined && dN !== null && dN > 0 && dN < 14;
  return (
  <header style={headerWrap}>
    <div style={headerLeft}>
      <span style={{ ...dimColor(0.5), fontSize: 11, fontFamily: monoFont, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
        coach
      </span>
      {/* F2 goal chip — hidden когда no goal (anti-fallback). Click → edit. */}
      {goal && (
        <button
          type="button"
          onClick={onGoalClick}
          title="Edit goal"
          style={{
            ...chipStyle,
            position: 'relative',
            cursor: 'pointer',
            background: '#111',
            border: '1px solid rgba(255,255,255,0.07)',
            color: 'rgba(255,255,255,0.85)',
            fontFamily: monoFont,
          }}
        >
          {urgent && (
            <span
              aria-hidden
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                height: 1.5,
                background: '#FF3B30',
                borderTopLeftRadius: 4,
                borderTopRightRadius: 4,
              }}
            />
          )}
          {`Цель: ${formatGoalChip(goal)}`}
        </button>
      )}
      {/* F1 trust badge: показывается только когда есть события. До этого
        фолбек — голый «coach», без fake-пустого «knows 0 events» (anti-
        fallback rule: не симулируем несуществующую память). */}
      {memoryStats && memoryStats.total30d > 0 && (
        <span style={chipStyle}>
          {`помнит ${memoryStats.total30d} ${memoryStats.total30d >= 10 ? 'событий · 30 дн' : 'событий'}`}
        </span>
      )}
      {mode === 'explore' && exploreWeek !== undefined && exploreWeek > 0 && (
        <span style={chipStyle}>{`explore · w${exploreWeek}`}</span>
      )}
    </div>

    <div role="tablist" aria-label="Learning mode" style={modeBox}>
      <div
        aria-hidden
        style={{
          ...modeIndicator,
          transform: `translateX(${modeIdx * 100}%)`,
        }}
      />
      {MODES.map((m) => (
        <button
          key={m.key}
          onClick={() => onModeClick(m.key)}
          role="tab"
          aria-selected={mode === m.key}
          aria-pressed={mode === m.key}
          style={{
            ...modeBtn,
            color: mode === m.key ? 'rgba(255,255,255,0.92)' : 'rgba(255,255,255,0.5)',
          }}
        >
          {m.label.toLowerCase()}
        </button>
      ))}
    </div>

    <div style={{ width: 80 }} aria-hidden />
  </header>
  );
};
