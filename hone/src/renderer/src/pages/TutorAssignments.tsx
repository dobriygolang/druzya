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
//
// 2026-05-12: v2 visual language — hairline cards, status stripes use
// ink-ramp + var(--red) only (was red/yellow/blue palette violating b/w
// rule), caption-mono 0.08em canonical.

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

const monoFont = "'JetBrains Mono', ui-monospace, monospace";

const captionMonoTiny: React.CSSProperties = {
  fontFamily: monoFont,
  fontSize: 10,
  fontWeight: 500,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--ink-40)',
};

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
          <div style={{ ...captionMonoTiny, marginBottom: 6 }}>FROM YOUR TUTOR</div>
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
            Assignments
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
            Здесь — то, что прислал тутор. Жми{' '}
            <span style={{ fontFamily: monoFont, fontSize: 13, color: 'var(--ink)' }}>Done</span>{' '}
            когда сделал; он увидит галочку и дельту относительно due-даты.
          </p>
        </header>

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
            <p style={{ margin: 0, fontSize: 14, color: 'var(--ink-60)' }}>Заданий нет.</p>
            <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--ink-40)' }}>
              Если ждёшь чего-то от тутора — спроси на ближайшей сессии.
            </p>
          </div>
        )}

        {state.status === 'ok' && state.items.length > 0 && (
          <ul
            className="motion-stagger"
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
  // B/W + red rule: overdue → var(--red) (canonical accent for "live alert"),
  // due_soon → ink-ramp 60% (urgency без второго hue), open → ink-ramp 30%
  // (calm). Same semantic, no chromatic noise.
  const stripe =
    status === 'overdue'
      ? 'var(--red)'
      : status === 'due_soon'
        ? 'rgba(255, 255, 255, 0.6)'
        : 'rgba(255, 255, 255, 0.3)';
  const dueColor =
    status === 'overdue' ? 'var(--red)' : status === 'due_soon' ? 'var(--ink)' : 'var(--ink-60)';

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
      {status === 'overdue' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          {/* v2 signature — red signal stripe для overdue assignments. */}
          <span aria-hidden="true" style={{ display: 'inline-block', width: 24, height: 1.5, background: 'var(--red)' }} />
          <span style={{ ...captionMonoTiny, color: 'var(--red)' }}>OVERDUE</span>
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
          {assignment.title}
        </h2>
        {assignment.dueAt && (
          <span
            style={{
              ...captionMonoTiny,
              color: dueColor,
              flex: '0 0 auto',
            }}
          >
            {formatDue(assignment.dueAt)}
          </span>
        )}
      </div>

      {assignment.bodyMd && (
        <pre
          style={{
            margin: '10px 0 14px',
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

      <div className="flex-wrap-row" style={{ alignItems: 'center', gap: 12 }}>
        <button
          type="button"
          onClick={onDone}
          disabled={busy}
          className="focus-ring motion-press"
          style={{
            background: 'var(--ink)',
            border: 0,
            color: 'var(--bg, #000)',
            padding: '7px 16px',
            borderRadius: 'var(--radius-inner)',
            fontSize: 13,
            fontWeight: 500,
            cursor: busy ? 'not-allowed' : 'pointer',
            opacity: busy ? 0.6 : 1,
            transition:
              'background-color var(--motion-dur-small) var(--motion-ease-standard), opacity var(--motion-dur-small) var(--motion-ease-standard), transform var(--motion-dur-small) var(--motion-ease-standard)',
          }}
        >
          {busy ? 'Saving…' : '✓ Done'}
        </button>
        {assignment.createdAt && (
          <span
            style={{
              ...captionMonoTiny,
              fontSize: 10,
            }}
          >
            received {assignment.createdAt.toLocaleDateString()}
          </span>
        )}
      </div>
    </article>
  );
}
