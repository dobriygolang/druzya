// Session store — mirrors main's SessionManager state + analysis
// events. Component code uses only this; no direct IPC calls.
//
// Two event channels we subscribe to:
//   sessionChanged → live session reference updates
//   sessionAnalysisReady → final report arrived from the backend

import { create } from 'zustand';

import { eventChannels } from '@shared/ipc';
import type { Session, SessionAnalysis, SessionKind } from '@shared/types';

interface State {
  current: Session | null;
  lastAnalysis: SessionAnalysis | null;
  loading: boolean;
  error: string | null;
  start: (kind: SessionKind) => Promise<void>;
  end: () => Promise<void>;
  refresh: () => Promise<void>;
  bootstrap: () => () => void;
}

export const useSessionStore = create<State>((set, get) => ({
  current: null,
  lastAnalysis: null,
  loading: false,
  error: null,

  refresh: async () => {
    try {
      const s = await window.druz9.sessions.current();
      set({ current: s });
    } catch {
      /* ignore */
    }
  },

  start: async (kind) => {
    set({ loading: true, error: null });
    try {
      const s = await window.druz9.sessions.start(kind);
      set({ current: s, loading: false, lastAnalysis: null });
    } catch (err) {
      set({ loading: false, error: (err as Error).message });
    }
  },

  end: async () => {
    set({ loading: true, error: null });
    try {
      const s = await window.druz9.sessions.end();
      set({ current: null, loading: false });
      // The analysis push will arrive via event:session-analysis-ready.
      // If the backend responded with a session that's already finished,
      // we just clear local state here.
      void s;
    } catch (err) {
      set({ loading: false, error: (err as Error).message });
    }
  },

  bootstrap: () => {
    void get().refresh();

    const unsubs = [
      window.druz9.on<Session | null>(eventChannels.sessionChanged, (s) => {
        set({ current: s });
      }),
      window.druz9.on<SessionAnalysis>(eventChannels.sessionAnalysisReady, (a) => {
        set({ lastAnalysis: a });
      }),
    ];

    return () => unsubs.forEach((u) => u());
  },
}));
