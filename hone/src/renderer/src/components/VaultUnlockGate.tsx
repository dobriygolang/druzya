// VaultUnlockGate — gate-component: при mount'е проверяет состояние vault'а,
// и если требуется (vault уже инициализирован server-side, но локально
// derivedKey не unlocked) — показывает passphrase prompt. После unlock'а
// рендерит children. Если vault ещё не initialised — show «Set up vault»
// flow с двумя prompt'ами (set + confirm passphrase).
//
// Используется как обёртка вокруг Notes (в App.tsx) — по политике пользователя
// notes по дефолту E2E-encrypted, поэтому без unlocked vault'а notes
// бесполезны.
//
// Архитектура крипто:
//   - Salt — server-side в vault_metadata.user_salt (per-user). Init создаёт
//     random salt, encrypts тестовый-block (ниже) для проверки future
//     unlock'ов.
//   - PBKDF2-SHA256 200k iter (см. api/vault.ts) → AES-256-GCM key.
//   - Key cached в module memory (не в localStorage) — при перезагрузке
//     приложения требуется повторный ввод. Это intended для secrecy: даже
//     если у злоумышленника физический доступ к ноуту с running'ed app,
//     после lock he нужен passphrase снова.

import { useEffect, useState } from 'react';

import { fetchSalt, initVault, isUnlocked, unlockVault, subscribe } from '../api/vault';

interface VaultUnlockGateProps {
  /** Children рендерятся ТОЛЬКО когда vault unlocked. */
  children: React.ReactNode;
}

type GateState =
  | { kind: 'loading' }
  | { kind: 'unlocked' }
  | { kind: 'needs-init' } // server salt пустой, нужен first-time setup
  | { kind: 'needs-unlock' }; // salt есть, нужен ввод passphrase

export function VaultUnlockGate({ children }: VaultUnlockGateProps) {
  const [state, setState] = useState<GateState>({ kind: 'loading' });
  const [error, setError] = useState<string | null>(null);
  const [pwd1, setPwd1] = useState('');
  const [pwd2, setPwd2] = useState('');
  const [busy, setBusy] = useState(false);

  // Initial probe: есть ли salt server-side. Если есть И в OS keychain'е
  // сохранена passphrase (Electron safeStorage) — auto-unlock'аем
  // незаметно для юзера (как auth-сессия). Это убирает «вводить пароль на
  // каждом запуске» — раз ввёл, дальше TouchID/DPAPI делает за тебя.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        if (isUnlocked()) {
          if (!cancelled) setState({ kind: 'unlocked' });
          return;
        }
        const salt = await fetchSalt();
        if (cancelled) return;
        if (salt === null) {
          setState({ kind: 'needs-init' });
          return;
        }
        // Try silent unlock через OS keychain.
        const bridge = typeof window !== 'undefined' ? window.hone : undefined;
        if (bridge?.vault) {
          try {
            const saved = await bridge.vault.passLoad();
            if (!cancelled && saved) {
              await unlockVault(saved);
              if (!cancelled) setState({ kind: 'unlocked' });
              return;
            }
          } catch {
            // Saved passphrase больше не работает (vault был re-init или
            // OS keychain поменялся) — clear и попросить ручной ввод.
            try {
              await bridge.vault.passClear();
            } catch {
              /* ignore */
            }
          }
        }
        if (!cancelled) setState({ kind: 'needs-unlock' });
      } catch (e) {
        if (cancelled) return;
        setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Подписываемся на vault subscribe — если другой component сделает
  // unlock/lock, обновим UI.
  useEffect(() => {
    const unsub = subscribe((u) => {
      setState(u ? { kind: 'unlocked' } : { kind: 'needs-unlock' });
    });
    return unsub;
  }, []);

  if (state.kind === 'loading') {
    return <CenterMsg text="Loading vault…" />;
  }
  if (state.kind === 'unlocked') {
    return <>{children}</>;
  }

  // persistPassphraseSilently — сохраняет в OS keychain через preload bridge.
  // Ошибки swallow'аем — degraded UX (юзер введёт passphrase в следующий
  // раз) лучше fail-loud.
  const persistPassphraseSilently = async (pass: string) => {
    const bridge = typeof window !== 'undefined' ? window.hone : undefined;
    if (!bridge?.vault) return;
    try {
      await bridge.vault.passSave(pass);
    } catch {
      /* ignore */
    }
  };

  const handleSetup = async () => {
    setError(null);
    if (pwd1.length < 8) {
      setError('Passphrase must be at least 8 characters.');
      return;
    }
    if (pwd1 !== pwd2) {
      setError('Passphrases do not match.');
      return;
    }
    setBusy(true);
    try {
      await initVault();
      await unlockVault(pwd1);
      await persistPassphraseSilently(pwd1);
      setState({ kind: 'unlocked' });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleUnlock = async () => {
    setError(null);
    if (!pwd1) {
      setError('Enter your passphrase.');
      return;
    }
    setBusy(true);
    try {
      await unlockVault(pwd1);
      await persistPassphraseSilently(pwd1);
      setState({ kind: 'unlocked' });
    } catch (e) {
      setError(`Wrong passphrase or vault corrupted: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  // Generate — random 24-char base32-ish passphrase. base32 alphabet выбран
  // потому что entropy высокая (5 бит/char × 24 = 120 бит), но он human-
  // friendly: нет похожих 0/O, 1/l/I, юзер может прочитать вслух / записать
  // на бумажку. Strength: equivalent примерно AES-128 (резерв запасной).
  const handleGenerate = () => {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 символа без 0/O/1/l/I
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    let out = '';
    for (let i = 0; i < bytes.length; i++) {
      out += alphabet[bytes[i]! % alphabet.length];
      if (i % 4 === 3 && i < bytes.length - 1) out += '-';
    }
    setPwd1(out);
    setPwd2(out);
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
        gap: 16,
        padding: 32,
        background: '#000',
        animationDuration: '160ms',
      }}
    >
      <div
        className="mono"
        style={{
          fontSize: 10,
          letterSpacing: '0.2em',
          color: 'var(--ink-40)',
          textTransform: 'uppercase',
        }}
      >
        Vault {state.kind === 'needs-init' ? '· first-time setup' : '· locked'}
      </div>
      <h1
        style={{
          margin: 0,
          fontSize: 28,
          fontWeight: 500,
          letterSpacing: '-0.02em',
          color: 'var(--ink)',
          textAlign: 'center',
        }}
      >
        {state.kind === 'needs-init' ? 'Set a vault passphrase' : 'Unlock your vault'}
      </h1>
      <p
        style={{
          margin: 0,
          fontSize: 13.5,
          color: 'var(--ink-60)',
          maxWidth: 440,
          textAlign: 'center',
          lineHeight: 1.6,
        }}
      >
        {state.kind === 'needs-init' ? (
          <>
            Hone encrypts your notes locally with AES-256-GCM. The key is derived
            from your passphrase via PBKDF2-SHA256 (200k iterations) and never
            leaves this device. <strong>If you lose this passphrase, your notes
            cannot be recovered.</strong>
          </>
        ) : (
          <>Enter your passphrase to decrypt your notes for this session.</>
        )}
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (state.kind === 'needs-init') void handleSetup();
          else void handleUnlock();
        }}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          width: '100%',
          maxWidth: 360,
          marginTop: 6,
        }}
      >
        <input
          type="password"
          autoFocus
          value={pwd1}
          onChange={(e) => setPwd1(e.target.value)}
          placeholder="Passphrase"
          disabled={busy}
          style={{
            padding: '12px 14px',
            fontSize: 14,
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 8,
            color: 'var(--ink)',
            outline: 'none',
            fontFamily: 'var(--font-mono, monospace)',
          }}
        />
        {state.kind === 'needs-init' && (
          <>
            <input
              type="password"
              value={pwd2}
              onChange={(e) => setPwd2(e.target.value)}
              placeholder="Confirm passphrase"
              disabled={busy}
              style={{
                padding: '12px 14px',
                fontSize: 14,
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 8,
                color: 'var(--ink)',
                outline: 'none',
                fontFamily: 'var(--font-mono, monospace)',
              }}
            />
            <button
              type="button"
              onClick={handleGenerate}
              disabled={busy}
              style={{
                alignSelf: 'flex-start',
                padding: '6px 12px',
                fontSize: 11,
                letterSpacing: '0.08em',
                color: 'var(--ink-60)',
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 6,
                cursor: busy ? 'default' : 'pointer',
                fontFamily: 'var(--font-mono, monospace)',
                transition: 'color 140ms ease, background-color 140ms ease',
              }}
              onMouseEnter={(e) => {
                if (busy) return;
                e.currentTarget.style.color = 'var(--ink)';
                e.currentTarget.style.background = 'rgba(255,255,255,0.08)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = 'var(--ink-60)';
                e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
              }}
            >
              ⚡ Generate strong passphrase
            </button>
            {pwd1.length > 0 && pwd1 === pwd2 && (
              <div
                className="mono"
                style={{
                  fontSize: 10,
                  letterSpacing: '0.06em',
                  color: 'var(--ink-40)',
                  padding: '4px 0',
                  wordBreak: 'break-all',
                  textAlign: 'center',
                }}
              >
                {pwd1}
                <div style={{ marginTop: 4, color: '#ff6a6a', fontSize: 9 }}>
                  ⚠ Save this somewhere safe (password manager).
                  If lost, your notes cannot be recovered.
                </div>
              </div>
            )}
          </>
        )}
        {error && (
          <div
            className="mono"
            style={{ fontSize: 11, color: '#ff6a6a', letterSpacing: '0.06em', textAlign: 'center' }}
          >
            {error}
          </div>
        )}
        <button
          type="submit"
          disabled={busy}
          style={{
            padding: '11px 20px',
            borderRadius: 999,
            background: busy ? 'rgba(255,255,255,0.1)' : '#fff',
            color: busy ? 'rgba(255,255,255,0.4)' : '#000',
            border: 'none',
            cursor: busy ? 'default' : 'pointer',
            fontSize: 13.5,
            fontWeight: 500,
            transition: 'background-color 160ms ease, color 160ms ease',
          }}
        >
          {busy
            ? 'Working…'
            : state.kind === 'needs-init'
              ? 'Create vault'
              : 'Unlock'}
        </button>
      </form>
      <div
        className="mono"
        style={{
          fontSize: 9,
          letterSpacing: '0.16em',
          color: 'var(--ink-40)',
          textTransform: 'uppercase',
          marginTop: 14,
        }}
      >
        E2E encrypted · key never leaves device
      </div>
    </div>
  );
}

function CenterMsg({ text }: { text: string }) {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--ink-40)',
        fontSize: 12,
        letterSpacing: '0.18em',
        textTransform: 'uppercase',
        fontFamily: 'var(--font-mono, monospace)',
      }}
    >
      {text}
    </div>
  );
}
