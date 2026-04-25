// Events — calendar of upcoming events from all my circles (bible §9
// Phase 6.5.3). Hone не создаёт events (это делается в web circles UI),
// но показывает + позволяет RSVP + быстрый jump в editor / whiteboard
// если у event'а указана соответствующая room.
import { useCallback, useEffect, useState } from 'react';
import { ConnectError, Code } from '@connectrpc/connect';

import {
  listMyEvents,
  joinEvent,
  leaveEvent,
  type CalendarEvent,
} from '../api/events';
import { useSessionStore } from '../stores/session';

interface State {
  status: 'loading' | 'ok' | 'error';
  events: CalendarEvent[];
  error: string | null;
  errorCode: Code | null;
}

const INITIAL: State = { status: 'loading', events: [], error: null, errorCode: null };

interface EventsPageProps {
  onJumpToEditor?: (roomId: string) => void;
  onJumpToBoard?: (roomId: string) => void;
}

export function EventsPage({ onJumpToEditor, onJumpToBoard }: EventsPageProps = {}) {
  const [state, setState] = useState<State>(INITIAL);
  const userId = useSessionStore((s) => s.userId);
  const [busyId, setBusyId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const events = await listMyEvents();
      setState({ status: 'ok', events, error: null, errorCode: null });
    } catch (err: unknown) {
      const ce = ConnectError.from(err);
      setState({
        status: 'error',
        events: [],
        error: ce.rawMessage || ce.message,
        errorCode: ce.code,
      });
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleRSVP = async (ev: CalendarEvent) => {
    setBusyId(ev.id);
    try {
      const joined = ev.participants.some((p) => p.userId === userId);
      if (joined) await leaveEvent(ev.id);
      else await joinEvent(ev.id);
      await reload();
    } catch (err: unknown) {
      const ce = ConnectError.from(err);
      setState((prev) => ({ ...prev, error: ce.rawMessage || ce.message }));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div
      className="fadein"
      style={{
        position: 'absolute',
        inset: 0,
        paddingTop: 96,
        paddingBottom: 120,
        overflowY: 'auto',
      }}
    >
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '0 32px' }}>
        <div
          className="mono"
          style={{ fontSize: 10, letterSpacing: '.24em', color: 'var(--ink-40)' }}
        >
          EVENTS
        </div>
        <h1
          style={{
            margin: '14px 0 8px',
            fontSize: 40,
            fontWeight: 400,
            letterSpacing: '-0.025em',
            lineHeight: 1.05,
          }}
        >
          What's coming up.
        </h1>
        <p style={{ margin: '0 0 32px', fontSize: 14, color: 'var(--ink-60)', lineHeight: 1.6 }}>
          Аггрегированный календарь из всех твоих circles. RSVP — и придут
          напоминания.
        </p>

        {state.status === 'loading' && (
          <p className="mono" style={{ fontSize: 11, color: 'var(--ink-40)' }}>
            LOADING…
          </p>
        )}

        {state.status === 'error' && (
          <p className="mono" style={{ fontSize: 11, color: 'var(--ink-40)' }}>
            {state.errorCode === Code.Unauthenticated
              ? 'SIGN IN TO SEE EVENTS'
              : `ERROR · ${state.error ?? ''}`}
          </p>
        )}

        {state.status === 'ok' && state.events.length === 0 && (
          <p style={{ fontSize: 13, color: 'var(--ink-40)' }}>
            Пока ни одного. Создай event внутри circle на druz9.online.
          </p>
        )}

        {state.status === 'ok' && state.events.length > 0 && (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {state.events.map((ev) => (
              <EventRow
                key={ev.id}
                ev={ev}
                joined={ev.participants.some((p) => p.userId === userId)}
                busy={busyId === ev.id}
                onRSVP={() => void handleRSVP(ev)}
                onJumpToEditor={onJumpToEditor}
                onJumpToBoard={onJumpToBoard}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function EventRow({
  ev,
  joined,
  busy,
  onRSVP,
  onJumpToEditor,
  onJumpToBoard,
}: {
  ev: CalendarEvent;
  joined: boolean;
  busy: boolean;
  onRSVP: () => void;
  onJumpToEditor?: (roomId: string) => void;
  onJumpToBoard?: (roomId: string) => void;
}) {
  const when = ev.startsAt
    ? ev.startsAt.toLocaleString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : 'TBD';

  return (
    <li
      style={{
        padding: '16px 18px',
        marginBottom: 10,
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.06)',
        borderRadius: 10,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <div>
          <div
            className="mono"
            style={{ fontSize: 10, letterSpacing: '.18em', color: 'var(--ink-40)' }}
          >
            {ev.circleName.toUpperCase() || 'CIRCLE'} · {when}
            {ev.recurrence === 'weekly_friday' && ' · WEEKLY'}
          </div>
          <div style={{ marginTop: 4, fontSize: 16, color: 'var(--ink)' }}>{ev.title}</div>
          {ev.description && (
            <div style={{ marginTop: 4, fontSize: 13, color: 'var(--ink-60)', lineHeight: 1.5 }}>
              {ev.description}
            </div>
          )}
          <div
            className="mono"
            style={{
              marginTop: 8,
              fontSize: 10,
              letterSpacing: '.14em',
              color: 'var(--ink-40)',
            }}
          >
            {ev.durationMin} MIN · {ev.participants.length} GOING
          </div>
        </div>
        <button
          onClick={onRSVP}
          disabled={busy}
          className="focus-ring mono"
          style={{
            padding: '6px 14px',
            fontSize: 11,
            letterSpacing: '.14em',
            color: joined ? 'var(--ink)' : '#000',
            background: joined ? 'transparent' : '#fff',
            border: joined ? '1px solid rgba(255,255,255,0.18)' : 'none',
            borderRadius: 999,
            fontWeight: 500,
          }}
        >
          {busy ? '…' : joined ? 'GOING ✓' : 'RSVP'}
        </button>
      </div>

      {(ev.editorRoomId || ev.whiteboardRoomId) && (
        <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {ev.editorRoomId && (
            <button
              onClick={() => onJumpToEditor?.(ev.editorRoomId)}
              className="focus-ring mono"
              style={{
                padding: '5px 12px',
                fontSize: 10,
                letterSpacing: '.14em',
                color: 'var(--ink)',
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: 999,
              }}
            >
              JOIN EDITOR ROOM →
            </button>
          )}
          {ev.whiteboardRoomId && (
            <button
              onClick={() => onJumpToBoard?.(ev.whiteboardRoomId)}
              className="focus-ring mono"
              style={{
                padding: '5px 12px',
                fontSize: 10,
                letterSpacing: '.14em',
                color: 'var(--ink)',
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: 999,
              }}
            >
              JOIN BOARD →
            </button>
          )}
        </div>
      )}
    </li>
  );
}
