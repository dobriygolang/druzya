// prefs — synchronous localStorage readers used at boot before the
// (lazy) Settings page module loads. Extracted so App.tsx can hydrate
// theme/pomodoro/dailyGoal without pulling in the whole 1400-line
// Settings page (vault, devices, resource library) on first paint.
//
// The Settings page itself re-uses the same SETTINGS_KEY / THEME_KEY
// strings, so writes from there are visible to these readers without
// any sync wiring.
import { THEME_IDS, type ThemeId } from '../components/CanvasBg';

const SETTINGS_KEY = 'hone:settings';
const THEME_KEY = 'hone:theme';

interface HoneSettings {
  pomodoroMinutes: number;
  dailyGoalMin: number;
  defaultVolume: number;
  notifications: boolean;
  ambientMusic: boolean;
}

const DEFAULTS: HoneSettings = {
  pomodoroMinutes: 25,
  dailyGoalMin: 120,
  defaultVolume: 40,
  notifications: true,
  ambientMusic: true,
};

function clampInt(v: unknown, lo: number, hi: number, fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return Math.max(lo, Math.min(hi, Math.round(v)));
}

function readSettings(): HoneSettings {
  if (typeof window === 'undefined') return DEFAULTS;
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw);
    return {
      pomodoroMinutes: clampInt(parsed?.pomodoroMinutes, 5, 90, DEFAULTS.pomodoroMinutes),
      dailyGoalMin: clampInt(parsed?.dailyGoalMin, 15, 480, DEFAULTS.dailyGoalMin),
      defaultVolume: clampInt(parsed?.defaultVolume, 0, 100, DEFAULTS.defaultVolume),
      notifications: typeof parsed?.notifications === 'boolean' ? parsed.notifications : DEFAULTS.notifications,
      ambientMusic: typeof parsed?.ambientMusic === 'boolean' ? parsed.ambientMusic : DEFAULTS.ambientMusic,
    };
  } catch {
    return DEFAULTS;
  }
}

/** Read the stored pomodoro duration in seconds (clamped 5–90 min). */
export function readPomodoroSeconds(): number {
  return readSettings().pomodoroMinutes * 60;
}

/** Read the stored daily focus goal in minutes (default 120). */
export function readDailyGoalMin(): number {
  return readSettings().dailyGoalMin;
}

export function readStoredTheme(): ThemeId {
  if (typeof window === 'undefined') return 'winter';
  try {
    const v = window.localStorage.getItem(THEME_KEY);
    if (v && (THEME_IDS as readonly string[]).includes(v)) return v as ThemeId;
  } catch {
    /* ignore */
  }
  return 'winter';
}

export const PREFS_KEYS = { SETTINGS_KEY, THEME_KEY } as const;
