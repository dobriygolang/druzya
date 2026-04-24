// Paywall modal. Rendered over any window (compact, expanded, settings).
// Opens in two situations:
//   1. The streaming pipeline returned a 'rate_limited' error — we
//      auto-open over the active window so the user sees the
//      alternative immediately.
//   2. The user clicks "Upgrade" in Settings → General.
//
// Copy, pricing and the subscribe URL are ALL server-driven via
// DesktopConfig.Paywall — the client hardcodes nothing. This keeps
// legal/marketing edits to a backend config flip.
//
// Current payment rail: Boosty. The CTA button does
// `shell.openExternal(subscribeUrl)` so the user completes the purchase
// in their browser; the backend's Boosty webhook (see
// docs/copilot-boosty-integration.md) flips their plan row and the
// client's next GetQuota reflects the new state.

import { useEffect, useState } from 'react';

import type { PaywallCopy, Quota } from '@shared/types';

import { IconCheck, IconClose, IconSparkles } from './icons';
import { Button } from './primitives';

export interface PaywallModalProps {
  copy: PaywallCopy[];
  currentPlan: Quota['plan'] | '';
  /** Optional explanation header — e.g. "You've used all 20 free requests today." */
  reason?: string;
  /** Called when the user finishes the Boosty flow or just dismisses. */
  onClose: () => void;
  /**
   * Called when the user says "I've already subscribed, refresh" — we
   * pull fresh quota from the backend. If the plan updated, the parent
   * may auto-close this modal.
   */
  onRefresh?: () => Promise<void>;
}

export function PaywallModal({ copy, currentPlan, reason, onClose, onRefresh }: PaywallModalProps) {
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Free plan row first, paid tiers after — the order DesktopConfig
  // gives us is expected to already match. We don't re-sort.
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 20,
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(720px, 100%)',
          maxHeight: 'calc(100vh - 48px)',
          background: 'var(--d9-obsidian)',
          border: '1px solid var(--d9-hairline-b)',
          borderRadius: 14,
          boxShadow: 'var(--s-float)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '20px 24px',
            background: 'var(--d9-accent-glow)',
            borderBottom: '1px solid var(--d9-hairline)',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 14,
          }}
        >
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 10,
              background: 'linear-gradient(135deg, var(--d9-accent) 0%, var(--d9-cyan) 100%)',
              color: 'white',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              boxShadow: '0 4px 14px rgba(124, 92, 255, 0.35)',
            }}
          >
            <IconSparkles size={18} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 600, fontFamily: 'var(--d9-font-display)' }}>
              {reason ?? 'Расширь возможности Cue'}
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--d9-ink-dim)', marginTop: 4, lineHeight: 1.5 }}>
              Или подключи свой OpenAI / Anthropic ключ в Настройках — инференс пойдёт напрямую,
              без подписки.
            </div>
          </div>
          <button
            onClick={onClose}
            title="Закрыть (Esc)"
            style={{
              width: 28,
              height: 28,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--d9-ink-mute)',
              background: 'transparent',
              border: '1px solid transparent',
              borderRadius: 6,
              cursor: 'pointer',
            }}
          >
            <IconClose size={14} />
          </button>
        </div>

        {/* Plans */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${Math.min(copy.length, 3)}, minmax(0, 1fr))`,
            gap: 12,
            padding: 20,
            overflowY: 'auto',
          }}
        >
          {copy.map((p) => (
            <PlanCard key={p.planId} plan={p} isCurrent={p.planId === currentPlan} />
          ))}
        </div>

        {/* Footer — "I've already paid" */}
        {onRefresh && (
          <div
            style={{
              padding: '12px 24px',
              borderTop: '1px solid var(--d9-hairline)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: 'var(--d9-slate)',
              fontSize: 12,
              color: 'var(--d9-ink-mute)',
            }}
          >
            <span>После оплаты на Boosty ваш план обновится в течение минуты.</span>
            <Button
              size="sm"
              variant="ghost"
              disabled={refreshing}
              onClick={async () => {
                setRefreshing(true);
                try {
                  await onRefresh();
                } finally {
                  setRefreshing(false);
                }
              }}
            >
              {refreshing ? 'Проверяю…' : 'Я уже оплатил'}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────

function PlanCard({ plan, isCurrent }: { plan: PaywallCopy; isCurrent: boolean }) {
  const hasSubscribe = !!plan.subscribeUrl && !isCurrent;
  const isHighlighted = plan.planId === 'seeker'; // "most popular"

  return (
    <div
      style={{
        position: 'relative',
        padding: '18px 18px 16px',
        background: isHighlighted ? 'var(--d9-slate)' : 'var(--d9-slate)',
        border: isHighlighted ? '1px solid var(--d9-accent)' : '1px solid var(--d9-hairline)',
        borderRadius: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        minHeight: 220,
      }}
    >
      {isHighlighted && !isCurrent && (
        <div
          style={{
            position: 'absolute',
            top: -10,
            left: 14,
            padding: '2px 8px',
            fontSize: 10,
            fontFamily: 'var(--d9-font-mono)',
            textTransform: 'uppercase',
            letterSpacing: 0.5,
            background: 'linear-gradient(135deg, var(--d9-accent) 0%, var(--d9-cyan) 100%)',
            color: 'white',
            borderRadius: 10,
          }}
        >
          Популярный
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontSize: 15, fontWeight: 600 }}>{plan.displayName}</span>
        {isCurrent && (
          <span
            style={{
              fontSize: 10,
              fontFamily: 'var(--d9-font-mono)',
              textTransform: 'uppercase',
              padding: '2px 8px',
              borderRadius: 10,
              background: 'rgba(52, 199, 89, 0.12)',
              color: 'var(--d9-ok)',
            }}
          >
            текущий
          </span>
        )}
      </div>

      <div style={{ fontSize: 20, fontWeight: 600, fontFamily: 'var(--d9-font-display)' }}>
        {plan.priceLabel}
      </div>

      <div style={{ fontSize: 12, color: 'var(--d9-ink-dim)', lineHeight: 1.5 }}>{plan.tagline}</div>

      <ul style={{ margin: '6px 0 0', padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {plan.bullets.map((b, i) => (
          <li
            key={i}
            style={{
              display: 'flex',
              gap: 8,
              fontSize: 12,
              color: 'var(--d9-ink)',
              lineHeight: 1.5,
            }}
          >
            <span style={{ color: 'var(--d9-ok)', flexShrink: 0, marginTop: 2 }}>
              <IconCheck size={12} />
            </span>
            <span>{b}</span>
          </li>
        ))}
      </ul>

      <div style={{ flex: 1 }} />

      <Button
        size="md"
        variant={isHighlighted ? 'primary' : 'secondary'}
        disabled={!hasSubscribe}
        onClick={() => {
          if (!hasSubscribe) return;
          // Route through main so the URL opens in the user's default
          // browser rather than an in-app webview. window.open would
          // spawn an Electron-owned window which shows up in captures.
          void openExternal(plan.subscribeUrl);
        }}
      >
        {isCurrent ? 'Текущий план' : plan.ctaLabel}
      </Button>
    </div>
  );
}

/**
 * Open the URL in the user's OS browser via main-process shell.openExternal.
 * Main enforces an http/https allow-list so a rogue paywall entry cannot
 * trigger a file:// or javascript: URL.
 */
async function openExternal(url: string): Promise<void> {
  await window.druz9.shell.openExternal(url);
}
