import React from 'react';

import { useT } from '@d9-i18n';

import type { NextAction } from '../../api/intelligence';
import { trackEvent } from '../../api/events';
import {
  openWebMock,
  openDruz9Web,
  openWebAtlasStruggle,
  openWebInsights,
} from '../../lib/cross-app-links';
import { monoFont } from './lib/styles';

/**
 * CrossAppReminder — Phase J / X4 (P1). Subtle footer на Coach page.
 *
 * Tier 1 (action mentions mock/interview): clickable chip → openWebMock().
 * Tier 2 (всегда): tiny footer-line «for full 5-stage mock interviews, see
 * druz9.online → /mock».
 *
 * Не CTA-banner, не блокирующий разводчик. Просто чтобы юзер знал что
 * Hone не делает полный mock loop — это live в web.
 */
export const CrossAppReminder: React.FC<{ action: NextAction | null }> = ({ action }) => {
  // Parse action target / kind / rationale на mock-related keywords.
  // EN + RU чтобы поймать оба языка LLM output'а.
  const text = `${action?.target ?? ''} ${action?.actionKind ?? ''} ${action?.rationale ?? ''}`.toLowerCase();
  const hasMockKeyword = /\b(mock|sysdesign|sys-design|system design|interview|собес|собесе|интервью|мок)\b/.test(text);

  // Tracking — focus_end event уже tracking'ит inside App. Здесь — отдельный
  // touchpoint для понимания насколько reminder reaches click. Не add'им new
  // event схему, переиспользуем coach_action_start с extra context.
  const onChipClick = (): void => {
    trackEvent('cross_app_open', { source: 'coach_chip', target: 'web_mock' });
    openWebMock();
  };
  const onFooterClick = (): void => {
    trackEvent('cross_app_open', { source: 'coach_footer', target: 'web_root' });
    openDruz9Web();
  };

  return (
    <div
      style={{
        marginTop: 28,
        paddingTop: 18,
        borderTop: '1px solid rgba(255,255,255,0.05)',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      {hasMockKeyword && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)' }}>
            Looks like a mock-style task —
          </span>
          <button
            type="button"
            onClick={onChipClick}
            className="focus-ring"
            style={{
              padding: '4px 10px',
              background: 'transparent',
              border: '1px solid rgba(255,255,255,0.18)',
              borderRadius: 4,
              color: 'rgba(255,255,255,0.85)',
              fontSize: 11,
              fontFamily: monoFont,
              letterSpacing: '0.04em',
              cursor: 'pointer',
            }}
            title="Open druz9.online → /mock for the full 5-stage pipeline"
          >
            open mock pipeline →
          </button>
        </div>
      )}
      {/* X5 (Phase J P2 2026-05-12) — deeper CTAs depending on action target.
          When target looks like an atlas anchor («node:…», «track:…»), allow
          jump to the struggle highlight surface on web Atlas. When action is
          a review type, jump to web Insights timeline. Both nil-safe — only
          render when the action target/text actually matches. */}
      <CoachActionDeepCTAs action={action} />
      <p
        style={{
          margin: 0,
          fontSize: 11,
          color: 'rgba(255,255,255,0.4)',
          lineHeight: 1.5,
          fontFamily: monoFont,
          letterSpacing: '0.02em',
        }}
      >
        Hone = тихий ежедневный coach. For full 5-stage mock interviews,
        Skill Atlas, and Codex curation, see{' '}
        <button
          type="button"
          onClick={onFooterClick}
          style={{
            background: 'transparent',
            border: 0,
            padding: 0,
            color: 'rgba(255,255,255,0.7)',
            textDecoration: 'underline',
            textUnderlineOffset: 2,
            cursor: 'pointer',
            font: 'inherit',
          }}
        >
          druz9.online
        </button>
        .
      </p>
    </div>
  );
};

// CoachActionDeepCTAs — X5 (Phase J P2 2026-05-12) deep handoff CTAs.
// Parses action target and decides which web surface to surface as one-line
// link. Stays subtle: text-only, no visual weight beyond CrossAppReminder.
const CoachActionDeepCTAs: React.FC<{ action: NextAction | null }> = ({ action }) => {
  const t = useT();
  if (!action) return null;
  const target = (action.target ?? '').trim();
  const kind = (action.actionKind ?? '').toLowerCase();

  // Atlas-anchor target — «node:dist-sharding» / «track:senior-backend».
  const atlasMatch = target.match(/^(?:node|atlas|track):(.+)$/i);
  const insightMatch = kind === 'review_resource' || kind === 'reflection';

  if (!atlasMatch && !insightMatch) return null;

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 14,
        alignItems: 'center',
        fontFamily: monoFont,
        fontSize: 10,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        color: 'rgba(255,255,255,0.4)',
      }}
    >
      {atlasMatch && (
        <button
          type="button"
          onClick={() => {
            trackEvent('cross_app_open', { source: 'coach_deep_cta', target: 'web_atlas_struggle' });
            openWebAtlasStruggle(target.toLowerCase());
          }}
          style={{
            background: 'transparent',
            border: 0,
            padding: 0,
            font: 'inherit',
            color: 'inherit',
            textDecoration: 'underline',
            textUnderlineOffset: 2,
            cursor: 'pointer',
          }}
          title={t('hone.coach.cross.open_atlas_title')}
        >
          view on web atlas →
        </button>
      )}
      {insightMatch && (
        <button
          type="button"
          onClick={() => {
            trackEvent('cross_app_open', { source: 'coach_deep_cta', target: 'web_insights' });
            openWebInsights();
          }}
          style={{
            background: 'transparent',
            border: 0,
            padding: 0,
            font: 'inherit',
            color: 'inherit',
            textDecoration: 'underline',
            textUnderlineOffset: 2,
            cursor: 'pointer',
          }}
          title={t('hone.coach.cross.open_insights_title')}
        >
          insights timeline →
        </button>
      )}
    </div>
  );
};
