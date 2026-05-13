import { useEffect, useState } from 'react';

import {
  initVault,
  unlockVault,
  lockVault,
  isUnlocked,
  subscribe as subscribeVault,
  fetchSalt,
} from '../../../api/vault';
import { LockIcon, LockGlyph } from '../vault/LockIcon';
import { VaultButton, VaultStatusBadge } from '../vault/VaultButton';
import { VaultPasswordForm } from '../vault/VaultPasswordForm';

// VaultSection — Private Vault status + setup / unlock / lock controls.
// Three states:
//   1. Not initialised: «Set up Vault» button → POST /vault/init + prompt
//      password → unlockVault() → store key in memory.
//   2. Initialised + locked: «Unlock» button → password prompt →
//      unlockVault() (re-derive same key from same salt).
//   3. Initialised + unlocked: «Lock now» button + status badge.
export function VaultSection() {
  // 'unknown' пока не определили (initial fetchSalt), 'none' = не initialised,
  // 'locked' = initialised но not unlocked, 'unlocked' = ready.
  const [state, setState] = useState<'unknown' | 'none' | 'locked' | 'unlocked'>('unknown');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Inline password inputs. window.prompt() в Electron renderer ВОЗВРАЩАЕТ
  // NULL без показа диалога (Chromium блокирует prompt по дефолту в Electron),
  // поэтому раньше клик Unlock молча ничего не делал. Используем inline form.
  const [pwd1, setPwd1] = useState('');
  const [pwd2, setPwd2] = useState('');
  const [showSetupForm, setShowSetupForm] = useState(false);
  const [showUnlockForm, setShowUnlockForm] = useState(false);

  // Sync with vault module state on subscribe.
  useEffect(() => {
    const refresh = async () => {
      if (isUnlocked()) {
        setState('unlocked');
        return;
      }
      try {
        const salt = await fetchSalt();
        setState(salt ? 'locked' : 'none');
      } catch {
        setState('locked'); // network blip — assume initialised
      }
    };
    void refresh();
    return subscribeVault((unlocked) => {
      if (unlocked) setState('unlocked');
      else void refresh();
    });
  }, []);

  // persistPassphraseSilently — сохраняем passphrase в OS keychain через
  // preload bridge. Безопасный no-op если safeStorage недоступен (Linux
  // без gnome-keyring) — юзер просто введёт passphrase следующий раз.
  const persistPassphraseSilently = async (pass: string) => {
    const bridge = typeof window !== 'undefined' ? window.hone : undefined;
    if (!bridge?.vault) return;
    try {
      await bridge.vault.passSave(pass);
    } catch {
      /* ignore */
    }
  };

  const resetForms = () => {
    setPwd1('');
    setPwd2('');
    setShowSetupForm(false);
    setShowUnlockForm(false);
    setError(null);
  };

  const onSetUp = async () => {
    setError(null);
    if (pwd1.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    if (pwd1 !== pwd2) {
      setError('Passwords do not match');
      return;
    }
    setBusy(true);
    try {
      await initVault();
      await unlockVault(pwd1);
      await persistPassphraseSilently(pwd1);
      resetForms();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onUnlock = async () => {
    setError(null);
    if (!pwd1) {
      setError('Enter your Vault password');
      return;
    }
    setBusy(true);
    try {
      await unlockVault(pwd1);
      // КРИТИЧНО: persist в Keychain ПОСЛЕ unlock — иначе следующий restart
      // снова попросит password (раньше Settings-flow не сохранял; только
      // VaultUnlockGate-flow сохранял).
      await persistPassphraseSilently(pwd1);
      resetForms();
    } catch (e) {
      setError(`Wrong password or vault corrupted: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const onLock = () => {
    lockVault();
    // Очищаем сохранённый passphrase из keychain — иначе при следующем
    // launch'е VaultUnlockGate auto-unlock'нет и юзер не сможет «оставаться
    // locked». Юзер явно сказал Lock — уважаем намерение.
    const bridge = typeof window !== 'undefined' ? window.hone : undefined;
    if (bridge?.vault) {
      void bridge.vault.passClear().catch(() => {
        /* ignore */
      });
    }
  };

  if (state === 'unknown') {
    return <div style={{ fontSize: 13, color: 'var(--ink-40)' }}>Loading…</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Большой объясняющий блок — что такое vault и зачем lock-icon
          в Notes. Юзер не должен идти в документацию чтобы понять. */}
      <div
        style={{
          display: 'flex',
          gap: 14,
          padding: '14px 16px',
          borderRadius: 12,
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid var(--ink-10)',
        }}
      >
        <div
          style={{
            width: 36,
            height: 36,
            flexShrink: 0,
            display: 'grid',
            placeItems: 'center',
            borderRadius: 10,
            background: 'rgba(255,255,255,0.04)',
            color: 'var(--ink-60)',
          }}
        >
          <LockIcon size={18} />
        </div>
        <div style={{ flex: 1, fontSize: 13, color: 'var(--ink-90)', lineHeight: 1.55 }}>
          <div style={{ marginBottom: 4, color: 'var(--ink)' }}>
            How encryption works
          </div>
          <div style={{ color: 'var(--ink-60)' }}>
            Once Vault is set up, every note in the sidebar gets a small{' '}
            <LockGlyph /> icon next to its three-dots menu. Click it on a sensitive
            note to encrypt the body before it reaches our servers. Encrypted notes
            stay readable to you on any of your devices (when Vault is unlocked),
            but invisible to coach AI, search, and publish-to-web.
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <VaultStatusBadge state={state} />
        {state === 'none' && !showSetupForm && (
          <VaultButton onClick={() => setShowSetupForm(true)} disabled={busy} primary>
            Set up Vault
          </VaultButton>
        )}
        {state === 'locked' && !showUnlockForm && (
          <VaultButton onClick={() => setShowUnlockForm(true)} disabled={busy} primary>
            Unlock
          </VaultButton>
        )}
        {state === 'unlocked' && (
          <VaultButton onClick={onLock} disabled={busy}>
            Lock now
          </VaultButton>
        )}
      </div>

      {/* Inline setup form — replaces window.prompt (broken in Electron).
          Two password fields: confirm + visible/hidden via type=password. */}
      {state === 'none' && showSetupForm && (
        <VaultPasswordForm
          mode="setup"
          pwd1={pwd1}
          pwd2={pwd2}
          onPwd1Change={setPwd1}
          onPwd2Change={setPwd2}
          onSubmit={onSetUp}
          onCancel={resetForms}
          busy={busy}
        />
      )}
      {state === 'locked' && showUnlockForm && (
        <VaultPasswordForm
          mode="unlock"
          pwd1={pwd1}
          pwd2=""
          onPwd1Change={setPwd1}
          onPwd2Change={() => undefined}
          onSubmit={onUnlock}
          onCancel={resetForms}
          busy={busy}
        />
      )}
      {error ? (
        <div style={{ fontSize: 12.5, color: 'var(--red)' }}>{error}</div>
      ) : (
        <div style={{ fontSize: 12, color: 'var(--ink-40)', lineHeight: 1.55 }}>
          {state === 'none' &&
            'After setup, lock icons appear next to each note in the sidebar.'}
          {state === 'locked' &&
            'Vault is set up. Unlock with your password to read or encrypt notes.'}
          {state === 'unlocked' &&
            'Vault unlocked for this session. Auto-locks on close, sign-out, or app reload.'}
        </div>
      )}
    </div>
  );
}
