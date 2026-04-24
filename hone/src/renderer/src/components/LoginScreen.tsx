// LoginScreen — показывается когда session.status === 'guest'.
//
// «Sign in» open'ит druz9.ru/login с return-URL desktop'а. Web после
// успешного OAuth callback'а редиректит на druz9://auth?token=...&refresh=
// ...&user=... — main-process ловит, persist'ит в keychain, шлёт
// authChanged → renderer hydrate'ает store, App'у переключается в
// signed_in.
//
// Дефолтный URL druz9.ru конфигурируем через VITE_DRUZ9_WEB_BASE — в
// dev/staging это может быть localhost:5173.
import { useState } from 'react';

import { Wordmark } from './Chrome';

const WEB_BASE =
  ((import.meta.env.VITE_DRUZ9_WEB_BASE as string | undefined) ?? '').trim() ||
  'https://druz9.ru';

const RETURN_URL = 'druz9://auth';

function loginURL(): string {
  // Отдельная страница на web'е (LoginPage с desktop=...) — она
  // прокидывает return через OAuth state, и callback редиректит на
  // RETURN_URL после persist'а.
  const u = new URL('/login', WEB_BASE);
  u.searchParams.set('desktop', RETURN_URL);
  return u.toString();
}

export function LoginScreen() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onClick = async () => {
    setBusy(true);
    setError(null);
    try {
      // Используем bridge.shell вместо window.open — последний
      // в Electron sandbox создаёт лишний BrowserWindow, нам нужен
      // именно браузер хоста для OAuth-flow.
      const bridge = window.hone;
      if (!bridge) {
        // Dev/browser smoke-test fallback.
        window.open(loginURL(), '_blank');
      } else {
        await bridge.shell.openExternal(loginURL());
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fadein"
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#000',
      }}
    >
      <Wordmark />
      <div style={{ maxWidth: 380, textAlign: 'center', padding: '0 32px' }}>
        <div
          className="mono"
          style={{ fontSize: 10, letterSpacing: '.24em', color: 'var(--ink-40)' }}
        >
          QUIET COCKPIT FOR DEVELOPERS
        </div>
        <h1
          style={{
            margin: '20px 0 8px',
            fontSize: 36,
            fontWeight: 400,
            letterSpacing: '-0.025em',
            lineHeight: 1.05,
          }}
        >
          Sign in to start.
        </h1>
        <p
          style={{
            fontSize: 14,
            color: 'var(--ink-60)',
            marginTop: 12,
            lineHeight: 1.6,
          }}
        >
          Hone uses your druz9 account. Login opens in your browser; come
          back here when it’s done.
        </p>

        <button
          onClick={onClick}
          disabled={busy}
          className="focus-ring"
          style={{
            marginTop: 32,
            padding: '11px 24px',
            borderRadius: 999,
            background: busy ? 'rgba(255,255,255,0.08)' : '#fff',
            color: busy ? 'var(--ink-60)' : '#000',
            fontSize: 13,
            fontWeight: 500,
          }}
        >
          {busy ? 'Opening browser…' : 'Sign in with druz9'}
        </button>

        {error && (
          <p
            className="mono"
            style={{ marginTop: 16, fontSize: 11, color: 'var(--ink-40)' }}
          >
            {error}
          </p>
        )}
      </div>

      <div
        className="mono"
        style={{
          position: 'absolute',
          bottom: 32,
          fontSize: 10,
          color: 'var(--ink-40)',
          letterSpacing: '.18em',
        }}
      >
        WAITING FOR druz9://auth …
      </div>
    </div>
  );
}
