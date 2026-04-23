// Shared shape for local (BYOK) LLM providers. Mirrors the backend
// domain.LLMProvider in spirit — streaming channel of typed events —
// but lives entirely in the Electron main process.
//
// Each provider implementation translates the model's wire format
// (OpenAI chat-completions vs Anthropic messages) into the common
// StreamEvent stream. The router picks a provider by model id; the
// rest of the app (streaming bridge, renderer) never knows which one.

export interface LocalLLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  /** Attachments are only meaningful on the terminal user turn. */
  images?: Array<{ mimeType: string; dataBase64: string }>;
}

export interface LocalCompletionRequest {
  model: string; // provider-qualified, e.g. "openai/gpt-4o" or "anthropic/claude-sonnet-4"
  messages: LocalLLMMessage[];
  temperature?: number;
  maxTokens?: number;
  /** Abort signal for cancellation (wired to analyze.cancel IPC). */
  signal: AbortSignal;
}

export type LocalStreamEvent =
  | { type: 'delta'; text: string }
  | {
      type: 'done';
      tokensIn: number;
      tokensOut: number;
      model: string;
    }
  | {
      type: 'error';
      code: 'rate_limited' | 'invalid_input' | 'model_unavailable' | 'transport' | 'auth';
      message: string;
      retryAfterSeconds?: number;
    };

export interface LocalLLMProvider {
  /**
   * Family this provider serves. Used by the router to pick between
   * OpenAI and Anthropic implementations by model-id prefix.
   */
  readonly family: 'openai' | 'anthropic';

  /**
   * Returns an async iterator over stream events. The provider is
   * responsible for translating wire formats and for aborting when
   * the request's signal fires.
   */
  stream(req: LocalCompletionRequest): AsyncGenerator<LocalStreamEvent, void, void>;

  /**
   * Cheap connectivity + auth probe used by the "test key" button.
   * Returns a short human-readable string on success (e.g. "ok, 42
   * models visible") or throws on failure. Never logs the key.
   */
  test(): Promise<string>;
}

/** Strip the provider prefix from a model id: "openai/gpt-4o" → "gpt-4o". */
export function stripFamily(modelId: string): string {
  const slash = modelId.indexOf('/');
  return slash === -1 ? modelId : modelId.slice(slash + 1);
}

/** Infer family from a model id. Returns null for unknown prefixes. */
export function familyOf(modelId: string): 'openai' | 'anthropic' | null {
  if (modelId.startsWith('openai/')) return 'openai';
  if (modelId.startsWith('anthropic/')) return 'anthropic';
  return null;
}
