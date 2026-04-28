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

import { saveLocalConversation } from '../lib/local-history';
import { usePaywallStore } from './paywall';

export interface UIMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  hasScreenshot: boolean;
  /** data: URL for the attached screenshot, if any. Only populated for
   *  locally-composed turns — server-hydrated history keeps a boolean
   *  hasScreenshot flag since we don't ship the bytes back down. */
  screenshotDataUrl?: string;
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
  /** Context window snapshot из последнего Done event'а. Footer expanded
   *  окна рендерит progress bar (messagesTotal / compactionThreshold) +
   *  tooltip. null до первого Done. */
  contextWindow: {
    messagesInWindow: number;
    messagesTotal: number;
    compactionThreshold: number;
    runningSummaryChars: number;
  } | null;
  /** Epoch ms когда последний раз backend сообщил о triggered компакции.
   *  ExpandedScreen рендерит ghost-pill «Старые сообщения сжаты» если
   *  значение свежее (≤ ~10s от Date.now()). null = ни разу не было. */
  compactionNoticeAt: number | null;

  /** Push the optimistic user turn and the empty assistant placeholder. */
  beginTurn: (args: {
    promptText: string;
    hasScreenshot: boolean;
    screenshotDataUrl?: string;
    streamId: string;
  }) => void;
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

// Stream watchdog: если за это время не пришло ни одного delta/done/error
// событие — backend/connection считается недоступным. Эмитим псевдо-error
// чтобы UI вышел из infinite "думаю…". Раньше юзер мог 10 минут смотреть
// на pending bubble не понимая что произошло (network drop, backend down,
// CDN deadlock — никаких сигналов не было).
const STREAM_WATCHDOG_MS = 60_000;
let streamWatchdog: ReturnType<typeof setTimeout> | null = null;

function armWatchdog(onTimeout: () => void) {
  if (streamWatchdog) clearTimeout(streamWatchdog);
  streamWatchdog = setTimeout(onTimeout, STREAM_WATCHDOG_MS);
}
function disarmWatchdog() {
  if (streamWatchdog) {
    clearTimeout(streamWatchdog);
    streamWatchdog = null;
  }
}

export const useConversationStore = create<State>((set, get) => ({
  conversationId: '',
  model: '',
  messages: [],
  streaming: false,
  streamId: null,
  quota: null,
  contextWindow: null,
  compactionNoticeAt: null,

  beginTurn: ({ promptText, hasScreenshot, screenshotDataUrl, streamId }) => {
    const userId = `local-user-${Date.now()}`;
    set((s) => ({
      streaming: true,
      streamId,
      messages: [
        ...s.messages,
        {
          id: userId,
          role: 'user',
          content: promptText,
          hasScreenshot,
          screenshotDataUrl,
          pending: false,
        },
        { id: EPHEMERAL_ASSISTANT_ID, role: 'assistant', content: '', hasScreenshot: false, pending: true },
      ],
    }));
    armWatchdog(() => {
      // Watchdog тиканул: 60s без событий → считаем connection dead.
      // Эмитим псевдо-error чтобы UI показал понятное сообщение вместо
      // вечного "думаю…".
      const cur = get();
      if (cur.streamId !== streamId) return; // уже сменился turn — игнор
      get().receiveError({
        streamId,
        code: 'transport',
        message: 'Соединение с сервером потеряно. Проверь интернет и попробуй снова.',
        retryAfterSeconds: 0,
      });
    });
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
    // Reset watchdog: backend жив (стримит токены). Каждый delta event
    // = liveness signal; перезаряжаем 60s окно. Если streaming зависнет
    // mid-response (rare, но бывает на flaky cloud), watchdog всё равно
    // сработает и юзер не залипнет.
    const sid = ev.streamId;
    armWatchdog(() => {
      if (get().streamId !== sid) return;
      get().receiveError({
        streamId: sid,
        code: 'transport',
        message: 'Стрим оборвался. Проверь интернет и попробуй снова.',
        retryAfterSeconds: 0,
      });
    });
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
    disarmWatchdog();
    set((s) => {
      const messages = s.messages.map((m, i) =>
        i === s.messages.length - 1 && m.role === 'assistant' ? { ...m, pending: false } : m,
      );
      const memory = saveLocalConversation({
        conversationId: s.conversationId,
        model: s.model,
        messages,
      });
      if (memory) {
        void window.druz9.memory.sync(s.conversationId, memory).catch((err) => {
          console.warn('[memory] sync failed', err);
        });
      }
      // Context window state — surface'ится в expanded footer'е (progress
      // bar + tooltip). compactionTriggered=true → ставим notice timestamp
      // чтобы UI показал ghost-pill «диалог сжат» на ~10 сек.
      const ctx = ev.context;
      const nextContextWindow = ctx
        ? {
            messagesInWindow: ctx.messagesInWindow,
            messagesTotal: ctx.messagesTotal,
            compactionThreshold: ctx.compactionThreshold,
            runningSummaryChars: ctx.runningSummaryChars,
          }
        : s.contextWindow;
      const nextCompactionNoticeAt = ctx?.compactionTriggered
        ? Date.now()
        : s.compactionNoticeAt;
      return {
        streaming: false,
        streamId: null,
        quota: ev.quota,
        messages,
        contextWindow: nextContextWindow,
        compactionNoticeAt: nextCompactionNoticeAt,
      };
    });
  },

  receiveError: (ev) => {
    if (ev.streamId !== get().streamId) return;
    disarmWatchdog();
    set((s) => {
      const messages = s.messages.map((m, i) =>
        i === s.messages.length - 1 && m.role === 'assistant'
          ? { ...m, pending: false, errorCode: ev.code, errorMessage: ev.message }
          : m,
      );
      const memory = saveLocalConversation({
        conversationId: s.conversationId,
        model: s.model,
        messages,
      });
      if (memory) {
        void window.druz9.memory.sync(s.conversationId, memory).catch((err) => {
          console.warn('[memory] sync failed', err);
        });
      }
      return {
        streaming: false,
        streamId: null,
        messages,
      };
    });
    // Auto-pop the paywall on quota exhaustion. Other error codes stay
    // inline in the chat bubble — only this one needs an upgrade path.
    if (ev.code === 'rate_limited') {
      usePaywallStore.getState().show({
        reason: 'Лимит запросов на сегодня исчерпан',
      });
    }
  },

  reset: () =>
    set({
      conversationId: '', model: '', messages: [], streaming: false, streamId: null,
      contextWindow: null, compactionNoticeAt: null,
    }),

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
      // contextWindow / compactionNoticeAt не сбрасываем в hydrate —
      // они актуальны только после реального Done event'а на этой же
      // conversation. Старая hydrated history — без metadata.
      contextWindow: null,
      compactionNoticeAt: null,
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
