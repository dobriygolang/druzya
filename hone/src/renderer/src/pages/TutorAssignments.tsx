// TutorAssignments — Wave 5.1d (student-side mirror of Wave 5.1).
//
// Surfaces pending tutor-pushed assignments inside Hone, separate from
// the AI-generated Today plan. The two streams stay distinct on purpose:
// AI plan items respond to skill-atlas weakness, tutor assignments are
// authored decisions — collapsing them into one list would erase the
// «my tutor said to do this» signal.
//
// Layout: vertical column. Each assignment is a card with title, due
// chip, body markdown (rendered as preserved-whitespace), and a Done
// button that flips completed_at. After complete the row disappears
// from the pending feed (server-side filter).

import { useCallback, useEffect, useState } from 'react';

import {
  completeAssignment,
  listPendingAssignments,
  type TutorAssignment,
} from '../api/tutor';

interface State {
  status: 'loading' | 'ok' | 'error';
  items: TutorAssignment[];
  error: string | null;
}

const INITIAL: State = { status: 'loading', items: [], error: null };

type RowStatus = 'open' | 'overdue' | 'due_soon';

function rowStatus(a: TutorAssignment): RowStatus {
  if (!a.dueAt) return 'open';
  const ms = a.dueAt.getTime() - Date.now();
  if (ms < 0) return 'overdue';
  if (ms < 24 * 60 * 60 * 1000) return 'due_soon';
  return 'open';
}

function formatDue(d: Date | null): string {
  if (!d) return '';
  const ms = d.getTime() - Date.now();
  if (ms < 0) {
    const overdue = Math.floor(-ms / (60 * 60 * 1000));
    if (overdue < 24) return `${overdue} h overdue`;
    return `${Math.floor(overdue / 24)} d overdue`;
  }
  const h = Math.floor(ms / (60 * 60 * 1000));
  if (h < 24) return `due in ${h}h`;
  return `due ${d.toLocaleDateString()}`;
}

export function TutorAssignmentsPage() {
  const [state, setState] = useState<State>(INITIAL);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState((prev) => ({ ...prev, status: 'loading' }));
    try {
      const items = await listPendingAssignments();
      setState({ status: 'ok', items, error: null });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'unknown';
      setState({ status: 'error', items: [], error: msg });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onDone = useCallback(
    async (id: string) => {
      setBusyId(id);
      try {
        await completeAssignment(id);
        // Optimistic — drop the row locally; server already excluded it
        // from the pending list, so the next load() would hide it anyway.
        setState((prev) => ({ ...prev, items: prev.items.filter((a) => a.id !== id) }));
      } catch {
        // Server-side `FailedPrecondition` (already completed) is benign —
        // refresh the list to sync. Other errors: surface a toast-style alert.
        await load();
      } finally {
        setBusyId(null);
      }
    },
    [load],
  );

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
            FROM YOUR TUTOR
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
            Assignments
          </h1>
          <p style={{ margin: '12px 0 0', fontSize: 13, color: 'var(--ink-60)', maxWidth: 520 }}>
            Здесь — то, что прислал тутор. Жми <span className="mono">Done</span> когда сделал;
            он увидит галочку и дельту относительно due-даты.
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
              Заданий нет.
            </p>
            <p
              style={{
                margin: '8px 0 0',
                fontSize: 12,
                color: 'var(--ink-40)',
              }}
            >
              Если ждёшь чего-то от тутора — спроси на ближайшей сессии.
            </p>
          </div>
        )}

        {state.status === 'ok' && state.items.length > 0 && (
          <ul
            style={{
              listStyle: 'none',
              padding: 0,
              margin: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            {state.items.map((a) => (
              <li key={a.id}>
                <AssignmentCard
                  assignment={a}
                  busy={busyId === a.id}
                  onDone={() => void onDone(a.id)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function AssignmentCard({
  assignment,
  busy,
  onDone,
}: {
  assignment: TutorAssignment;
  busy: boolean;
  onDone: () => void;
}) {
  const status = rowStatus(assignment);
  const stripe =
    status === 'overdue'
      ? 'rgb(248, 113, 113)'
      : status === 'due_soon'
        ? 'rgb(251, 191, 36)'
        : 'rgb(96, 165, 250)';

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
          {assignment.title}
        </h2>
        {assignment.dueAt && (
          <span
            className="mono"
            style={{
              fontSize: 10,
              letterSpacing: '0.16em',
              color: stripe,
              textTransform: 'uppercase',
            }}
          >
            {formatDue(assignment.dueAt)}
          </span>
        )}
      </div>

      {assignment.bodyMd && (
        <pre
          style={{
            margin: '8px 0 12px',
            whiteSpace: 'pre-wrap',
            fontFamily: 'inherit',
            fontSize: 14,
            lineHeight: 1.6,
            color: 'var(--ink-60)',
          }}
        >
          {assignment.bodyMd}
        </pre>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button
          type="button"
          onClick={onDone}
          disabled={busy}
          style={{
            background: 'rgba(255,255,255,0.1)',
            border: '1px solid rgba(255,255,255,0.16)',
            color: 'var(--ink)',
            padding: '6px 14px',
            borderRadius: 8,
            fontSize: 13,
            cursor: busy ? 'not-allowed' : 'pointer',
            opacity: busy ? 0.6 : 1,
          }}
        >
          {busy ? 'Saving…' : '✓ Done'}
        </button>
        {assignment.createdAt && (
          <span
            className="mono"
            style={{
              fontSize: 10,
              letterSpacing: '0.12em',
              color: 'var(--ink-40)',
            }}
          >
            received {assignment.createdAt.toLocaleDateString()}
          </span>
        )}
      </div>
    </article>
  );
}
