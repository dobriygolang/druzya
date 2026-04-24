// Auto-trigger policy for the etap-3 "live coach" flow.
//
// Subscribes to audio-capture transcript deltas; decides when the
// latest utterance represents an end-of-question that the user
// likely wants a crib note for; invokes the `/copilot/suggestion`
// endpoint; broadcasts the suggestion to the renderer.
//
// Why in main (not renderer):
//   - Single-source-of-truth: the toggle + cooldown live across
//     window recreates (expanded window can be closed/reopened
//     without losing coach state).
//   - We already own the audio-capture events in main; keeping the
//     decision loop next door avoids two IPC hops (audio→renderer→
//     main→backend becomes audio→main→backend).
//
// Design knobs (below) are empirical. The cooldown is the biggest
// knob: too short → suggestion storm on a chatty interlocutor; too
// long → user waits mid-answer for the second suggestion.

import type { SuggestionClient, SuggestionResult } from '../api/suggestion';

/** 15s cooldown between triggers. Matches a natural "think, answer,
 *  breathe" rhythm for the user. Also caps worst-case cost at 4
 *  calls/min even under pathological transcript floods. */
const COOLDOWN_MS = 15_000;
/** Minimum words since the last trigger for the next to fire. Without
 *  this, a quick "Yes?" after a pause would re-trigger within cooldown
 *  of the previous longer question. */
const MIN_WORDS_SINCE_LAST_TRIGGER = 5;
/** Rolling context window for the `context` field. Big enough to
 *  disambiguate ("what was the complexity?" — without context the LLM
 *  guesses algorithm complexity instead of project complexity). */
const CONTEXT_WINDOW_MS = 60_000;

export type CoachEventKind = 'suggestion' | 'status' | 'error';

export interface CoachSuggestionEvent {
  kind: 'suggestion';
  id: string;
  question: string;
  text: string;
  latencyMs: number;
}
export interface CoachStatusEvent {
  kind: 'status';
  enabled: boolean;
  thinking: boolean;
}
export interface CoachErrorEvent {
  kind: 'error';
  message: string;
}
export type CoachEvent = CoachSuggestionEvent | CoachStatusEvent | CoachErrorEvent;

export interface TriggerPolicy {
  /** Fed by the audio-capture transcript hook. Every successful
   *  transcribed chunk calls this. */
  onTranscript: (text: string) => void;
  /** User toggles auto-suggest on/off via UI. When off, onTranscript
   *  still rolls the context window (so a later toggle-on has history)
   *  but no triggers fire. */
  setEnabled: (on: boolean) => void;
  isEnabled: () => boolean;
}

interface TranscriptEntry {
  text: string;
  at: number; // epoch ms
}

export function createTriggerPolicy(
  client: SuggestionClient,
  onEvent: (e: CoachEvent) => void,
  opts: { persona?: string } = {},
): TriggerPolicy {
  let enabled = false;
  let lastTriggerAt = 0;
  let wordsSinceLastTrigger = 0;
  let inflight = false;
  // Rolling window of recent transcript entries. Pruned to the
  // CONTEXT_WINDOW_MS horizon on each push.
  const history: TranscriptEntry[] = [];

  const emitStatus = (thinking: boolean) => {
    onEvent({ kind: 'status', enabled, thinking });
  };

  const buildContext = (): string => {
    const horizon = Date.now() - CONTEXT_WINDOW_MS;
    return history
      .filter((e) => e.at >= horizon)
      .map((e) => e.text)
      .join(' ');
  };

  const shouldFire = (lastText: string): boolean => {
    if (!enabled || inflight) return false;
    if (Date.now() - lastTriggerAt < COOLDOWN_MS) return false;
    if (wordsSinceLastTrigger < MIN_WORDS_SINCE_LAST_TRIGGER) return false;
    // End-of-question heuristic: last chunk ends with "?" after trim.
    // Rus/En both use the same mark, so no locale branching needed.
    // Also fire on "?!" / "??" — common typos in Whisper output.
    const trimmed = lastText.trimEnd();
    return /[?？][!?]?$/.test(trimmed);
  };

  const fire = async (question: string) => {
    inflight = true;
    lastTriggerAt = Date.now();
    wordsSinceLastTrigger = 0;
    emitStatus(true);
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    try {
      const res: SuggestionResult = await client.request({
        question,
        context: buildContext(),
        persona: opts.persona ?? 'meeting',
        language: '',
      });
      onEvent({
        kind: 'suggestion',
        id,
        question,
        text: res.text,
        latencyMs: res.latencyMs,
      });
    } catch (err) {
      onEvent({
        kind: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      inflight = false;
      emitStatus(false);
    }
  };

  return {
    onTranscript: (text) => {
      const now = Date.now();
      history.push({ text, at: now });
      // Prune ahead of time so the array doesn't grow unbounded in
      // long meetings (100 chunks/min × 60min = 6k entries).
      const horizon = now - CONTEXT_WINDOW_MS;
      while (history.length > 0 && history[0].at < horizon) {
        history.shift();
      }
      wordsSinceLastTrigger += countWords(text);

      if (shouldFire(text)) {
        // Await not necessary — errors surface via onEvent.
        void fire(text.trim());
      }
    },
    setEnabled: (on) => {
      enabled = on;
      emitStatus(inflight);
    },
    isEnabled: () => enabled,
  };
}

function countWords(s: string): number {
  let n = 0;
  let inWord = false;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    const isSpace = c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d;
    if (isSpace) {
      inWord = false;
    } else if (!inWord) {
      n += 1;
      inWord = true;
    }
  }
  return n;
}
