// Coach store — mirrors the main-process trigger policy for the
// auto-suggest feature (etap 3). Holds: toggle state, "thinking"
// flag (while /copilot/suggestion is in-flight), and the most-recent
// suggestion text.
//
// Two design choices worth noting:
//   - We store ONE suggestion at a time, not a list. Auto-triggers
//     replace the pill's content rather than stack — UX is "current
//     tip, not feed". The user can dismiss explicitly or let the
//     next trigger overwrite.
//   - `thinking` is surfaced separately from `suggestion` so the UI
//     can show a spinner while the LLM is mid-flight even before a
//     suggestion exists.

import { create } from 'zustand';

import {
  eventChannels,
  type CoachErrorEvent,
  type CoachStatusEvent,
  type CoachSuggestionEvent,
} from '@shared/ipc';

export interface CoachSuggestion {
  id: string;
  question: string;
  text: string;
  latencyMs: number;
  at: number;
}

interface State {
  enabled: boolean;
  thinking: boolean;
  suggestion: CoachSuggestion | null;
  error: string | null;

  bootstrap: () => () => void;
  toggle: () => Promise<void>;
  setEnabled: (on: boolean) => Promise<void>;
  dismiss: () => void;
}

export const useCoachStore = create<State>((set, get) => ({
  enabled: false,
  thinking: false,
  suggestion: null,
  error: null,

  bootstrap: () => {
    // Pull the canonical toggle state from main — survives window
    // re-opens since the trigger policy lives for the app lifetime.
    void window.druz9.coach.getAutoSuggest().then((on) => set({ enabled: on }));

    const unsubs = [
      window.druz9.on<CoachStatusEvent>(eventChannels.coachStatus, (ev) => {
        set({ enabled: ev.enabled, thinking: ev.thinking });
      }),
      window.druz9.on<CoachSuggestionEvent>(eventChannels.coachSuggestion, (ev) => {
        set({
          suggestion: {
            id: ev.id,
            question: ev.question,
            text: ev.text,
            latencyMs: ev.latencyMs,
            at: Date.now(),
          },
          error: null,
        });
      }),
      window.druz9.on<CoachErrorEvent>(eventChannels.coachError, (ev) => {
        set({ error: ev.message || 'Suggestion error' });
      }),
    ];
    return () => unsubs.forEach((u) => u());
  },

  toggle: async () => {
    const next = !get().enabled;
    await get().setEnabled(next);
  },

  setEnabled: async (on) => {
    // Optimistic — status event will confirm or correct.
    set({ enabled: on, error: null });
    try {
      await window.druz9.coach.setAutoSuggest(on);
    } catch {
      // Roll back on IPC failure.
      set({ enabled: !on });
    }
  },

  dismiss: () => set({ suggestion: null, error: null }),
}));
