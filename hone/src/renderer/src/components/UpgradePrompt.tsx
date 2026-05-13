// UpgradePrompt — global modal которая показывается при попадании юзером
// в quota limit. Источник message — `useQuotaStore.upgradePromptMessage`.
//
// Триггеры (calls в коде):
//   - Notes handleCreate ловит 402 от backend → showUpgradePrompt('note quota')
//   - Boards/Rooms create аналогично
//   - При попытке cross-device sync на free tier (Settings)
//
// UX: blocking modal с двумя actions — Upgrade (открывает /pricing в default

import { useCallback, useState } from 'react';

import { useQuotaStore } from '../stores/quota';
import { Modal } from './primitives/Modal';
import { motion as motionTokens } from '../lib/design-tokens';

export function UpgradePrompt() {
  const message = useQuotaStore((s) => s.upgradePromptMessage);
  const tier = useQuotaStore((s) => s.tier);
  const dismiss = useQuotaStore((s) => s.dismissUpgradePrompt);
  const [open, setOpen] = useState(true);

  // Smooth exit: flip open → Modal exit anim → store dismiss.
  const close = useCallback(() => {
    setOpen(false);
    window.setTimeout(dismiss, motionTokens.dur.medium);
  }, [dismiss]);

  if (!message) return null;

  return (
    <Modal open={open} onClose={close} size="sm">
      <div
        className="mono"
        style={{
          position: 'relative',
          fontSize: 10,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'var(--ink-40)',
          marginBottom: 10,
          paddingLeft: 12,
        }}
      >
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: 0,
            top: 2,
            bottom: 2,
            width: 1.5,
            background: 'var(--red)',
          }}
        />
        {tier === 'free' ? 'Free tier limit' : 'Quota exceeded'}
      </div>
      <h2
        style={{
          margin: 0,
          fontSize: 20,
          fontWeight: 500,
          letterSpacing: '-0.01em',
          color: 'var(--ink)',
          lineHeight: 1.3,
          marginBottom: 12,
        }}
      >
        Time to upgrade
      </h2>
      <p
        style={{
          margin: 0,
          fontSize: 13.5,
          color: 'var(--ink-60)',
          lineHeight: 1.6,
          marginBottom: 22,
        }}
      >
        {message}
      </p>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <button
          onClick={close}
          style={{
            padding: '9px 16px',
            borderRadius: 8,
            background: 'transparent',
            border: '1px solid var(--hair-2)',
            color: 'var(--ink-60)',
            fontSize: 13,
            cursor: 'pointer',
            transition:
              'background-color var(--motion-dur-small) var(--motion-ease-standard), color var(--motion-dur-small) var(--motion-ease-standard)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--hair)';
            e.currentTarget.style.color = 'var(--ink)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.color = 'var(--ink-60)';
          }}
        >
          Not now
        </button>
        <button
          onClick={() => {
            const url = 'https://druz9.online/pricing';
            const bridge = typeof window !== 'undefined' ? window.hone : undefined;
            if (bridge) void bridge.shell.openExternal(url);
            else window.open(url, '_blank');
            close();
          }}
          style={{
            padding: '9px 18px',
            borderRadius: 8,
            background: 'var(--ink)',
            color: 'var(--bg)',
            border: 'none',
            fontSize: 13,
            fontWeight: 500,
            cursor: 'pointer',
            transition:
              'transform var(--motion-dur-small) var(--motion-ease-standard)',
          }}
        >
          View plans →
        </button>
      </div>
    </Modal>
  );
}
