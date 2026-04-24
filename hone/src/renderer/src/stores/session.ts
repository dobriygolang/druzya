// session.ts — auth store с keychain-bootstrap'ом.
//
// Поведение на mount: hydrate() читает session из main-process через
// IPC bridge (window.hone.auth.session), main-process в свою очередь
// расшифровывает файл safeStorage'ом. На login deep-link — main-process
// шлёт authChanged event, мы persist'им в keychain и ставим в store.
//
// Pre-mount → state = { status: 'unknown' } чтобы UI не флипал между
// «not signed in» и «signed in» во время restore.
import { create } from 'zustand';

export type AuthStatus = 'unknown' | 'guest' | 'signed_in';

interface SessionState {
  status: AuthStatus;
  userId: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: number;

  /** Bootstrap on app mount — reads from keychain via preload. */
  bootstrap: () => Promise<void>;

  /** Called by deep-link handler / login modal after token arrives. */
  hydrate: (s: {
    userId: string;
    accessToken: string;
    refreshToken?: string;
    expiresAt?: number;
  }) => void;

  /** Clears in-memory + keychain. Used by logout. */
  clear: () => Promise<void>;
}

export const useSessionStore = create<SessionState>((set) => ({
  status: 'unknown',
  userId: null,
  accessToken: null,
  refreshToken: null,
  expiresAt: 0,

  bootstrap: async () => {
    const bridge = typeof window !== 'undefined' ? window.hone : undefined;
    if (!bridge) {
      // Browser-only смоук-тест (без Electron) — guest, dev-token хатч в
      // transport.ts всё ещё работает.
      set({ status: 'guest' });
      return;
    }
    try {
      const s = await bridge.auth.session();
      if (s && s.accessToken) {
        set({
          status: 'signed_in',
          userId: s.userId,
          accessToken: s.accessToken,
          refreshToken: s.refreshToken ?? null,
          expiresAt: s.expiresAt ?? 0,
        });
        return;
      }
    } catch {
      /* swallow — keychain may be locked / unavailable */
    }
    set({ status: 'guest' });
  },

  hydrate: ({ userId, accessToken, refreshToken, expiresAt }) => {
    set({
      status: 'signed_in',
      userId,
      accessToken,
      refreshToken: refreshToken ?? null,
      expiresAt: expiresAt ?? 0,
    });
  },

  clear: async () => {
    const bridge = typeof window !== 'undefined' ? window.hone : undefined;
    if (bridge) {
      try {
        await bridge.auth.logout();
      } catch {
        /* ignore */
      }
    }
    set({ status: 'guest', userId: null, accessToken: null, refreshToken: null, expiresAt: 0 });
  },
}));
