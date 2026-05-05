// Desktop wrapper for POST /api/v1/transcription. The audio crosses the
// IPC boundary as a Uint8Array (zero-copy via transferable buffers);
// main assembles multipart/form-data here and POSTs to the backend
// with the user's bearer from keychain.

import { getValidSession } from '../auth/refresh';
import type { RuntimeConfig } from '../config/bootstrap';

export interface TranscribeInput {
  /** Raw audio bytes. webm/opus from MediaRecorder is the default. */
  audio: Uint8Array;
  mime: string;
  filename: string;
  /** BCP-47 hint ("ru", "en"). Empty string = provider auto-detect. */
  language: string;
  /** Optional bias phrase for domain vocabulary. */
  prompt: string;
}

export interface TranscribeResult {
  text: string;
  language: string;
  duration: number;
}

export interface TranscriptionClient {
  transcribe: (input: TranscribeInput) => Promise<TranscribeResult>;
}

/**
 * Structured error thrown by the REST clients in this directory. Lets
 * callers distinguish "rate-limited, please back off" (429) from a hard
 * failure (4xx/5xx) so they can implement retry/queue logic without
 * regex-parsing error.message.
 */
export class HttpClientError extends Error {
  /** HTTP status code from the response. */
  public readonly status: number;
  /** Parsed Retry-After header (seconds). 0 = absent or unparseable. */
  public readonly retryAfterSeconds: number;
  /** Raw response body (truncated to 200 chars), for log context. */
  public readonly bodySnippet: string;
  constructor(status: number, retryAfterSeconds: number, bodySnippet: string, message: string) {
    super(message);
    this.name = 'HttpClientError';
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
    this.bodySnippet = bodySnippet;
  }
}

/**
 * Parse the Retry-After header. RFC 7231 allows two forms:
 *   - delta-seconds: integer like "120"
 *   - HTTP-date:     "Wed, 21 Oct 2015 07:28:00 GMT"
 * We accept both; bad/missing → 0 (caller falls back to exp backoff).
 */
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

export function createTranscriptionClient(cfg: RuntimeConfig): TranscriptionClient {
  const url = (p: string) => `${cfg.apiBaseURL.replace(/\/+$/, '')}${p}`;

  return {
    transcribe: async (input) => {
      const s = await getValidSession({ apiBaseURL: cfg.apiBaseURL });
      const headers: Record<string, string> = {};
      if (s) headers.Authorization = `Bearer ${s.accessToken}`;

      // Node 20 has global FormData + Blob. The Uint8Array's underlying
      // ArrayBuffer may be a SharedArrayBuffer (TS widens it since 5.7);
      // slice() always returns a plain ArrayBuffer, which matches the
      // Blob constructor's BlobPart signature.
      const form = new FormData();
      const ab = input.audio.buffer.slice(
        input.audio.byteOffset,
        input.audio.byteOffset + input.audio.byteLength,
      ) as ArrayBuffer;
      const blob = new Blob([ab], { type: input.mime || 'audio/webm' });
      form.append('audio', blob, input.filename || 'audio.webm');
      if (input.language) form.append('language', input.language);
      if (input.prompt) form.append('prompt', input.prompt);

      const resp = await fetch(url('/api/v1/transcription'), {
        method: 'POST',
        headers, // fetch sets multipart boundary automatically; don't override Content-Type.
        body: form,
      });
      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        const snippet = text.slice(0, 200);
        const retryAfter = parseRetryAfter(resp.headers.get('retry-after'));
        throw new HttpClientError(
          resp.status,
          retryAfter,
          snippet,
          `POST /transcription: ${resp.status} ${snippet}`,
        );
      }
      const raw = (await resp.json()) as Record<string, unknown>;
      return {
        text: String(raw.text ?? ''),
        language: String(raw.language ?? ''),
        duration: Number(raw.duration ?? 0),
      };
    },
  };
}
