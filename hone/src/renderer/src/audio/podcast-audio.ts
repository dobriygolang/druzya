// podcast-audio.ts — module-level singleton, который owns'ит ОДИН HTMLAudio
// element подключённый к document.body. Не destroyed при page navigation
// — Podcasts page'а unmount'ится, audio продолжает играть в фоне.
//
// Зачем не useState/Context: audio element нужен outside React tree чтобы
// пережить unmount Player'а. Singleton с subscribe-pattern даёт reactivity
// для UI (Player на Podcasts page + volume slider в Dock'е) без context-
// provider'а наверху.
//
// API:
//   - loadAndPlay(podcast) — подгружает src, начинает play (с user-gesture
//     контекстом — caller должен звать в click handler'е, иначе autoplay
//     policy блочит).
//   - pause() / resume() — при том же current podcast.
//   - seek(sec) — устанавливает currentTime.
//   - skip(deltaSec) — относительный seek (±15s shortcuts).
//   - setVolume(0..1) — управление громкостью (Dock volume slider).
//   - setPlaybackRate(0.75 / 1 / 1.25 / 1.5 / 1.75 / 2) — speed.
//   - subscribe(fn) → unsubscribe — для UI rerender'а на каждое изменение.

export interface PodcastAudioState {
  // null когда никакой podcast не активен.
  podcastId: string | null;
  audioUrl: string | null;
  title: string | null;
  // Computed live от audio element.
  currentTime: number;
  duration: number;
  playing: boolean;
  // Multiplied with system volume в audio element (0..1).
  volume: number;
  playbackRate: number;
  // Last error message — UI показывает toast.
  error: string | null;
}

const INITIAL: PodcastAudioState = {
  podcastId: null,
  audioUrl: null,
  title: null,
  currentTime: 0,
  duration: 0,
  playing: false,
  volume: 0.4, // mirror dock default
  playbackRate: 1,
  error: null,
};

let state: PodcastAudioState = INITIAL;
const listeners = new Set<(s: PodcastAudioState) => void>();
let audioEl: HTMLAudioElement | null = null;

// Persistence для playbackRate + volume — читается на init.
const RATE_KEY = 'hone:podcast:rate';
const VOL_KEY = 'hone:podcast:volume';

function readPersistedRate(): number {
  if (typeof window === 'undefined') return 1;
  try {
    const v = window.localStorage.getItem(RATE_KEY);
    const n = v ? parseFloat(v) : 1;
    return Number.isFinite(n) && n > 0 ? n : 1;
  } catch {
    return 1;
  }
}
function readPersistedVolume(): number {
  if (typeof window === 'undefined') return 0.4;
  try {
    const v = window.localStorage.getItem(VOL_KEY);
    const n = v ? parseFloat(v) : 0.4;
    return Number.isFinite(n) && n >= 0 && n <= 1 ? n : 0.4;
  } catch {
    return 0.4;
  }
}

function ensureAudio(): HTMLAudioElement {
  if (audioEl) return audioEl;
  if (typeof document === 'undefined') {
    throw new Error('podcast-audio: SSR not supported');
  }
  const el = document.createElement('audio');
  el.preload = 'metadata';
  el.style.display = 'none';
  // Лучший cross-platform behavior: после tab inactivity audio
  // продолжает играть (Electron's BrowserWindow webContents).
  el.crossOrigin = 'anonymous';
  document.body.appendChild(el);

  el.addEventListener('play', () => emit({ playing: true }));
  el.addEventListener('pause', () => emit({ playing: false }));
  el.addEventListener('ended', () => emit({ playing: false }));
  el.addEventListener('timeupdate', () => emit({ currentTime: el.currentTime }));
  el.addEventListener('durationchange', () => {
    if (el.duration && Number.isFinite(el.duration)) emit({ duration: el.duration });
  });
  el.addEventListener('loadedmetadata', () => {
    if (el.duration && Number.isFinite(el.duration)) emit({ duration: el.duration });
  });
  el.addEventListener('error', () => {
    const code = el.error?.code;
    let msg = 'Audio playback failed';
    if (code === 1) msg = 'Aborted';
    else if (code === 2) msg = 'Network error';
    else if (code === 3) msg = 'Decode error';
    else if (code === 4) msg = 'Audio format not supported';
    emit({ error: msg, playing: false });
  });

  // Restore persisted prefs.
  el.volume = readPersistedVolume();
  el.playbackRate = readPersistedRate();
  audioEl = el;
  return el;
}

function emit(partial: Partial<PodcastAudioState>): void {
  state = { ...state, ...partial };
  for (const fn of listeners) {
    try {
      fn(state);
    } catch {
      /* listener error — ignore */
    }
  }
}

// ─── Public API ─────────────────────────────────────────────────────────

export function getPodcastAudioState(): PodcastAudioState {
  return state;
}

export function subscribePodcastAudio(fn: (s: PodcastAudioState) => void): () => void {
  listeners.add(fn);
  // Push current state immediately so caller синкается без extra fetch.
  try {
    fn(state);
  } catch {
    /* ignore */
  }
  return () => listeners.delete(fn);
}

export interface PodcastSeed {
  id: string;
  audioUrl: string;
  title: string;
  initialProgressSec?: number;
}

export async function loadAndPlay(seed: PodcastSeed): Promise<void> {
  const el = ensureAudio();
  const switching = state.podcastId !== seed.id;
  if (switching) {
    el.src = seed.audioUrl;
    if (seed.initialProgressSec && seed.initialProgressSec > 0) {
      // Wait for metadata to apply currentTime correctly. listenOnce on
      // loadedmetadata; if metadata уже loaded, set immediately.
      const applyTime = () => {
        try {
          el.currentTime = seed.initialProgressSec ?? 0;
        } catch {
          /* may fail на Safari если metadata ещё не ready */
        }
      };
      if (el.readyState >= 1) applyTime();
      else el.addEventListener('loadedmetadata', applyTime, { once: true });
    }
    emit({
      podcastId: seed.id,
      audioUrl: seed.audioUrl,
      title: seed.title,
      currentTime: seed.initialProgressSec ?? 0,
      duration: 0,
      error: null,
    });
  }
  try {
    await el.play();
  } catch (e) {
    emit({ error: (e as Error).message || 'Playback failed' });
  }
}

export async function resume(): Promise<void> {
  const el = ensureAudio();
  if (!state.audioUrl) return;
  try {
    await el.play();
  } catch (e) {
    emit({ error: (e as Error).message || 'Playback failed' });
  }
}

export function pause(): void {
  const el = audioEl;
  if (!el) return;
  el.pause();
}

export function seek(sec: number): void {
  const el = audioEl;
  if (!el) return;
  el.currentTime = Math.max(0, sec);
}

export function skip(deltaSec: number): void {
  const el = audioEl;
  if (!el) return;
  const max = state.duration || el.duration || 0;
  el.currentTime = Math.max(0, Math.min(max, el.currentTime + deltaSec));
}

export function setVolume(v: number): void {
  const el = ensureAudio();
  const clamped = Math.max(0, Math.min(1, v));
  el.volume = clamped;
  emit({ volume: clamped });
  try {
    window.localStorage.setItem(VOL_KEY, String(clamped));
  } catch {
    /* private mode */
  }
}

export function setPlaybackRate(rate: number): void {
  const el = ensureAudio();
  const clamped = Math.max(0.5, Math.min(3, rate));
  el.playbackRate = clamped;
  emit({ playbackRate: clamped });
  try {
    window.localStorage.setItem(RATE_KEY, String(clamped));
  } catch {
    /* private mode */
  }
}

// React hook (тонкая обёртка над subscribe).
import { useEffect, useState as useReactState } from 'react';

export function usePodcastAudio(): PodcastAudioState {
  const [s, setS] = useReactState<PodcastAudioState>(getPodcastAudioState);
  useEffect(() => subscribePodcastAudio(setS), []);
  return s;
}
