// Coach — Phase 2 learning-companion surface (2026-05-04).
//
// Mockup: docs/mocks/druz9-hone-bundle/learning-companion.html.
// Backend: services/intelligence Coach UCs (GetNextAction / GetForkSnapshot
// / SetLearningMode / SetForkBranch / LogResource).
//
// Layout:
//   header  — coach label + mode switcher (explore/commit/deep) + week chip
//   hero    — «one daily action» card (8/12)
//   sidebar — snapshot panel + 5-axis radar (4/12)
//   below   — fork view (explore-only) — dual MLE/DE bars + lean badge
//   feed    — placeholder activity stream (coming Phase 2 follow-up)
import React, { useEffect, useMemo, useState } from 'react';

import {
  getNextAction,
  getForkSnapshot,
  getResourceTrail,
  getSkillRadar,
  getCoachStats,
  setLearningMode as rpcSetMode,
  logResource,
  type NextAction,
  type ForkSnapshot,
  type ResourceTrail,
  type SkillRadar,
  type ResourceTouch,
  type CoachStats,
} from '../api/intelligence';

type Mode = 'explore' | 'commit' | 'deep';

const MODES: { key: Mode; label: string }[] = [
  { key: 'explore', label: 'Explore' },
  { key: 'commit', label: 'Commit' },
  { key: 'deep', label: 'Deep' },
];

interface CoachProps {
  onStartFocus?: (args: { pinnedTitle: string }) => void;
}

export const Coach: React.FC<CoachProps> = ({ onStartFocus }) => {
  const [mode, setMode] = useState<Mode>('explore');
  const [modeError, setModeError] = useState<string | null>(null);
  const [next, setNext] = useState<NextAction | null>(null);
  const [nextLoading, setNextLoading] = useState(true);
  const [nextError, setNextError] = useState<string | null>(null);

  const [fork, setFork] = useState<ForkSnapshot | null>(null);
  const [forkLoading, setForkLoading] = useState(false);

  const [trail, setTrail] = useState<ResourceTrail | null>(null);
  const [radar, setRadar] = useState<SkillRadar | null>(null);
  const [stats, setStats] = useState<CoachStats | null>(null);

  // Initial: hydrate fork snapshot — оно содержит current mode из learning_state.
  useEffect(() => {
    let cancelled = false;
    getForkSnapshot()
      .then((r) => {
        if (cancelled) return;
        setFork(r);
        if (r.mode === 'commit' || r.mode === 'deep' || r.mode === 'explore') {
          setMode(r.mode);
        }
      })
      .catch(() => {
        /* fork data optional на первом mount */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Snapshot stats — 4 KPIs. Cheap aggregations from existing readers.
  useEffect(() => {
    let cancelled = false;
    getCoachStats()
      .then((r) => {
        if (!cancelled) setStats(r);
      })
      .catch(() => {
        if (!cancelled) setStats(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Activity trail — last 7 days. Cheap read; не зависит от mode.
  useEffect(() => {
    let cancelled = false;
    getResourceTrail(7, 5)
      .then((r) => {
        if (!cancelled) setTrail(r);
      })
      .catch(() => {
        if (!cancelled) setTrail(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Hero next-action — cached 1/day на бэке.
  useEffect(() => {
    let cancelled = false;
    setNextLoading(true);
    setNextError(null);
    getNextAction()
      .then((r) => {
        if (!cancelled) setNext(r);
      })
      .catch((err) => {
        if (!cancelled) setNextError(err?.message ?? 'unable to load');
      })
      .finally(() => {
        if (!cancelled) setNextLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Refetch fork при ручном mode-switch — чтобы UI оставался live.
  useEffect(() => {
    if (mode !== 'explore') return;
    let cancelled = false;
    setForkLoading(true);
    getForkSnapshot()
      .then((r) => {
        if (!cancelled) setFork(r);
      })
      .catch(() => {
        if (!cancelled) setFork(null);
      })
      .finally(() => {
        if (!cancelled) setForkLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mode]);

  // Skill radar — re-pull при mode change. Rubric derive'ится server-side
  // (mode='explore' с fork_branch='de' → rubric 'de', etc.).
  useEffect(() => {
    let cancelled = false;
    const rubric =
      mode === 'commit' || mode === 'deep'
        ? 'dev_senior'
        : fork?.currentBranch === 'mle'
        ? 'mle'
        : 'de';
    getSkillRadar(rubric)
      .then((r) => {
        if (!cancelled) setRadar(r);
      })
      .catch(() => {
        if (!cancelled) setRadar(null);
      });
    return () => {
      cancelled = true;
    };
  }, [mode, fork?.currentBranch]);

  // Hero CTA handlers — wired в backend (LogResource + GetNextAction).
  const refetchAction = async (force: boolean) => {
    setNextLoading(true);
    setNextError(null);
    try {
      const r = await getNextAction(force);
      setNext(r);
    } catch (err: unknown) {
      setNextError((err as Error)?.message ?? 'unable to load');
    } finally {
      setNextLoading(false);
    }
  };

  const onStart = () => {
    if (!next || !onStartFocus) return;
    const title = next.target ? `coach · ${next.actionKind} · ${next.target}` : `coach · ${next.actionKind}`;
    onStartFocus({ pinnedTitle: title });
  };

  const onSkip = async () => {
    if (!next) return;
    try {
      // log skip event (best-effort) + refetch с force.
      if (next.target) {
        await logResource({ resourceUrl: next.target, kind: 'skipped' }).catch(() => {});
      }
    } finally {
      void refetchAction(true);
    }
  };

  const onSuggestOther = () => {
    void refetchAction(true);
  };

  const onModeClick = async (next: Mode) => {
    if (next === mode) return;
    setMode(next); // optimistic
    setModeError(null);
    try {
      const updated = await rpcSetMode(next);
      // Refresh fork data — exploreWeekIndex может пересчитаться.
      if (next === 'explore') {
        setFork((prev) => (prev ? { ...prev, exploreWeekIndex: updated.exploreWeekIndex } : prev));
      }
    } catch (err) {
      // Backend reject — show inline message + revert. FailedPrecondition
      // (commit/deep без track) — типичный case; raw err.message содержит
      // user-friendly «commit requires track_id». Auto-clear через 4s.
      const msg = err instanceof Error ? err.message : String(err);
      const friendly = /track_id|track id|requires track/i.test(msg)
        ? 'Pick a track first (open Atlas → enrol).'
        : msg.replace(/^\[\w+\]\s*/, '').replace(/learningStateAdapter\.SetMode:\s*/, '');
      setModeError(friendly);
      setMode(mode);
      window.setTimeout(() => setModeError(null), 4000);
    }
  };

  const modeIdx = MODES.findIndex((m) => m.key === mode);

  return (
    <>
      <CoachStyles />
      <div style={shell} className="coach-page-enter">
        <div style={innerWrap}>
          <CoachHeader
            mode={mode}
            onModeClick={onModeClick}
            modeIdx={modeIdx}
            exploreWeek={fork?.exploreWeekIndex}
          />

          {modeError && (
            <div
              role="alert"
              style={{
                margin: '12px 0',
                padding: '8px 12px',
                fontSize: 12,
                color: 'rgba(255,255,255,0.85)',
                background: 'rgba(255,59,48,0.08)',
                border: '1px solid rgba(255,59,48,0.35)',
                borderLeft: '2px solid #FF3B30',
                borderRadius: 4,
                fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                letterSpacing: '0.02em',
              }}
            >
              {modeError}
            </div>
          )}

          <div style={grid} className="coach-stagger">
            <HeroCard
              mode={mode}
              loading={nextLoading}
              error={nextError}
              action={next}
              onStart={onStart}
              onSkip={onSkip}
              onSuggestOther={onSuggestOther}
            />
            <SnapshotPanel mode={mode} fork={fork} radar={radar} stats={stats} />
          </div>

          {mode === 'explore' && (
            <div className="coach-stagger" style={{ marginTop: 16 }}>
              <ForkSection fork={fork} loading={forkLoading} />
            </div>
          )}

          <ActivityFeed trail={trail} />
        </div>

        <AICursor />
      </div>
    </>
  );
};

// ── header ──────────────────────────────────────────────────────────────

const CoachHeader: React.FC<{
  mode: Mode;
  onModeClick: (m: Mode) => void;
  modeIdx: number;
  exploreWeek?: number;
}> = ({ mode, onModeClick, modeIdx, exploreWeek }) => (
  <header style={headerWrap}>
    <div style={headerLeft}>
      <span style={{ ...dimColor(0.5), fontSize: 11, fontFamily: monoFont, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        coach
      </span>
      {mode === 'explore' && exploreWeek !== undefined && exploreWeek > 0 && (
        <span style={chipStyle}>{`explore · w${exploreWeek}`}</span>
      )}
    </div>

    <div style={modeBox}>
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

// ── hero card ───────────────────────────────────────────────────────────

const HeroCard: React.FC<{
  mode: Mode;
  loading: boolean;
  error: string | null;
  action: NextAction | null;
  onStart: () => void;
  onSkip: () => void;
  onSuggestOther: () => void;
}> = ({ mode, loading, error, action, onStart, onSkip, onSuggestOther }) => {
  const slot = useMemo(() => {
    if (mode === 'commit') return 'today · committed track';
    if (mode === 'deep') return 'today · deep prep';
    return 'today · explore';
  }, [mode]);

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

// ── snapshot panel + radar ──────────────────────────────────────────────

const SnapshotPanel: React.FC<{
  mode: Mode;
  fork: ForkSnapshot | null;
  radar: SkillRadar | null;
  stats: CoachStats | null;
}> = ({ mode, fork, radar, stats }) => {
  const items: { label: string; value: string }[] = useMemo(() => {
    const mockCard = stats && stats.lastMockScore > 0
      ? `${stats.lastMockScore}/100${stats.lastMockSection ? ` · ${stats.lastMockSection}` : ''}`
      : '—';
    return [
      { label: 'focus today', value: stats ? `${stats.focusTodayMin} min` : '— min' },
      { label: 'last mock', value: mockCard },
    ];
  }, [stats]);
  void fork;

  // Radar axes — real data из GetSkillRadar. Если backend ещё не вернул
  // или axes пусты (нет mocks под rubric), показываем placeholder с zero
  // scores, чтобы pentagon был визуально стабилен.
  const axes = useMemo<RadarAxis[]>(() => {
    if (radar && radar.axes.length === 5) {
      return radar.axes.map((a) => ({ key: a.key, label: a.label, score: a.score }));
    }
    // Placeholder pentagon (zero scores) — preserves shape geometry.
    const labels =
      mode === 'commit' || mode === 'deep'
        ? ['algo', 'code', 'comm', 'stress', 'sysd']
        : ['etl', 'dist', 'sql', 'stream', 'ops'];
    return labels.map((l) => ({ key: l, label: l, score: 0.05 }));
  }, [radar, mode]);

  const rubricLabel =
    radar?.rubric === 'dev_senior'
      ? 'dev rubric'
      : radar?.rubric
      ? `${radar.rubric} rubric`
      : mode === 'explore'
      ? 'de rubric'
      : 'dev rubric';

  return (
    <aside style={snapshotCard}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <span style={{ ...dimColor(0.5), fontSize: 11, fontFamily: monoFont, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          snapshot
        </span>
        <span style={chipStyle}>{mode}</span>
      </div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {items.map((it) => (
          <li key={it.label} style={snapRow}>
            <span style={{ ...dimColor(0.5), fontSize: 12 }}>{it.label}</span>
            <span style={{ fontFamily: monoFont, fontSize: 13 }}>{it.value}</span>
          </li>
        ))}
      </ul>

      <div style={{ marginTop: 18, paddingTop: 16, borderTop: '1px solid rgba(255,255,255,0.07)' }}>
        <div style={{ ...dimColor(0.5), fontSize: 11, fontFamily: monoFont, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
          5-axis · {rubricLabel}
          {radar && (
            <span style={{ float: 'right', ...dimColor(0.3) }}>
              {radar.axes.reduce((s, a) => s + a.mockCount, 0)} sigs
            </span>
          )}
        </div>
        <Radar axes={axes} />
        {radar && radar.axes.some((a) => a.confidence === 'empty' || a.confidence === 'low') && (
          <div style={{ ...dimColor(0.4), fontSize: 10, fontFamily: monoFont, marginTop: 6, letterSpacing: '0.04em' }}>
            low confidence — radar may jitter (need more mocks)
          </div>
        )}
      </div>
    </aside>
  );
};

// ── radar (5 axes) ──────────────────────────────────────────────────────

interface RadarAxis {
  key: string;
  label: string;
  score: number; // 0..1
}

const Radar: React.FC<{ axes: RadarAxis[]; size?: number }> = ({ axes, size = 180 }) => {
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 22;

  // Cartesian for each axis vertex (top → clockwise).
  const points = axes.map((a, i) => {
    const angle = (Math.PI * 2 * i) / axes.length - Math.PI / 2;
    return {
      ...a,
      x: cx + r * Math.cos(angle),
      y: cy + r * Math.sin(angle),
      sx: cx + r * a.score * Math.cos(angle),
      sy: cy + r * a.score * Math.sin(angle),
      angle,
    };
  });

  // Find weakest для red dot (#FF3B30 indicator only).
  const weakest = points.reduce((acc, p) => (p.score < acc.score ? p : acc), points[0]);

  return (
    <svg width="100%" height={size} viewBox={`0 0 ${size} ${size}`} style={{ display: 'block' }}>
      {/* Concentric polygons — guides at 0.25 / 0.5 / 0.75 / 1.0 */}
      {[0.25, 0.5, 0.75, 1].map((step) => {
        const path = points
          .map((_, i) => {
            const angle = (Math.PI * 2 * i) / axes.length - Math.PI / 2;
            const gx = cx + r * step * Math.cos(angle);
            const gy = cy + r * step * Math.sin(angle);
            return `${i === 0 ? 'M' : 'L'}${gx},${gy}`;
          })
          .join(' ') + ' Z';
        return (
          <path
            key={step}
            d={path}
            fill="none"
            stroke="rgba(255,255,255,0.06)"
            strokeWidth={1}
          />
        );
      })}

      {/* Axis lines */}
      {points.map((p) => (
        <line
          key={`axis-${p.key}`}
          x1={cx}
          y1={cy}
          x2={p.x}
          y2={p.y}
          stroke="rgba(255,255,255,0.07)"
          strokeWidth={1}
        />
      ))}

      {/* Score polygon */}
      <path
        d={
          points.map((pt, i) => `${i === 0 ? 'M' : 'L'}${pt.sx},${pt.sy}`).join(' ') + ' Z'
        }
        fill="rgba(255,255,255,0.06)"
        stroke="rgba(255,255,255,0.55)"
        strokeWidth={1.2}
        className="coach-radar-shape"
      />

      {/* Score dots */}
      {points.map((p) => (
        <circle
          key={`dot-${p.key}`}
          cx={p.sx}
          cy={p.sy}
          r={2.5}
          fill={p.key === weakest.key ? '#FF3B30' : 'rgba(255,255,255,0.85)'}
        />
      ))}

      {/* Labels — outside the radius */}
      {points.map((p) => {
        const lx = cx + (r + 12) * Math.cos(p.angle);
        const ly = cy + (r + 12) * Math.sin(p.angle);
        return (
          <text
            key={`lbl-${p.key}`}
            x={lx}
            y={ly}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={9}
            fontFamily={monoFont}
            fill="rgba(255,255,255,0.5)"
          >
            {p.label}
          </text>
        );
      })}
    </svg>
  );
};

// ── fork section ────────────────────────────────────────────────────────

const ForkSection: React.FC<{ fork: ForkSnapshot | null; loading: boolean }> = ({ fork, loading }) => (
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

// ── activity feed (live, last 7d) ───────────────────────────────────────

const ActivityFeed: React.FC<{ trail: ResourceTrail | null }> = ({ trail }) => {
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
        <span style={{ ...dimColor(0.3), fontSize: 11, fontFamily: monoFont, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
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
          letterSpacing: '0.06em',
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

// ── AI-cursor overlay ───────────────────────────────────────────────────
//
// Animated SVG cursor moves across the page on mode-change, simulating
// «AI thinking». Random target inside viewport — no click effect (this is
// pure animation hint). Mockup pattern: cursor + ai-pulse + ai-label.

const AICursor: React.FC = () => {
  const [pos, setPos] = useState<{ x: number; y: number; visible: boolean }>({
    x: -100,
    y: -100,
    visible: false,
  });
  const [label, setLabel] = useState<string>('');

  useEffect(() => {
    // Trigger animation periodically — every 25-40s, simulating
    // proactive AI moves. Real WS-driven cursor — Phase 5 (Notes).
    const tick = () => {
      const targetX = 60 + Math.random() * (window.innerWidth - 200);
      const targetY = 120 + Math.random() * (window.innerHeight - 280);
      const labels = [
        'updating fork-snapshot',
        'rerolling next action',
        'syncing radar scores',
        'rescoring activity',
      ];
      setLabel(labels[Math.floor(Math.random() * labels.length)]);
      setPos({ x: targetX, y: targetY, visible: true });
      setTimeout(() => setPos((p) => ({ ...p, visible: false })), 2400);
    };
    const id = setInterval(tick, 30_000);
    // First show after 4s — initial "AI is awake" hint.
    const first = setTimeout(tick, 4000);
    return () => {
      clearInterval(id);
      clearTimeout(first);
    };
  }, []);

  return (
    <div
      aria-hidden
      style={{
        position: 'fixed',
        left: pos.x,
        top: pos.y,
        pointerEvents: 'none',
        opacity: pos.visible ? 1 : 0,
        transition: 'opacity 320ms cubic-bezier(0.2,0.7,0.2,1), left 1100ms cubic-bezier(0.2,0.7,0.2,1), top 1100ms cubic-bezier(0.2,0.7,0.2,1)',
        zIndex: 50,
      }}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="rgba(255,255,255,0.85)">
        <path d="M3 2 L11 17 L13 11 L20 9 Z" />
      </svg>
      <span
        style={{
          position: 'absolute',
          top: 22,
          left: 14,
          fontSize: 10,
          fontFamily: monoFont,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          background: 'rgba(255,255,255,0.92)',
          color: '#000',
          padding: '3px 7px',
          borderRadius: 4,
          whiteSpace: 'nowrap',
        }}
      >
        ai · {label}
      </span>
    </div>
  );
};

// ── styles + animations ─────────────────────────────────────────────────

const CoachStyles: React.FC = () => (
  <style>{`
@keyframes coachPageFade {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
}
.coach-page-enter { animation: coachPageFade 220ms cubic-bezier(0.2,0.7,0.2,1) both; }

@keyframes coachFadeUp {
  from { opacity: 0; transform: translateY(9px); }
  to   { opacity: 1; transform: translateY(0); }
}
.coach-stagger > *               { opacity: 0; animation: coachFadeUp 480ms cubic-bezier(0.2,0.7,0.2,1) forwards; }
.coach-stagger > *:nth-child(1)  { animation-delay:  60ms; }
.coach-stagger > *:nth-child(2)  { animation-delay: 130ms; }
.coach-stagger > *:nth-child(3)  { animation-delay: 200ms; }
.coach-stagger > *:nth-child(4)  { animation-delay: 270ms; }
.coach-stagger > *:nth-child(5)  { animation-delay: 340ms; }

@keyframes coachDrawPath {
  from { stroke-dashoffset: 600; opacity: 0.4; }
  to   { stroke-dashoffset: 0;   opacity: 1; }
}
.coach-radar-shape {
  stroke-dasharray: 600;
  animation: coachDrawPath 1.2s cubic-bezier(0.2,0.7,0.2,1) forwards;
  animation-delay: 700ms;
}

@keyframes coachFillBar {
  from { transform: scaleX(0); }
  to   { transform: scaleX(1); }
}
.coach-fill-bar {
  transform-origin: left;
  animation: coachFillBar 1100ms ease-out forwards;
  animation-delay: 240ms;
}
`}</style>
);

// ── design tokens ───────────────────────────────────────────────────────

const monoFont =
  '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace';

const shell: React.CSSProperties = {
  // Coach живёт внутри Hone shell (position:fixed inset:0). Чтобы
  // длинный контент scroll'ился, выставляем absolute fill + overflow.
  position: 'absolute',
  inset: 0,
  overflowY: 'auto',
  background: '#000',
  color: 'rgba(255,255,255,0.92)',
  padding: '60px 28px 96px',
  fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif',
  letterSpacing: '-0.005em',
};

const innerWrap: React.CSSProperties = {
  maxWidth: 1280,
  margin: '0 auto',
};

const headerWrap: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  paddingTop: 8,
  paddingBottom: 20,
  gap: 16,
};

const headerLeft: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  minWidth: 80,
};

const grid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(12, 1fr)',
  gap: 16,
  marginBottom: 16,
};

const heroCard: React.CSSProperties = {
  gridColumn: 'span 8',
  background: '#0a0a0a',
  border: '1px solid rgba(255,255,255,0.07)',
  borderRadius: 12,
  padding: 28,
  position: 'relative',
  overflow: 'hidden',
};

const snapshotCard: React.CSSProperties = {
  gridColumn: 'span 4',
  background: '#0a0a0a',
  border: '1px solid rgba(255,255,255,0.07)',
  borderRadius: 12,
  padding: 24,
};

const forkCard: React.CSSProperties = {
  background: '#0a0a0a',
  border: '1px solid rgba(255,255,255,0.07)',
  borderRadius: 12,
  padding: 28,
};

const feedCard: React.CSSProperties = {
  background: '#0a0a0a',
  border: '1px solid rgba(255,255,255,0.07)',
  borderRadius: 12,
  padding: 20,
  marginTop: 16,
};

const forkGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, 1fr)',
  gap: 16,
};

const forkCol: React.CSSProperties = {
  background: '#111',
  border: '1px solid rgba(255,255,255,0.07)',
  borderRadius: 10,
  padding: 20,
  position: 'relative',
};

const leanRing: React.CSSProperties = {
  borderColor: 'rgba(255,255,255,0.18)',
};

const forkColHead: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  marginBottom: 12,
};

const leaningBadge: React.CSSProperties = {
  position: 'absolute',
  top: -10,
  left: 16,
  background: '#fff',
  color: '#000',
  fontSize: 10,
  fontFamily: monoFont,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  padding: '3px 8px',
  borderRadius: 4,
};

const fillTrack: React.CSSProperties = {
  height: 4,
  background: 'rgba(255,255,255,0.07)',
  borderRadius: 2,
  overflow: 'hidden',
};

const fillFill: React.CSSProperties = {
  height: '100%',
  background: 'rgba(255,255,255,0.7)',
  transition: 'width 320ms cubic-bezier(0.2,0.7,0.2,1)',
};

const heroChips: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  marginBottom: 18,
};

const heroTitle: React.CSSProperties = {
  fontSize: 28,
  fontWeight: 600,
  lineHeight: 1.18,
  letterSpacing: '-0.01em',
  color: '#fff',
  margin: '0 0 8px',
};

const hairline: React.CSSProperties = {
  height: 1,
  background: 'rgba(255,255,255,0.07)',
  margin: '20px 0',
};

const whyBox: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '32px 1fr',
  gap: 12,
  marginBottom: 24,
};

const whyLabel: React.CSSProperties = {
  fontSize: 10,
  fontFamily: monoFont,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: 'rgba(255,255,255,0.3)',
  marginTop: 3,
};

const heroActions: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  flexWrap: 'wrap',
};

const btnPrimary: React.CSSProperties = {
  background: '#fff',
  color: '#000',
  fontSize: 13,
  fontWeight: 500,
  padding: '8px 16px',
  borderRadius: 6,
  border: 0,
  cursor: 'pointer',
};

const btnGhost: React.CSSProperties = {
  background: 'transparent',
  color: 'rgba(255,255,255,0.7)',
  fontSize: 13,
  padding: '8px 14px',
  borderRadius: 6,
  border: '1px solid rgba(255,255,255,0.07)',
  cursor: 'pointer',
};

const modeBox: React.CSSProperties = {
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  padding: 4,
  background: '#111',
  border: '1px solid rgba(255,255,255,0.07)',
  borderRadius: 8,
};

const modeIndicator: React.CSSProperties = {
  position: 'absolute',
  top: 4,
  bottom: 4,
  background: '#161616',
  border: '1px solid rgba(255,255,255,0.12)',
  width: 'calc(33.33% - 2px)',
  borderRadius: 6,
  transition: 'transform 220ms cubic-bezier(0.2,0.7,0.2,1)',
};

const modeBtn: React.CSSProperties = {
  position: 'relative',
  zIndex: 1,
  padding: '6px 16px',
  fontSize: 12,
  fontWeight: 500,
  letterSpacing: '0.02em',
  borderRadius: 6,
  minWidth: 92,
  background: 'transparent',
  border: 0,
  cursor: 'pointer',
};

const chipStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '3px 9px',
  fontSize: 10,
  fontFamily: monoFont,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  background: '#111',
  border: '1px solid rgba(255,255,255,0.07)',
  color: 'rgba(255,255,255,0.7)',
  borderRadius: 4,
};

const snapRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '8px 0',
  borderBottom: '1px solid rgba(255,255,255,0.07)',
};

function dimColor(opacity: number): React.CSSProperties {
  return { color: `rgba(255,255,255,${opacity})` };
}

export default Coach;
