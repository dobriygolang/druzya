// Desktop wrapper for POST /api/v1/copilot/suggestion — the ephemeral
// auto-trigger LLM call. Same bearer-from-keychain pattern as the
// other REST clients in main/api/.

import { getValidSession } from '../auth/refresh';
import type { RuntimeConfig } from '../config/bootstrap';

export interface SuggestionInput {
  question: string;
  context: string;
  /** "meeting" | "interview" | "" (→ "meeting"). */
  persona: string;
  /** BCP-47 hint or ""-auto. */
  language: string;
}

export interface SuggestionResult {
  text: string;
  model: string;
  latencyMs: number;
  tokensIn: number;
  tokensOut: number;
}

export interface SuggestionClient {
  request: (input: SuggestionInput) => Promise<SuggestionResult>;
}

export function createSuggestionClient(cfg: RuntimeConfig): SuggestionClient {
  const url = (p: string) => `${cfg.apiBaseURL.replace(/\/+$/, '')}${p}`;

  return {
    request: async (input) => {
      const s = await getValidSession({ apiBaseURL: cfg.apiBaseURL });
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (s) headers.Authorization = `Bearer ${s.accessToken}`;

      const resp = await fetch(url('/api/v1/copilot/suggestion'), {
        method: 'POST',
        headers,
        body: JSON.stringify({
          question: input.question,
          context: input.context,
          persona: input.persona,
          language: input.language,
        }),
      });
      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        throw new Error(`POST /copilot/suggestion: ${resp.status} ${text.slice(0, 200)}`);
      }
      const raw = (await resp.json()) as Record<string, unknown>;
      return {
        text: String(raw.text ?? ''),
        model: String(raw.model ?? ''),
        latencyMs: Number(raw.latency_ms ?? raw.latencyMs ?? 0),
        tokensIn: Number(raw.tokens_in ?? raw.tokensIn ?? 0),
        tokensOut: Number(raw.tokens_out ?? raw.tokensOut ?? 0),
      };
    },
  };
}
