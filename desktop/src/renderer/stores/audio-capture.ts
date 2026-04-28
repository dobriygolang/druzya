// Audio-capture store — mirrors the main-process AudioCapture state
// machines (одна на каждый source) и буферит transcript deltas для
// renderer'а.
//
// Архитектура: два независимых source'а — 'system' (ScreenCaptureKit,
// кнопка «Слушать», ловит звук Google Meet/Zoom/YouTube) и 'mic'
// (AVAudioEngine, кнопка «Микрофон», ровно голос юзера). Оба могут
// работать параллельно. Store хранит slice на каждый source.
//
// Event sources (from main, via window.druz9.on):
//   audio-capture-state-changed → { source, state }
//   audio-capture-transcript    → { source, text, windowSec, isFinal }
//   audio-capture-error         → { source, message }

import { create } from 'zustand';

import {
  eventChannels,
  type AudioCaptureSource,
  type AudioCaptureState,
  type AudioCaptureStateEvent,
  type AudioCaptureTranscriptEvent,
  type AudioCaptureErrorEvent,
} from '@shared/ipc';

export interface TranscriptChunk {
  /** Откуда чанк: системный звук (собеседник) или микрофон (юзер). */
  source: AudioCaptureSource;
  text: string;
  /** ms epoch when committed. Используется для chronological merge'а
   *  двух source-streams в одну ленту. */
  at: number;
}

interface SourceSlice {
  state: AudioCaptureState;
  /** Финальные сегменты этого source. */
  chunks: TranscriptChunk[];
  /** Текущий in-progress utterance этого source. */
  partialText: string;
  /** Монотонный seq, инкрементируется на каждый новый final chunk.
   *  Listener'ы (auto-send timer) watch'ат значение чтобы детектить
   *  commit без deep-diff'а массива. */
  finalSeq: number;
  /** Epoch ms когда start() флипнулся в running; null пока idle. */
  startedAt: number | null;
  error: string | null;
}

const emptySlice = (): SourceSlice => ({
  state: 'idle',
  chunks: [],
  partialText: '',
  finalSeq: 0,
  startedAt: null,
  error: null,
});

interface State {
  /** Доступен ли native binary вообще (resolveBinaryPath !== null). */
  available: boolean;
  system: SourceSlice;
  mic: SourceSlice;

  bootstrap: () => () => void;
  start: (source: AudioCaptureSource) => Promise<void>;
  stop: (source: AudioCaptureSource) => Promise<void>;
  /** Очистить chunks + partial для одного source (например после auto-send). */
  clear: (source?: AudioCaptureSource) => void;
  /** Combined chronological text для отправки в LLM. Mic-фразы помечаются
   *  «Я:», system-фразы — «Они:» чтобы LLM понимала кто что сказал.
   *  Если активен только один source — префиксы не добавляем (короче). */
  fullText: () => string;
  /** Эквивалент fullText но для UI preview — те же merge правила. */
  liveText: () => string;
  /** Хоть один source сейчас в active state (running или starting). */
  anyRecording: () => boolean;
}

const sliceKey = (source: AudioCaptureSource): 'system' | 'mic' => source;

const labelFor = (source: AudioCaptureSource): string =>
  source === 'mic' ? 'Я' : 'Они';

const composeMerged = (system: SourceSlice, mic: SourceSlice, includePartials: boolean): string => {
  // Если активен один — префиксы лишние.
  const systemActive = system.chunks.length > 0 || (includePartials && system.partialText);
  const micActive = mic.chunks.length > 0 || (includePartials && mic.partialText);
  const both = systemActive && micActive;

  type Item = { source: AudioCaptureSource; text: string; at: number };
  const items: Item[] = [];
  for (const c of system.chunks) items.push({ source: 'system', text: c.text, at: c.at });
  for (const c of mic.chunks) items.push({ source: 'mic', text: c.text, at: c.at });
  items.sort((a, b) => a.at - b.at);

  // Partials append'ятся в конец «как сейчас идущая фраза» — у них нет
  // committed timestamp'а. Если сразу два partial'а — ставим в порядке
  // system→mic (стабильно).
  if (includePartials) {
    const now = Date.now();
    if (system.partialText) items.push({ source: 'system', text: system.partialText, at: now });
    if (mic.partialText) items.push({ source: 'mic', text: mic.partialText, at: now + 1 });
  }

  if (items.length === 0) return '';
  if (!both) {
    // Один source — без меток.
    return items.map((i) => i.text).join(' ');
  }
  return items.map((i) => `${labelFor(i.source)}: ${i.text}`).join('\n');
};

export const useAudioCaptureStore = create<State>((set, get) => ({
  available: false,
  system: emptySlice(),
  mic: emptySlice(),

  bootstrap: () => {
    void window.druz9.audioCapture.isAvailable().then((a) => set({ available: a }));

    const apply = (source: AudioCaptureSource, mut: (s: SourceSlice) => SourceSlice) => {
      set((prev) => ({ ...prev, [sliceKey(source)]: mut(prev[sliceKey(source)]) }));
    };

    const unsubs = [
      window.druz9.on<AudioCaptureStateEvent>(eventChannels.audioCaptureStateChanged, (ev) => {
        if (!ev || (ev.source !== 'system' && ev.source !== 'mic')) return;
        apply(ev.source, (slice) => ({
          ...slice,
          state: ev.state,
          // startedAt стампим только на 'running' transition'е, чтобы
          // таймер UI считал от момента когда audio реально пошёл, а
          // не от click'а (который может висеть в 'starting' секунду
          // пока macOS consult'ит TCC).
          startedAt:
            ev.state === 'running'
              ? slice.startedAt ?? Date.now()
              : ev.state === 'idle'
                ? null
                : slice.startedAt,
          error: ev.state === 'idle' ? null : slice.error,
        }));
      }),
      window.druz9.on<AudioCaptureTranscriptEvent>(eventChannels.audioCaptureTranscript, (ev) => {
        // eslint-disable-next-line no-console
        console.log('[store:audio] transcript event', ev);
        if (!ev || (ev.source !== 'system' && ev.source !== 'mic')) return;
        const text = (ev.text ?? '').trim();
        if (!text) return;
        if (ev.isFinal) {
          apply(ev.source, (slice) => ({
            ...slice,
            chunks: [...slice.chunks, { source: ev.source, text, at: Date.now() }],
            partialText: '',
            finalSeq: slice.finalSeq + 1,
          }));
        } else {
          apply(ev.source, (slice) => ({ ...slice, partialText: text }));
        }
      }),
      window.druz9.on<AudioCaptureErrorEvent>(eventChannels.audioCaptureError, (ev) => {
        if (!ev || (ev.source !== 'system' && ev.source !== 'mic')) return;
        apply(ev.source, (slice) => ({ ...slice, error: ev.message || 'Ошибка записи' }));
      }),
    ];
    return () => unsubs.forEach((u) => u());
  },

  start: async (source) => {
    set((prev) => ({
      ...prev,
      [sliceKey(source)]: { ...emptySlice(), state: prev[sliceKey(source)].state },
    }));
    try {
      await window.druz9.audioCapture.start(source);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Не удалось запустить запись';
      set((prev) => ({
        ...prev,
        [sliceKey(source)]: { ...prev[sliceKey(source)], error: msg },
      }));
    }
  },

  stop: async (source) => {
    try {
      await window.druz9.audioCapture.stop(source);
    } catch {
      /* state transitions via event; nothing to do on reject */
    }
  },

  clear: (source) => {
    if (!source) {
      set({ system: { ...get().system, chunks: [], partialText: '', error: null },
            mic: { ...get().mic, chunks: [], partialText: '', error: null } });
      return;
    }
    set((prev) => ({
      ...prev,
      [sliceKey(source)]: { ...prev[sliceKey(source)], chunks: [], partialText: '', error: null },
    }));
  },

  fullText: () => composeMerged(get().system, get().mic, true),
  liveText: () => composeMerged(get().system, get().mic, true),

  anyRecording: () => {
    const s = get();
    const isOn = (st: AudioCaptureState) => st === 'running' || st === 'starting';
    return isOn(s.system.state) || isOn(s.mic.state);
  },
}));
