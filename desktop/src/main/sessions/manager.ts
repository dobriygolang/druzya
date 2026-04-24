// SessionManager — the main-process owner of a user's live session.
//
// Responsibilities:
//   1. Hold the currently-live session id (or null when no session).
//   2. Forward start/end to the backend via SessionsClient.
//   3. On end, kick off a poll loop on GetSessionAnalysis and push a
//      'event:session-analysis-ready' event to the renderer when
//      status flips to ready or failed.
//
// Not a singleton — one instance per main process, owned by
// registerHandlers. The renderer talks to it exclusively via IPC.

import { eventChannels } from '@shared/ipc';
import type { Session, SessionAnalysis, SessionKind } from '@shared/types';

import type { SessionsClient } from '../api/sessions';
import { broadcast } from '../windows/window-manager';

const POLL_INTERVAL_MS = 3000;
const MAX_POLL_ATTEMPTS = 120; // ~6 minutes — generous for LLM latency

export interface SessionManager {
  start: (kind: SessionKind) => Promise<Session>;
  end: () => Promise<Session | null>;
  current: () => Session | null;
  getAnalysis: (sessionId: string) => Promise<SessionAnalysis>;
  list: (
    cursor: string,
    limit: number,
    kind?: SessionKind,
  ) => Promise<{ sessions: Session[]; nextCursor: string }>;
  dispose: () => void;
}

export interface ManagerDeps {
  client: SessionsClient;
}

export function createSessionManager(deps: ManagerDeps): SessionManager {
  let current: Session | null = null;
  let pollAbort: AbortController | null = null;

  const emitChanged = () => broadcast(eventChannels.sessionChanged, current);

  const pollServerAnalysis = async (sessionId: string): Promise<void> => {
    const ctrl = new AbortController();
    pollAbort?.abort();
    pollAbort = ctrl;

    let attempts = 0;
    while (!ctrl.signal.aborted && attempts++ < MAX_POLL_ATTEMPTS) {
      await sleep(POLL_INTERVAL_MS, ctrl.signal);
      if (ctrl.signal.aborted) return;
      try {
        const analysis = await deps.client.getAnalysis(sessionId);
        if (analysis.status === 'ready' || analysis.status === 'failed') {
          broadcast(eventChannels.sessionAnalysisReady, analysis);
          return;
        }
      } catch {
        // Transient network errors — keep polling until the budget runs out.
      }
    }
  };

  return {
    start: async (kind: SessionKind) => {
      if (current) {
        throw new Error('live_session_exists');
      }
      const s = await deps.client.start(kind);
      current = s;
      emitChanged();
      return s;
    },

    end: async () => {
      if (!current) return null;
      const sessionID = current.id;
      let ended: Session;
      try {
        ended = await deps.client.end(sessionID);
      } catch (err) {
        // If the backend rejects the end (e.g. already-ended race), we
        // still clear our local state so the user isn't stuck.
        current = null;
        emitChanged();
        throw err;
      }
      current = null;
      emitChanged();
      // Kick off backend analysis polling.
      void pollServerAnalysis(sessionID);
      return ended;
    },

    current: () => current,

    getAnalysis: (sessionId: string) => deps.client.getAnalysis(sessionId),

    list: deps.client.list,

    dispose: () => {
      pollAbort?.abort();
      pollAbort = null;
    },
  };
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(t);
      resolve();
    }, { once: true });
  });
}
