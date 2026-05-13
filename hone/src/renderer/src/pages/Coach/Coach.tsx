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
import React, { useEffect, useState } from 'react';

import { useT } from '@d9-i18n';

import {
  getNextAction,
  getForkSnapshot,
  getResourceTrail,
  getSkillRadar,
  getCoachStats,
  getMemoryStats,
  setLearningMode as rpcSetMode,
  logResource,
  type NextAction,
  type ForkSnapshot,
  type ResourceTrail,
  type SkillRadar,
  type CoachStats,
  type MemoryStats,
} from '../../api/intelligence';
import { useGoalStore } from '../../stores/goal';
import { GoalEditModal } from '../../components/GoalEditModal';
import { trackEvent } from '../../api/events';
import { analytics, ANALYTICS_EVENTS } from '../../lib/analytics';
import { type Mode, MODES } from './lib/types';
import { CoachStyles, shell, innerWrap, grid } from './lib/styles';
import { CoachHeader } from './CoachHeader';
import { HeroCard } from './HeroCard';
import { SnapshotPanel } from './SnapshotPanel';
import { ForkSection } from './ForkSection';
import { ActivityFeed } from './ActivityFeed';
import { CrossAppReminder } from './CrossAppReminder';
import { AICursor } from './AICursor';

interface CoachProps {
  onStartFocus?: (args: { pinnedTitle: string }) => void;
}

export const Coach: React.FC<CoachProps> = ({ onStartFocus }) => {
  const t = useT();
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
  // F1 (Phase B — 2026-05-12): memory trust indicator. Total30d из
  // EpisodeRepo.Stats30d через /intelligence/memory/stats RPC. Не fatal
  // если отвалится — coach surface работает и без него; failure тихо
  // оставляет badge в «coach» fallback.
  const [memoryStats, setMemoryStats] = useState<MemoryStats | null>(null);

  // CI1 (Phase A W2): visible error state для auxiliary fetches. Hero
  // next-action имеет свой `nextError` (рендерится HeroCard inline);
  // mode-switch имеет `modeError`. Остальные 4 (fork/stats/trail/radar) —
  // optional auxiliaries: страница работает и без них, но silent fail
  // ломает доверие. Один combined банер показывается если хоть одна
  // упала, retry бампит auxReload и refetch'ит всё четыре разом.
  const [auxError, setAuxError] = useState<string | null>(null);
  const [auxReload, setAuxReload] = useState(0);

  // F2 (2026-05-12) — primary goal chip near header. Hidden когда no goal
  // (anti-fallback: не показываем fake-цель). Click → edit modal.
  const activeGoal = useGoalStore((s) => s.active);
  const [goalModalOpen, setGoalModalOpen] = useState(false);

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
      .catch((err) => {
        if (cancelled) return;
        setAuxError(`Fork snapshot: ${(err as Error)?.message ?? 'failed'}`);
      });
    return () => {
      cancelled = true;
    };
  }, [auxReload]);

  // Snapshot stats — 4 KPIs. Cheap aggregations from existing readers.
  useEffect(() => {
    let cancelled = false;
    getCoachStats()
      .then((r) => {
        if (!cancelled) setStats(r);
      })
      .catch((err) => {
        if (cancelled) return;
        setStats(null);
        setAuxError((prev) => prev ?? `Stats: ${(err as Error)?.message ?? 'failed'}`);
      });
    return () => {
      cancelled = true;
    };
  }, [auxReload]);

  // Activity trail — last 7 days. Cheap read; не зависит от mode.
  useEffect(() => {
    let cancelled = false;
    getResourceTrail(7, 5)
      .then((r) => {
        if (!cancelled) setTrail(r);
      })
      .catch((err) => {
        if (cancelled) return;
        setTrail(null);
        setAuxError((prev) => prev ?? `Activity: ${(err as Error)?.message ?? 'failed'}`);
      });
    return () => {
      cancelled = true;
    };
  }, [auxReload]);

  // Memory stats — F1 trust indicator («coach помнит N событий»). Тихий
  // failure: silent setMemoryStats(null) если backend lulls — badge просто
  // fallback'нется в «coach» без N. Не разбавляем auxError — это
  // optional decoration, не core data.
  useEffect(() => {
    let cancelled = false;
    getMemoryStats()
      .then((r) => {
        if (!cancelled) setMemoryStats(r);
      })
      .catch(() => {
        if (!cancelled) setMemoryStats(null);
      });
    return () => {
      cancelled = true;
    };
  }, [auxReload]);

  // Hero next-action — cached 1/day на бэке.
  useEffect(() => {
    let cancelled = false;
    setNextLoading(true);
    setNextError(null);
    getNextAction()
      .then((r) => {
        if (cancelled) return;
        setNext(r);
        // Phase J / X3 — surface the next-action view. Use action_kind +
        // mode (categorical, low-cardinality) — never raw `target` text.
        if (r) {
          analytics.track(ANALYTICS_EVENTS.coach_next_action_viewed, {
            action_kind: r.actionKind,
            mode,
          });
        }
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
      .catch((err) => {
        if (cancelled) return;
        setFork(null);
        setAuxError((prev) => prev ?? `Fork: ${(err as Error)?.message ?? 'failed'}`);
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
      .catch((err) => {
        if (cancelled) return;
        setRadar(null);
        setAuxError((prev) => prev ?? `Radar: ${(err as Error)?.message ?? 'failed'}`);
      });
    return () => {
      cancelled = true;
    };
  }, [mode, fork?.currentBranch, auxReload]);

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
    trackEvent('coach_action_start', { action_kind: next.actionKind, mode });
    // Phase J / X3 — cross-product taxonomy. `target` is a stable
    // resource id (atlas slug / url-fragment), safe to track. Free-text
    // titles never enter properties — sanitize() would strip them anyway.
    analytics.track(ANALYTICS_EVENTS.coach_next_action_consumed, {
      action_kind: next.actionKind,
      mode,
    });
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
            memoryStats={memoryStats}
            goal={activeGoal}
            onGoalClick={() => setGoalModalOpen(true)}
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

          {auxError && (
            <div className="data-loader-error" style={{ margin: '12px 0' }}>
              <div className="data-loader-error-stripe" />
              <div className="data-loader-error-body">
                <div className="data-loader-error-label">{t('hone.coach.err.partial_load')}</div>
                <div className="data-loader-error-detail">{auxError}</div>
                <button
                  type="button"
                  className="data-loader-error-retry"
                  onClick={() => {
                    setAuxError(null);
                    setAuxReload((n) => n + 1);
                  }}
                >
                  retry
                </button>
              </div>
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

          {/* Phase J / X4 (P1) — identity contextual reminder. Hone Coach
              даёт single next-action; full chat thread + 5-stage mock
              живут в web. Когда next-action упоминает «mock» / «sysdesign» /
              «interview» — показываем actionable chip с deep-link. Иначе —
              тихий footer-line. Footer-line всегда subtle (text-secondary,
              small), не CTA-banner. */}
          <CrossAppReminder action={next} />
        </div>

        <AICursor />
      </div>

      {goalModalOpen && activeGoal && (
        <GoalEditModal goal={activeGoal} onClose={() => setGoalModalOpen(false)} />
      )}
    </>
  );
};

export default Coach;
