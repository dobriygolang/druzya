// session.ts — minimal auth store.
//
// Today: holds accessToken + userId in-memory so the transport can read
// it from an interceptor without prop-drilling. The keychain-backed
// bootstrap (Phase 5b) will hydrate this on app start via the preload
// bridge; for MVP we leave it null and rely on VITE_DRUZ9_DEV_TOKEN when
// smoke-testing against a real backend.
//
// Zustand is imported directly here (not through a barrel) to keep
// bundle analysis honest — each store is its own chunk.
import { create } from 'zustand';

interface SessionState {
  userId: string | null;
  accessToken: string | null;
  /** Called by the auth bootstrap once keychain unlocks. */
  hydrate: (s: { userId: string; accessToken: string }) => void;
  /** Clears everything — used by logout and by expired-token handlers. */
  clear: () => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  userId: null,
  accessToken: null,
  hydrate: ({ userId, accessToken }) => set({ userId, accessToken }),
  clear: () => set({ userId: null, accessToken: null }),
}));
