// Auth store — tracks whether the user is logged in. Session details stay
// in the main-process keychain; we only mirror the userId here so the UI
// can branch on "logged in vs not" without a round trip per render.

import { create } from 'zustand';

import { eventChannels, type AuthChangedEvent, type AuthSession } from '@shared/ipc';

interface AuthState {
  session: AuthSession | null;
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
  /** Called once on mount to seed state + subscribe to auth-changed events. */
  bootstrap: () => () => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  session: null,
  loading: true,
  refresh: async () => {
    try {
      const s = await window.druz9.auth.session();
      set({ session: s, loading: false });
    } catch {
      set({ loading: false });
    }
  },
  logout: async () => {
    await window.druz9.auth.logout();
    set({ session: null });
  },
  bootstrap: () => {
    void get().refresh();
    return window.druz9.on<AuthChangedEvent>(eventChannels.authChanged, (payload) => {
      set({ session: payload.session, loading: false });
    });
  },
}));
