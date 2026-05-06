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
import React, { useEffect, useMemo, useState } from 'react';

import { getStats, type HoneStats, type FocusDay } from '../api/hone';
import { getCoachStats, type CoachStats } from '../api/intelligence';
import { listExternalActivity, type ExternalActivity, type ExternalSource } from '../api/external';
import { ExternalActivityModal } from '../components/ExternalActivityModal';

type Range = '7d' | '30d' | '90d';

export const Stats: React.FC = () => {
  const [range, setRange] = useState<Range>('7d');
  const [stats, setStats] = useState<HoneStats | null>(null);
  const [coach, setCoach] = useState<CoachStats | null>(null);
  const [activity, setActivity] = useState<ExternalActivity[]>([]);
  // logOpen state retired — Sergey 2026-05-05: no manual logging button.
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getStats()
      .then((r) => {
        if (!cancelled) setStats(r);
      })
      .catch(() => {
        if (!cancelled) setStats(null);
      });
    return () => {
      cancelled = true;
    };
  }, [reload]);

  useEffect(() => {
    let cancelled = false;
    getCoachStats()
      .then((r) => {
        if (!cancelled) setCoach(r);
      })
      .catch(() => {
        if (!cancelled) setCoach(null);
      });
    return () => {
      cancelled = true;
    };
  }, [reload]);

  useEffect(() => {
    let cancelled = false;
    listExternalActivity({ limit: 30 })
      .then((r) => {
        if (!cancelled) setActivity(r);
      })
      .catch(() => {
        if (!cancelled) setActivity([]);
      });
    return () => {
      cancelled = true;
    };
  }, [reload]);

  const focusDays = useMemo(() => padToSevenDays(stats?.lastSevenDays ?? []), [stats]);
  const totalFocusMin = useMemo(
    () => Math.round((stats?.totalFocusedSeconds ?? 0) / 60),
    [stats],
  );
  const topTopics = useMemo(() => deriveTopTopics(activity), [activity]);

  return (
    <>
      <StatsStyles />
      <div style={shell} className="stats-page-enter">
        <div style={innerWrap}>
          <Header range={range} setRange={setRange} />

          <div style={kpiRow} className="stats-stagger">
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

          <div style={midRow} className="stats-stagger">
            <FocusHeatmap days={focusDays} />
            <TopTopicsCard topics={topTopics} />
          </div>

          <ActivityFeed
            items={activity}
            onDeleted={() => setReload((n) => n + 1)}
          />
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
    <span
      style={{
        ...dimColor(0.5),
        fontSize: 11,
        fontFamily: monoFont,
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
      }}
    >
      stats
    </span>
    <div style={rangeBox}>
      {(['7d', '30d', '90d'] as Range[]).map((r) => (
        <button
          key={r}
          onClick={() => setRange(r)}
          style={{
            ...rangeBtn,
            color: range === r ? 'rgba(255,255,255,0.92)' : 'rgba(255,255,255,0.5)',
            background: range === r ? '#161616' : 'transparent',
            borderColor: range === r ? 'rgba(255,255,255,0.12)' : 'transparent',
          }}
        >
          {r}
        </button>
      ))}
    </div>
  </header>
);

// ── KPI card ────────────────────────────────────────────────────────────

const KpiCard: React.FC<{ label: string; value: string; unit: string; hint: string }> = ({
  label,
  value,
  unit,
  hint,
}) => (
  <div style={kpiCard}>
    <div
      style={{
        ...dimColor(0.5),
        fontSize: 10,
        fontFamily: monoFont,
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        marginBottom: 8,
      }}
    >
      {label}
    </div>
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
      <span style={kpiValue}>{value}</span>
      {unit && <span style={{ ...dimColor(0.5), fontSize: 13, fontFamily: monoFont }}>{unit}</span>}
    </div>
    {hint && (
      <div style={{ ...dimColor(0.3), fontSize: 11, fontFamily: monoFont, marginTop: 6 }}>{hint}</div>
    )}
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
        <span
          style={{
            ...dimColor(0.3),
            fontSize: 11,
            fontFamily: monoFont,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
          }}
        >
          last 7d
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 140 }}>
        {days.map((d) => {
          const ratio = d.seconds / max;
          const min = Math.round(d.seconds / 60);
          return (
            <div key={d.date} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
              <div style={{ ...dimColor(0.3), fontSize: 10, fontFamily: monoFont }}>
                {min || '·'}
              </div>
              <div
                title={`${d.date} · ${min} min · ${d.sessions} sessions`}
                style={{
                  width: '100%',
                  height: `${Math.max(3, ratio * 100)}%`,
                  background:
                    d.seconds === 0
                      ? 'rgba(255,255,255,0.05)'
                      : `rgba(255,255,255,${0.25 + ratio * 0.55})`,
                  borderRadius: 3,
                  transition: 'height 320ms cubic-bezier(0.2,0.7,0.2,1)',
                }}
              />
              <div style={{ ...dimColor(0.5), fontSize: 10, fontFamily: monoFont }}>
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
      <div style={{ ...dimColor(0.5), fontSize: 12 }}>
        no external activity yet — log a session to start tracking.
      </div>
    ) : (
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {topics.map((t) => (
          <li
            key={t.label}
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 50px 60px',
              alignItems: 'center',
              gap: 8,
              padding: '6px 0',
            }}
          >
            <span style={{ fontSize: 13, ...dimColor(0.85) }}>{t.label}</span>
            <span style={{ ...dimColor(0.5), fontSize: 11, fontFamily: monoFont, textAlign: 'right' }}>
              {t.minutes}m
            </span>
            <div style={{ position: 'relative', height: 4, background: 'rgba(255,255,255,0.07)', borderRadius: 2 }}>
              <div
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: `${Math.min(100, t.share * 100)}%`,
                  background: 'rgba(255,255,255,0.7)',
                  borderRadius: 2,
                }}
              />
            </div>
          </li>
        ))}
      </ul>
    )}
  </div>
);

// ── activity feed ──────────────────────────────────────────────────────

const ActivityFeed: React.FC<{
  items: ExternalActivity[];
  onDeleted: () => void;
}> = ({ items, onDeleted }) => {
  void onDeleted; // delete UC wired в following iteration
  return (
    <section style={feedCard} className="stats-stagger">
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
        <div style={{ ...dimColor(0.5), fontSize: 12 }}>
          no entries yet — track LeetCode / Coursera / books / YouTube here, daily-brief reads them.
        </div>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {items.slice(0, 10).map((it) => (
            <li key={it.id} style={feedRow}>
              <span
                style={{
                  fontSize: 10,
                  fontFamily: monoFont,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  ...dimColor(0.5),
                  minWidth: 80,
                }}
              >
                {it.source}
              </span>
              <span style={{ flex: 1, fontSize: 13, ...dimColor(0.85) }}>
                {it.topicFreeText || it.topicAtlasNodeId || '(no topic)'}
              </span>
              <span style={{ fontFamily: monoFont, fontSize: 12, ...dimColor(0.5), whiteSpace: 'nowrap' }}>
                {it.durationMin}m
              </span>
              <span style={{ fontFamily: monoFont, fontSize: 11, ...dimColor(0.3), whiteSpace: 'nowrap' }}>
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

const monoFont =
  '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace';

const shell: React.CSSProperties = {
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

const rangeBox: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  padding: 4,
  background: '#111',
  border: '1px solid rgba(255,255,255,0.07)',
  borderRadius: 8,
  gap: 4,
};

const rangeBtn: React.CSSProperties = {
  padding: '6px 16px',
  fontSize: 12,
  fontWeight: 500,
  letterSpacing: '0.02em',
  borderRadius: 6,
  minWidth: 56,
  background: 'transparent',
  border: '1px solid transparent',
  cursor: 'pointer',
  fontFamily: monoFont,
};

// btnGhost retired with manual log button (Sergey 2026-05-05).

const kpiRow: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(4, 1fr)',
  gap: 16,
  marginBottom: 16,
};

const kpiCard: React.CSSProperties = {
  background: '#0a0a0a',
  border: '1px solid rgba(255,255,255,0.07)',
  borderRadius: 12,
  padding: 20,
};

const kpiValue: React.CSSProperties = {
  fontSize: 32,
  fontWeight: 600,
  lineHeight: 1,
  color: '#fff',
};

const midRow: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, 1fr)',
  gap: 16,
  marginBottom: 16,
};

const card: React.CSSProperties = {
  background: '#0a0a0a',
  border: '1px solid rgba(255,255,255,0.07)',
  borderRadius: 12,
  padding: 24,
};

const feedCard: React.CSSProperties = {
  background: '#0a0a0a',
  border: '1px solid rgba(255,255,255,0.07)',
  borderRadius: 12,
  padding: 20,
};

const cardTitle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  letterSpacing: '-0.01em',
  margin: 0,
};

const feedRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '8px 0',
  borderTop: '1px solid rgba(255,255,255,0.07)',
};

function dimColor(opacity: number): React.CSSProperties {
  return { color: `rgba(255,255,255,${opacity})` };
}

const StatsStyles: React.FC = () => (
  <style>{`
@keyframes statsFade {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}
.stats-page-enter { animation: statsFade 220ms cubic-bezier(0.2,0.7,0.2,1) both; }

@keyframes statsRise {
  from { opacity: 0; transform: translateY(9px); }
  to { opacity: 1; transform: translateY(0); }
}
.stats-stagger > * { opacity: 0; animation: statsRise 480ms cubic-bezier(0.2,0.7,0.2,1) forwards; }
.stats-stagger > *:nth-child(1) { animation-delay: 60ms; }
.stats-stagger > *:nth-child(2) { animation-delay: 130ms; }
.stats-stagger > *:nth-child(3) { animation-delay: 200ms; }
.stats-stagger > *:nth-child(4) { animation-delay: 270ms; }
`}</style>
);

export default Stats;
