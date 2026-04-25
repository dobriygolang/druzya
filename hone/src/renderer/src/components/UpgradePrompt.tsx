// UpgradePrompt — global modal которая показывается при попадании юзером
// в quota limit. Источник message — `useQuotaStore.upgradePromptMessage`.
//
// Триггеры (calls в коде):
//   - Notes handleCreate ловит 402 от backend → showUpgradePrompt('note quota')
//   - Boards/Rooms create аналогично
//   - При попытке cross-device sync на free tier (Settings)
//
// UX: blocking modal с двумя actions — Upgrade (пока stub'нём на /pricing
// URL когда страница появится) и Dismiss. Стиль — winter palette,
// fadein animation.

import { useEffect } from 'react';

import { useQuotaStore } from '../stores/quota';

export function UpgradePrompt() {
  const message = useQuotaStore((s) => s.upgradePromptMessage);
  const tier = useQuotaStore((s) => s.tier);
  const dismiss = useQuotaStore((s) => s.dismissUpgradePrompt);

  // Esc closes.
  useEffect(() => {
    if (!message) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [message, dismiss]);

  if (!message) return null;

  return (
    <div
      className="fadein"
      onClick={dismiss}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        backdropFilter: 'blur(6px)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 32,
        animationDuration: '160ms',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: 480,
          width: '100%',
          padding: '28px 30px',
          background: 'rgba(20,20,22,0.96)',
          backdropFilter: 'blur(18px)',
          border: '1px solid rgba(255,255,255,0.08)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
          borderRadius: 14,
          color: 'var(--ink)',
          fontFamily: 'Inter, system-ui, sans-serif',
        }}
      >
        <div
          className="mono"
          style={{
            fontSize: 10,
            letterSpacing: '0.2em',
            textTransform: 'uppercase',
            color: 'var(--ink-40)',
            marginBottom: 10,
          }}
        >
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
            onClick={dismiss}
            style={{
              padding: '9px 16px',
              borderRadius: 8,
              background: 'transparent',
              border: '1px solid rgba(255,255,255,0.1)',
              color: 'var(--ink-60)',
              fontSize: 13,
              cursor: 'pointer',
              transition: 'background-color 140ms ease, color 140ms ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
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
              dismiss();
            }}
            style={{
              padding: '9px 18px',
              borderRadius: 8,
              background: '#fff',
              color: '#000',
              border: 'none',
              fontSize: 13,
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            View plans →
          </button>
        </div>
      </div>
    </div>
  );
}
