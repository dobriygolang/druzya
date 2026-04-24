// Audio-capture store — mirrors the main-process AudioCapture state
// machine and buffers transcript deltas for the renderer to paint.
//
// Event sources (from main, via window.druz9.on):
//   audio-capture-state-changed → AudioCaptureState
//   audio-capture-transcript    → { text, windowSec }
//   audio-capture-error         → { message }

import { create } from 'zustand';

import { eventChannels, type AudioCaptureState, type AudioCaptureTranscriptEvent } from '@shared/ipc';

export interface TranscriptChunk {
  text: string;
  at: number; // ms epoch when it landed in the renderer
}

interface State {
  state: AudioCaptureState;
  available: boolean;
  /** Epoch ms when start() succeeded; null while idle. Drives the
   *  elapsed-seconds counter in the UI. */
  startedAt: number | null;
  chunks: TranscriptChunk[];
  error: string | null;

  bootstrap: () => () => void;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  clear: () => void;
  /** Concatenate every buffered chunk with single-space join. Used
   *  when the user wants to copy the meeting text into a prompt. */
  fullText: () => string;
}

export const useAudioCaptureStore = create<State>((set, get) => ({
  state: 'idle',
  available: false,
  startedAt: null,
  chunks: [],
  error: null,

  bootstrap: () => {
    // Probe availability once — the button reads this to hide itself
    // on Windows/Linux or when the binary hasn't been built yet.
    void window.druz9.audioCapture.isAvailable().then((a) => set({ available: a }));

    const unsubs = [
      window.druz9.on<AudioCaptureState>(eventChannels.audioCaptureStateChanged, (s) => {
        set((prev) => ({
          state: s,
          // Only stamp startedAt on the running transition, so the
          // timer starts from when audio actually flows, not from
          // the click that may sit in 'starting' for a second while
          // macOS consults TCC.
          startedAt: s === 'running' ? (prev.startedAt ?? Date.now()) : s === 'idle' ? null : prev.startedAt,
          error: s === 'idle' ? null : prev.error,
        }));
      }),
      window.druz9.on<AudioCaptureTranscriptEvent>(eventChannels.audioCaptureTranscript, (ev) => {
        const text = (ev.text ?? '').trim();
        if (!text) return;
        set((prev) => ({
          chunks: [...prev.chunks, { text, at: Date.now() }],
        }));
      }),
      window.druz9.on<{ message: string }>(eventChannels.audioCaptureError, (ev) => {
        set({ error: ev.message || 'Ошибка записи' });
      }),
    ];
    return () => unsubs.forEach((u) => u());
  },

  start: async () => {
    set({ error: null, chunks: [] });
    try {
      await window.druz9.audioCapture.start();
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Не удалось запустить запись' });
    }
  },

  stop: async () => {
    try {
      await window.druz9.audioCapture.stop();
    } catch {
      /* state transitions via event; nothing to do on reject */
    }
  },

  clear: () => set({ chunks: [], error: null }),

  fullText: () => get().chunks.map((c) => c.text).join(' '),
}));
