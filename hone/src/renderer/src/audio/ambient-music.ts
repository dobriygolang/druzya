// ambient-music.ts — looping cosmic background track. Singleton — like
// podcast-audio.ts но для ambient: автомат-loop, без UI seek/play
// controls (только on/off через Settings).
//
// Подкаст и ambient делят один volume bus (Dock slider управляет обоими)
// — поэтому setVolume здесь forwards в setVolume podcast-audio.ts. На
// практике разные audio elements могут иметь свой volume; для простоты
// мы держим *одинаковую* громкость и пока не делаем мини-mixer (TODO:
// если юзер захочет separate ambient-volume slider — добавить).
//
// Источник трека: hosted royalty-free space ambient. Default URL ниже —
// placeholder; оператор кладёт реальный URL в env (или пресет CDN'а)
// через `localStorage['hone:ambient-url']`. Юзер сам не настраивает.
//
// Длина: ожидаем ~10h compilation (single trail или crossfade-loop). Если
// short loop (5-15 min) — element.loop=true сам зацикливает без перерыва.

const PERSIST_KEY = 'hone:ambient:enabled';
// Default URL — собрать из public-domain ambient (kevinmacleod / freesound
// CC0). Поменяй через `localStorage['hone:ambient-url']` если нужно.
const DEFAULT_AMBIENT_URL = 'https://cdn.druz9.online/ambient/cosmic-loop.mp3';

let audioEl: HTMLAudioElement | null = null;
let started = false;

function readUrl(): string {
  if (typeof window === 'undefined') return DEFAULT_AMBIENT_URL;
  try {
    return window.localStorage.getItem('hone:ambient-url') || DEFAULT_AMBIENT_URL;
  } catch {
    return DEFAULT_AMBIENT_URL;
  }
}

function ensureAudio(): HTMLAudioElement {
  if (audioEl) return audioEl;
  if (typeof document === 'undefined') {
    throw new Error('ambient-music: SSR not supported');
  }
  const el = document.createElement('audio');
  el.src = readUrl();
  el.loop = true;
  el.preload = 'auto';
  el.crossOrigin = 'anonymous';
  el.style.display = 'none';
  // Volume управляется отдельно от podcast-audio — оба слушают Dock slider
  // через App.tsx useEffect (см. там). Initial: half-of-podcast чтобы
  // ambient не overpowered podcast voice'ы при их одновременной игре.
  el.volume = 0.2;
  document.body.appendChild(el);
  audioEl = el;
  return el;
}

export async function startAmbient(): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PERSIST_KEY, '1');
  } catch {
    /* private mode */
  }
  const el = ensureAudio();
  // Browser autoplay policy: первый play() требует user gesture. Если
  // вызывается из onClick toggle'а в Settings — сработает. На app-start
  // bootstrap auto-restore через `bootstrapAmbient` ниже не сработает
  // (no user gesture); ambient заиграет после первого click anywhere.
  try {
    if (!started) started = true;
    await el.play();
  } catch {
    // Autoplay blocked — установим listener на первое click anywhere,
    // play тогда. Idempotent — multiple calls к startAmbient'у заменяют
    // listener.
    const onAnyClick = async () => {
      window.removeEventListener('click', onAnyClick);
      try {
        await el.play();
      } catch {
        /* still blocked? fallback на ничего */
      }
    };
    window.addEventListener('click', onAnyClick, { once: true });
  }
}

export function stopAmbient(): void {
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(PERSIST_KEY, '0');
    } catch {
      /* ignore */
    }
  }
  if (audioEl) {
    audioEl.pause();
  }
}

export function setAmbientVolume(v: number): void {
  if (!audioEl) return;
  audioEl.volume = Math.max(0, Math.min(1, v));
}

/**
 * bootstrapAmbient — вызывается из App.tsx при mount'е. Если юзер ранее
 * включил ambient (`hone:ambient:enabled=1`), пытается start. На autoplay
 * policy block — ставит one-shot click listener.
 */
export function bootstrapAmbient(): void {
  if (typeof window === 'undefined') return;
  let enabled = true; // default ON
  try {
    const raw = window.localStorage.getItem(PERSIST_KEY);
    if (raw !== null) enabled = raw === '1';
  } catch {
    /* private mode → use default */
  }
  if (!enabled) return;
  void startAmbient();
}

export function isAmbientEnabled(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const raw = window.localStorage.getItem(PERSIST_KEY);
    if (raw === null) return true; // default ON
    return raw === '1';
  } catch {
    return true;
  }
}
