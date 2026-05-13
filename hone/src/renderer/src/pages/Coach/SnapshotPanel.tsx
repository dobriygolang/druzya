import React, { useMemo } from 'react';
import type {
  ForkSnapshot,
  SkillRadar,
  CoachStats,
} from '../../api/intelligence';
import { type Mode, dimColor } from './lib/types';
import { monoFont, snapshotCard, snapRow, chipStyle } from './lib/styles';

interface RadarAxis {
  key: string;
  label: string;
  score: number; // 0..1
}

interface SnapshotPanelProps {
  mode: Mode;
  fork: ForkSnapshot | null;
  radar: SkillRadar | null;
  stats: CoachStats | null;
}

export const SnapshotPanel: React.FC<SnapshotPanelProps> = ({ mode, fork, radar, stats }) => {
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
        <span style={{ ...dimColor(0.5), fontSize: 11, fontFamily: monoFont, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
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
        <div style={{ ...dimColor(0.5), fontSize: 11, fontFamily: monoFont, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
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
