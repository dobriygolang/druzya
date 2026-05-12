// Session store — mirrors main's SessionManager state + analysis
// events. Component code uses only this; no direct IPC calls.
//
// Two event channels we subscribe to:
//   sessionChanged → live session reference updates
//   sessionAnalysisReady → final report arrived from the backend

import { create } from 'zustand';

import { eventChannels, type NotesReadyEvent } from '@shared/ipc';
import type { Session, SessionAnalysis, SessionKind } from '@shared/types';

interface State {
  current: Session | null;
  lastAnalysis: SessionAnalysis | null;
  /** Local file path of the saved meeting notes, set when notesReady fires. */
  notesFilePath: string | null;
  loading: boolean;
  /**
   * True from the moment end() is invoked until the analysis event fires
   * (or 30s timeout). Surfaces an "Analyzing…" interim state — without it
   * the UI jumped from active → idle с no acknowledgement that the backend
   * is still chewing on the transcript.
   */
  ending: boolean;
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
  notesFilePath: null,
  loading: false,
  ending: false,
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
      set({ current: s, loading: false, lastAnalysis: null, notesFilePath: null, attachedDocIds: [] });
      // Phase J / X3 — cue_session_started. `kind` is the SessionKind
      // enum value (categorical, low-cardinality) — safe to track.
      void import('../lib/analytics').then(({ analytics, ANALYTICS_EVENTS }) => {
        analytics.track(ANALYTICS_EVENTS.cue_session_started, { kind });
      });
    } catch (err) {
      set({ loading: false, error: (err as Error).message });
    }
  },

  end: async () => {
    // ending=true surfaces an "Analyzing…" interim UI between the user's
    // click and the analysis event. lastAnalysis becomes the gating signal:
    // when its status is 'ready' / 'failed' we drop ending. A 30s timeout
    // guards against backend swallowing the event (degraded path).
    set({ loading: true, ending: true, error: null });
    try {
      const s = await window.druz9.sessions.end();
      set({ current: null, loading: false, attachedDocIds: [] });
      // Phase J / X3 — cue_session_completed. Backend later emits
      // sessionAnalysisReady; we fire on `end()` so we attribute the
      // user's explicit stop, not the post-hoc analyzer finish.
      void import('../lib/analytics').then(({ analytics, ANALYTICS_EVENTS }) => {
        analytics.track(ANALYTICS_EVENTS.cue_session_completed, {
          had_session: s !== null,
        });
      });
      void s;
    } catch (err) {
      set({ loading: false, ending: false, error: (err as Error).message });
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
        // Analysis event arrived — drop the "Analyzing…" interim flag once
        // we have a terminal status. 'pending' / 'running' keep us in
        // interim; 'ready' / 'failed' / '' (unknown) — release the UI.
        const isTerminal = a.status === 'ready' || a.status === 'failed' || a.status === '';
        set((prev) => ({
          lastAnalysis: a,
          ending: isTerminal ? false : prev.ending,
        }));
      }),
      window.druz9.on<NotesReadyEvent>(eventChannels.notesReady, (ev) => {
        set({ notesFilePath: ev.filePath });
      }),
    ];

    return () => unsubs.forEach((u) => u());
  },
}));
