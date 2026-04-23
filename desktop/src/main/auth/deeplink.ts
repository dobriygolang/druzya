// druz9:// URL scheme handler. Telegram login widget redirects the browser
// to druz9://auth/telegram?access_token=...&refresh_token=...&user_id=...
// &expires_at=...; macOS hands that URL to the running Electron instance
// (or launches it if cold) and we feed it back through this parser.

import { app, BrowserWindow } from 'electron';

import { saveSession, type StoredSession } from './keychain';

const SCHEME = 'druz9';

export type DeepLinkListener = (session: StoredSession) => void;

let listener: DeepLinkListener | null = null;

/** Registers the protocol and begins listening for login callbacks. */
export function registerDeepLinks(onLogin: DeepLinkListener): void {
  listener = onLogin;

  // Register as the default handler for druz9://.
  if (process.defaultApp) {
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient(SCHEME, process.execPath, [process.argv[1]!]);
    }
  } else {
    app.setAsDefaultProtocolClient(SCHEME);
  }

  app.on('open-url', (event, url) => {
    event.preventDefault();
    void handleCallbackURL(url);
  });

  // Windows/Linux: protocol URLs arrive via second-instance arguments.
  app.on('second-instance', (_event, argv) => {
    const url = argv.find((a) => a.startsWith(`${SCHEME}://`));
    if (url) {
      void handleCallbackURL(url);
    }
    // Foreground whatever window is open so the user sees the result.
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
}

async function handleCallbackURL(rawURL: string): Promise<void> {
  const parsed = safeParseURL(rawURL);
  if (!parsed) return;
  if (parsed.host !== 'auth' || !parsed.pathname.startsWith('/telegram')) return;

  const accessToken = parsed.searchParams.get('access_token');
  const refreshToken = parsed.searchParams.get('refresh_token');
  const userId = parsed.searchParams.get('user_id');
  const expiresAt = parsed.searchParams.get('expires_at');
  if (!accessToken || !refreshToken || !userId || !expiresAt) return;

  const session: StoredSession = { accessToken, refreshToken, userId, expiresAt };
  await saveSession(session);
  listener?.(session);
}

function safeParseURL(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}
