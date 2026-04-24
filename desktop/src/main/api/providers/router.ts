// Routes an Analyze/Chat turn to either the local provider (BYOK) or the
// Druz9 backend. The choice is per-turn, based on (model's provider family)
// AND (Keychain entry presence for that family).
//
// The router emits the same IPC-friendly event shape regardless of path, so
// streaming.ts does not care which upstream answered.

import { randomUUID } from 'node:crypto';

import type { AnalyzeInput } from '@shared/ipc';

import { loadKey, type ByokProvider } from '../../auth/byok-keychain';
import type { CopilotClient } from '../client';
import { AnthropicProvider } from './anthropic';
import { OpenAIProvider } from './openai';
import {
  familyOf,
  type LocalLLMMessage,
  type LocalLLMProvider,
  type LocalStreamEvent,
} from './types';

// ─────────────────────────────────────────────────────────────────────────
// Public event shape — superset of LocalStreamEvent plus the "created"
// frame that the backend sends first. For BYOK turns, the router
// synthesizes a Created frame with client-generated UUIDs.
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
      /**
       * Updated quota snapshot from the backend. BYOK turns don't touch
       * server quota, so we leave this null in that case.
       */
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
  const family = familyOf(chosenModel);

  // BYOK eligibility: the model belongs to a family we can drive locally
  // AND we have a key for that family.
  const byokKey = family ? await loadKey(family as ByokProvider) : null;

  if (byokKey && family) {
    yield* routeLocal({ input, chosenModel, family, apiKey: byokKey, signal });
    return;
  }

  yield* routeServer(deps.client, input, kind, chosenModel, signal);
}

// ─────────────────────────────────────────────────────────────────────────
// Local path — BYOK
// ─────────────────────────────────────────────────────────────────────────

async function* routeLocal(args: {
  input: AnalyzeInput;
  chosenModel: string;
  family: 'openai' | 'anthropic';
  apiKey: string;
  signal: AbortSignal;
}): AsyncGenerator<RoutedEvent, void, void> {
  const { input, chosenModel, family, apiKey, signal } = args;

  // Client-generated ids — server doesn't know about this conversation.
  const conversationId = input.conversationId || randomUUID();
  const userMessageId = randomUUID();
  const assistantMessageId = randomUUID();

  yield {
    type: 'created',
    conversationId,
    userMessageId,
    assistantMessageId,
    model: chosenModel,
  };

  const provider: LocalLLMProvider =
    family === 'openai' ? new OpenAIProvider(apiKey) : new AnthropicProvider(apiKey);

  const messages = buildMessages(input.promptText, input.attachments);
  const start = Date.now();

  for await (const ev of provider.stream({
    model: chosenModel,
    messages,
    signal,
  })) {
    yield mapLocalEvent(ev, { assistantMessageId, start });
    if (ev.type === 'done' || ev.type === 'error') return;
  }
}

function buildMessages(
  promptText: string,
  attachments: AnalyzeInput['attachments'],
): LocalLLMMessage[] {
  // System prompt mirrors the backend's `systemPrompt` in app/analyze.go so
  // BYOK turns get the same assistant persona.
  const system: LocalLLMMessage = {
    role: 'system',
    content:
      'You are Druz9 Copilot — a stealthy, precise assistant for software engineers.\n' +
      "You are being shown a screenshot of the user's screen (code, terminal, a task, or an error).\n" +
      'Answer in the language the user wrote to you (Russian by default).\n' +
      'Be concise. Use Markdown. When quoting code, use fenced blocks with the correct language tag.\n' +
      'When the screenshot shows a programming task, explain the idea first, then show a clean solution.\n' +
      'Never mention that you cannot see the image if an image is provided — analyse it as given.',
  };

  const user: LocalLLMMessage = {
    role: 'user',
    content: promptText,
    images: attachments
      .filter((a) => a.kind === 'screenshot')
      .map((a) => ({ mimeType: a.mimeType, dataBase64: a.dataBase64 })),
  };
  return [system, user];
}

function mapLocalEvent(
  ev: LocalStreamEvent,
  ctx: { assistantMessageId: string; start: number },
): RoutedEvent {
  switch (ev.type) {
    case 'delta':
      return { type: 'delta', text: ev.text };
    case 'done':
      return {
        type: 'done',
        assistantMessageId: ctx.assistantMessageId,
        tokensIn: ev.tokensIn,
        tokensOut: ev.tokensOut,
        latencyMs: Date.now() - ctx.start,
        quota: null,
      };
    case 'error':
      return {
        type: 'error',
        code: ev.code,
        message: ev.message,
        retryAfterSeconds: ev.retryAfterSeconds ?? 0,
      };
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Server path — Connect-RPC to backend (existing behaviour)
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
