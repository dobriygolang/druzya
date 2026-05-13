import React from 'react';
import type { ForkSnapshot } from '../../api/intelligence';
import { dimColor } from './lib/types';
import {
  monoFont,
  forkCard,
  forkGrid,
  forkCol,
  leanRing,
  forkColHead,
  leaningBadge,
  fillTrack,
  fillFill,
} from './lib/styles';

export const ForkSection: React.FC<{ fork: ForkSnapshot | null; loading: boolean }> = ({ fork, loading }) => (
  <section style={forkCard}>
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
      <h2 style={{ fontSize: 18, fontWeight: 600, letterSpacing: '-0.01em', margin: 0 }}>
        which path does the work feel like home?
      </h2>
      {fork?.leanBranch && (
        <span style={{ fontSize: 11, fontFamily: monoFont, ...dimColor(0.5) }}>
          lean {fork.leanBranch.toUpperCase()} · conf {fork.confidence.toFixed(2)}
        </span>
      )}
    </div>
    <p style={{ ...dimColor(0.5), fontSize: 12, marginBottom: 24 }}>
      {fork?.exploreWeekIndex
        ? `${fork.exploreWeekIndex}-week explore window · weekly fork-analysis`
        : 'explore window · weekly fork-analysis'}
    </p>
    {loading ? (
      <div style={dimColor(0.5)}>loading fork snapshot…</div>
    ) : !fork || fork.branches.length === 0 ? (
      <div style={dimColor(0.5)}>no fork data yet — keep exploring.</div>
    ) : (
      <div style={forkGrid}>
        {fork.branches.map((b) => (
          <ForkBranchCard key={b.branch} branch={b} lean={fork.leanBranch === b.branch} />
        ))}
      </div>
    )}
  </section>
);

const ForkBranchCard: React.FC<{
  branch: ForkSnapshot['branches'][number];
  lean: boolean;
}> = ({ branch, lean }) => {
  const fillPct = Math.min(100, Math.round((branch.compositeScore / 400) * 100));
  return (
    <div style={{ ...forkCol, ...(lean ? leanRing : {}) }}>
      <div style={forkColHead}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>{branch.branch.toUpperCase()}</span>
        <span style={{ fontFamily: monoFont, fontSize: 12, ...dimColor(0.5) }}>
          {branch.mockCount} mocks · avg {Math.round(branch.avgScore)}
        </span>
      </div>
      {lean && <span style={leaningBadge}>leaning</span>}
      <div style={fillTrack}>
        <div style={{ ...fillFill, width: `${fillPct}%` }} className="coach-fill-bar" />
      </div>
      <div style={{ ...dimColor(0.5), fontSize: 12, marginTop: 8 }}>
        voluntary deep-dives: <span style={{ fontFamily: monoFont }}>{branch.voluntaryDeepDives}</span>
      </div>
    </div>
  );
};
