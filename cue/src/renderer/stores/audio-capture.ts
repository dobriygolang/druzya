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

import { translate } from '@d9-i18n';

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
  /** Diarization speaker label (C4):
   *   - mic source: 0 (the user, "Я"), set unconditionally
   *   - system source: 1..N, clustered per-utterance backend'ом
   *   - undefined: legacy/partial frame — fall back to source-based label
   */
  speakerId?: number;
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

  /**
   * C4 diarization: per-session human-readable labels на speaker IDs.
   * Key = speakerId (number → string for stable JSON), value = user
   * relabel ("Interviewer", "PM"). speaker 0 = mic = "Я" (фиксировано,
   * не override'итcя через UI). Системные speaker 1..N начинают как
   * "Собеседник N", юзер может переименовать через SpeakerLabel компонент.
   * Persisted в localStorage по session-key (Date.now() при первом start).
   */
  speakerLabels: Record<string, string>;
  /** Session key для localStorage scope'а. Re-инициализируется на
   *  каждый clear()/start cycle. Format: `cue.speakers.<epoch>`. */
  speakerLabelsKey: string;

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
  /** C4 manual relabel. Rename one speaker; "" deletes the override
   *  (reverts to default "Собеседник N"). Не trackable history — это
   *  in-session prefs. Speaker 0 (mic) НЕ renamable — always «Я». */
  renameSpeaker: (speakerId: number, label: string) => void;
  /** Resolve speaker label для UI / LLM submission. Returns custom label
   *  если есть, иначе default ("Я" для 0/mic, "Собеседник N" для system N). */
  labelFor: (speakerId: number | undefined, source: AudioCaptureSource) => string;
}

const sliceKey = (source: AudioCaptureSource): 'system' | 'mic' => source;

/**
 * Default label resolver — used when юзер ещё не переименовал speaker
 * через SpeakerLabel UI. Speaker 0 / mic = «Я» (анкор для AI/user),
 * system без speaker_id (legacy) = «Они», system с speaker_id = «Собеседник N».
 */
const defaultSpeakerLabel = (speakerId: number | undefined, source: AudioCaptureSource): string => {
  if (source === 'mic' || speakerId === 0) return translate('cue.store.audio.speaker_me');
  if (typeof speakerId === 'number' && speakerId > 0)
    return translate('cue.store.audio.speaker_n', { n: speakerId });
  return translate('cue.store.audio.speaker_them');
};

const resolveSpeakerLabel = (
  speakerId: number | undefined,
  source: AudioCaptureSource,
  overrides: Record<string, string>,
): string => {
  // Mic / speaker 0 never override'итcя — sacred anchor for the user.
  if (source === 'mic' || speakerId === 0) return translate('cue.store.audio.speaker_me');
  if (typeof speakerId === 'number') {
    const key = String(speakerId);
    if (overrides[key]) return overrides[key];
  }
  return defaultSpeakerLabel(speakerId, source);
};

const composeMerged = (
  system: SourceSlice,
  mic: SourceSlice,
  includePartials: boolean,
  overrides: Record<string, string>,
): string => {
  // Если активен один — префиксы лишние ТОЛЬКО если в system source
  // не различено несколько speaker'ов. Если diarizer нашёл 2+ speaker'а
  // в системном звуке — лейблы critical для LLM context'а.
  const systemActive = system.chunks.length > 0 || (includePartials && system.partialText);
  const micActive = mic.chunks.length > 0 || (includePartials && mic.partialText);
  const sysSpeakerIds = new Set<number>();
  for (const c of system.chunks) {
    if (typeof c.speakerId === 'number') sysSpeakerIds.add(c.speakerId);
  }
  const sysHasMultipleSpeakers = sysSpeakerIds.size >= 2;
  const both = systemActive && micActive;
  const needsLabels = both || sysHasMultipleSpeakers;

  type Item = { source: AudioCaptureSource; text: string; at: number; speakerId?: number };
  const items: Item[] = [];
  for (const c of system.chunks) items.push({ source: 'system', text: c.text, at: c.at, speakerId: c.speakerId });
  for (const c of mic.chunks) items.push({ source: 'mic', text: c.text, at: c.at, speakerId: 0 });
  items.sort((a, b) => a.at - b.at);

  // Partials append'ятся в конец «как сейчас идущая фраза» — у них нет
  // committed timestamp'а. Если сразу два partial'а — ставим в порядке
  // system→mic (стабильно).
  if (includePartials) {
    const now = Date.now();
    if (system.partialText) items.push({ source: 'system', text: system.partialText, at: now });
    if (mic.partialText) items.push({ source: 'mic', text: mic.partialText, at: now + 1, speakerId: 0 });
  }

  if (items.length === 0) return '';
  if (!needsLabels) {
    // Один source без diarization split'а — без меток (короче для LLM).
    return items.map((i) => i.text).join(' ');
  }
  return items
    .map((i) => `${resolveSpeakerLabel(i.speakerId, i.source, overrides)}: ${i.text}`)
    .join('\n');
};

/** localStorage helpers. Speaker label overrides scoped по session-key —
 *  каждое start cycle получает свой namespace, чтобы старые labels
 *  не утекали в новый interview. */
const loadSpeakerLabels = (key: string): Record<string, string> => {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === 'string') out[k] = v;
      }
      return out;
    }
  } catch {
    /* corrupt JSON — ignore */
  }
  return {};
};

const saveSpeakerLabels = (key: string, labels: Record<string, string>): void => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(labels));
  } catch {
    /* quota exceeded / private mode — silent */
  }
};

const newSpeakerLabelsKey = (): string => `cue.speakers.${Date.now()}`;

const initialKey = newSpeakerLabelsKey();

export const useAudioCaptureStore = create<State>((set, get) => ({
  available: false,
  system: emptySlice(),
  mic: emptySlice(),
  speakerLabels: loadSpeakerLabels(initialKey),
  speakerLabelsKey: initialKey,

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
        // Privacy: transcript events НЕ логируем (они содержат raw речь юзера +
        // системного аудио). Раньше был console.log — потенциальный leak в
        // crash-reports / DevTools / forensic tools.
        if (!ev || (ev.source !== 'system' && ev.source !== 'mic')) return;
        const text = (ev.text ?? '').trim();
        if (!text) return;
        // Mic source: backend omitempty drops speaker_id=0 → undefined here.
        // Normalize so chunks consistently carry speakerId (0 для mic).
        const speakerId =
          ev.source === 'mic'
            ? 0
            : typeof ev.speakerId === 'number'
              ? ev.speakerId
              : undefined;
        if (ev.isFinal) {
          apply(ev.source, (slice) => ({
            ...slice,
            chunks: [...slice.chunks, { source: ev.source, text, at: Date.now(), speakerId }],
            partialText: '',
            finalSeq: slice.finalSeq + 1,
          }));
        } else {
          apply(ev.source, (slice) => ({ ...slice, partialText: text }));
        }
      }),
      window.druz9.on<AudioCaptureErrorEvent>(eventChannels.audioCaptureError, (ev) => {
        if (!ev || (ev.source !== 'system' && ev.source !== 'mic')) return;
        const msg = ev.message || translate('cue.store.audio.err_record');
        apply(ev.source, (slice) => ({ ...slice, error: msg }));
        // Toast — у пользователя должен быть VISIBLE сигнал что start
        // не удался. Раньше error попадал только в slice.error и
        // показывался в LiveTranscriptStrip; но strip рендерится
        // только когда `recording` true → если start fail'ил ДО
        // перехода в running, юзер ничего не видел. Toast виден
        // ВСЕГДА (отдельное окно tray-style).
        const label = ev.source === 'mic'
          ? translate('cue.store.audio.label_mic')
          : translate('cue.store.audio.label_system');
        void window.druz9.toast.show(`${label}: ${msg}`, 'error').catch(() => {});
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
      // IPC вообще не дошёл (preload broken / main crashed) — это
      // catastrophic. Toast обязателен: иначе click → ничего →
      // юзер думает что приложение сломано.
      const msg = err instanceof Error ? err.message : translate('cue.store.audio.err_start');
      set((prev) => ({
        ...prev,
        [sliceKey(source)]: { ...prev[sliceKey(source)], error: msg },
      }));
      const label = source === 'mic'
        ? translate('cue.store.audio.label_mic')
        : translate('cue.store.audio.label_system');
      void window.druz9.toast.show(`${label}: ${msg}`, 'error').catch(() => {});
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
      // Full clear → новая «сессия» speaker labels (старые не нужны, могут
      // путать на следующем интервью). Создаём свежий key, dropping old
      // overrides. Старый localStorage entry осiraется как archive — Cue
      // ничего с ним не делает (storage-quota мизер).
      const nextKey = newSpeakerLabelsKey();
      set({
        system: { ...get().system, chunks: [], partialText: '', error: null },
        mic: { ...get().mic, chunks: [], partialText: '', error: null },
        speakerLabels: {},
        speakerLabelsKey: nextKey,
      });
      return;
    }
    set((prev) => ({
      ...prev,
      [sliceKey(source)]: { ...prev[sliceKey(source)], chunks: [], partialText: '', error: null },
    }));
  },

  fullText: () => composeMerged(get().system, get().mic, true, get().speakerLabels),
  liveText: () => composeMerged(get().system, get().mic, true, get().speakerLabels),

  anyRecording: () => {
    const s = get();
    const isOn = (st: AudioCaptureState) => st === 'running' || st === 'starting';
    return isOn(s.system.state) || isOn(s.mic.state);
  },

  renameSpeaker: (speakerId, label) => {
    // Speaker 0 = mic = «Я» — anchor, не override'итcя через UI. Защита
    // от случайного renaming через keyboard shortcut.
    if (speakerId === 0) return;
    const trimmed = label.trim();
    const key = String(speakerId);
    set((prev) => {
      const next = { ...prev.speakerLabels };
      if (trimmed === '') {
        delete next[key];
      } else {
        next[key] = trimmed;
      }
      saveSpeakerLabels(prev.speakerLabelsKey, next);
      return { ...prev, speakerLabels: next };
    });
  },

  labelFor: (speakerId, source) => {
    return resolveSpeakerLabel(speakerId, source, get().speakerLabels);
  },
}));
