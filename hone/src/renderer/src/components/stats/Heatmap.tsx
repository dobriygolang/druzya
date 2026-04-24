// Heatmap — 7-row × 26-week grid (182 days) of focus activity.
//
// Data shape matches the backend's FocusHeatmapDay stream: the component
// takes an ordered list of { seconds, date } cells and buckets them into
// opacity brackets. Empty / missing days render as the lowest bracket
// (a visible but faded square) so the grid never "looks broken" with
// gaps.
//
// Today's cell is the most recent entry in `days` and renders in accent
// red. Brackets are deliberately crude (5 levels) — the grid is a vibe
// signal, not a chart, and GitHub has trained everyone to read this
// shape at a glance.
import type { FocusDay } from '../../api/hone';

interface HeatmapProps {
  days?: FocusDay[];
}

const CELLS = 7 * 26;

function opacityFor(seconds: number): number {
  // Brackets: 0, <10min, <30min, <60min, <2h, 2h+. The top bracket
  // is bright white (0.6 opacity) — the user never sees 100% because
  // that would flatten the grid visually at any scale.
  if (seconds <= 0) return 0.04;
  if (seconds < 600) return 0.1;
  if (seconds < 1800) return 0.2;
  if (seconds < 3600) return 0.35;
  if (seconds < 7200) return 0.5;
  return 0.6;
}

export function Heatmap({ days = [] }: HeatmapProps) {
  // Map ISO date → seconds for O(1) lookup; fall back to 0 on miss.
  const bySeconds = new Map(days.map((d) => [d.date, d.seconds]));

  // Build the cell order. We align the rightmost column to today and
  // walk backwards in time one day per cell, column-first. This matches
  // the design's grid-auto-flow: column with 7 rows.
  const today = days.at(-1)?.date ?? new Date().toISOString().slice(0, 10);
  const anchor = new Date(`${today}T00:00:00Z`);
  const cells: { iso: string; seconds: number; isToday: boolean }[] = [];
  for (let i = CELLS - 1; i >= 0; i--) {
    const d = new Date(anchor);
    d.setUTCDate(anchor.getUTCDate() - i);
    const iso = d.toISOString().slice(0, 10);
    cells.push({ iso, seconds: bySeconds.get(iso) ?? 0, isToday: iso === today });
  }

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateRows: 'repeat(7, 1fr)',
        gridAutoFlow: 'column',
        gridAutoColumns: '1fr',
        gap: 3,
      }}
    >
      {cells.map((c) => (
        <span
          key={c.iso}
          title={`${c.iso} · ${Math.round(c.seconds / 60)}m`}
          style={{
            aspectRatio: '1/1',
            borderRadius: 2,
            background: c.isToday
              ? 'var(--red)'
              : `rgba(255,255,255,${opacityFor(c.seconds)})`,
          }}
        />
      ))}
    </div>
  );
}
