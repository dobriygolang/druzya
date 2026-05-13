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
import { useQuotaStore } from '../stores/quota';
import { requestUpgrade } from '../components/UpgradeModal';

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

const monoFont = "'JetBrains Mono', ui-monospace, monospace";

const captionMonoTiny: React.CSSProperties = {
  fontFamily: monoFont,
  fontSize: 10,
  fontWeight: 500,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--ink-40)',
};

export function CalendarPage() {
  const [state, setState] = useState<State>(INITIAL);
  const tier = useQuotaStore((s) => s.tier);

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
      className="motion-page-in"
      style={{
        position: 'absolute',
        inset: 0,
        paddingTop: 96,
        paddingBottom: 120,
        overflowY: 'auto',
      }}
    >
      <div style={{ width: 720, maxWidth: '92%', margin: '0 auto', padding: '0 24px' }}>
        <header style={{ marginBottom: 24 }}>
          <div style={{ ...captionMonoTiny, marginBottom: 6 }}>CALENDAR · UPCOMING</div>
          <h1
            style={{
              margin: 0,
              fontSize: 'var(--type-h1-size)',
              lineHeight: 'var(--type-h1-lh)',
              letterSpacing: 'var(--type-h1-ls)',
              fontWeight: 'var(--type-h1-weight)',
              color: 'var(--ink)',
            }}
          >
            Your sessions
          </h1>
          <p
            style={{
              margin: '12px 0 0',
              fontSize: 'var(--type-body-size)',
              lineHeight: 'var(--type-body-lh)',
              color: 'var(--ink-60)',
              maxWidth: 540,
            }}
          >
            События, которые тутор поставил тебе в расписание. Live-сессия (происходит сейчас)
            подсвечивается красным сигналом; meet-link открывается одним кликом.
          </p>
        </header>

        {tier === 'free' && (
          <button
            type="button"
            onClick={() => {
              requestUpgrade({
                feature: 'calendar_sync',
                label: 'Google Calendar sync',
                benefit:
                  'Pro syncs tutor sessions, focus blocks, and reflections two-ways with Google Calendar — schedule a session in either place and the other reflects it within seconds.',
              });
            }}
            className="focus-ring"
            style={{
              display: 'flex',
              width: '100%',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              marginBottom: 20,
              padding: '12px 14px',
              background: 'transparent',
              border: '1px solid var(--hair-2)',
              borderRadius: 'var(--radius-outer)',
              color: 'inherit',
              cursor: 'pointer',
              font: 'inherit',
              textAlign: 'left',
              flexWrap: 'wrap',
              transition: 'border-color var(--motion-dur-small) var(--motion-ease-standard)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = 'var(--ink-20)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'var(--hair-2)';
            }}
          >
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 13, color: 'var(--ink-90)' }}>
                Sync with Google Calendar · Pro
              </div>
              <div style={{ marginTop: 2, fontSize: 12, color: 'var(--ink-60)' }}>
                Two-way sync with Google Calendar — sessions and focus blocks in one feed.
              </div>
            </div>
            <span style={{ fontSize: 12, color: 'var(--ink-40)' }}>See plans →</span>
          </button>
        )}

        {state.status === 'loading' && (
          <p style={{ color: 'var(--ink-40)', fontSize: 13 }}>Loading…</p>
        )}
        {state.status === 'error' && (
          <p
            role="alert"
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 10,
              fontSize: 13,
              color: 'var(--red)',
            }}
          >
            <span aria-hidden="true" style={{ display: 'inline-block', width: 24, height: 1.5, background: 'var(--red)', marginTop: 8, flex: '0 0 auto' }} />
            <span>Не удалось загрузить: {state.error}</span>
          </p>
        )}
        {state.status === 'ok' && state.items.length === 0 && (
          <div
            style={{
              padding: 32,
              textAlign: 'center',
              border: '1px solid var(--hair-2)',
              borderRadius: 'var(--radius-outer)',
              background: 'transparent',
            }}
          >
            <p style={{ margin: 0, fontSize: 14, color: 'var(--ink-60)' }}>
              Запланированных событий нет.
            </p>
            <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--ink-40)' }}>
              Тутор поставит сессию — она появится здесь и в HomePage-чипе.
            </p>
          </div>
        )}

        {state.status === 'ok' && state.groupItems.length > 0 && (
          <section style={{ marginBottom: 28 }} className="motion-stagger">
            <div style={{ ...captionMonoTiny, marginBottom: 10 }}>GROUP CLASSES · OPEN</div>
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
          <div className="motion-stagger" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            {grouped.map(({ key, items }) => (
              <section key={key}>
                <div style={{ ...captionMonoTiny, marginBottom: 10 }}>{key.toUpperCase()}</div>
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
  // B/W + red rule: live → var(--red) (canonical accent для "now"),
  // soon → ink-ramp 60%, later → ink-ramp 30%. No hue palette.
  const stripe =
    ds === 'live'
      ? 'var(--red)'
      : ds === 'soon'
        ? 'rgba(255, 255, 255, 0.6)'
        : 'rgba(255, 255, 255, 0.3)';
  const chipColor =
    ds === 'live' ? 'var(--red)' : ds === 'soon' ? 'var(--ink)' : 'var(--ink-60)';

  return (
    <article
      style={{
        padding: '14px 16px 12px',
        background: 'transparent',
        border: '1px solid var(--hair-2)',
        borderLeft: `3px solid ${stripe}`,
        borderRadius: 'var(--radius-outer)',
      }}
    >
      {ds === 'live' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          {/* v2 signature — red signal stripe denotes live session. */}
          <span aria-hidden="true" style={{ display: 'inline-block', width: 24, height: 1.5, background: 'var(--red)' }} />
          <span style={{ ...captionMonoTiny, color: 'var(--red)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span aria-hidden="true" className="red-pulse" style={{ display: 'inline-block', width: 5, height: 5, borderRadius: 999, background: 'var(--red)' }} />
            LIVE NOW
          </span>
        </div>
      )}
      <div className="flex-wrap-row" style={{ alignItems: 'baseline', gap: 12, marginBottom: 6 }}>
        <h2
          style={{
            margin: 0,
            fontSize: 'var(--type-h3-size)',
            lineHeight: 'var(--type-h3-lh)',
            letterSpacing: 'var(--type-h3-ls)',
            fontWeight: 'var(--type-h3-weight)',
            color: 'var(--ink)',
            flex: 1,
            minWidth: 0,
          }}
        >
          {event.title}
        </h2>
        {event.scheduledAt && ds !== 'live' && (
          <span
            style={{
              ...captionMonoTiny,
              color: chipColor,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            {timeUntil(event.scheduledAt)}
          </span>
        )}
      </div>

      {event.bodyMd && (
        <pre
          style={{
            margin: '8px 0 12px',
            whiteSpace: 'pre-wrap',
            fontFamily: 'inherit',
            fontSize: 13,
            lineHeight: 1.55,
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
            margin: '8px 0 12px',
            padding: '10px 12px',
            border: '1px solid var(--hair-2)',
            background: 'transparent',
            borderRadius: 'var(--radius-inner)',
          }}
        >
          <div style={{ ...captionMonoTiny, fontSize: 9, marginBottom: 4, color: 'var(--ink-60)' }}>
            SESSION NOTE
          </div>
          <pre
            style={{
              margin: 0,
              whiteSpace: 'pre-wrap',
              fontFamily: 'inherit',
              fontSize: 13,
              lineHeight: 1.55,
              color: 'var(--ink)',
            }}
          >
            {event.sessionNote}
          </pre>
        </div>
      )}

      <div
        className="flex-wrap-row"
        style={{
          alignItems: 'center',
          gap: 12,
          ...captionMonoTiny,
        }}
      >
        {event.scheduledAt && <span>{timeOfDay(event.scheduledAt)}</span>}
        <span>· {event.durationMin} min</span>
        {event.meetUrl && (
          <a
            href={event.meetUrl}
            target="_blank"
            rel="noreferrer"
            className="focus-ring motion-press"
            style={{
              marginLeft: 'auto',
              padding: '5px 12px',
              border: '1px solid var(--hair-2)',
              borderRadius: 999,
              color: 'var(--ink)',
              textDecoration: 'none',
              fontFamily: monoFont,
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              transition:
                'background-color var(--motion-dur-small) var(--motion-ease-standard), border-color var(--motion-dur-small) var(--motion-ease-standard), transform var(--motion-dur-small) var(--motion-ease-standard)',
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
        background: 'transparent',
        border: '1px solid var(--hair-2)',
        borderLeft: '3px solid rgba(255, 255, 255, 0.7)',
        borderRadius: 'var(--radius-outer)',
      }}
    >
      <div className="flex-wrap-row" style={{ alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{ ...captionMonoTiny, fontSize: 9 }}>
          GROUP{event.capacity > 0 ? ` · cap ${event.capacity}` : ''}
        </span>
        {event.scheduledAt && (
          <span style={{ fontSize: 11, color: 'var(--ink-40)', marginLeft: 'auto', fontFamily: monoFont }}>
            {timeOfDay(event.scheduledAt)} · {timeUntil(event.scheduledAt)}
          </span>
        )}
      </div>
      <div
        style={{
          fontSize: 14,
          fontWeight: 500,
          letterSpacing: '-0.005em',
          color: 'var(--ink)',
          marginBottom: 6,
        }}
      >
        {event.title}
      </div>
      {event.bodyMd && (
        <p
          style={{
            margin: '0 0 10px',
            fontSize: 12,
            color: 'var(--ink-60)',
            whiteSpace: 'pre-wrap',
            lineHeight: 1.55,
          }}
        >
          {event.bodyMd}
        </p>
      )}
      <div className="flex-wrap-row" style={{ alignItems: 'center', gap: 10 }}>
        <button
          type="button"
          onClick={onJoin}
          disabled={busy !== null}
          className="focus-ring motion-press"
          style={{
            ...captionMonoTiny,
            padding: '5px 12px',
            background: 'var(--ink)',
            color: 'var(--bg, #000)',
            border: 0,
            borderRadius: 999,
            cursor: busy ? 'wait' : 'pointer',
            transition:
              'background-color var(--motion-dur-small) var(--motion-ease-standard), opacity var(--motion-dur-small) var(--motion-ease-standard), transform var(--motion-dur-small) var(--motion-ease-standard)',
          }}
        >
          {busy === 'join' ? '…' : 'JOIN'}
        </button>
        <button
          type="button"
          onClick={onLeave}
          disabled={busy !== null}
          className="focus-ring motion-press"
          style={{
            ...captionMonoTiny,
            padding: '5px 12px',
            background: 'transparent',
            color: 'var(--ink-60)',
            border: '1px solid var(--hair-2)',
            borderRadius: 999,
            cursor: busy ? 'wait' : 'pointer',
            transition:
              'background-color var(--motion-dur-small) var(--motion-ease-standard), color var(--motion-dur-small) var(--motion-ease-standard), border-color var(--motion-dur-small) var(--motion-ease-standard), transform var(--motion-dur-small) var(--motion-ease-standard)',
          }}
        >
          {busy === 'leave' ? '…' : 'LEAVE'}
        </button>
        {err && (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'flex-start',
              gap: 8,
              fontSize: 11,
              color: 'var(--red)',
            }}
          >
            <span aria-hidden="true" style={{ display: 'inline-block', width: 16, height: 1.5, background: 'var(--red)', marginTop: 5 }} />
            {err}
          </span>
        )}
      </div>
    </article>
  );
}
