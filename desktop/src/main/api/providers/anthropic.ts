// Anthropic provider — direct-to-API client for BYOK mode.
//
// Anthropic's Messages API has a different shape from OpenAI:
//   - `system` prompt is a top-level field, not a role-tagged message.
//   - Vision uses `{type: "image", source: {type: "base64", media_type, data}}`.
//   - Streaming is SSE with typed `event:` lines (message_start,
//     content_block_delta, message_delta, message_stop).
//
// We translate into the same LocalStreamEvent stream as the OpenAI
// provider so the router and the streaming bridge remain uniform.

import {
  familyOf,
  stripFamily,
  type LocalCompletionRequest,
  type LocalLLMMessage,
  type LocalLLMProvider,
  type LocalStreamEvent,
} from './types';

const ANTHROPIC_BASE = 'https://api.anthropic.com/v1';
const ANTHROPIC_VERSION = '2023-06-01';

export class AnthropicProvider implements LocalLLMProvider {
  readonly family = 'anthropic' as const;
  constructor(private readonly apiKey: string) {}

  async *stream(req: LocalCompletionRequest): AsyncGenerator<LocalStreamEvent, void, void> {
    if (familyOf(req.model) !== 'anthropic') {
      yield { type: 'error', code: 'invalid_input', message: `not an anthropic model: ${req.model}` };
      return;
    }

    const { system, messages } = splitSystem(req.messages);
    const body = JSON.stringify({
      model: stripFamily(req.model),
      messages: toAnthropicMessages(messages),
      system: system || undefined,
      stream: true,
      max_tokens: req.maxTokens ?? 4096, // Anthropic requires max_tokens
      temperature: req.temperature,
    });

    let resp: Response;
    try {
      resp = await fetch(`${ANTHROPIC_BASE}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
          // Allow use from non-http-origin contexts (Electron main has no
          // Origin; the header is still good hygiene).
          'anthropic-dangerous-direct-browser-access': 'true',
          Accept: 'text/event-stream',
        },
        body,
        signal: req.signal,
      });
    } catch (err) {
      yield { type: 'error', code: 'transport', message: (err as Error).message };
      return;
    }

    if (!resp.ok) {
      yield* yieldHttpError(resp);
      return;
    }
    if (!resp.body) {
      yield { type: 'error', code: 'transport', message: 'empty response body' };
      return;
    }
    yield* parseAnthropicSSE(resp.body, req.signal);
  }

  async test(): Promise<string> {
    // Anthropic doesn't have a cheap "list models" endpoint. The canonical
    // health check is a tiny Messages call with a 1-token cap.
    const resp = await fetch(`${ANTHROPIC_BASE}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }],
      }),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`${resp.status} ${truncate(text, 120)}`);
    }
    return 'ok';
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Wire translation
// ─────────────────────────────────────────────────────────────────────────

/**
 * Split the system prompt out of the conversation list. We assume the
 * caller built the message array as [system, user, assistant, user, ...]
 * (as the app/analyze.go buildLLMMessages does) — Anthropic wants the
 * system string at the top level.
 */
function splitSystem(msgs: LocalLLMMessage[]): { system: string; messages: LocalLLMMessage[] } {
  const systemParts: string[] = [];
  const rest: LocalLLMMessage[] = [];
  for (const m of msgs) {
    if (m.role === 'system') systemParts.push(m.content);
    else rest.push(m);
  }
  return { system: systemParts.join('\n\n'), messages: rest };
}

type AnthropicPart =
  | { type: 'text'; text: string }
  | {
      type: 'image';
      source: { type: 'base64'; media_type: string; data: string };
    };

function toAnthropicMessages(msgs: LocalLLMMessage[]) {
  return msgs.map((m) => {
    if (!m.images || m.images.length === 0) {
      return { role: m.role, content: m.content };
    }
    const parts: AnthropicPart[] = [];
    if (m.content) parts.push({ type: 'text', text: m.content });
    for (const img of m.images) {
      parts.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: img.mimeType || 'image/png',
          data: img.dataBase64,
        },
      });
    }
    return { role: m.role, content: parts };
  });
}

// ─────────────────────────────────────────────────────────────────────────
// SSE parser — Anthropic dialect
// ─────────────────────────────────────────────────────────────────────────

async function* parseAnthropicSSE(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): AsyncGenerator<LocalStreamEvent, void, void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let tokensIn = 0;
  let tokensOut = 0;
  let modelEcho = '';
  try {
    while (true) {
      if (signal.aborted) return;
      const { value, done } = await reader.read();
      if (done) {
        yield { type: 'done', tokensIn, tokensOut, model: modelEcho };
        return;
      }
      buffer += decoder.decode(value, { stream: true });
      let nl = buffer.indexOf('\n');
      while (nl !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        nl = buffer.indexOf('\n');
        if (!line || !line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        let ev: {
          type?: string;
          message?: { model?: string; usage?: { input_tokens?: number } };
          delta?: { text?: string; stop_reason?: string };
          usage?: { output_tokens?: number };
        };
        try {
          ev = JSON.parse(payload);
        } catch {
          continue;
        }
        switch (ev.type) {
          case 'message_start': {
            modelEcho = ev.message?.model ?? modelEcho;
            tokensIn = ev.message?.usage?.input_tokens ?? tokensIn;
            break;
          }
          case 'content_block_delta': {
            const text = ev.delta?.text;
            if (text) yield { type: 'delta', text };
            break;
          }
          case 'message_delta': {
            tokensOut = ev.usage?.output_tokens ?? tokensOut;
            break;
          }
          case 'message_stop': {
            yield { type: 'done', tokensIn, tokensOut, model: modelEcho };
            return;
          }
          // ping / content_block_start / content_block_stop — ignore
        }
      }
    }
  } catch (err) {
    if ((err as { name?: string })?.name === 'AbortError') return;
    yield { type: 'error', code: 'transport', message: (err as Error).message };
  } finally {
    try {
      await reader.cancel();
    } catch {
      /* already closed */
    }
  }
}

async function* yieldHttpError(resp: Response): AsyncGenerator<LocalStreamEvent, void, void> {
  const text = await resp.text().catch(() => '');
  if (resp.status === 401 || resp.status === 403) {
    yield { type: 'error', code: 'auth', message: `unauthorized: ${truncate(text, 120)}` };
    return;
  }
  if (resp.status === 429) {
    const retry = parseRetryAfter(resp.headers.get('retry-after'));
    yield { type: 'error', code: 'rate_limited', message: 'rate limited', retryAfterSeconds: retry };
    return;
  }
  if (resp.status === 404) {
    yield { type: 'error', code: 'model_unavailable', message: `404: ${truncate(text, 120)}` };
    return;
  }
  yield { type: 'error', code: 'transport', message: `http ${resp.status}: ${truncate(text, 120)}` };
}

function parseRetryAfter(raw: string | null): number {
  if (!raw) return 0;
  const n = parseInt(raw.trim(), 10);
  return isFinite(n) && n > 0 ? n : 0;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}
