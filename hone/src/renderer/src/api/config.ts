// API config — where the Connect-RPC client points to. Resolved once at
// boot from Vite env vars so the bundle is a plain constant, no runtime
// window lookups.
//
// Dev default points at the monorepo's local monolith (make dev). Prod
// builds set VITE_DRUZ9_API_BASE via electron-builder / CI so the DMG
// ships with api.druzya.tech baked in.
//
// `VITE_DRUZ9_DEV_TOKEN` is a hatch-escape for smoke-testing the
// vertical slice (Stats page against a real backend) before the keychain
// auth flow lands. When set, the interceptor attaches it as a Bearer
// token; in prod it's unset and the interceptor reads from the keytar
// session instead.

const envBase = (import.meta.env.VITE_DRUZ9_API_BASE ?? '').trim();

export const API_BASE_URL = envBase || 'http://localhost:8080';

export const DEV_BEARER_TOKEN: string | null =
  (import.meta.env.VITE_DRUZ9_DEV_TOKEN ?? '').trim() || null;
