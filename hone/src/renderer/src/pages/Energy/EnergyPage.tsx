// EnergyPage — recent energy log visualization (Phase K Wave 15).
//
// Layout:
//   • Header: title + range selector (7d/14d/30d).
//   • EnergyPicker: tap-here, fast log.
//   • Plot: each point is one log entry, X = hour-of-day, Y = level (1..5).
//     B/W only. Dots are 6px circles; today's points have a thin red
//     ring (the only accent in the project).
//   • Recent list under the plot — last N rows w/ note tooltip.
//
// No external chart lib — simple SVG, < 100 LOC plot area.
import { useEffect, useMemo, useState } from 'react';

import { EnergyPicker } from '../../components/EnergyPicker';
import { listEnergyLogs, type EnergyLog } from '../../api/energy';
import { trackEvent } from '../../api/events';

type Range = '7d' | '14d' | '30d';
const RANGE_DAYS: Record<Range, number> = { '7d': 7, '14d': 14, '30d': 30 };

export function EnergyPage(): JSX.Element {
  const [range, setRange] = useState<Range>('7d');
  const [logs, setLogs] = useState<EnergyLog[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = async (): Promise<void> => {
    setLoading(true);
    try {
      const rows = await listEnergyLogs(RANGE_DAYS[range]);
      setLogs(rows);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
    trackEvent('energy_page_open', { range });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range]);

  // ── Avg-by-hour pattern (simple aggregate over loaded window).
  const avgByHour = useMemo(() => {
    const buckets: Array<{ sum: number; count: number }> = Array.from(
      { length: 24 },
      () => ({ sum: 0, count: 0 }),
    );
    for (const l of logs) {
      const h = new Date(l.loggedAt).getHours();
      buckets[h].sum += l.level;
      buckets[h].count += 1;
    }
    return buckets.map((b) => (b.count === 0 ? null : b.sum / b.count));
  }, [logs]);

  // ── Plot geometry.
  const W = 720;
  const H = 240;
  const PAD_L = 36;
  const PAD_R = 16;
  const PAD_T = 16;
  const PAD_B = 28;

  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;

  // X by hour (0..23), Y by level (1..5).
  const xForHour = (h: number, m = 0): number =>
    PAD_L + ((h + m / 60) / 24) * innerW;
  const yForLevel = (lvl: number): number =>
    PAD_T + (1 - (lvl - 1) / 4) * innerH;

  const todayStr = new Date().toDateString();

  return (
    <div
      className="motion-page-in"
      style={{
        position: 'absolute',
        inset: 0,
        paddingTop: 64,
        padding: '64px 24px 24px',
        color: 'var(--ink)',
        overflowY: 'auto',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ fontSize: 14, letterSpacing: '0.14em', margin: 0, opacity: 0.7 }}>ENERGY</h2>
        <div style={{ display: 'flex', gap: 4 }}>
          {(['7d', '14d', '30d'] as Range[]).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              style={{
                ...rangeBtn,
                background: range === r ? 'rgba(255,255,255,0.08)' : 'transparent',
              }}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      <div style={{ marginTop: 16, display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <EnergyPicker onLogged={() => void reload()} />
        <div style={{ fontSize: 11, opacity: 0.55, maxWidth: 320, lineHeight: 1.6 }}>
          Tap a level whenever you notice. Patterns surface after ~10 points —
          schedule deep work for your peak windows.
        </div>
      </div>

      <div style={{ marginTop: 24 }}>
        {loading && <div style={{ opacity: 0.5, fontSize: 12 }}>Loading…</div>}
        {!loading && logs.length === 0 && (
          <div style={{ opacity: 0.5, fontSize: 12 }}>
            No entries yet. Log your current energy above.
          </div>
        )}
        {!loading && logs.length > 0 && (
          <svg
            width={W}
            height={H}
            style={{ maxWidth: '100%', display: 'block' }}
            aria-label="Energy by hour-of-day"
          >
            {/* Y grid lines for levels 1..5 */}
            {[1, 2, 3, 4, 5].map((lvl) => (
              <g key={lvl}>
                <line
                  x1={PAD_L}
                  y1={yForLevel(lvl)}
                  x2={W - PAD_R}
                  y2={yForLevel(lvl)}
                  stroke="rgba(255,255,255,0.05)"
                  strokeWidth={1}
                />
                <text
                  x={PAD_L - 8}
                  y={yForLevel(lvl) + 3}
                  textAnchor="end"
                  fontSize={9}
                  fill="rgba(255,255,255,0.4)"
                  fontFamily="JetBrains Mono, ui-monospace, monospace"
                >
                  {lvl}
                </text>
              </g>
            ))}
            {/* X axis hour labels (every 3h) */}
            {[0, 3, 6, 9, 12, 15, 18, 21, 24].map((h) => (
              <text
                key={h}
                x={xForHour(h)}
                y={H - 8}
                textAnchor="middle"
                fontSize={9}
                fill="rgba(255,255,255,0.4)"
                fontFamily="JetBrains Mono, ui-monospace, monospace"
              >
                {h.toString().padStart(2, '0')}
              </text>
            ))}

            {/* Avg curve */}
            {(() => {
              const pts: Array<{ x: number; y: number }> = [];
              for (let h = 0; h < 24; h++) {
                const avg = avgByHour[h];
                if (avg !== null) pts.push({ x: xForHour(h, 30), y: yForLevel(avg) });
              }
              if (pts.length < 2) return null;
              const d = pts.map((p, i) => (i === 0 ? `M${p.x},${p.y}` : `L${p.x},${p.y}`)).join(' ');
              return (
                <path
                  d={d}
                  fill="none"
                  stroke="rgba(255,255,255,0.25)"
                  strokeWidth={1.5}
                />
              );
            })()}

            {/* Points */}
            {logs.map((l) => {
              const t = new Date(l.loggedAt);
              const isToday = t.toDateString() === todayStr;
              const cx = xForHour(t.getHours(), t.getMinutes());
              const cy = yForLevel(l.level);
              return (
                <g key={l.id}>
                  <circle
                    cx={cx}
                    cy={cy}
                    r={4}
                    fill={isToday ? '#FF3B30' : 'var(--ink)'}
                    opacity={isToday ? 1 : 0.7}
                  />
                  {l.note && (
                    <title>{`${t.toLocaleString()} · ${l.level} · ${l.note}`}</title>
                  )}
                </g>
              );
            })}
          </svg>
        )}
      </div>

      <div style={{ marginTop: 24 }}>
        <div style={{ fontSize: 11, opacity: 0.55, letterSpacing: '0.14em' }}>
          RECENT
        </div>
        <div style={{ marginTop: 8, fontSize: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {logs.slice(0, 20).map((l) => (
            <div
              key={l.id}
              style={{
                display: 'grid',
                gridTemplateColumns: '110px 30px 1fr',
                gap: 12,
                paddingBottom: 6,
                borderBottom: '1px solid rgba(255,255,255,0.04)',
              }}
            >
              <span style={{ opacity: 0.5, fontFamily: 'JetBrains Mono, ui-monospace, monospace' }}>
                {new Date(l.loggedAt).toLocaleString(undefined, {
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
              <span style={{ fontWeight: 500 }}>{l.level}</span>
              <span style={{ opacity: 0.7 }}>{l.note || ''}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const rangeBtn: React.CSSProperties = {
  height: 24,
  padding: '0 10px',
  fontSize: 10,
  letterSpacing: '0.08em',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 6,
  color: 'var(--ink)',
  cursor: 'pointer',
};
