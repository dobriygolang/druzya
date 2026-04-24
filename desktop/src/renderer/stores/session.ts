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
  // attachedDocIds — documents the user has attached to the live
  // session. Refreshed alongside `current`; drives the "N docs" badge
  // in the expanded chat header. An empty array both when there's no
  // live session AND when the live session has nothing attached; the
  // badge reads count + live-ness from `current` to disambiguate.
  attachedDocIds: string[];
  start: (kind: SessionKind) => Promise<void>;
  end: () => Promise<void>;
  refresh: () => Promise<void>;
  refreshAttachedDocs: () => Promise<void>;
  bootstrap: () => () => void;
}

export const useSessionStore = create<State>((set, get) => ({
  current: null,
  lastAnalysis: null,
  loading: false,
  error: null,
  attachedDocIds: [],

  refresh: async () => {
    try {
      const s = await window.druz9.sessions.current();
      set({ current: s });
      // Refresh attachment list alongside so the badge stays honest
      // after a main-process session change (start/end from another
      // window).
      await get().refreshAttachedDocs();
    } catch {
      /* ignore */
    }
  },

  refreshAttachedDocs: async () => {
    const s = get().current;
    if (!s || !s.id) {
      set({ attachedDocIds: [] });
      return;
    }
    try {
      const ids = await window.druz9.documents.listAttachedToSession(s.id);
      set({ attachedDocIds: ids });
    } catch {
      // Silent — the documents service may be disabled (OLLAMA_HOST
      // unset on the server). Badge simply stays hidden.
      set({ attachedDocIds: [] });
    }
  },

  start: async (kind) => {
    set({ loading: true, error: null });
    try {
      const s = await window.druz9.sessions.start(kind);
      set({ current: s, loading: false, lastAnalysis: null, attachedDocIds: [] });
    } catch (err) {
      set({ loading: false, error: (err as Error).message });
    }
  },

  end: async () => {
    set({ loading: true, error: null });
    try {
      const s = await window.druz9.sessions.end();
      set({ current: null, loading: false, attachedDocIds: [] });
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
        void get().refreshAttachedDocs();
      }),
      window.druz9.on<SessionAnalysis>(eventChannels.sessionAnalysisReady, (a) => {
        set({ lastAnalysis: a });
      }),
    ];

    return () => unsubs.forEach((u) => u());
  },
}));
