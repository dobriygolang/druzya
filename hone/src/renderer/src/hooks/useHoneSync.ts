// useHoneSync — sync replication loop (Phase C-4).
//
// На login: full bootstrap pull → IndexedDB cache. После — polling каждые
// 30s + immediate pull on window focus / online events. Errors silent
// (sync — best-effort, не должен ломать app). При 401 device_revoked
// sync.ts internally trigger'ит session.clear() — see api/sync.ts.
//
// Phase R3 cooldown — sync interval pauses when the app is in the
// background (`document.hidden`). When the user comes back to Hone, the
// visibilitychange handler triggers an immediate pull and resumes the
// 30s cadence. This stops Hone from waking the laptop's NIC every 30s
// while the user is in IDE / browser / Slack, which was a major heat
// contributor on M1 Airs.
import { useEffect } from 'react';

const POLL_INTERVAL_MS = 30_000;

export function useHoneSync(status: string, userId: string | null): void {
  useEffect(() => {
    if (status !== 'signed_in' || !userId) return;
    let stopped = false;
    let timer: number | null = null;

    const runPull = async () => {
      if (stopped) return;
      try {
        const { pullUntilCaughtUp, getStoredCursor, setStoredCursor } = await import('../api/sync');
        const { applyPullResponse } = await import('../api/localCache');
        const resp = await pullUntilCaughtUp(getStoredCursor());
        await applyPullResponse(userId, resp);
        setStoredCursor(resp.cursor);
      } catch {
        /* silent retry on next tick */
      }
    };

    const startTimer = () => {
      if (timer !== null) return;
      timer = window.setInterval(() => void runPull(), POLL_INTERVAL_MS);
    };
    const stopTimer = () => {
      if (timer === null) return;
      window.clearInterval(timer);
      timer = null;
    };

    void runPull(); // initial
    if (typeof document === 'undefined' || !document.hidden) startTimer();

    const onFocus = () => void runPull();
    const onOnline = () => void runPull();
    const onVisibility = () => {
      if (document.hidden) {
        stopTimer();
      } else {
        // Returned to the app — pull immediately (catch up on missed
        // changes), then resume the cadence.
        void runPull();
        startTimer();
      }
    };
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      stopped = true;
      stopTimer();
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [status, userId]);
}
