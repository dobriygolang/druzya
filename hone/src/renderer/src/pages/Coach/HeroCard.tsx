import React, { useMemo } from 'react';
import type { NextAction } from '../../api/intelligence';
import { type Mode, dimColor } from './lib/types';
import {
  monoFont,
  heroCard,
  heroChips,
  heroTitle,
  hairline,
  whyBox,
  whyLabel,
  heroActions,
  btnPrimary,
  btnGhost,
  chipStyle,
} from './lib/styles';

interface HeroCardProps {
  mode: Mode;
  loading: boolean;
  error: string | null;
  action: NextAction | null;
  onStart: () => void;
  onSkip: () => void;
  onSuggestOther: () => void;
}

export const HeroCard: React.FC<HeroCardProps> = ({ mode, loading, error, action, onStart, onSkip, onSuggestOther }) => {
  const slot = useMemo(() => {
    if (mode === 'commit') return 'today · committed track';
    if (mode === 'deep') return 'today · deep prep';
    return 'today · explore';
  }, [mode]);

  // Mark monoFont as imported for tsconfig — it's used in chip styles below
  void monoFont;

  return (
    <section style={heroCard}>
      <div style={heroChips}>
        <span style={chipStyle}>{slot}</span>
        <span style={chipStyle}>{action?.actionKind ?? 'focus_block'}</span>
        <span style={{ ...dimColor(0.3), marginLeft: 'auto', fontSize: 11, fontFamily: monoFont }}>
          est {action?.estimatedMinutes ?? 25} min
        </span>
      </div>

      <h1 style={heroTitle}>
        {loading
          ? 'loading…'
          : error
          ? 'unable to load next action'
          : action?.target || 'no action queued'}
      </h1>
      <p style={{ ...dimColor(0.7), fontSize: 13, marginBottom: 24 }}>
        {action?.actionKind ? `kind: ${action.actionKind}` : 'AI selects one concrete next step from your state.'}
      </p>

      <div style={hairline} />

      <div style={whyBox}>
        <div style={whyLabel}>why</div>
        <p style={{ ...dimColor(0.7), fontSize: 13, lineHeight: 1.55 }}>
          {action?.rationale ?? (loading ? '' : 'AI rationale appears here once loaded.')}
        </p>
      </div>

      <div style={heroActions}>
        <button
          style={btnPrimary}
          disabled={loading || !action}
          onClick={onStart}
          title="Pin this task and start a focus session"
        >
          {loading ? 'loading…' : `start ${action?.estimatedMinutes ?? 25} min`}
        </button>
        <button
          style={btnGhost}
          disabled={loading}
          onClick={onSkip}
          title="Mark this resource as skipped — AI proposes the next one"
        >
          not now
        </button>
        <button
          style={btnGhost}
          disabled={loading}
          onClick={onSuggestOther}
          title="Ask AI for an alternative recommendation"
        >
          try another
        </button>
      </div>
    </section>
  );
};
