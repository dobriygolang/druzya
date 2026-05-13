import { VaultButton } from './VaultButton';

// VaultPasswordForm — inline replacement для window.prompt() который
// в Electron renderer не работает (Chromium блокирует JS-prompt). Mode:
// 'setup' рендерит два поля + warning, 'unlock' — одно поле.
export function VaultPasswordForm({
  mode,
  pwd1,
  pwd2,
  onPwd1Change,
  onPwd2Change,
  onSubmit,
  onCancel,
  busy,
}: {
  mode: 'setup' | 'unlock';
  pwd1: string;
  pwd2: string;
  onPwd1Change: (v: string) => void;
  onPwd2Change: (v: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  busy: boolean;
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        padding: 14,
        borderRadius: 10,
        background: 'rgba(255,255,255,0.02)',
        border: '1px solid var(--ink-10)',
      }}
    >
      {mode === 'setup' && (
        <div style={{ fontSize: 12, color: 'var(--ink-60)', lineHeight: 1.55, marginBottom: 4 }}>
          Choose a Vault password (min 8 chars). <strong style={{ color: 'var(--red)' }}>No recovery</strong>{' '}
          — if you forget it, all encrypted notes are permanently lost.
        </div>
      )}
      <input
        type="password"
        value={pwd1}
        onChange={(e) => onPwd1Change(e.target.value)}
        placeholder={mode === 'setup' ? 'New password' : 'Vault password'}
        autoFocus
        autoComplete={mode === 'setup' ? 'new-password' : 'current-password'}
        style={{
          padding: '8px 12px',
          fontSize: 13,
          borderRadius: 8,
          border: '1px solid var(--ink-10)',
          background: 'rgba(255,255,255,0.03)',
          color: 'var(--ink)',
          outline: 'none',
        }}
      />
      {mode === 'setup' && (
        <input
          type="password"
          value={pwd2}
          onChange={(e) => onPwd2Change(e.target.value)}
          placeholder="Confirm password"
          autoComplete="new-password"
          style={{
            padding: '8px 12px',
            fontSize: 13,
            borderRadius: 8,
            border: '1px solid var(--ink-10)',
            background: 'rgba(255,255,255,0.03)',
            color: 'var(--ink)',
            outline: 'none',
          }}
        />
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
        <VaultButton onClick={onSubmit} disabled={busy} primary>
          {busy ? '…' : mode === 'setup' ? 'Set up' : 'Unlock'}
        </VaultButton>
        <VaultButton onClick={onCancel} disabled={busy}>
          Cancel
        </VaultButton>
      </div>
    </form>
  );
}
