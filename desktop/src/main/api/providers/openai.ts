// OpenAI provider — direct-to-API client for BYOK mode.
//
// Uses the v1 chat-completions endpoint with stream=true. Vision is
// encoded via the content-parts array (same shape OpenRouter speaks on
// the backend, so the prompt construction stays unified).
//
// Requests originate from this Node-side module; the user's key never
// leaves the main process.

import {
  familyOf,
  stripFamily,
  type LocalCompletionRequest,
  type LocalLLMMessage,
  type LocalLLMProvider,
  type LocalStreamEvent,
} from './types';

const OPENAI_BASE = 'https://api.openai.com/v1';

export class OpenAIProvider implements LocalLLMProvider {
  readonly family = 'openai' as const;
  constructor(private readonly apiKey: string) {}

  async *stream(req: LocalCompletionRequest): AsyncGenerator<LocalStreamEvent, void, void> {
    if (familyOf(req.model) !== 'openai') {
      yield { type: 'error', code: 'invalid_input', message: `not an openai model: ${req.model}` };
      return;
    }
    const body = JSON.stringify({
      model: stripFamily(req.model),
      messages: toOpenAIMessages(req.messages),
      stream: true,
      stream_options: { include_usage: true },
      temperature: req.temperature,
      max_tokens: req.maxTokens,
    });
    let resp: Response;
    try {
      resp = await fetch(`${OPENAI_BASE}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
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
    yield* parseSSE(resp.body, req.signal);
  }

  async test(): Promise<string> {
    const resp = await fetch(`${OPENAI_BASE}/models`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`${resp.status} ${truncate(text, 120)}`);
    }
    const json = (await resp.json()) as { data?: unknown[] };
    return `ok, ${json.data?.length ?? '?'} models`;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Wire translation
// ─────────────────────────────────────────────────────────────────────────

type OpenAIPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

function toOpenAIMessages(msgs: LocalLLMMessage[]) {
  return msgs.map((m) => {
    if (!m.images || m.images.length === 0) {
      return { role: m.role, content: m.content };
    }
    const parts: OpenAIPart[] = [];
    if (m.content) parts.push({ type: 'text', text: m.content });
    for (const img of m.images) {
      parts.push({
        type: 'image_url',
        image_url: { url: `data:${img.mimeType || 'image/png'};base64,${img.dataBase64}` },
      });
    }
    return { role: m.role, content: parts };
  });
}

// ─────────────────────────────────────────────────────────────────────────
// SSE parser — one implementation shared with Anthropic via arguments
// would be nice; the two formats differ enough that a dedicated parser
// per provider is simpler to read.
// ─────────────────────────────────────────────────────────────────────────

async function* parseSSE(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): AsyncGenerator<LocalStreamEvent, void, void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let modelEcho = '';
  try {
    while (true) {
      if (signal.aborted) return;
      const { value, done } = await reader.read();
      if (done) {
        // Fall-through done without a usage frame: emit zero-usage done.
        yield { type: 'done', tokensIn: 0, tokensOut: 0, model: modelEcho };
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
        if (payload === '[DONE]') {
          yield { type: 'done', tokensIn: 0, tokensOut: 0, model: modelEcho };
          return;
        }
        let chunk: {
          model?: string;
          choices?: Array<{ delta?: { content?: string } }>;
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        };
        try {
          chunk = JSON.parse(payload);
        } catch {
          continue;
        }
        if (chunk.model) modelEcho = chunk.model;
        for (const c of chunk.choices ?? []) {
          const delta = c.delta?.content ?? '';
          if (delta) yield { type: 'delta', text: delta };
        }
        if (chunk.usage) {
          yield {
            type: 'done',
            tokensIn: chunk.usage.prompt_tokens ?? 0,
            tokensOut: chunk.usage.completion_tokens ?? 0,
            model: modelEcho,
          };
          return;
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
