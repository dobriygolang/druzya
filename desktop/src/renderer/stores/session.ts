// Session store — mirrors main's SessionManager state + analysis
// events. Component code uses only this; no direct IPC calls.
//
// Two event channels we subscribe to:
//   sessionChanged → live session reference updates
//   sessionAnalysisReady → final report arrived (server or BYOK)
//
// BYOK path: we also handle sessionRequestLocalTranscript by
// serializing the current conversation store's turns back through
// session:local-transcript-response.

import { create } from 'zustand';

import { eventChannels } from '@shared/ipc';
import type { Session, SessionAnalysis, SessionKind } from '@shared/types';

import { useConversationStore } from './conversation';

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
      // BYOK transcript request from main. Renderer owns the actual
      // conversation content in BYOK mode (those turns never reach the
      // server), so main has to ask us for it.
      window.druz9.on<{ sessionId: string }>(
        eventChannels.sessionRequestLocalTranscript,
        () => {
          window.druz9.sessions.submitLocalTranscript(serializeConversationStore());
        },
      ),
    ];

    return () => unsubs.forEach((u) => u());
  },
}));

/**
 * Render the active conversation store into a Markdown transcript the
 * BYOK analyzer can consume. Keeps it short (last 40 turns to bound
 * LLM token cost).
 */
function serializeConversationStore(): string {
  const { messages } = useConversationStore.getState();
  const trimmed = messages.slice(-40);
  const lines: string[] = [];
  for (const m of trimmed) {
    const role = m.role === 'user' ? 'Пользователь' : 'Ассистент';
    const note = m.hasScreenshot ? ' (со скриншотом)' : '';
    lines.push(`**${role}${note}:**\n${m.content}\n`);
  }
  return lines.join('\n---\n');
}
