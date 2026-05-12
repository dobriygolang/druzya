// druz9-cue:// deep-link intent router for Cue.
//
// History: Originally only `druz9-cue://open?file=<path>` was supported
// (Hone → Cue handoff: «start Cue with this imported note → open the
// session in local list»). X5 (Phase J P2 2026-05-12) generalises into a
// typed intent system so future cross-product handoffs (web → Cue
// «start session for upcoming interview», Hone → Cue «record this note
// as voice»…) can plug in without touching the URL parser.
//
// Recognised intents:
//   druz9-cue://open?file=<path>      → session.open (Hone → Cue, existing)
//   druz9-cue://session.start?company=&persona=  → session.start (X5 future, web → Cue)
//   druz9-cue://transcript.open?id=<session-id>  → transcript.open (X5 future)
//
// Protocol scheme registration is the OS-level handshake: Cue tells the
// OS "I own druz9-cue://" so any app launching `open druz9-cue://...`
// lands in our open-url handler. Done at app startup, idempotent.
//
// The renderer subscribes to the `cue:openSession` channel — see
// cue/src/preload/index.ts for the contextBridge that exposes it. New
// intent channels can plug in via the same pattern — the channel name
// must be in shared/ipc.ts eventChannels.

import { app } from 'electron';
import type { BrowserWindow } from 'electron';

import { eventChannels } from '@shared/ipc';

// PROTOCOL = 'druz9-cue' (НЕ 'druz9'). 'druz9://' принадлежит Hone;
// Cue использует свою схему для open-by-file-path deeplink'ов чтобы
// macOS не путалось при route'е cross-app deeplink'ов вроде
// druz9://notes/import → Hone (раньше Cue перехватывал и сам же
// no-op'ил, см. electron-builder.yml).
const PROTOCOL = 'druz9-cue';
const CUE_OPEN_CHANNEL = eventChannels.cueOpenSession;

/** Closed union of recognised Cue intents. */
export type CueDeepLinkIntent =
  | { kind: 'session.open'; filePath: string; source?: string }
  | { kind: 'session.start'; company?: string; persona?: string; source?: string }
  | { kind: 'transcript.open'; sessionId: string; source?: string };

let cachedTargetWindow: BrowserWindow | null = null;
// Pending URL queued during cold-start before the renderer is ready.
let pendingUrl: string | null = null;

export interface CueDeepLinkPayload {
  filePath: string;
  source?: string;
}

/**
 * Register the druz9:// protocol scheme + wire macOS open-url and Windows/
 * Linux second-instance handlers. Pass the main BrowserWindow once it's
 * created so deep-links can be forwarded immediately.
 *
 * Safe to call multiple times — idempotent: app.setAsDefaultProtocolClient
 * is a no-op on repeats and we replace listeners.
 */
export function registerDeepLinks(target: BrowserWindow | null): void {
  cachedTargetWindow = target;

  // 1. Tell the OS we own druz9://
  if (process.defaultApp && process.argv.length >= 2) {
    // dev: electron <main> arg pattern. Pass the script path so the OS
    // re-launches the dev binary with the right args, otherwise it would
    // try to spawn `electron` with no entry.
    app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [process.argv[1]]);
  } else {
    app.setAsDefaultProtocolClient(PROTOCOL);
  }

  // 2. macOS: warm-app receives URL via 'open-url'.
  app.removeAllListeners('open-url');
  app.on('open-url', (event, url) => {
    event.preventDefault();
    dispatch(url);
  });

  // 3. Windows / Linux: warm-app receives URL via second-instance argv.
  // We claim the single-instance lock here only if no one else has — this
  // module is bootstrapped once, after the rest of main has decided
  // whether to call requestSingleInstanceLock for its own reasons.
  app.on('second-instance', (_event, argv) => {
    const url = argv.find((arg) => arg.startsWith(`${PROTOCOL}://`));
    if (url) dispatch(url);
    if (cachedTargetWindow && !cachedTargetWindow.isDestroyed()) {
      if (cachedTargetWindow.isMinimized()) cachedTargetWindow.restore();
      cachedTargetWindow.focus();
    }
  });

  // 4. Cold-start: druz9 URL может прийти как argv[N]. flush'им сразу
  // в pendingUrl — отдадим renderer'у когда он подпишется.
  const coldUrl = process.argv.find((arg) => arg.startsWith(`${PROTOCOL}://`));
  if (coldUrl) pendingUrl = coldUrl;
}

/**
 * Renderer вызывает после mount'а listener'а — забираем queued URL.
 * Возвращает payload или null если нет pending'а.
 */
export function consumePendingDeepLink(): CueDeepLinkPayload | null {
  if (!pendingUrl) return null;
  const intent = parseCueDeepLink(pendingUrl);
  pendingUrl = null;
  if (!intent || intent.kind !== 'session.open') return null;
  return { filePath: intent.filePath, source: intent.source };
}

function dispatch(url: string): void {
  const intent = parseCueDeepLink(url);
  if (!intent) return;

  // For the existing «session.open» path we keep the dedicated channel
  // (renderer already subscribes via cue:openSession). New intent kinds
  // route through dispatchExtended for forward compatibility.
  if (intent.kind === 'session.open') {
    if (cachedTargetWindow && !cachedTargetWindow.isDestroyed()) {
      cachedTargetWindow.webContents.send(CUE_OPEN_CHANNEL, {
        filePath: intent.filePath,
        source: intent.source,
      });
      if (cachedTargetWindow.isMinimized()) cachedTargetWindow.restore();
      cachedTargetWindow.focus();
    } else {
      pendingUrl = url;
    }
    return;
  }
  // X5 forward-compat: session.start / transcript.open kinds. These don't
  // have dedicated channels yet — we drop them silently with a debug log
  // until the renderer hosts the relevant surfaces. Don't break existing
  // installs.
  if (cachedTargetWindow && !cachedTargetWindow.isDestroyed()) {
    if (cachedTargetWindow.isMinimized()) cachedTargetWindow.restore();
    cachedTargetWindow.focus();
  }
}

/**
 * Pure URL → typed Intent. Single source of truth for the Cue deeplink
 * grammar. Returns null for non-druz9-cue:// inputs or malformed payloads.
 */
export function parseCueDeepLink(raw: string): CueDeepLinkIntent | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== `${PROTOCOL}:`) return null;
    const host = u.host.toLowerCase();
    const source = u.searchParams.get('source') ?? undefined;

    // Existing — `druz9-cue://open?file=...`
    if (host === 'open') {
      const file = u.searchParams.get('file');
      if (!file) return null;
      return { kind: 'session.open', filePath: file, source };
    }

    // X5 — `druz9-cue://session.start?company=&persona=`
    if (host === 'session.start' || host === 'start') {
      return {
        kind: 'session.start',
        company: u.searchParams.get('company') ?? undefined,
        persona: u.searchParams.get('persona') ?? undefined,
        source,
      };
    }

    // X5 — `druz9-cue://transcript.open?id=<session-id>`
    if (host === 'transcript.open' || host === 'transcript') {
      const id = u.searchParams.get('id') ?? u.searchParams.get('session');
      if (!id) return null;
      return { kind: 'transcript.open', sessionId: id, source };
    }
    return null;
  } catch {
    return null;
  }
}
