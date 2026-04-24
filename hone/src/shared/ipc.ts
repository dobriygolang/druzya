// Shared IPC types. Kept deliberately narrow for the Hone MVP — the
// stealth/copilot app (desktop/) has a much larger IPC surface because
// it touches capture / hotkeys / permissions; Hone is a single main
// window that mostly speaks to the backend directly, so the preload
// bridge is nearly empty in v0.
//
// As we wire Connect-RPC into the renderer and start exposing
// native-side helpers (deep-links, update feed, keychain-backed auth),
// this file grows — keep its shape symmetric with
// desktop/src/shared/ipc.ts so a future shared/electron-core can
// extract the common subset.

export const invokeChannels = {
  appVersion: 'app:version',
  authSession: 'auth:session',
  authLogout: 'auth:logout',
} as const;

export const eventChannels = {
  deepLink: 'app:deep-link',
} as const;

/** Stable shape of the window.hone API exposed via contextBridge. */
export interface HoneAPI {
  app: {
    version: () => Promise<string>;
  };
  auth: {
    /** Returns null when the user has not yet logged in. */
    session: () => Promise<AuthSession | null>;
    logout: () => Promise<void>;
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
  expiresAt: number; // unix-ms
}

export interface EventPayload {
  deepLink: { url: string };
}
