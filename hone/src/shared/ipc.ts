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
  pomodoroLoad: 'pomodoro:load',
  pomodoroSave: 'pomodoro:save',
  shellOpenExternal: 'shell:open-external',
  updaterCheck: 'updater:check',
  updaterInstall: 'updater:install',
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
  /** Subscribe to a main→renderer push (returns an unsubscribe fn). */
  on: <K extends keyof typeof eventChannels>(
    channel: K,
    listener: (payload: EventPayload[K]) => void,
  ) => () => void;
}

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
