// Calendar — Wave 5.2b student-side surface for tutor-scheduled events.
//
// Layout: vertical column.
//   - Header copy
//   - Empty / loading / error states
//   - Day-grouped event list, earliest first.
//
// Polls upcoming events every 60 s + on window focus (matches the
// HomePage chip refresh cadence). Events render in the viewer's local
// timezone — backend stores UTC, we re-render via toLocaleString.

import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  joinEvent,
  leaveEvent,
  listUpcomingEvents,
  listUpcomingGroupEvents,
  type TutorEvent,
} from '../api/tutor';

interface State {
  status: 'loading' | 'ok' | 'error';
  items: TutorEvent[];
  groupItems: TutorEvent[];
  error: string | null;
}

const INITIAL: State = { status: 'loading', items: [], groupItems: [], error: null };

type DisplayState = 'live' | 'soon' | 'later';

function eventDisplayState(e: TutorEvent): DisplayState {
  if (!e.scheduledAt) return 'later';
  const start = e.scheduledAt.getTime();
  const end = start + e.durationMin * 60_000;
  const now = Date.now();
  if (now >= start && now <= end) return 'live';
  if (start - now < 24 * 60 * 60 * 1000) return 'soon';
  return 'later';
}

// Group label: «Today» / «Tomorrow» / «Mon, Mar 14». Uses the user's
// local TZ — events in different days are visually separated, which
// matters when «next session» is at 9am and you're glancing at the page
// at midnight.
function dayKey(d: Date): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const that = new Date(d);
  that.setHours(0, 0, 0, 0);
  const diffDays = Math.round((that.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Tomorrow';
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function timeOfDay(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function timeUntil(d: Date): string {
  const ms = d.getTime() - Date.now();
  if (ms <= 0) return 'now';
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `in ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `in ${h}h`;
  return `in ${Math.floor(h / 24)}d`;
}

export function CalendarPage() {
  const [state, setState] = useState<State>(INITIAL);

  const refresh = useCallback(async () => {
    try {
      const [items, groupItems] = await Promise.all([
        listUpcomingEvents(50),
        listUpcomingGroupEvents().catch(() => [] as TutorEvent[]),
      ]);
      setState({ status: 'ok', items, groupItems, error: null });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'unknown';
      setState({ status: 'error', items: [], groupItems: [], error: msg });
    }
  }, []);

  useEffect(() => {
    void refresh();
    // 60 s poll mirrors the assignments banner. Cheap GET against the
    // partial-indexed table; refresh-on-focus catches «tutor scheduled
    // something while I was away».
    const id = window.setInterval(() => void refresh(), 60_000);
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('focus', onFocus);
    };
  }, [refresh]);

  const grouped = useMemo(() => groupByDay(state.items), [state.items]);

  return (
    <div
      className="fadein"
      style={{
        position: 'absolute',
        inset: 0,
        animationDuration: '320ms',
        paddingTop: 96,
        paddingBottom: 120,
        overflowY: 'auto',
      }}
    >
      <div style={{ width: 720, maxWidth: '92%', margin: '0 auto', padding: '0 24px' }}>
        <header style={{ marginBottom: 24 }}>
          <div
            className="mono"
            style={{
              fontSize: 10,
              letterSpacing: '0.24em',
              color: 'var(--ink-40)',
              marginBottom: 4,
            }}
          >
            CALENDAR · UPCOMING
          </div>
          <h1
            style={{
              margin: 0,
              fontSize: 40,
              fontWeight: 500,
              letterSpacing: '-0.02em',
              lineHeight: 1.1,
              color: 'var(--ink)',
            }}
          >
            Your sessions
          </h1>
          <p style={{ margin: '12px 0 0', fontSize: 13, color: 'var(--ink-60)', maxWidth: 520 }}>
            События, которые тутор поставил тебе в расписание. Live-сессия
            (происходит сейчас) подсвечивается зелёным; meet-link открывается
            одним кликом.
          </p>
        </header>

        {state.status === 'loading' && (
          <p style={{ color: 'var(--ink-40)', fontSize: 13 }}>Loading…</p>
        )}
        {state.status === 'error' && (
          <p style={{ color: 'var(--ink-60)', fontSize: 13 }}>
            Не удалось загрузить: {state.error}
          </p>
        )}
        {state.status === 'ok' && state.items.length === 0 && (
          <div
            style={{
              padding: 32,
              textAlign: 'center',
              border: '1px solid rgba(255,255,255,0.06)',
              borderRadius: 12,
              background: 'rgba(255,255,255,0.02)',
            }}
          >
            <p style={{ margin: 0, fontSize: 14, color: 'var(--ink-60)' }}>
              Запланированных событий нет.
            </p>
            <p
              style={{
                margin: '8px 0 0',
                fontSize: 12,
                color: 'var(--ink-40)',
              }}
            >
              Тутор поставит сессию — она появится здесь и в HomePage-чипе.
            </p>
          </div>
        )}

        {state.status === 'ok' && state.groupItems.length > 0 && (
          <section style={{ marginBottom: 28 }}>
            <div
              className="mono"
              style={{
                fontSize: 10,
                letterSpacing: '0.2em',
                color: 'var(--ink-40)',
                marginBottom: 8,
              }}
            >
              GROUP CLASSES · OPEN
            </div>
            <ul
              style={{
                listStyle: 'none',
                padding: 0,
                margin: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
            >
              {state.groupItems.map((ev) => (
                <li key={ev.id}>
                  <GroupEventCard event={ev} onChanged={refresh} />
                </li>
              ))}
            </ul>
          </section>
        )}

        {state.status === 'ok' && state.items.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            {grouped.map(({ key, items }) => (
              <section key={key}>
                <div
                  className="mono"
                  style={{
                    fontSize: 10,
                    letterSpacing: '0.2em',
                    color: 'var(--ink-40)',
                    marginBottom: 8,
                  }}
                >
                  {key.toUpperCase()}
                </div>
                <ul
                  style={{
                    listStyle: 'none',
                    padding: 0,
                    margin: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                  }}
                >
                  {items.map((ev) => (
                    <li key={ev.id}>
                      <EventCard event={ev} />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function groupByDay(items: TutorEvent[]): Array<{ key: string; items: TutorEvent[] }> {
  const buckets = new Map<string, TutorEvent[]>();
  const order: string[] = [];
  for (const e of items) {
    if (!e.scheduledAt) continue;
    const k = dayKey(e.scheduledAt);
    if (!buckets.has(k)) {
      buckets.set(k, []);
      order.push(k);
    }
    buckets.get(k)!.push(e);
  }
  return order.map((k) => ({ key: k, items: buckets.get(k)! }));
}

function EventCard({ event }: { event: TutorEvent }) {
  const ds = eventDisplayState(event);
  const stripe =
    ds === 'live' ? 'rgb(74, 222, 128)' : ds === 'soon' ? 'rgb(251, 191, 36)' : 'rgb(96, 165, 250)';

  return (
    <article
      style={{
        padding: '14px 16px 12px',
        background: 'rgba(255,255,255,0.02)',
        border: '1px solid rgba(255,255,255,0.06)',
        borderLeft: `3px solid ${stripe}`,
        borderRadius: 12,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
        <h2
          style={{
            margin: 0,
            fontSize: 16,
            fontWeight: 500,
            color: 'var(--ink)',
            flex: 1,
            minWidth: 0,
          }}
        >
          {event.title}
        </h2>
        {event.scheduledAt && (
          <span
            className="mono"
            style={{
              fontSize: 10,
              letterSpacing: '0.16em',
              color: stripe,
              textTransform: 'uppercase',
            }}
          >
            {ds === 'live' ? 'LIVE NOW' : timeUntil(event.scheduledAt)}
          </span>
        )}
      </div>

      {event.bodyMd && (
        <pre
          style={{
            margin: '6px 0 10px',
            whiteSpace: 'pre-wrap',
            fontFamily: 'inherit',
            fontSize: 13,
            lineHeight: 1.5,
            color: 'var(--ink-60)',
          }}
        >
          {event.bodyMd}
        </pre>
      )}

      {/* Wave 5.2d — completed events carry the tutor's session note.
          ListUpcomingEvents excludes completed status server-side, so
          this branch is dormant for the upcoming feed; kept for the
          future «past sessions» endpoint that surfaces them. */}
      {event.sessionNote && (
        <div
          style={{
            margin: '6px 0 10px',
            padding: '8px 10px',
            border: '1px solid rgba(255,255,255,0.18)',
            background: 'rgba(255,255,255,0.04)',
            borderRadius: 8,
          }}
        >
          <div
            className="mono"
            style={{
              fontSize: 9,
              letterSpacing: '0.18em',
              color: 'rgba(255,255,255,0.85)',
              marginBottom: 2,
            }}
          >
            SESSION NOTE
          </div>
          <pre
            style={{
              margin: 0,
              whiteSpace: 'pre-wrap',
              fontFamily: 'inherit',
              fontSize: 13,
              lineHeight: 1.5,
              color: 'var(--ink)',
            }}
          >
            {event.sessionNote}
          </pre>
        </div>
      )}

      <div
        className="mono"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 10,
          fontSize: 10,
          letterSpacing: '0.14em',
          color: 'var(--ink-40)',
          textTransform: 'uppercase',
        }}
      >
        {event.scheduledAt && <span>{timeOfDay(event.scheduledAt)}</span>}
        <span>· {event.durationMin} min</span>
        {event.meetUrl && (
          <a
            href={event.meetUrl}
            target="_blank"
            rel="noreferrer"
            style={{
              color: 'var(--ink-60)',
              textDecoration: 'none',
              padding: '3px 10px',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 999,
              marginLeft: 'auto',
            }}
          >
            JOIN →
          </a>
        )}
      </div>
    </article>
  );
}

function GroupEventCard({
  event,
  onChanged,
}: {
  event: TutorEvent;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<'join' | 'leave' | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const onJoin = async () => {
    setBusy('join');
    setErr(null);
    try {
      await joinEvent(event.id);
      onChanged();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'join failed');
    } finally {
      setBusy(null);
    }
  };
  const onLeave = async () => {
    setBusy('leave');
    setErr(null);
    try {
      await leaveEvent(event.id);
      onChanged();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'leave failed');
    } finally {
      setBusy(null);
    }
  };

  return (
    <article
      style={{
        padding: '14px 16px 12px',
        background: 'rgba(255,255,255,0.02)',
        border: '1px solid rgba(255,255,255,0.06)',
        borderLeft: '3px solid rgb(168, 85, 247)',
        borderRadius: 12,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span
          className="mono"
          style={{
            fontSize: 9,
            letterSpacing: '0.2em',
            color: 'var(--ink-40)',
          }}
        >
          GROUP{event.capacity > 0 ? ` · cap ${event.capacity}` : ''}
        </span>
        {event.scheduledAt && (
          <span style={{ fontSize: 11, color: 'var(--ink-40)', marginLeft: 'auto' }}>
            {timeOfDay(event.scheduledAt)} · {timeUntil(event.scheduledAt)}
          </span>
        )}
      </div>
      <div style={{ fontSize: 14, color: 'var(--ink)', marginBottom: 4 }}>{event.title}</div>
      {event.bodyMd && (
        <p style={{ margin: '0 0 8px', fontSize: 12, color: 'var(--ink-60)', whiteSpace: 'pre-wrap' }}>
          {event.bodyMd}
        </p>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          type="button"
          onClick={onJoin}
          disabled={busy !== null}
          className="mono"
          style={{
            fontSize: 10,
            letterSpacing: '0.18em',
            padding: '5px 10px',
            background: 'rgba(168, 85, 247, 0.15)',
            color: 'rgb(216, 180, 254)',
            border: '1px solid rgba(168, 85, 247, 0.3)',
            borderRadius: 999,
            cursor: busy ? 'wait' : 'pointer',
          }}
        >
          {busy === 'join' ? '…' : 'JOIN'}
        </button>
        <button
          type="button"
          onClick={onLeave}
          disabled={busy !== null}
          className="mono"
          style={{
            fontSize: 10,
            letterSpacing: '0.18em',
            padding: '5px 10px',
            background: 'transparent',
            color: 'var(--ink-60)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 999,
            cursor: busy ? 'wait' : 'pointer',
          }}
        >
          {busy === 'leave' ? '…' : 'LEAVE'}
        </button>
        {err && <span style={{ fontSize: 11, color: 'rgb(248, 113, 113)' }}>{err}</span>}
      </div>
    </article>
  );
}
