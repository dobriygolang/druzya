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
  /**
   * True when backend injected cross-product context (goal/memory/
   * activity/radar) into the LLM call. AutoSuggestPill surfaces a
   * subtle "Personalized from your druz9 activity" hint when set.
   * C3 (Phase J 2026-05-12). This is the unique moat vs Cluely.
   */
  contextUsed: boolean;
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
            contextUsed: ev.contextUsed ?? false,
          },
          error: null,
        });
        // Phase J / X3 — cue_suggestion_received. latencyMs bucketed
        // (fast/med/slow) keeps cardinality low without leaking exact
        // model timings into property keys.
        void import('../lib/analytics').then(({ analytics, ANALYTICS_EVENTS }) => {
          const ms = ev.latencyMs;
          const latency_bucket = ms < 500 ? 'fast' : ms < 1500 ? 'med' : 'slow';
          analytics.track(ANALYTICS_EVENTS.cue_suggestion_received, {
            latency_bucket,
            context_used: ev.contextUsed ?? false,
          });
        });
      }),
      window.druz9.on<CoachErrorEvent>(eventChannels.coachError, (ev) => {
        set({ error: ev.message || 'Suggestion error' });
        // Compact окно coach error не рендерит (только Expanded). Toast —
        // OS-уровневый канал чтобы юзер сидящий в compact знал о degradation.
        //
        // 3 distinct cases:
        //   - rate-limited       → warn (transient, follow next 15s cooldown)
        //   - all providers down → warn (cascade exhausted, дольше retry)
        //   - other              → error (likely auth/payload bug)
        const msg = ev.message ?? '';
        const lowerMsg = msg.toLowerCase();
        const isRateLimit = lowerMsg.includes('rate-limited') || lowerMsg.includes('rate limit');
        // Backend cascade order: groq → cerebras → google → cloudflare → zai
        // → mistral → openrouter → deepseek → ollama. Если все 9 fail —
        // backend ответит 503 / all-providers-exhausted / similar phrasing.
        // Heuristic match защищает от exact-string fragility.
        const isCascadeExhausted =
          lowerMsg.includes('all providers') ||
          lowerMsg.includes('providers exhausted') ||
          lowerMsg.includes('no providers') ||
          lowerMsg.includes('service unavailable');
        let friendly: string;
        let kind: 'warn' | 'error';
        if (isRateLimit) {
          friendly = 'AI rate-limited — следующая попытка через 15s';
          kind = 'warn';
        } else if (isCascadeExhausted) {
          friendly = 'AI providers временно недоступны — попробуй через минуту';
          kind = 'warn';
        } else {
          friendly = 'AI suggestion failed';
          kind = 'error';
        }
        void window.druz9.toast.show(friendly, kind).catch(() => {
          /* swallow — toast не критичен, inline error в Expanded fallback */
        });
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
