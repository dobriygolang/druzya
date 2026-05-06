// Streaming transcription client. Long-lived WebSocket to
// /ws/transcription/stream that ships raw PCM16 chunks and receives
// JSON deltas back. audio-mac.ts is the sole consumer.
//
// Phase F8b: dropped the legacy batch client (createTranscriptionClient
// + transcribe IPC handler) — streaming is the only path now. The
// HttpClientError type stays here because suggestion.ts re-uses it via
// `import { HttpClientError } from '../api/transcription'` (one shared
// error shape across REST clients with retry-after support).

import { getValidSession } from '../auth/refresh';
import type { RuntimeConfig } from '../config/bootstrap';

/**
 * Structured error thrown by REST clients in this directory. Lets
 * callers distinguish "rate-limited, please back off" (429) from a hard
 * failure (4xx/5xx) so they can implement retry/queue logic without
 * regex-parsing error.message. Currently used by suggestion.ts.
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

// ─────────────────────────────────────────────────────────────────────────
// Streaming WS client.
//
// Server: GET /ws/transcription/stream?token=<JWT>&language=ru&prompt=...
// Wire protocol:
//   Client → BinaryMessage  raw PCM16 16kHz mono LE
//          → TextMessage    {"type":"reset"|"prompt"|"ping", ...}
//   Server → TextMessage    {"type":"final"|"partial"|"error","text":"...","duration":1.2}
// ─────────────────────────────────────────────────────────────────────────

/** Frame the server pushes to the client. Mirrors backend streamCtl. */
export interface TranscriptionStreamMessage {
  type: 'final' | 'partial' | 'error' | 'pong';
  text?: string;
  message?: string;
  language?: string;
  duration?: number;
}

/**
 * Frame the client sends to the server (control plane only — audio
 * goes as binary). Backend recognises:
 *   - `reset`    → flush current window + start a new utterance
 *   - `boundary` → alias of reset (semantic difference, same effect)
 *   - `final`    → flush, treat as final fragment (currently same as reset)
 *   - `prompt`   → update language/prompt hints mid-session
 *   - `ping`     → keep-alive; server replies with `pong`
 */
export interface TranscriptionStreamControl {
  type: 'reset' | 'boundary' | 'final' | 'prompt' | 'ping';
  text?: string;
  language?: string;
}

export interface TranscriptionStreamHandlers {
  /** Server emitted a delta (partial = preliminary, final = window done). */
  onMessage: (msg: TranscriptionStreamMessage) => void;
  /** Connection opened — safe to start sending audio. */
  onOpen: () => void;
  /**
   * Connection closed (intentional or peer-initiated). `code` follows the
   * RFC6455 close codes; clean stop = 1000. Caller decides whether to
   * reconnect — see backoff helper in audio-mac.ts.
   */
  onClose: (code: number, reason: string) => void;
  /** Transport-level error (DNS, TLS, mid-stream drop). */
  onError: (err: Error) => void;
}

export interface TranscriptionStreamConnectOptions {
  /** BCP-47 hint forwarded to Whisper. */
  language?: string;
  /** Bias prompt for domain vocab. */
  prompt?: string;
}

/**
 * Live handle returned to the caller. send() pushes raw PCM bytes; sendCtl
 * sends a JSON control frame; close() shuts down voluntarily. isOpen()
 * is a snapshot of readyState — useful for the audio loop to check before
 * pushing chunks (we DROP chunks while WS is reconnecting rather than
 * buffer them, since stale audio in a live transcript = noise).
 */
export interface TranscriptionStreamHandle {
  send: (pcm: Uint8Array) => void;
  sendCtl: (ctl: TranscriptionStreamControl) => void;
  close: (code?: number, reason?: string) => void;
  isOpen: () => boolean;
}

/**
 * Build a streaming-client factory. Each call to connect() spawns ONE
 * WebSocket; reconnection is the caller's responsibility (lives in
 * audio-mac.ts where state machine + backoff already exist).
 *
 * Returns null from connect() when no valid session is present (caller
 * surfaces a "log in" toast — there is no fallback).
 */
export interface TranscriptionStreamClient {
  connect: (
    handlers: TranscriptionStreamHandlers,
    opts?: TranscriptionStreamConnectOptions,
  ) => Promise<TranscriptionStreamHandle | null>;
}

export function createTranscriptionStreamClient(cfg: RuntimeConfig): TranscriptionStreamClient {
  // Derive ws:// or wss:// from the configured HTTP base. Keeps single
  // source of truth (DRUZ9_API_BASE_URL).
  const wsBase = cfg.apiBaseURL.replace(/^http(s?):\/\//, (_, s) => `ws${s}://`).replace(/\/+$/, '');
  return {
    connect: async (handlers, opts) => {
      const s = await getValidSession({ apiBaseURL: cfg.apiBaseURL });
      if (!s) return null;
      const params = new URLSearchParams({ token: s.accessToken });
      if (opts?.language) params.set('language', opts.language);
      if (opts?.prompt) params.set('prompt', opts.prompt);
      const url = `${wsBase}/ws/transcription/stream?${params.toString()}`;

      // Node 22 (Electron 41 main) ships global WebSocket. We avoid the
      // `ws` npm dep — fewer transitive deps, and the platform impl is
      // honoured by Sentry/electron-updater for proxy detection too.
      const sock = new WebSocket(url);
      sock.binaryType = 'arraybuffer';

      sock.addEventListener('open', () => handlers.onOpen());
      sock.addEventListener('close', (ev) => {
        // CloseEvent.reason may be empty; pass through whatever we have.
        handlers.onClose(ev.code, ev.reason || '');
      });
      sock.addEventListener('error', (ev) => {
        // Browser/Node WebSocket events are intentionally opaque (no
        // message exposed for security reasons); surface a generic
        // Error so callers can branch on transport-level failure.
        const detail = (ev as Event & { message?: string }).message ?? 'websocket error';
        handlers.onError(new Error(detail));
      });
      sock.addEventListener('message', (ev: MessageEvent<unknown>) => {
        // Server only ever sends TextMessages (JSON frames); binary
        // would be a server bug — drop silently.
        if (typeof ev.data !== 'string') return;
        try {
          const parsed = JSON.parse(ev.data) as TranscriptionStreamMessage;
          handlers.onMessage(parsed);
        } catch {
          /* malformed frame from server — ignore */
        }
      });

      return {
        send: (pcm) => {
          if (sock.readyState !== WebSocket.OPEN) return;
          // Slice to a fresh ArrayBuffer — Buffer/Uint8Array views may
          // back onto a SharedArrayBuffer (TS 5.7 widens), and the
          // WebSocket.send signature only accepts ArrayBuffer / Blob /
          // ArrayBufferView with regular ArrayBuffer.
          const ab = pcm.buffer.slice(
            pcm.byteOffset,
            pcm.byteOffset + pcm.byteLength,
          ) as ArrayBuffer;
          sock.send(ab);
        },
        sendCtl: (ctl) => {
          if (sock.readyState !== WebSocket.OPEN) return;
          sock.send(JSON.stringify(ctl));
        },
        close: (code, reason) => {
          try {
            sock.close(code ?? 1000, reason ?? '');
          } catch {
            /* already closed */
          }
        },
        isOpen: () => sock.readyState === WebSocket.OPEN,
      };
    },
  };
}
