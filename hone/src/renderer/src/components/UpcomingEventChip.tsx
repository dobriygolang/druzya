// Shows the NEXT scheduled tutor session (if any within the next 24h)
// as a small pill at top-right. Click → /calendar page; meet-link click
// opens the URL directly. Hidden during focus session and when nothing
// is upcoming-soon.

import { useCallback, useEffect, useState } from 'react';

import { listUpcomingEvents, type TutorEvent } from '../api/tutor';

const SOON_WINDOW_MS = 24 * 60 * 60 * 1000;

function timeUntil(d: Date): string {
  const ms = d.getTime() - Date.now();
  if (ms <= 0) return 'now';
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `in ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `in ${h}h`;
  return `in ${Math.floor(h / 24)}d`;
}

function isLive(e: TutorEvent): boolean {
  if (!e.scheduledAt) return false;
  const start = e.scheduledAt.getTime();
  const end = start + e.durationMin * 60_000;
  const now = Date.now();
  return now >= start && now <= end;
}

interface Props {
  running: boolean;
  onOpenCalendar: () => void;
}

export function UpcomingEventChip({ running, onOpenCalendar }: Props) {
  const [items, setItems] = useState<TutorEvent[]>([]);

  const refresh = useCallback(async () => {
    try {
      const next = await listUpcomingEvents(5);
      setItems(next);
    } catch {
      // Silent — chip is non-critical UI; if the API is down we just hide.
      setItems([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
    // 60s poll matches the assignments banner cadence.
    let id: number | null = null;
    const startPolling = () => {
      if (id !== null) return;
      id = window.setInterval(() => void refresh(), 60_000);
    };
    const stopPolling = () => {
      if (id === null) return;
      window.clearInterval(id);
      id = null;
    };
    if (typeof document === 'undefined' || !document.hidden) startPolling();
    const onFocus = () => void refresh();
    const onVisibility = () => {
      if (document.hidden) {
        stopPolling();
      } else {
        void refresh();
        startPolling();
      }
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stopPolling();
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [refresh]);

  if (running) return null;

  // Pick the next event (earliest-future). Server already returns
  // earliest-first, but we double-check by sorting on the JS side in
  // case the policy changes.
  const next = pickNext(items);
  if (!next || !next.scheduledAt) return null;

  const live = isLive(next);
  const ms = next.scheduledAt.getTime() - Date.now();
  // Only surface within the «soon» window — past 24h would clutter Home.
  // Live events always surface (otherwise the chip would dismiss right
  // when the user needs the join button most).
  if (!live && (ms < 0 || ms > SOON_WINDOW_MS)) return null;

  // Active "LIVE NOW" event surfaces as red signal stripe; scheduled-soon
  // sessions use ink-ramp (no chroma — calmer indicator).
  const stripe = live ? 'var(--red)' : 'var(--ink-60)';

  return (
    <button
      type="button"
      onClick={onOpenCalendar}
      className="fadein"
      style={{
        position: 'absolute',
        top: 56,
        right: 32,
        maxWidth: 320,
        padding: '8px 12px',
        background: 'rgba(8,8,8,0.92)',
        border: '1px solid var(--hair)',
        borderLeft: `3px solid ${stripe}`,
        borderRadius: 'var(--radius-inner)',
        backdropFilter: 'blur(14px)',
        color: 'var(--ink)',
        textAlign: 'left',
        cursor: 'pointer',
      }}
      title={next.title}
    >
      <div
        className="mono"
        style={{
          fontSize: 9,
          letterSpacing: '0.08em',
          color: 'var(--ink-40)',
          marginBottom: 2,
        }}
      >
        {live ? 'LIVE NOW · TUTOR' : `NEXT SESSION · ${timeUntil(next.scheduledAt).toUpperCase()}`}
      </div>
      <div
        style={{
          fontSize: 13,
          fontWeight: 500,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {next.title}
      </div>
      {live && next.meetUrl && (
        <a
          href={next.meetUrl}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="mono"
          style={{
            display: 'inline-block',
            marginTop: 6,
            padding: '3px 8px',
            fontSize: 9,
            letterSpacing: '0.08em',
            color: stripe,
            textDecoration: 'none',
            border: `1px solid ${stripe}`,
            borderRadius: 999,
          }}
        >
          JOIN →
        </a>
      )}
    </button>
  );
}

function pickNext(items: TutorEvent[]): TutorEvent | null {
  if (items.length === 0) return null;
  // Defensive: live first, then earliest-upcoming.
  const live = items.find(isLive);
  if (live) return live;
  const sorted = [...items]
    .filter((e) => e.scheduledAt !== null)
    .sort((a, b) => (a.scheduledAt!.getTime() - b.scheduledAt!.getTime()));
  return sorted[0] ?? null;
}
