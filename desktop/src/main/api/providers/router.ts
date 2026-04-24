// Routes every Analyze/Chat turn to the Druz9 backend via Connect-RPC.
//
// Prior to the BYOK removal this file branched between a local provider
// path (direct OpenAI/Anthropic on user keys in Keychain) and the server
// path. The local branch is gone — every turn now hits the server, which
// dispatches via the llmchain (Groq → Cerebras → OpenRouter) multi-provider
// router. The function is kept as a single entry point so streaming.ts
// does not have to know about Connect — same IPC event shape as before.
import type { AnalyzeInput } from '@shared/ipc';

import type { CopilotClient } from '../client';

// ─────────────────────────────────────────────────────────────────────────
// Public event shape — matches what the backend streams over Connect.
// ─────────────────────────────────────────────────────────────────────────

export type RoutedEvent =
  | {
      type: 'created';
      conversationId: string;
      userMessageId: string;
      assistantMessageId: string;
      model: string;
    }
  | { type: 'delta'; text: string }
  | {
      type: 'done';
      assistantMessageId: string;
      tokensIn: number;
      tokensOut: number;
      latencyMs: number;
      /** Updated quota snapshot from the backend. Always non-null now. */
      quota: null | {
        plan: 'free' | 'seeker' | 'ascendant' | '';
        requestsUsed: number;
        requestsCap: number;
        resetsAt: string;
        modelsAllowed: string[];
      };
    }
  | {
      type: 'error';
      code: string;
      message: string;
      retryAfterSeconds: number;
    };

export interface RouterDeps {
  client: CopilotClient;
  /** Default model from DesktopConfig — used when input.model is empty. */
  defaultModel: () => string;
}

/**
 * The main entrypoint. Returns an async generator of RoutedEvents; the
 * caller is responsible for piping them onto IPC and for cancelling via
 * the AbortSignal.
 */
export async function* routeTurn(
  deps: RouterDeps,
  input: AnalyzeInput,
  kind: 'analyze' | 'chat',
  signal: AbortSignal,
): AsyncGenerator<RoutedEvent, void, void> {
  const chosenModel = input.model || deps.defaultModel();
  yield* routeServer(deps.client, input, kind, chosenModel, signal);
}

// ─────────────────────────────────────────────────────────────────────────
// Server path — Connect-RPC to backend.
// ─────────────────────────────────────────────────────────────────────────

async function* routeServer(
  client: CopilotClient,
  input: AnalyzeInput,
  kind: 'analyze' | 'chat',
  chosenModel: string,
  signal: AbortSignal,
): AsyncGenerator<RoutedEvent, void, void> {
  const attachments = input.attachments.map((a) => ({
    kind: (a.kind === 'screenshot' ? 1 : 2) as 1 | 2,
    data: Uint8Array.from(Buffer.from(a.dataBase64, 'base64')),
    mimeType: a.mimeType,
    width: a.width,
    height: a.height,
  }));
  const req = {
    conversationId: input.conversationId,
    promptText: input.promptText,
    model: chosenModel,
    attachments,
    client: {
      os: process.platform === 'darwin' ? 1 : process.platform === 'win32' ? 2 : 3,
      osVersion: '',
      appVersion: '0.1.0',
      triggerAction: hotkeyActionToEnum(input.triggerAction),
      focusedAppHint: input.focusedAppHint,
    },
  } as const;

  try {
    const iter =
      kind === 'analyze'
        ? (client.analyze(req as Parameters<CopilotClient['analyze']>[0], { signal }) as AsyncIterable<unknown>)
        : (client.chat(req as Parameters<CopilotClient['chat']>[0], { signal }) as AsyncIterable<unknown>);

    for await (const ev of iter) {
      const mapped = mapServerEvent(ev);
      if (mapped) yield mapped;
    }
  } catch (err) {
    if ((err as { name?: string })?.name === 'AbortError') return;
    // Surface the Connect code explicitly — the server's "copilot failure"
    // generic message otherwise leaves us guessing. Full error object is
    // also logged to main-process console so it shows up in dev logs.
    const e = err as { code?: number; rawMessage?: string; message?: string };
    // eslint-disable-next-line no-console
    console.error('[copilot stream] connect error', {
      code: e.code,
      rawMessage: e.rawMessage,
      message: e.message,
      model: chosenModel,
      hasConversationId: !!input.conversationId,
    });
    const prettyCode =
      e.code === 16 ? 'unauthenticated'
      : e.code === 14 ? 'unavailable'
      : e.code === 8 ? 'rate_limited'
      : e.code === 7 ? 'forbidden'
      : e.code === 13 ? 'internal'
      : 'transport';
    yield {
      type: 'error',
      code: prettyCode,
      message: e.rawMessage || e.message || 'stream error',
      retryAfterSeconds: 0,
    };
  }
}

function mapServerEvent(rawEv: unknown): RoutedEvent | null {
  const ev = rawEv as { kind?: { case: string; value: Record<string, unknown> } };
  if (!ev.kind) return null;
  switch (ev.kind.case) {
    case 'created': {
      const v = ev.kind.value;
      return {
        type: 'created',
        conversationId: String(v.conversationId ?? ''),
        userMessageId: String(v.userMessageId ?? ''),
        assistantMessageId: String(v.assistantMessageId ?? ''),
        model: String(v.modelId ?? ''),
      };
    }
    case 'delta':
      return { type: 'delta', text: String(ev.kind.value.text ?? '') };
    case 'done': {
      const v = ev.kind.value;
      const q = (v.updatedQuota ?? {}) as Record<string, unknown>;
      return {
        type: 'done',
        assistantMessageId: String(v.assistantMessageId ?? ''),
        tokensIn: Number(v.tokensIn ?? 0),
        tokensOut: Number(v.tokensOut ?? 0),
        latencyMs: Number(v.latencyMs ?? 0),
        quota: {
          plan: mapPlan(Number(q.plan ?? 0)),
          requestsUsed: Number(q.requestsUsed ?? 0),
          requestsCap: Number(q.requestsCap ?? 0),
          resetsAt: (q.resetsAt as { toDate?: () => Date })?.toDate?.()?.toISOString() ?? '',
          modelsAllowed: (q.modelsAllowed as string[] | undefined) ?? [],
        },
      };
    }
    case 'error': {
      const v = ev.kind.value;
      return {
        type: 'error',
        code: String(v.code ?? 'internal'),
        message: String(v.message ?? ''),
        retryAfterSeconds: Number(v.retryAfterSeconds ?? 0),
      };
    }
  }
  return null;
}

function hotkeyActionToEnum(a: string): number {
  switch (a) {
    case 'screenshot_area': return 1;
    case 'screenshot_full': return 2;
    case 'voice_input': return 3;
    case 'toggle_window': return 4;
    case 'quick_prompt': return 5;
    case 'clear_conversation': return 6;
    default: return 0;
  }
}

function mapPlan(n: number): 'free' | 'seeker' | 'ascendant' | '' {
  switch (n) {
    case 1: return 'free';
    case 2: return 'seeker';
    case 3: return 'ascendant';
    default: return '';
  }
}
