// Bars — last 7 days of focus time as a bar chart. Each bar height is
// relative to the 7-day max rather than the server-reported daily cap,
// so the chart always uses its full vertical space even on low-volume
// weeks. Today is rendered in accent red.
import type { FocusDay } from '../../api/hone';

interface BarsProps {
  days: FocusDay[]; // 0..7 most recent days, oldest first
}

const MAX_HEIGHT_PX = 120;
const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function weekdayLabel(iso: string): string {
  // Build a UTC-anchored Date — the backend emits YYYY-MM-DD and we
  // want the label deterministic regardless of the user's local TZ.
  const d = new Date(`${iso}T00:00:00Z`);
  return WEEKDAY_LABELS[d.getUTCDay()] ?? '';
}

export function Bars({ days }: BarsProps) {
  const todayISO = days.at(-1)?.date ?? new Date().toISOString().slice(0, 10);
  const maxSeconds = Math.max(1, ...days.map((d) => d.seconds));

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${days.length || 1}, 1fr)`,
        gap: 10,
        alignItems: 'end',
        height: 150,
      }}
    >
      {days.map((d) => {
        const h = (d.seconds / maxSeconds) * MAX_HEIGHT_PX;
        const isToday = d.date === todayISO;
        return (
          <div key={d.date} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
            <div style={{ width: '100%', height: MAX_HEIGHT_PX, display: 'flex', alignItems: 'flex-end' }}>
              <div
                style={{
                  width: '100%',
                  height: h,
                  background: isToday ? 'var(--red)' : 'rgba(255,255,255,0.9)',
                  borderRadius: 3,
                  transition: 'height 500ms cubic-bezier(.2,.7,.2,1)',
                }}
              />
            </div>
            <div className="mono" style={{ fontSize: 10, color: 'var(--ink-40)' }}>
              {weekdayLabel(d.date)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
