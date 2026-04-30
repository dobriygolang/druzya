// Shared IPC types. Kept deliberately narrow for the Hone MVP — the
// stealth/copilot app (desktop/) has a much larger IPC surface because
// it touches capture / hotkeys / permissions; Hone is a single main
// window that mostly speaks to the backend directly, so the preload
// bridge stays compact.

export const invokeChannels = {
  appVersion: 'app:version',
  cueReadNote: 'cue:read-note',
  authSession: 'auth:session',
  authPersist: 'auth:persist',
  authLogout: 'auth:logout',
  authTgStart: 'auth:tg-start',
  authTgPoll: 'auth:tg-poll',
  pomodoroLoad: 'pomodoro:load',
  pomodoroSave: 'pomodoro:save',
  shellOpenExternal: 'shell:open-external',
  updaterCheck: 'updater:check',
  updaterInstall: 'updater:install',
  trafficLightsShow: 'window:traffic-lights-show',
  // Vault passphrase persistence через OS keychain (Electron safeStorage).
  // Хранит wrapping key для derivedKey'а вault'а: однажды unlock'енный
  // passphrase шифруется TouchID/DPAPI и читается на следующем запуске
  // → vault unlock silently. Logout / explicit lock → clear.
  vaultPassLoad: 'vault:pass-load',
  vaultPassSave: 'vault:pass-save',
  vaultPassClear: 'vault:pass-clear',
  // Phase 2.5 — Hone tray. Renderer pushes a compact status string
  // ("25:00", "Focus 12:34") + optional pinned-task subtitle, main
  // process renders it into the macOS menubar tray title/tooltip.
  // Empty string clears the title (tray becomes icon-only).
  trayUpdate: 'tray:update',
} as const;

export const eventChannels = {
  deepLink: 'app:deep-link',
  authChanged: 'auth:changed',
  updaterStatus: 'updater:status',
  cueNoteImport: 'cue:note-import',
} as const;

// ── Cue session analysis types ────────────────────────────────────────────
// Mirror of desktop/src/shared/types SessionAnalysis — kept in sync manually.
// Future: extract to a shared workspace package.

export interface CueAnalysisItem {
  title: string;
  detail: string;
}

export interface CueAnalysisTerm {
  term: string;
  definition: string;
}

export interface CueSessionAnalysis {
  sessionId: string;
  title: string;
  tldr: string;
  startedAt: string;
  finishedAt: string;
  keyTopics: string[];
  actionItems: CueAnalysisItem[];
  terminology: CueAnalysisTerm[];
  decisions: CueAnalysisItem[];
  openQuestions: string[];
  reportMarkdown: string;
  overallScore: number;
  usage: { inputTokens: number; outputTokens: number } | null;
}

/** Stable shape of the window.hone API exposed via contextBridge. */
export interface HoneAPI {
  app: {
    version: () => Promise<string>;
  };
  auth: {
    /** Returns null when the user has not yet logged in. */
    session: () => Promise<AuthSession | null>;
    /** Persists a session received via deep-link OAuth callback. */
    persist: (s: AuthSession) => Promise<void>;
    logout: () => Promise<void>;
    /**
     * Begin the Telegram code-flow. Hone main hits the backend directly —
     * unlike the web flow, no /login intermediary, no druz9:// redirect.
     * Returns the code + deep-link to t.me/<bot>?start=<code> for the
     * user to confirm.
     */
    tgStart: () => Promise<TelegramStart>;
    /**
     * Poll the backend for the Telegram code's confirmation. The discriminated
     * `kind` mirrors the web's PollResult. On `ok` Hone main also persists the
     * session to the keychain and broadcasts authChanged — caller just needs
     * to update its store.
     */
    tgPoll: (code: string) => Promise<TelegramPollResult>;
  };
  pomodoro: {
    load: () => Promise<PomodoroSnapshot | null>;
    save: (s: PomodoroSnapshot) => Promise<void>;
  };
  shell: {
    openExternal: (url: string) => Promise<void>;
  };
  updater: {
    /** Kick manual update check. Idempotent — no-op if check in flight. */
    check: () => Promise<void>;
    /** Quit + install the already-downloaded update. */
    install: () => Promise<void>;
  };
  window: {
    /**
     * Toggle macOS traffic-light buttons (close / minimise / zoom). Renderer
     * shows them only on hover into a top-left zone, чтобы canvas оставался
     * визуально чистым по дефолту.
     */
    setTrafficLights: (visible: boolean) => Promise<void>;
  };
  /** Phase 2.5 — push status to the macOS menubar tray. */
  tray: {
    /**
     * title — short text rendered next to the icon ("25:00", "Focus 12:34").
     * Empty string clears the title (icon-only).
     * tooltip — longer hover text (pinned task, track step). Empty allowed.
     */
    update: (title: string, tooltip: string) => Promise<void>;
  };
  vault: {
    /** Read OS-encrypted vault passphrase (returns null if not saved). */
    passLoad: () => Promise<string | null>;
    /** Persist passphrase wrapped via OS safeStorage (TouchID / DPAPI). */
    passSave: (passphrase: string) => Promise<void>;
    /** Forget saved passphrase — next launch will require manual unlock. */
    passClear: () => Promise<void>;
  };
  /** Cue integration — read meeting notes saved by the Cue desktop app. */
  cue: {
    readNote: (filePath: string) => Promise<CueSessionAnalysis | null>;
  };
  /** Subscribe to a main→renderer push (returns an unsubscribe fn). */
  on: <K extends keyof typeof eventChannels>(
    channel: K,
    listener: (payload: EventPayload[K]) => void,
  ) => () => void;
}

export interface TelegramStart {
  code: string;
  deepLink: string;
  expiresAt: string;
}

export type TelegramPollResult =
  | { kind: 'ok'; session: AuthSession; isNewUser: boolean }
  | { kind: 'pending' }
  | { kind: 'expired' }
  | { kind: 'rate_limited'; retryAfter: number }
  | { kind: 'error'; message: string };

export interface AuthSession {
  userId: string;
  accessToken: string;
  /** Refresh token, opaque to renderer. May be empty in dev-token paths. */
  refreshToken: string;
  /** Unix-ms when the access token stops being valid. 0 = unknown. */
  expiresAt: number;
}

// PomodoroSnapshot — что main персистит на каждом изменении остатка
// или running-флага. Восстанавливается на mount renderer'а; даёт
// «таймер не слетает на reload» свойство, обещанное в Phase 5b.3.
export interface PomodoroSnapshot {
  /** Секунды, оставшиеся в текущем pomodoro'е. */
  remainSec: number;
  /** Был ли таймер запущен в момент сохранения. */
  running: boolean;
  /** Unix-ms когда сделан snapshot — нужно чтобы restore догнал часы. */
  savedAt: number;
}

export interface EventPayload {
  deepLink: { url: string };
  cueNoteImport: { filePath: string; analysis: CueSessionAnalysis };
  // authChanged — main говорит renderer'у «сессия обновилась» (например
  // пришёл OAuth deep-link). Renderer должен hydrate'нуть store.
  authChanged: AuthSession | null;
  // updaterStatus — auto-update state machine.
  //   'idle'       — после старта / после install отказа
  //   'checking'   — pulling latest-mac.yml
  //   'available'  — версия X доступна, загружаем
  //   'downloaded' — готово к перезапуску, renderer показывает toast
  //   'error'      — с message'ом (feed 404, network, etc.)
  updaterStatus:
    | { kind: 'idle' }
    | { kind: 'checking' }
    | { kind: 'available'; version: string }
    | { kind: 'downloaded'; version: string }
    | { kind: 'error'; message: string };
}
