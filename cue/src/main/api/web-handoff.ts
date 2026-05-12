// web-handoff.ts — Cue → web (druz9.online) deep-link helpers.
// X5 (Phase J P2 2026-05-12) cross-product bidirectional handoff.
//
// Cue is a stealth tray-copilot — its UI is minimalist by design (live
// transcript + suggestion cards). Anything that needs more screen real
// estate or persistence (full session report with annotations, atlas
// navigation, profile/memory edit) lives on druz9.online. These helpers
// wrap shell.openExternal so renderer → main IPC → external browser is
// the single supported path.
//
// Attribution: every URL gets `?source=cue_<surface>` query param so
// backend telemetry can attribute conversion. Hone has the mirror helper
// (`hone/src/renderer/src/lib/cross-app-links.ts buildURL`) which the
// product team standardises on for cross-product funnel reports.
//
// Source naming convention: «cue_<screen>_<element>».
//   cue_expanded_post_session    — ExpandedScreen post-session footer
//   cue_suggestion_review_atlas  — Suggestion card «review on Atlas»
//   cue_settings_memory          — Settings → Memory edit-on-web
//
// Use shell.openExternal directly (not BrowserWindow.loadURL) so the
// link opens in the user's default browser, where they're already
// authenticated to druz9.online. In-app webviews would force re-login.

import { shell } from 'electron';

// Single source of truth for the web base URL. Mirrors
// cue/src/main/config/bootstrap.ts upstreamApiBase default — same env
// override (DRUZ9_WEB_BASE) wins so staging deploys point both at the
// same host.
const WEB_BASE = (process.env.DRUZ9_WEB_BASE?.trim() || 'https://druz9.online').replace(/\/+$/, '');

const SOURCE_PREFIX = 'cue';

/**
 * Build a fully-qualified URL with attribution query params. source must
 * be a short kebab-case tag like 'expanded_post_session'. Extra params
 * skip when undefined / empty.
 */
function buildURL(path: string, source: string, params?: Record<string, string | undefined>): string {
  const url = new URL(path.startsWith('/') ? path : `/${path}`, `${WEB_BASE}/`);
  url.searchParams.set('source', `${SOURCE_PREFIX}_${source}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (typeof v === 'string' && v.length > 0) url.searchParams.set(k, v);
    }
  }
  return url.toString();
}

function openExternal(url: string): void {
  // Best-effort. Don't surface failures to renderer — pop-up blockers
  // and shell quirks shouldn't crash mid-interview flow.
  void shell.openExternal(url).catch(() => {
    /* swallow */
  });
}

/**
 * Open the web view of a specific Cue session — full report with
 * annotations, AI summary, transcript. Triggered from ExpandedScreen
 * post-session footer («view full report →»).
 */
export function openWebSession(sessionId: string): void {
  openExternal(buildURL(`/sessions/${encodeURIComponent(sessionId)}`, 'expanded_post_session'));
}

/**
 * Open the user's full insights stream on web. Cue suggestion cards may
 * cite an insight («Coach mentioned X yesterday») and offer this CTA so
 * the user can read the full context.
 */
export function openWebInsight(insightId: string): void {
  openExternal(buildURL('/insights', 'suggestion_insight_open', { focus: insightId }));
}

/**
 * Open web Atlas with focus on a struggle node. Triggered from suggestion
 * card when Cue detects the user is stuck on a topic during interview
 * («Review on Atlas →»). Pairs with the MarkAtlasStruggle backend hook
 * so the node is already highlighted when the user arrives.
 */
export function openWebAtlasNode(nodeId: string): void {
  openExternal(
    buildURL('/atlas/explore', 'suggestion_review_atlas', {
      focus: nodeId,
      highlight: 'struggle',
    }),
  );
}

/**
 * Open the user's primary-goal edit surface on web. Cue settings link
 * here when the user wants to retarget the suggestion personalisation
 * («editing memory affects what Cue knows about you»).
 */
export function openWebProfileMemory(): void {
  openExternal(buildURL('/profile/memory', 'settings_memory'));
}

/**
 * Open druz9 web root with cue attribution. Generic CTA for Settings
 * ecosystem card / onboarding completion screen.
 */
export function openWebRoot(source: string = 'generic'): void {
  openExternal(buildURL('/', source));
}

/**
 * Open the Hone marketing/download page on web. Cue onboarding suggests
 * Hone as the «next surface in the ecosystem».
 */
export function openWebHoneInstall(): void {
  openExternal(buildURL('/hone', 'onboarding_hone_install'));
}
