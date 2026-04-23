// Bridges LLM streams (from either backend or BYOK providers) into IPC
// events. The renderer never sees Connect internals or provider SDKs —
// it calls analyze.start, gets a streamId, and subscribes to
// event:analyze-delta / -done / -error.
//
// Routing between server and BYOK happens inside router.routeTurn based
// on (model id → family → Keychain key presence).

import { randomUUID } from 'node:crypto';

import { eventChannels, type AnalyzeCreatedEvent, type AnalyzeDeltaEvent, type AnalyzeDoneEvent, type AnalyzeErrorEvent, type AnalyzeInput } from '@shared/ipc';

import type { CopilotClient } from '../api/client';
import { routeTurn, type RoutedEvent } from '../api/providers/router';
import { broadcast } from '../windows/window-manager';

const inflight = new Map<string, AbortController>();

export interface StreamerDeps {
  client: CopilotClient;
  /** Returns the current default model id (from DesktopConfig). */
  defaultModel: () => string;
}

export function createStreamer(deps: StreamerDeps) {
  return {
    start: (input: AnalyzeInput, kind: 'analyze' | 'chat'): Promise<string> =>
      startStream(deps, input, kind),
    cancel: (streamId: string): void => {
      inflight.get(streamId)?.abort();
      inflight.delete(streamId);
    },
  };
}

async function startStream(
  deps: StreamerDeps,
  input: AnalyzeInput,
  kind: 'analyze' | 'chat',
): Promise<string> {
  const streamId = randomUUID();
  const ctrl = new AbortController();
  inflight.set(streamId, ctrl);
  void pump(deps, input, kind, streamId, ctrl);
  return streamId;
}

async function pump(
  deps: StreamerDeps,
  input: AnalyzeInput,
  kind: 'analyze' | 'chat',
  streamId: string,
  ctrl: AbortController,
): Promise<void> {
  try {
    for await (const ev of routeTurn(deps, input, kind, ctrl.signal)) {
      broadcastRouted(ev, streamId);
      if (ev.type === 'done' || ev.type === 'error') return;
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

function broadcastRouted(ev: RoutedEvent, streamId: string): void {
  switch (ev.type) {
    case 'created':
      broadcast(eventChannels.analyzeCreated, {
        streamId,
        conversationId: ev.conversationId,
        userMessageId: ev.userMessageId,
        assistantMessageId: ev.assistantMessageId,
        model: ev.model,
      } satisfies AnalyzeCreatedEvent);
      return;
    case 'delta':
      broadcast(eventChannels.analyzeDelta, {
        streamId,
        text: ev.text,
      } satisfies AnalyzeDeltaEvent);
      return;
    case 'done':
      broadcast(eventChannels.analyzeDone, {
        streamId,
        assistantMessageId: ev.assistantMessageId,
        tokensIn: ev.tokensIn,
        tokensOut: ev.tokensOut,
        latencyMs: ev.latencyMs,
        // Renderer's AnalyzeDoneEvent.quota is non-nullable for MVP; BYOK
        // turns fill it with a zero-cap snapshot so the UI can detect
        // "not our quota" via requestsCap === 0.
        quota: ev.quota ?? {
          plan: '',
          requestsUsed: 0,
          requestsCap: 0,
          resetsAt: '',
          modelsAllowed: [],
        },
      } satisfies AnalyzeDoneEvent);
      return;
    case 'error':
      broadcast(eventChannels.analyzeError, {
        streamId,
        code: ev.code,
        message: ev.message,
        retryAfterSeconds: ev.retryAfterSeconds,
      } satisfies AnalyzeErrorEvent);
      return;
  }
}
