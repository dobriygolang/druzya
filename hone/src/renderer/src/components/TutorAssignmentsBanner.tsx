// TutorAssignmentsBanner — surfaces the most-urgent pending tutor
// assignment on Hone HomePage. Connects Wave 5.1 (tutor pushes) to
// the student's daily flow without forcing them to navigate to /assignments.
//
// Design constraints:
//  - Hidden during an active focus session (don't distract mid-work).
//  - Hidden when zero pending — silent state is the common case.
//  - Shows ONE most-urgent card (overdue → due-soon → open) + a
//    «+N more» chip if there are siblings.
//  - Polls every 60s. Cheap REST GET; no SSE needed for this surface.

import { useCallback, useEffect, useState } from 'react';

import { completeAssignment, listPendingAssignments, type TutorAssignment } from '../api/tutor';

type Status = 'overdue' | 'due_soon' | 'open';

function rowStatus(a: TutorAssignment): Status {
  if (!a.dueAt) return 'open';
  const ms = a.dueAt.getTime() - Date.now();
  if (ms < 0) return 'overdue';
  if (ms < 24 * 60 * 60 * 1000) return 'due_soon';
  return 'open';
}

// Sort key: overdue first, then due_soon, then open. Within each
// bucket, earliest due_at wins; assignments without due_at sink to the
// end of their bucket. Most-urgent → top.
function urgencyRank(s: Status): number {
  return s === 'overdue' ? 0 : s === 'due_soon' ? 1 : 2;
}

function pickMostUrgent(items: TutorAssignment[]): TutorAssignment | null {
  if (items.length === 0) return null;
  const sorted = [...items].sort((a, b) => {
    const ra = urgencyRank(rowStatus(a));
    const rb = urgencyRank(rowStatus(b));
    if (ra !== rb) return ra - rb;
    const da = a.dueAt?.getTime() ?? Number.POSITIVE_INFINITY;
    const db = b.dueAt?.getTime() ?? Number.POSITIVE_INFINITY;
    return da - db;
  });
  return sorted[0];
}

function formatDue(d: Date | null): string {
  if (!d) return '';
  const ms = d.getTime() - Date.now();
  if (ms < 0) {
    const h = Math.floor(-ms / (60 * 60 * 1000));
    if (h < 24) return `${h}h overdue`;
    return `${Math.floor(h / 24)}d overdue`;
  }
  const h = Math.floor(ms / (60 * 60 * 1000));
  if (h < 24) return `due in ${h}h`;
  return d.toLocaleDateString();
}

interface Props {
  /** Hide entirely during focus session — caller passes the running flag. */
  running: boolean;
  /** Open the full assignments page. App owns navigation. */
  onOpenAll: () => void;
}

export function TutorAssignmentsBanner({ running, onOpenAll }: Props) {
  const [items, setItems] = useState<TutorAssignment[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await listPendingAssignments(10);
      setItems(next);
    } catch {
      // Silent: banner is non-critical UI; if the API is down we just
      // hide rather than show a scary error on Home.
      setItems([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
    // Poll every 60s — covers «tutor pushed something while I was
    // working». Cheap GET against a partial-indexed table.
    // Phase R3 cooldown — paused while the document is hidden (Hone in
    // background). The visibilitychange handler resumes the cadence and
    // immediately refreshes so the user sees up-to-date state on return.
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
    const onVisibility = () => {
      if (document.hidden) {
        stopPolling();
      } else {
        void refresh();
        startPolling();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stopPolling();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [refresh]);

  // Refresh when the window regains focus too — a tutor pushed in the
  // background while user was in another app, returning to Hone shows
  // the new card immediately.
  useEffect(() => {
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refresh]);

  const onDone = useCallback(
    async (id: string) => {
      setBusyId(id);
      try {
        await completeAssignment(id);
        // Optimistic drop — the next refresh would also exclude it.
        setItems((prev) => prev.filter((a) => a.id !== id));
      } catch {
        // Server-side already-completed → benign; refresh syncs.
        await refresh();
      } finally {
        setBusyId(null);
      }
    },
    [refresh],
  );

  if (running) return null;
  const top = pickMostUrgent(items);
  if (!top) return null;

  const status = rowStatus(top);
  const stripe =
    status === 'overdue'
      ? 'rgb(248, 113, 113)'
      : status === 'due_soon'
        ? 'rgb(251, 191, 36)'
        : 'rgb(96, 165, 250)';
  const moreCount = items.length - 1;

  return (
    <div
      className="fadein"
      style={{
        position: 'absolute',
        bottom: 100,
        left: 32,
        width: 380,
        padding: '12px 14px',
        background: 'rgba(8,8,8,0.92)',
        border: '1px solid rgba(255,255,255,0.06)',
        borderLeft: `3px solid ${stripe}`,
        borderRadius: 12,
        backdropFilter: 'blur(14px)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          marginBottom: 6,
        }}
      >
        <span
          className="mono"
          style={{
            fontSize: 9,
            letterSpacing: '0.22em',
            color: 'var(--ink-40)',
          }}
        >
          FROM YOUR TUTOR
        </span>
        {top.dueAt && (
          <span
            className="mono"
            style={{
              fontSize: 9,
              letterSpacing: '0.16em',
              color: stripe,
              textTransform: 'uppercase',
              marginLeft: 'auto',
            }}
          >
            {formatDue(top.dueAt)}
          </span>
        )}
      </div>

      <div
        style={{
          fontSize: 14,
          fontWeight: 500,
          color: 'var(--ink)',
          marginBottom: 8,
          // 2-line truncate via webkit-line-clamp; falls back to overflow
          // hidden on platforms without it.
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}
      >
        {top.title}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          type="button"
          onClick={() => void onDone(top.id)}
          disabled={busyId === top.id}
          className="mono"
          style={{
            padding: '4px 10px',
            fontSize: 10,
            letterSpacing: '0.16em',
            color: 'var(--ink)',
            background: 'rgba(255,255,255,0.08)',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 999,
            cursor: busyId === top.id ? 'not-allowed' : 'pointer',
            opacity: busyId === top.id ? 0.6 : 1,
          }}
        >
          {busyId === top.id ? '…' : '✓ DONE'}
        </button>
        <button
          type="button"
          onClick={onOpenAll}
          className="mono"
          style={{
            padding: '4px 10px',
            fontSize: 10,
            letterSpacing: '0.16em',
            color: 'var(--ink-40)',
            background: 'transparent',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 999,
          }}
        >
          {moreCount > 0 ? `OPEN · +${moreCount} MORE` : 'OPEN'}
        </button>
      </div>
    </div>
  );
}
