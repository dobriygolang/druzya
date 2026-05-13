import React, { useMemo } from 'react';
import type { ResourceTrail, ResourceTouch } from '../../api/intelligence';
import { dimColor } from './lib/types';
import { monoFont, feedCard } from './lib/styles';

export const ActivityFeed: React.FC<{ trail: ResourceTrail | null }> = ({ trail }) => {
  // Merge все 4 buckets в одну ленту, sort по hours_ago ASC (newest first).
  const events = useMemo(() => {
    if (!trail) return [];
    return [
      ...trail.finishedRecent,
      ...trail.markedUnhelpful,
      ...trail.recentReflections,
    ].sort((a, b) => a.hoursAgo - b.hoursAgo);
  }, [trail]);

  const empty =
    !trail ||
    (events.length === 0 && trail.unfinishedCount === 0);

  return (
    <section style={feedCard} className="coach-stagger" aria-label="recent activity">
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 }}>
        <h2 style={{ fontSize: 14, fontWeight: 600, letterSpacing: '-0.01em', margin: 0 }}>recent activity</h2>
        <span style={{ ...dimColor(0.3), fontSize: 11, fontFamily: monoFont, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          last 7d
        </span>
      </div>

      {trail && trail.unfinishedCount > 0 && (
        <div
          style={{
            ...dimColor(0.7),
            fontSize: 12,
            padding: '8px 10px',
            background: '#111',
            border: '1px solid rgba(255,255,255,0.07)',
            borderRadius: 6,
            marginBottom: 12,
          }}
        >
          {trail.unfinishedCount} resource(s) opened but not finished — close or commit.
        </div>
      )}

      {empty ? (
        <div style={{ ...dimColor(0.5), fontSize: 12 }}>
          no activity yet — open a curated resource to start your trail.
        </div>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {events.slice(0, 8).map((ev, i) => (
            <ActivityRow key={`${ev.url}-${ev.kind}-${i}`} ev={ev} />
          ))}
        </ul>
      )}
    </section>
  );
};

const ActivityRow: React.FC<{ ev: ResourceTouch }> = ({ ev }) => {
  const tag = useMemo(() => {
    switch (ev.kind) {
      case 'finished':
        return { label: 'finished', color: 'rgba(255,255,255,0.7)' };
      case 'unhelpful':
        return { label: 'unhelpful', color: '#FF3B30' };
      case 'reflection_submitted':
        return { label: 'reflection', color: 'rgba(255,255,255,0.85)' };
      default:
        return { label: ev.kind, color: 'rgba(255,255,255,0.5)' };
    }
  }, [ev.kind]);

  const ago = ev.hoursAgo < 1 ? '< 1h' : ev.hoursAgo < 24 ? `${ev.hoursAgo}h ago` : `${Math.round(ev.hoursAgo / 24)}d ago`;

  return (
    <li
      style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: 12,
        padding: '8px 0',
        borderTop: '1px solid rgba(255,255,255,0.07)',
      }}
    >
      <span
        style={{
          fontSize: 10,
          fontFamily: monoFont,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          color: tag.color,
          minWidth: 80,
        }}
      >
        {tag.label}
      </span>
      <a
        href={ev.url}
        target="_blank"
        rel="noreferrer"
        style={{ ...dimColor(0.85), fontSize: 13, flex: 1, textDecoration: 'none', wordBreak: 'break-all' }}
      >
        {ev.url}
      </a>
      <span style={{ ...dimColor(0.3), fontSize: 11, fontFamily: monoFont, whiteSpace: 'nowrap' }}>{ago}</span>
    </li>
  );
};
