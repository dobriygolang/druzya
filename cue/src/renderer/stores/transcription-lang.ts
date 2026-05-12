// Voice transcription language preference. Persists in localStorage.
//
// Применение: native audio-capture binary в main process будет позже
// читать this preference через IPC (audio-capture:start payload получит
// lang field). Пока что store существует sebagai preference-сlot —
// SettingsScreen позволяет юзеру выставить значение, оно сохраняется,
// рестарт сессии подхватит.
//
// Sergey 2026-05-12 polish wave — single language picker, не пытаемся
// продублировать в obvious places (avoid two-place sync hell).
import { create } from 'zustand';

export type TranscriptionLang = 'ru-RU' | 'en-US' | 'en-GB' | 'auto';

const STORAGE_KEY = 'cue:transcriptionLang:v1';
const DEFAULT_LANG: TranscriptionLang = 'auto';

const VALID: ReadonlySet<TranscriptionLang> = new Set<TranscriptionLang>([
  'ru-RU',
  'en-US',
  'en-GB',
  'auto',
]);

function readInitial(): TranscriptionLang {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw && VALID.has(raw as TranscriptionLang)) {
      return raw as TranscriptionLang;
    }
  } catch {
    /* private mode / SSR — fall through */
  }
  return DEFAULT_LANG;
}

interface State {
  lang: TranscriptionLang;
  setLang: (lang: TranscriptionLang) => void;
}

export const useTranscriptionLangStore = create<State>((set) => ({
  lang: readInitial(),
  setLang: (lang) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      /* drop — store ещё обновится in-memory */
    }
    set({ lang });
  },
}));

export const TRANSCRIPTION_LANG_LABELS: Record<TranscriptionLang, string> = {
  'ru-RU': 'Русский',
  'en-US': 'English (US)',
  'en-GB': 'English (UK)',
  auto: 'Auto-detect',
};
