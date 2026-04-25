// Shared IPC types. Kept deliberately narrow for the Hone MVP — the
// stealth/copilot app (desktop/) has a much larger IPC surface because
// it touches capture / hotkeys / permissions; Hone is a single main
// window that mostly speaks to the backend directly, so the preload
// bridge stays compact.

export const invokeChannels = {
  appVersion: 'app:version',
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
} as const;

export const eventChannels = {
  deepLink: 'app:deep-link',
  authChanged: 'auth:changed',
  updaterStatus: 'updater:status',
} as const;

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
