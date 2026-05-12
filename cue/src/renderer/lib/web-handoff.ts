// web-handoff.ts (Cue renderer) — X5 (Phase J P2 2026-05-12).
//
// Renderer-side mirror of cue/src/main/api/web-handoff.ts. Renderer can't
// import main process modules, so we duplicate the URL-builder logic here
// and route through the shell.openExternal preload bridge.
//
// Source attribution mirrors the main side: every URL gets a
// `?source=cue_<surface>` query param. Backend telemetry groups by source
// for the cross-product conversion funnel.

// druz9 web base URL. Hardcoded production default to avoid pulling in
// the config service from main into renderer; staging deploys can override
// via the build-time DRUZ9_WEB_BASE env on the main process side (where
// upstreamApiBase is read).
const WEB_BASE = 'https://druz9.online';
const SOURCE_PREFIX = 'cue';

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
  // window.druz9.shell.openExternal is set up by preload (см. cue/src/preload/index.ts).
  void window.druz9.shell.openExternal(url).catch(() => {
    /* swallow — pop-up blocker / shell quirk shouldn't crash UI */
  });
}

/**
 * Open the web session report page. Triggered from SummaryModal footer
 * («view full report on druz9.online»).
 */
export function openWebSession(sessionId: string): void {
  if (!sessionId) {
    // No id → fallback to /sessions list. Better than dead URL.
    openExternal(buildURL('/sessions', 'expanded_session_list'));
    return;
  }
  openExternal(buildURL(`/sessions/${encodeURIComponent(sessionId)}`, 'expanded_post_session'));
}

/**
 * Open web Atlas with focus on a struggle node. Suggestion card / summary
 * action items often reference topics («struggled with sharding») — clicking
 * jumps to the curated atlas view for that node.
 */
export function openWebAtlasNode(nodeId: string): void {
  openExternal(
    buildURL('/atlas/explore', 'suggestion_review_atlas', {
      focus: nodeId,
      highlight: 'struggle',
    }),
  );
}

/** Open user's memory timeline on web. */
export function openWebProfileMemory(): void {
  openExternal(buildURL('/profile/memory', 'settings_memory'));
}

/** Generic druz9.online open with attribution. */
export function openWebRoot(source = 'generic'): void {
  openExternal(buildURL('/', source));
}
