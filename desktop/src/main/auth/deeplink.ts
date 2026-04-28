// druz9:// deep-link handling for Cue desktop.
//
// Use case: Hone (note-taking companion) shows a "Start Cue" button on
// imported meeting notes. Click → it opens `druz9://cue/open?file=<path>`
// which OS routes back here. We surface the path to the renderer so it
// jumps directly to that session in the local sessions list.
//
// Protocol scheme registration is the OS-level handshake: Cue tells the
// OS "I own druz9://" so any app launching `open druz9://...` lands in
// our open-url handler. Done at app startup, idempotent.
//
// The renderer subscribes to the `cue:openSession` channel — see
// desktop/src/preload/index.ts for the contextBridge that exposes it.

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

let cachedTargetWindow: BrowserWindow | null = null;
// Pending URL queued during cold-start before the renderer is ready.
let pendingUrl: string | null = null;

export interface CueDeepLinkPayload {
  filePath: string;
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
  const parsed = parseCueOpenURL(pendingUrl);
  pendingUrl = null;
  return parsed;
}

function dispatch(url: string): void {
  // Only handle cue/open today; other paths reserved for future flows
  // (cue/share, cue/settings, etc).
  const payload = parseCueOpenURL(url);
  if (!payload) return;

  if (cachedTargetWindow && !cachedTargetWindow.isDestroyed()) {
    cachedTargetWindow.webContents.send(CUE_OPEN_CHANNEL, payload);
    if (cachedTargetWindow.isMinimized()) cachedTargetWindow.restore();
    cachedTargetWindow.focus();
  } else {
    pendingUrl = url;
  }
}

/**
 * Parse `druz9-cue://open?file=<encoded-abs-path>`.
 * Anything else returns null — caller should fall through silently.
 */
function parseCueOpenURL(raw: string): CueDeepLinkPayload | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== `${PROTOCOL}:`) return null;
    // Для druz9-cue://open?file=... URL парсится как host="open", path="".
    // (До разделения схем было host="cue", path="/open" в "druz9://cue/open" —
    // см. git blame, оставлено в комменте для traceability.)
    if (u.host !== 'open') return null;
    const file = u.searchParams.get('file');
    if (!file) return null;
    return { filePath: file };
  } catch {
    return null;
  }
}
