// X2 (P0) — Pro upgrade + BYOK URLs used by Cue UpgradeModal.
//
// These are duplicated from `main/config/bootstrap.ts` because the
// renderer doesn't import main-process modules. Acceptable trade-off:
// these are compile-time-stable production URLs, override через Vite env
// var if you want a staging build (rare). Renderer's other config (paywall
// copy, models list) flows through DesktopConfig server-driven IPC, but
// these two URLs are not server-driven — Pro/BYOK landing pages are
// shipped as part of web frontend and the URL shape is fixed.
//
// Stripe attribution: query param `source=cue&feature=<slug>` is appended
// at click-site (see UpgradeModal.tsx). Backend redirect strips/keeps as
// needed for funnel analytics.

const FALLBACK_PRO = 'https://druz9.online/upgrade';
const FALLBACK_BYOK = 'https://druz9.online/byok';

// Vite injects import.meta.env at build time. Override in `.env.local`
// with VITE_DRUZ9_PRO_URL / VITE_DRUZ9_BYOK_URL for staging/local backend.
const envPro = (import.meta.env.VITE_DRUZ9_PRO_URL as string | undefined)?.trim();
const envByok = (import.meta.env.VITE_DRUZ9_BYOK_URL as string | undefined)?.trim();

export const PRO_UPGRADE_URL_BASE: string = envPro && envPro.length > 0 ? envPro : FALLBACK_PRO;
export const PRO_BYOK_URL: string = envByok && envByok.length > 0 ? envByok : FALLBACK_BYOK;
