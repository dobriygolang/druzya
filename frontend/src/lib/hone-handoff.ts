// hone-handoff.ts — web → Hone deep-link helpers (X5 Phase J P2 2026-05-12).
//
// druz9 ecosystem has three surfaces — web (this codebase, druz9.online),
// Hone (desktop focus cockpit), Cue (stealth tray-copilot). Web Coach,
// Atlas, Mock surfaces all benefit from «practice this in Hone» / «reflect
// in Hone» CTAs — single moment of intent is too valuable to leave hanging.
//
// Deep-link contract (Hone owns `druz9://`, see hone/src/main/auth/deeplink.ts):
//
//   druz9://focus.start?goal=…&mode=pomodoro&duration=25
//   druz9://coach.open?topic=mock-reflection
//   druz9://note.open?id=<note-id>
//   druz9://task.open?id=<task-id>
//
// All URLs carry `?source=web_<surface>` so backend telemetry can attribute
// the funnel: web Coach click → Hone focus_session.started.
//
// Detection of «Hone not installed»: there's no reliable native API for
// this in the browser. We rely on the user reading the toast («Если Hone
// не открылся — скачай его на druz9.online/hone»). False negative is OK
// in this direction — clicking the CTA either lands them in Hone or
// nowhere visible; either way no data is lost.

/** Hone's deep-link scheme. Must match hone/electron-builder.yml registration. */
export const HONE_DEEPLINK_BASE = 'druz9://';

/** Source tags reflect the click origin для backend funnel attribution. */
const SOURCE_PREFIX = 'web';

/**
 * Build a `druz9://...` URL with attribution. params are appended as
 * query string; undefined / empty values skip.
 */
function buildDeepLink(
  intent: string,
  source: string,
  params?: Record<string, string | number | undefined>,
): string {
  const qs = new URLSearchParams();
  qs.set('source', `${SOURCE_PREFIX}_${source}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null) continue;
      if (typeof v === 'number') {
        if (Number.isFinite(v)) qs.set(k, String(v));
        continue;
      }
      if (v.length > 0) qs.set(k, v);
    }
  }
  return `${HONE_DEEPLINK_BASE}${intent}?${qs.toString()}`;
}

/**
 * Trigger the deep-link by setting window.location. Browsers route this
 * to the LaunchServices / Win shell handler for `druz9://`. If Hone isn't
 * installed there's no observable effect — we attempt a fallback toast
 * via the caller (since toast UI patterns differ across pages).
 */
function openDeepLink(url: string): void {
  if (typeof window === 'undefined') return;
  // Use a temporary anchor so we don't navigate the current document if
  // the protocol handler is missing (Chrome on missing scheme stays on
  // current page; setting location.href would error in some browsers).
  // location.href is still simpler and works on all major browsers.
  // The trick is to set it in a microtask so React doesn't batch this
  // into a unmount that races with the user's click animation.
  window.setTimeout(() => {
    window.location.href = url;
  }, 0);
}

// ── Focus session ───────────────────────────────────────────────────────

export interface OpenHoneFocusOpts {
  /** Free-form pinned-task title or atlas-anchor id («node:dist-sharding»). */
  goal?: string;
  /** Closed set, matches hone_focus_mode_valid: pomodoro|stopwatch|free|plan|pinned|countdown. */
  mode?: 'pomodoro' | 'stopwatch' | 'free' | 'plan' | 'pinned' | 'countdown';
  /** Duration in minutes for pomodoro / countdown modes. */
  duration?: number;
  /** Source override — default 'coach' when unspecified. */
  source?: string;
}

/**
 * Open Hone with a pre-filled focus session. Most common entry-point —
 * Coach «schedule focus session» → Hone fires pomodoro on the goal.
 */
export function openHoneFocusSession(opts: OpenHoneFocusOpts = {}): void {
  openDeepLink(
    buildDeepLink('focus.start', opts.source ?? 'coach', {
      goal: opts.goal,
      mode: opts.mode,
      duration: opts.duration,
    }),
  );
}

// ── Coach (one-action card) ─────────────────────────────────────────────

/**
 * Open Hone Coach surface — single next-action card. Useful when the web
 * coach surface needs more context-rich navigation (full chat thread on
 * web) and wants to nudge user toward Hone's tight reflection loop.
 */
export function openHoneCoach(topic?: string, source = 'web_coach_open'): void {
  openDeepLink(
    buildDeepLink('coach.open', source, { topic }),
  );
}

// ── Notes / Tasks ───────────────────────────────────────────────────────

/**
 * Open a specific note in Hone Notes. Used by Mock «reflect on this stage»
 * which creates a note + opens it for review.
 */
export function openHoneNote(noteId: string, source = 'mock_reflection'): void {
  openDeepLink(buildDeepLink('note.open', source, { id: noteId }));
}

/**
 * Open a specific task in Hone TaskBoard. Used by Atlas «add to taskboard»
 * confirmation flow.
 */
export function openHoneTask(taskId: string, source = 'atlas_task_open'): void {
  openDeepLink(buildDeepLink('task.open', source, { id: taskId }));
}

// ── English exercises ───────────────────────────────────────────────────

/**
 * Open Hone English hub on a specific exercise. modality drives which
 * sub-surface opens (reading / writing / listening / speaking).
 */
export function openHoneEnglishExercise(
  exerciseId: string,
  modality?: 'reading' | 'writing' | 'listening' | 'speaking',
  source = 'english_practice',
): void {
  openDeepLink(buildDeepLink('english.exercise', source, { id: exerciseId, modality }));
}

// ── Generic helpers / fallback ──────────────────────────────────────────

/**
 * Detect whether the platform plausibly supports custom protocol handlers
 * — used by trigger UIs to hide / fade the Hone CTA on mobile (where
 * desktop deeplinks always fail) without false positives on desktop.
 */
export function isHoneDeepLinkSupported(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  // Mobile UAs — deeplinks here always fail because Hone is desktop-only.
  if (/Android|iPhone|iPad|iPod|Mobile/.test(ua)) return false;
  return true;
}

/**
 * The download page for users who don't have Hone installed yet. Caller
 * decides when to surface (e.g. timeout after openHoneFocusSession with
 * no focus event back on web).
 */
export const HONE_DOWNLOAD_URL = '/hone';
