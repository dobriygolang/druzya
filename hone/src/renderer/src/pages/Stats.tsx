// Stats — Phase 4 dashboard surface (2026-05-04).
//
// Mockup: docs/mocks/druz9-hone-bundle/hone-stats.html.
// Backend: HoneService.GetStats (existing) + IntelligenceService.GetCoachStats
// (Phase 2) + HoneService.ListExternalActivity (existing).
//
// Layout:
//   header — STATS label + range picker (7d/30d/90d)
//   row 1  — 4 KPI cards (focus today / streak / tasks done / last mock score)
//   row 2  — 7-day heatmap (горизонтальные столбцы) + top topics панель
//   row 3  — recent external activity list + "+ log session" CTA
//
// StatsOverlay (S-key from home) остаётся параллельно — он lighter-weight
// "peek" версия. Эта page — full dashboard для tab navigation.
//
// 2026-05-12: v2 visual language — hairline-only cards (был `#0a0a0a` fill),
// letter-spacing 0.08em canonical, foundation `.motion-stagger` + `.motion-page-in`
// classes (inline keyframes удалены), range picker hairline active state.
import React, { useMemo, useState } from 'react';

import { getStats, type HoneStats, type FocusDay } from '../api/hone';
import {
  getCoachStats,
  listFocusReflections,
  type CoachStats,
  type FocusReflectionEntry,
} from '../api/intelligence';
import { listExternalActivity, type ExternalActivity, type ExternalSource } from '../api/external';
import { ExternalActivityModal } from '../components/ExternalActivityModal';
import { useDataState } from '../hooks/useDataState';
import { openWebProfileMemory, openWebInsights } from '../lib/cross-app-links';

type Range = '7d' | '30d' | '90d';

export const Stats: React.FC = () => {
  const [range, setRange] = useState<Range>('7d');
  // logOpen state retired — Sergey 2026-05-05: no manual logging button.
  const [reload, setReload] = useState(0);

  // CI1 (Phase A W2): unify async fetch state via useDataState. Previously
  // each .catch set state to null silently — KPIs would just show «—» without
  // any indication something failed. Now we surface error stripe + retry via
  // <ErrorStripe> below.
  const statsState = useDataState(() => getStats(), [reload]);
  const coachState = useDataState(() => getCoachStats(), [reload]);
  const activityState = useDataState(
    () => listExternalActivity({ limit: 30 }),
    [reload],
  );
  // H2 (Phase J 2026-05-12) — pomodoro grade trend. Window matches range
  // picker; default 30 covers the typical "how am I doing?" question.
  const reflectionsWindow =
    range === '7d' ? 7 : range === '30d' ? 30 : 90;
  const reflectionsState = useDataState(
    () => listFocusReflections(reflectionsWindow),
    [reload, reflectionsWindow],
  );

  const stats: HoneStats | null = statsState.data;
  const coach: CoachStats | null = coachState.data;
  const activity: ExternalActivity[] = activityState.data ?? [];
  const reflections: FocusReflectionEntry[] = reflectionsState.data ?? [];

  const focusDays = useMemo(() => padToSevenDays(stats?.lastSevenDays ?? []), [stats]);
  const totalFocusMin = useMemo(
    () => Math.round((stats?.totalFocusedSeconds ?? 0) / 60),
    [stats],
  );
  const topTopics = useMemo(() => deriveTopTopics(activity), [activity]);

  // First non-null error wins — Stats has 3 sources; if all three failed
  // they're likely failing for the same reason (network / auth), so we
  // show one combined stripe with a single retry that bumps `reload`.
  const firstError =
    (statsState.status === 'error' && statsState.error) ||
    (coachState.status === 'error' && coachState.error) ||
    (activityState.status === 'error' && activityState.error) ||
    null;

  return (
    <>
      <div style={shell} className="motion-page-in">
        <div style={innerWrap}>
          <Header range={range} setRange={setRange} />

          {firstError && (
            <ErrorStripe
              message={firstError.message}
              onRetry={() => setReload((n) => n + 1)}
            />
          )}

          <div style={kpiRow} className="motion-stagger">
            <KpiCard
              label="focus today"
              value={coach ? `${coach.focusTodayMin}` : '—'}
              unit="min"
              hint={`${totalFocusMin}m total · ${range}`}
            />
            <KpiCard
              label="streak"
              value={stats ? `${stats.currentStreakDays}` : '—'}
              unit="days"
              hint={stats ? `longest ${stats.longestStreakDays}d` : ''}
            />
            <KpiCard
              label="tasks done"
              value={stats ? `${stats.queue.todayDone}` : '—'}
              unit={`/ ${stats?.queue.todayTotal ?? 0}`}
              hint="today queue"
            />
            <KpiCard
              label="last mock"
              value={coach && coach.lastMockScore > 0 ? `${coach.lastMockScore}` : '—'}
              unit={coach && coach.lastMockScore > 0 ? '/100' : ''}
              hint={coach?.lastMockSection || ''}
            />
          </div>

          <div style={midRow} className="motion-stagger">
            <FocusHeatmap days={focusDays} />
            <TopTopicsCard topics={topTopics} />
          </div>

          {/* H2 (Phase J 2026-05-12) — pomodoro grade trend.
              Single-row sparkline + summary line: «N reflections · avg 3.4».
              Empty-state placeholder когда юзер ещё ничего не submit'ил. */}
          <GradeTrendCard items={reflections} windowDays={reflectionsWindow} />

          <ActivityFeed
            items={activity}
            onDeleted={() => setReload((n) => n + 1)}
          />

          {/* X5 (Phase J P2 2026-05-12) — cross-product analytics handoff.
              Stats KPIs are summary cards; full breakdown (weekly reports,
              insight timeline) lives on druz9.online. Two discreet links
              в стиле остального footer'а. */}
          <StatsWebHandoff />
        </div>
      </div>

      {/* ExternalActivityModal removed — Sergey 2026-05-05: no manual logging.
        Activity feed populates from auto-tracked events (focus sessions,
        atlas resource clicks, reflection submissions, tutor assignments). */}
      {false && (
        <ExternalActivityModal
          onClose={() => undefined}
          onSaved={() => {
            setReload((n) => n + 1);
          }}
        />
      )}
    </>
  );
};

// ── header ──────────────────────────────────────────────────────────────

const Header: React.FC<{
  range: Range;
  setRange: (r: Range) => void;
}> = ({ range, setRange }) => (
  <header style={headerWrap}>
    <span style={captionMonoSmall}>stats</span>
    <div role="tablist" aria-label="Date range" style={rangeBox}>
      {(['7d', '30d', '90d'] as Range[]).map((r) => (
        <button
          key={r}
          onClick={() => setRange(r)}
          role="tab"
          aria-selected={range === r}
          aria-pressed={range === r}
          className="focus-ring motion-press"
          style={{
            ...rangeBtn,
            color: range === r ? 'var(--ink)' : 'var(--ink-60)',
            background: range === r ? 'rgba(255, 255, 255, 0.06)' : 'transparent',
            borderColor: range === r ? 'var(--hair-2)' : 'transparent',
          }}
        >
          {r}
        </button>
      ))}
    </div>
  </header>
);

// ── ErrorStripe (CI1 Phase A W2) ────────────────────────────────────────
//
// Shows one combined stripe + retry button when any of Stats' three async
// sources (getStats / getCoachStats / listExternalActivity) failed. Single
// retry bumps the shared `reload` tick so all three refetch together —
// they fail together too in 90%+ cases (network drop / 401), so giving the
// user three separate retry affordances is noise.

const ErrorStripe: React.FC<{ message: string; onRetry: () => void }> = ({
  message,
  onRetry,
}) => (
  <div className="data-loader-error" style={{ marginBottom: 16 }}>
    <div className="data-loader-error-stripe" />
    <div className="data-loader-error-body">
      <div className="data-loader-error-label">Stats не загружаются</div>
      {message && <div className="data-loader-error-detail">{message}</div>}
      <button type="button" className="data-loader-error-retry focus-ring motion-press" onClick={onRetry}>
        retry
      </button>
    </div>
  </div>
);

// ── KPI card ────────────────────────────────────────────────────────────

const KpiCard: React.FC<{ label: string; value: string; unit: string; hint: string }> = ({
  label,
  value,
  unit,
  hint,
}) => (
  <div style={kpiCard}>
    <div style={{ ...captionMonoTiny, marginBottom: 8 }}>{label}</div>
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
      <span style={kpiValue}>{value}</span>
      {unit && <span style={{ color: 'var(--ink-60)', fontSize: 13, fontFamily: monoFont }}>{unit}</span>}
    </div>
    {hint && <div style={{ color: 'var(--ink-40)', fontSize: 11, fontFamily: monoFont, marginTop: 6 }}>{hint}</div>}
  </div>
);

// ── focus heatmap ───────────────────────────────────────────────────────

const FocusHeatmap: React.FC<{ days: FocusDay[] }> = ({ days }) => {
  const max = Math.max(1, ...days.map((d) => d.seconds));
  return (
    <div style={card}>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          marginBottom: 16,
        }}
      >
        <h2 style={cardTitle}>focused time</h2>
        <span style={captionMonoSmall}>last 7d</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 140 }}>
        {days.map((d) => {
          const ratio = d.seconds / max;
          const min = Math.round(d.seconds / 60);
          return (
            <div key={d.date} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, minWidth: 0 }}>
              <div style={{ color: 'var(--ink-40)', fontSize: 10, fontFamily: monoFont }}>
                {min || '·'}
              </div>
              <div
                title={`${d.date} · ${min} min · ${d.sessions} sessions`}
                style={{
                  width: '100%',
                  height: `${Math.max(3, ratio * 100)}%`,
                  background:
                    d.seconds === 0
                      ? 'rgba(255, 255, 255, 0.05)'
                      : `rgba(255, 255, 255, ${0.25 + ratio * 0.55})`,
                  borderRadius: 3,
                  transition: 'height var(--motion-dur-large) var(--motion-ease-emphasized)',
                }}
              />
              <div style={{ color: 'var(--ink-60)', fontSize: 10, fontFamily: monoFont }}>
                {weekdayShort(d.date)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ── top topics ──────────────────────────────────────────────────────────

interface Topic {
  label: string;
  source: ExternalSource;
  minutes: number;
  share: number;
}

function deriveTopTopics(items: ExternalActivity[]): Topic[] {
  const total = items.reduce((s, it) => s + it.durationMin, 0);
  if (total === 0) return [];
  const buckets = new Map<string, { source: ExternalSource; minutes: number }>();
  for (const it of items) {
    const label = it.topicFreeText.trim() || it.topicAtlasNodeId || it.source;
    const prev = buckets.get(label);
    if (prev) prev.minutes += it.durationMin;
    else buckets.set(label, { source: it.source, minutes: it.durationMin });
  }
  return Array.from(buckets.entries())
    .map(([label, b]) => ({ label, source: b.source, minutes: b.minutes, share: b.minutes / total }))
    .sort((a, b) => b.minutes - a.minutes)
    .slice(0, 7);
}

const TopTopicsCard: React.FC<{ topics: Topic[] }> = ({ topics }) => (
  <div style={card}>
    <h2 style={{ ...cardTitle, marginBottom: 16 }}>top topics</h2>
    {topics.length === 0 ? (
      <div style={{ color: 'var(--ink-60)', fontSize: 12 }}>
        no external activity yet — log a session to start tracking.
      </div>
    ) : (
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {topics.map((t) => (
          <li
            key={t.label}
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0, 1fr) 56px 64px',
              alignItems: 'center',
              gap: 8,
              padding: '6px 0',
              minWidth: 0,
            }}
          >
            <span style={{ fontSize: 13, color: 'var(--ink-90)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {t.label}
            </span>
            <span style={{ color: 'var(--ink-60)', fontSize: 11, fontFamily: monoFont, textAlign: 'right' }}>
              {t.minutes}m
            </span>
            <div style={{ position: 'relative', height: 4, background: 'var(--hair-2)', borderRadius: 2 }}>
              <div
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: `${Math.min(100, t.share * 100)}%`,
                  background: 'rgba(255, 255, 255, 0.7)',
                  borderRadius: 2,
                  transition: 'width var(--motion-dur-large) var(--motion-ease-emphasized)',
                }}
              />
            </div>
          </li>
        ))}
      </ul>
    )}
  </div>
);

// ── grade trend (H2 Phase J 2026-05-12) ────────────────────────────────
//
// Closed-loop visualization: после того как юзер submit'ит grade в Hone
// reflection prompt, бар появляется тут. B/W-only — высота столбика
// proportional to grade (max=5), хайрлайн-граница, mono cap'tions.
//
// Empty-state guidance говорит юзеру что чарт оживёт после пары pomodoro.

const GradeTrendCard: React.FC<{
  items: FocusReflectionEntry[];
  windowDays: number;
}> = ({ items, windowDays }) => {
  // Only entries with explicit grade (skip 0 = no-rating). Coach prompt
  // and chart обе на grade-based statistics — notes-only entries не
  // прибавляют сигнала "как сейчас".
  const graded = useMemo(() => items.filter((it) => it.grade >= 1 && it.grade <= 5), [items]);
  const avg = useMemo(() => {
    if (graded.length === 0) return 0;
    const sum = graded.reduce((a, b) => a + b.grade, 0);
    return sum / graded.length;
  }, [graded]);
  // Newest-first arrives; chart reads left→right oldest→newest.
  const orderedAsc = useMemo(() => [...graded].slice().reverse(), [graded]);

  return (
    <section style={feedCard} className="motion-stagger">
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          marginBottom: 12,
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <h2 style={cardTitle}>grade trend</h2>
        <span style={captionMonoSmall}>last {windowDays}d</span>
      </div>

      {graded.length === 0 ? (
        <div style={{ color: 'var(--ink-60)', fontSize: 12 }}>
          no reflections yet — grade a pomodoro 1-5 to start your trend.
        </div>
      ) : (
        <>
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-end',
              gap: 3,
              height: 64,
              minWidth: 0,
            }}
            aria-label="Pomodoro grade trend"
          >
            {orderedAsc.map((r) => {
              const ratio = r.grade / 5;
              const dateLabel = r.endedAt
                ? r.endedAt.toISOString().slice(0, 10)
                : '?';
              return (
                <div
                  key={r.reflectionId}
                  title={`${dateLabel} · grade ${r.grade}/5 · ${Math.round(r.durationSeconds / 60)}m ${r.focusMode}`}
                  style={{
                    flex: 1,
                    minWidth: 4,
                    maxWidth: 24,
                    height: `${Math.max(8, ratio * 100)}%`,
                    background: `rgba(255, 255, 255, ${0.25 + ratio * 0.55})`,
                    borderRadius: 2,
                    transition: 'height var(--motion-dur-large) var(--motion-ease-emphasized)',
                  }}
                />
              );
            })}
          </div>
          <div
            style={{
              marginTop: 12,
              display: 'flex',
              alignItems: 'baseline',
              gap: 16,
              flexWrap: 'wrap',
              fontFamily: monoFont,
              fontSize: 11,
              color: 'var(--ink-60)',
              letterSpacing: '0.04em',
            }}
          >
            <span>
              <span style={{ color: 'var(--ink)' }}>{graded.length}</span>
              {' '}reflections
            </span>
            <span>
              avg{' '}
              <span style={{ color: 'var(--ink)' }}>{avg.toFixed(1)}</span>
              {' '}/ 5
            </span>
            {items.length > graded.length && (
              <span style={{ color: 'var(--ink-40)' }}>
                +{items.length - graded.length} note-only
              </span>
            )}
          </div>
        </>
      )}
    </section>
  );
};

// ── X5 (Phase J P2 2026-05-12) web handoff footer ──────────────────────

const StatsWebHandoff: React.FC = () => {
  return (
    <div
      style={{
        marginTop: 24,
        paddingTop: 18,
        borderTop: '1px solid rgba(255,255,255,0.05)',
        display: 'flex',
        flexWrap: 'wrap',
        gap: 18,
        fontFamily: 'monospace',
        fontSize: 10,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        color: 'rgba(255,255,255,0.4)',
      }}
    >
      <button
        type="button"
        onClick={() => openWebInsights()}
        style={linkBtn}
        title="Открыть Insights stream в браузере (druz9.online)"
      >
        view insight timeline →
      </button>
      <button
        type="button"
        onClick={() => openWebProfileMemory()}
        style={linkBtn}
        title="Открыть Memory timeline в браузере (druz9.online)"
      >
        full memory timeline →
      </button>
    </div>
  );
};

const linkBtn: React.CSSProperties = {
  background: 'transparent',
  border: 0,
  padding: 0,
  font: 'inherit',
  color: 'inherit',
  textDecoration: 'underline',
  textUnderlineOffset: 2,
  cursor: 'pointer',
};

// ── activity feed ──────────────────────────────────────────────────────

const ActivityFeed: React.FC<{
  items: ExternalActivity[];
  onDeleted: () => void;
}> = ({ items, onDeleted }) => {
  void onDeleted; // delete UC wired в following iteration
  return (
    <section style={feedCard} className="motion-stagger">
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          marginBottom: 12,
        }}
      >
        <h2 style={cardTitle}>recent external activity</h2>
        {/* Manual «+ log» button удалён — Sergey 2026-05-05: AI должен
         * сам анализировать поведение, не просить юзера логать руками.
         * Existing data-feed: tutor-pushed assignments + atlas resource
         * clicks via user_resource_log + reflection submissions. */}
      </div>

      {items.length === 0 ? (
        <div style={{ color: 'var(--ink-60)', fontSize: 12 }}>
          no entries yet — track LeetCode / Coursera / books / YouTube here, daily-brief reads them.
        </div>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {items.slice(0, 10).map((it) => (
            <li key={it.id} style={feedRow}>
              <span style={{ ...captionMonoTiny, minWidth: 80, flex: '0 0 auto' }}>{it.source}</span>
              <span style={{ flex: 1, fontSize: 13, color: 'var(--ink-90)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {it.topicFreeText || it.topicAtlasNodeId || '(no topic)'}
              </span>
              <span style={{ fontFamily: monoFont, fontSize: 12, color: 'var(--ink-60)', whiteSpace: 'nowrap' }}>
                {it.durationMin}m
              </span>
              <span style={{ fontFamily: monoFont, fontSize: 11, color: 'var(--ink-40)', whiteSpace: 'nowrap' }}>
                {formatAgo(it.occurredAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};

function padToSevenDays(input: FocusDay[]): FocusDay[] {
  const byDate = new Map(input.map((d) => [d.date, d]));
  const out: FocusDay[] = [];
  const todayISO = (() => {
    if (input.length > 0) {
      return input.map((d) => d.date).sort().at(-1) as string;
    }
    return new Date().toISOString().slice(0, 10);
  })();
  const anchor = new Date(`${todayISO}T00:00:00Z`);
  for (let i = 6; i >= 0; i--) {
    const d = new Date(anchor);
    d.setUTCDate(anchor.getUTCDate() - i);
    const iso = d.toISOString().slice(0, 10);
    out.push(byDate.get(iso) ?? { date: iso, seconds: 0, sessions: 0 });
  }
  return out;
}

function weekdayShort(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][d.getUTCDay()];
}

function formatAgo(occurredAt: Date | null): string {
  if (!occurredAt) return '';
  const ms = Date.now() - occurredAt.getTime();
  const hours = Math.floor(ms / 3600_000);
  if (hours < 1) return '< 1h';
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

// ── design tokens ───────────────────────────────────────────────────────

const monoFont = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace";

const captionMonoSmall: React.CSSProperties = {
  fontFamily: monoFont,
  fontSize: 11,
  fontWeight: 500,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--ink-40)',
};

const captionMonoTiny: React.CSSProperties = {
  fontFamily: monoFont,
  fontSize: 10,
  fontWeight: 500,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--ink-40)',
};

const shell: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  overflowY: 'auto',
  background: 'var(--bg)',
  color: 'var(--ink)',
  padding: '60px 28px 96px',
  fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
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
  flexWrap: 'wrap',
};

const rangeBox: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  padding: 4,
  background: 'transparent',
  border: '1px solid var(--hair-2)',
  borderRadius: 'var(--radius-inner)',
  gap: 4,
};

const rangeBtn: React.CSSProperties = {
  padding: '6px 16px',
  fontSize: 12,
  fontWeight: 500,
  letterSpacing: '0.02em',
  borderRadius: 6,
  minWidth: 56,
  border: '1px solid transparent',
  cursor: 'pointer',
  fontFamily: monoFont,
  transition:
    'background-color var(--motion-dur-small) var(--motion-ease-standard), color var(--motion-dur-small) var(--motion-ease-standard), border-color var(--motion-dur-small) var(--motion-ease-standard), transform var(--motion-dur-small) var(--motion-ease-standard)',
};

const kpiRow: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
  gap: 16,
  marginBottom: 16,
};

const kpiCard: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid var(--hair-2)',
  borderRadius: 'var(--radius-outer)',
  padding: 20,
  minWidth: 0,
};

const kpiValue: React.CSSProperties = {
  fontSize: 32,
  fontWeight: 600,
  letterSpacing: '-0.018em',
  lineHeight: 1,
  color: 'var(--ink)',
};

const midRow: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
  gap: 16,
  marginBottom: 16,
};

const card: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid var(--hair-2)',
  borderRadius: 'var(--radius-outer)',
  padding: 24,
  minWidth: 0,
};

const feedCard: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid var(--hair-2)',
  borderRadius: 'var(--radius-outer)',
  padding: 20,
  minWidth: 0,
};

const cardTitle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  letterSpacing: '-0.012em',
  margin: 0,
  color: 'var(--ink)',
};

const feedRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '8px 0',
  borderTop: '1px solid var(--hair)',
  minWidth: 0,
};

export default Stats;
