// Defensive hardening applied to every BrowserWindow we create.
//
// Goals:
//   1. window.open() from a renderer NEVER spawns an in-app popup —
//      route http(s) URLs to the OS browser, drop everything else.
//      An in-app popup would show up in screen captures, defeating
//      stealth for a moment.
//   2. Renderer is never navigated away from its vite origin — a stray
//      <a href> click would replace our UI wholesale.
//   3. webview / embedding / permission requests are all denied.
//
// Call `hardenWindow(win)` right after creating a BrowserWindow.

import { shell, type BrowserWindow } from 'electron';
import { URL } from 'node:url';

const RENDERER_ALLOWED_PROTOCOLS = new Set(['file:', 'http:', 'https:']);

export function hardenWindow(win: BrowserWindow): void {
  const wc = win.webContents;

  // 1. window.open handler.
  wc.setWindowOpenHandler(({ url }) => {
    if (isHttpUrl(url)) {
      void shell.openExternal(url);
    }
    // http → browser, everything else → silently dropped. No new
    // Electron window is ever spawned.
    return { action: 'deny' };
  });

  // 2. Navigation lock. Hash-route changes (#/compact → #/expanded)
  //    fire 'will-navigate' too — we allow anything that keeps the
  //    origin and protocol of the current URL. External links go to
  //    the OS browser instead.
  wc.on('will-navigate', (event, url) => {
    const target = safeParse(url);
    const current = safeParse(wc.getURL());
    if (!target || !current) {
      event.preventDefault();
      return;
    }
    if (!RENDERER_ALLOWED_PROTOCOLS.has(target.protocol)) {
      event.preventDefault();
      return;
    }
    if (target.origin !== current.origin) {
      event.preventDefault();
      if (isHttpUrl(url)) void shell.openExternal(url);
    }
    // Same-origin navigation (hash/path change inside our bundle) — allow.
  });

  // 3. No webviews. Their creation event is the canonical extension
  //    surface and we deliberately opt out.
  wc.on('will-attach-webview', (event) => {
    event.preventDefault();
  });

  // 4. Permission requests default-deny. We ask only for the perms
  //    we explicitly need (microphone for voice input) via
  //    systemPreferences directly.
  wc.session.setPermissionRequestHandler((_contents, _permission, callback) => {
    callback(false);
  });
}

function isHttpUrl(raw: string): boolean {
  const u = safeParse(raw);
  return u?.protocol === 'http:' || u?.protocol === 'https:';
}

function safeParse(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}
