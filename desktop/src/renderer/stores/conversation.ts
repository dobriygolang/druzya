// Active-conversation store. Holds the message list and streaming state
// for the expanded chat window. Analyze/Chat events from the main process
// arrive via window.druz9.on(...) and mutate this store.

import { create } from 'zustand';

import {
  eventChannels,
  type AnalyzeCreatedEvent,
  type AnalyzeDeltaEvent,
  type AnalyzeDoneEvent,
  type AnalyzeErrorEvent,
} from '@shared/ipc';
import type { Message, Quota } from '@shared/types';

export interface UIMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  hasScreenshot: boolean;
  pending: boolean; // assistant still streaming
  errorCode?: string;
  errorMessage?: string;
}

interface State {
  conversationId: string;
  model: string;
  messages: UIMessage[];
  streaming: boolean;
  streamId: string | null;
  quota: Quota | null;

  /** Push the optimistic user turn and the empty assistant placeholder. */
  beginTurn: (args: { promptText: string; hasScreenshot: boolean; streamId: string }) => void;
  receiveCreated: (ev: AnalyzeCreatedEvent) => void;
  receiveDelta: (ev: AnalyzeDeltaEvent) => void;
  receiveDone: (ev: AnalyzeDoneEvent) => void;
  receiveError: (ev: AnalyzeErrorEvent) => void;
  reset: () => void;
  /** Bulk-load from server (opening an existing conversation). */
  hydrate: (conversationId: string, model: string, messages: Message[]) => void;
  bootstrap: () => () => void;
}

const EPHEMERAL_ASSISTANT_ID = '__pending__';

export const useConversationStore = create<State>((set, get) => ({
  conversationId: '',
  model: '',
  messages: [],
  streaming: false,
  streamId: null,
  quota: null,

  beginTurn: ({ promptText, hasScreenshot, streamId }) => {
    const userId = `local-user-${Date.now()}`;
    set((s) => ({
      streaming: true,
      streamId,
      messages: [
        ...s.messages,
        { id: userId, role: 'user', content: promptText, hasScreenshot, pending: false },
        { id: EPHEMERAL_ASSISTANT_ID, role: 'assistant', content: '', hasScreenshot: false, pending: true },
      ],
    }));
  },

  receiveCreated: (ev) => {
    if (ev.streamId !== get().streamId) return;
    set((s) => ({
      conversationId: ev.conversationId,
      model: ev.model || s.model,
      // Stamp the real assistant message id onto the placeholder.
      messages: s.messages.map((m) =>
        m.id === EPHEMERAL_ASSISTANT_ID ? { ...m, id: ev.assistantMessageId } : m,
      ),
    }));
  },

  receiveDelta: (ev) => {
    if (ev.streamId !== get().streamId) return;
    set((s) => ({
      messages: s.messages.map((m, i) =>
        i === s.messages.length - 1 && m.role === 'assistant'
          ? { ...m, content: m.content + ev.text }
          : m,
      ),
    }));
  },

  receiveDone: (ev) => {
    if (ev.streamId !== get().streamId) return;
    set((s) => ({
      streaming: false,
      streamId: null,
      quota: ev.quota,
      messages: s.messages.map((m, i) =>
        i === s.messages.length - 1 && m.role === 'assistant' ? { ...m, pending: false } : m,
      ),
    }));
  },

  receiveError: (ev) => {
    if (ev.streamId !== get().streamId) return;
    set((s) => ({
      streaming: false,
      streamId: null,
      messages: s.messages.map((m, i) =>
        i === s.messages.length - 1 && m.role === 'assistant'
          ? { ...m, pending: false, errorCode: ev.code, errorMessage: ev.message }
          : m,
      ),
    }));
  },

  reset: () =>
    set({ conversationId: '', model: '', messages: [], streaming: false, streamId: null }),

  hydrate: (conversationId, model, messages) =>
    set({
      conversationId,
      model,
      messages: messages
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => ({
          id: m.id,
          role: m.role as 'user' | 'assistant',
          content: m.content,
          hasScreenshot: m.hasScreenshot,
          pending: false,
        })),
      streaming: false,
      streamId: null,
    }),

  bootstrap: () => {
    const unsubs = [
      window.druz9.on<AnalyzeCreatedEvent>(eventChannels.analyzeCreated, get().receiveCreated),
      window.druz9.on<AnalyzeDeltaEvent>(eventChannels.analyzeDelta, get().receiveDelta),
      window.druz9.on<AnalyzeDoneEvent>(eventChannels.analyzeDone, get().receiveDone),
      window.druz9.on<AnalyzeErrorEvent>(eventChannels.analyzeError, get().receiveError),
    ];
    return () => unsubs.forEach((u) => u());
  },
}));
