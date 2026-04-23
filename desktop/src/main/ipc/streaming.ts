// Bridges Connect-RPC server streams into IPC events.
//
// The renderer never sees Connect internals — it calls analyze.start,
// gets a streamId, and subscribes to event:analyze-delta / -done / -error.
// All of those are emitted by this module.

import { randomUUID } from 'node:crypto';

import type { AnalyzeInput, AnalyzeCreatedEvent, AnalyzeDeltaEvent, AnalyzeDoneEvent, AnalyzeErrorEvent } from '@shared/ipc';
import { eventChannels } from '@shared/ipc';

import type { CopilotClient } from '../api/client';
import { broadcast } from '../windows/window-manager';

/** Map of in-flight streams keyed by streamId → AbortController. */
const inflight = new Map<string, AbortController>();

export interface StreamerDeps {
  client: CopilotClient;
}

export function createStreamer(deps: StreamerDeps) {
  return {
    start: (input: AnalyzeInput, kind: 'analyze' | 'chat'): Promise<string> =>
      startStream(deps.client, input, kind),
    cancel: (streamId: string): void => {
      inflight.get(streamId)?.abort();
      inflight.delete(streamId);
    },
  };
}

async function startStream(
  client: CopilotClient,
  input: AnalyzeInput,
  kind: 'analyze' | 'chat',
): Promise<string> {
  const streamId = randomUUID();
  const ctrl = new AbortController();
  inflight.set(streamId, ctrl);

  const attachments = input.attachments.map((a) => ({
    kind: (a.kind === 'screenshot' ? 1 : 2) as 1 | 2, // proto enum numbers
    data: Uint8Array.from(Buffer.from(a.dataBase64, 'base64')),
    mimeType: a.mimeType,
    width: a.width,
    height: a.height,
  }));

  const req = {
    conversationId: input.conversationId,
    promptText: input.promptText,
    model: input.model,
    attachments,
    client: {
      os: process.platform === 'darwin' ? 1 : process.platform === 'win32' ? 2 : 3,
      osVersion: '',
      appVersion: '0.1.0',
      triggerAction: hotkeyActionToEnum(input.triggerAction),
      focusedAppHint: input.focusedAppHint,
    },
  } as const;

  // Fire off the stream asynchronously; we return streamId immediately
  // and the renderer subscribes to IPC events for the rest.
  void pump(client, req, kind, streamId, ctrl);
  return streamId;
}

async function pump(
  client: CopilotClient,
  req: unknown,
  kind: 'analyze' | 'chat',
  streamId: string,
  ctrl: AbortController,
): Promise<void> {
  try {
    const iter =
      kind === 'analyze'
        ? (client.analyze(req as Parameters<CopilotClient['analyze']>[0], { signal: ctrl.signal }) as AsyncIterable<unknown>)
        : (client.chat(req as Parameters<CopilotClient['chat']>[0], { signal: ctrl.signal }) as AsyncIterable<unknown>);

    for await (const event of iter) {
      const ev = event as {
        kind: { case: string; value: Record<string, unknown> };
      };
      switch (ev.kind?.case) {
        case 'created': {
          const v = ev.kind.value;
          broadcast(eventChannels.analyzeCreated, {
            streamId,
            conversationId: String(v.conversationId ?? ''),
            userMessageId: String(v.userMessageId ?? ''),
            assistantMessageId: String(v.assistantMessageId ?? ''),
            model: String(v.modelId ?? ''),
          } satisfies AnalyzeCreatedEvent);
          break;
        }
        case 'delta': {
          broadcast(eventChannels.analyzeDelta, {
            streamId,
            text: String(ev.kind.value.text ?? ''),
          } satisfies AnalyzeDeltaEvent);
          break;
        }
        case 'done': {
          const v = ev.kind.value;
          const quota = (v.updatedQuota ?? {}) as Record<string, unknown>;
          broadcast(eventChannels.analyzeDone, {
            streamId,
            assistantMessageId: String(v.assistantMessageId ?? ''),
            tokensIn: Number(v.tokensIn ?? 0),
            tokensOut: Number(v.tokensOut ?? 0),
            latencyMs: Number(v.latencyMs ?? 0),
            quota: {
              plan: mapPlan(Number(quota.plan ?? 0)),
              requestsUsed: Number(quota.requestsUsed ?? 0),
              requestsCap: Number(quota.requestsCap ?? 0),
              resetsAt: (quota.resetsAt as { toDate?: () => Date })?.toDate?.()?.toISOString() ?? '',
              modelsAllowed: (quota.modelsAllowed as string[] | undefined) ?? [],
            },
          } satisfies AnalyzeDoneEvent);
          break;
        }
        case 'error': {
          const v = ev.kind.value;
          broadcast(eventChannels.analyzeError, {
            streamId,
            code: String(v.code ?? 'internal'),
            message: String(v.message ?? ''),
            retryAfterSeconds: Number(v.retryAfterSeconds ?? 0),
          } satisfies AnalyzeErrorEvent);
          break;
        }
      }
    }
  } catch (err) {
    broadcast(eventChannels.analyzeError, {
      streamId,
      code: 'transport',
      message: (err as Error).message ?? 'stream error',
      retryAfterSeconds: 0,
    } satisfies AnalyzeErrorEvent);
  } finally {
    inflight.delete(streamId);
  }
}

// ─────────────────────────────────────────────────────────────────────────

function hotkeyActionToEnum(a: string): number {
  switch (a) {
    case 'screenshot_area':
      return 1;
    case 'screenshot_full':
      return 2;
    case 'voice_input':
      return 3;
    case 'toggle_window':
      return 4;
    case 'quick_prompt':
      return 5;
    case 'clear_conversation':
      return 6;
    default:
      return 0;
  }
}

function mapPlan(n: number): 'free' | 'seeker' | 'ascendant' | '' {
  switch (n) {
    case 1:
      return 'free';
    case 2:
      return 'seeker';
    case 3:
      return 'ascendant';
    default:
      return '';
  }
}
