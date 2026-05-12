// Desktop wrapper for POST /api/v1/copilot/suggestion — the ephemeral
// auto-trigger LLM call. Same bearer-from-keychain pattern as the
// other REST clients in main/api/.
//
// Retry/queue policy (R7):
//   - On 429 we queue + silently retry with exp backoff (500/1000/
//     2000/4000ms, Retry-After respected). Up to 3 retries per request.
//   - Queue is bounded (MAX_PENDING=5). When full, the oldest queued
//     request is dropped (its promise rejects with a queue-full error
//     that callers can ignore — the 15s cooldown means a fresh
//     suggestion is only seconds away anyway).
//   - Non-429 errors propagate to caller as-is — those are real bugs
//     (auth expired, malformed payload), not transient capacity issues.
//   - The 15s cooldown is enforced by the caller (CoachOverlay), not
//     here — preserving that contract is intentional.

import { getValidSession } from '../auth/refresh';
import type { RuntimeConfig } from '../config/bootstrap';
import { HttpClientError } from './transcription';

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

const MAX_PENDING = 5;
const MAX_RETRIES = 3;
const BACKOFF_MS = [500, 1000, 2000, 4000] as const;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function parseRetryAfter(headerValue: string | null): number {
  if (!headerValue) return 0;
  const asInt = Number(headerValue);
  if (Number.isFinite(asInt) && asInt >= 0) return Math.floor(asInt);
  const asDate = Date.parse(headerValue);
  if (!Number.isNaN(asDate)) {
    const deltaMs = asDate - Date.now();
    return deltaMs > 0 ? Math.ceil(deltaMs / 1000) : 0;
  }
  return 0;
}

export function createSuggestionClient(cfg: RuntimeConfig): SuggestionClient {
  const url = (p: string) => `${cfg.apiBaseURL.replace(/\/+$/, '')}${p}`;

  /**
   * Pending queue. Each entry tracks its in-flight promise so we can
   * drop the oldest when MAX_PENDING is exceeded (the dropped one's
   * promise rejects with a benign error — callers either await or
   * void the result; nothing else changes).
   */
  type Pending = { reject: (err: Error) => void };
  const pending: Pending[] = [];

  const doFetchOnce = async (input: SuggestionInput): Promise<SuggestionResult> => {
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
      const snippet = text.slice(0, 200);
      const retryAfter = parseRetryAfter(resp.headers.get('retry-after'));
      throw new HttpClientError(
        resp.status,
        retryAfter,
        snippet,
        `POST /copilot/suggestion: ${resp.status} ${snippet}`,
      );
    }
    const raw = (await resp.json()) as Record<string, unknown>;
    return {
      text: String(raw.text ?? ''),
      model: String(raw.model ?? ''),
      latencyMs: Number(raw.latency_ms ?? raw.latencyMs ?? 0),
      tokensIn: Number(raw.tokens_in ?? raw.tokensIn ?? 0),
      tokensOut: Number(raw.tokens_out ?? raw.tokensOut ?? 0),
    };
  };

  const requestWithRetry = async (input: SuggestionInput): Promise<SuggestionResult> => {
    let attempt = 0;
    let lastErr: unknown = null;
    while (attempt <= MAX_RETRIES) {
      try {
        return await doFetchOnce(input);
      } catch (err) {
        lastErr = err;
        const isRateLimit = err instanceof HttpClientError && err.status === 429;
        if (!isRateLimit || attempt >= MAX_RETRIES) break;
        const serverRetryMs = err instanceof HttpClientError
          ? Math.min(err.retryAfterSeconds * 1000, 8000)
          : 0;
        const backoffMs = serverRetryMs > 0 ? serverRetryMs : BACKOFF_MS[attempt];
        // eslint-disable-next-line no-console
        console.log(
          `[suggestion] rate-limited, backing off ${backoffMs}ms ` +
          `(attempt ${attempt + 1}/${MAX_RETRIES})`,
        );
        await sleep(backoffMs);
        attempt += 1;
      }
    }
    // Silent terminal: rate-limit exhausted retries → toss a benign
    // error. Coach UI swallows + waits for next 15s cooldown tick.
    if (lastErr instanceof HttpClientError && lastErr.status === 429) {
      throw new Error('suggestion rate-limited; retry exhausted');
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  };

  return {
    request: (input) => {
      // Drop oldest if queue full. Oldest's promise rejects with a
      // generic Error so any awaiting caller gets a Promise.catch hook
      // (UI already swallows network errors — see CoachOverlay).
      while (pending.length >= MAX_PENDING) {
        const dropped = pending.shift();
        dropped?.reject(new Error('suggestion queue full; oldest dropped'));
      }
      let entry: Pending;
      const p = new Promise<SuggestionResult>((resolve, reject) => {
        entry = { reject };
        // Fire-and-forget the actual request; settle the outer promise
        // when retry helper resolves/rejects.
        requestWithRetry(input).then(resolve, reject);
      });
      // entry is assigned synchronously by the Promise executor.
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      pending.push(entry!);
      // Remove from queue on settle (success or final failure) so the
      // pending count tracks actual in-flight work.
      const cleanup = () => {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const idx = pending.indexOf(entry!);
        if (idx !== -1) pending.splice(idx, 1);
      };
      p.then(cleanup, cleanup);
      return p;
    },
  };
}
