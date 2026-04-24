// Legacy — the desktop used to receive a druz9://auth/telegram?token=…
// callback from the frontend. That pattern did NOT match the Druzya
// backend (which is pull-based via /auth/telegram/start + /poll), so
// this module is reduced to a stub until a non-auth deep-link use
// case appears (e.g. opening a conversation by link from a share URL).

/** Placeholder — no-op. See main/auth/telegram-code.ts for the real login flow. */
export function registerDeepLinks(_: unknown): void {
  // Intentionally empty.
}
