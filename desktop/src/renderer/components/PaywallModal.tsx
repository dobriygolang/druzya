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

  // Visual hierarchy:
  //   - highlighted (Pro): solid gradient border + accent-tinted bg +
  //     elevated shadow → реально визуально выделяется (раньше bg был
  //     одинаковый с обычным планом).
  //   - current: green tint + лёгкий glow.
  //   - regular: neutral slate, hairline border.
  const cardBg = isHighlighted
    ? 'linear-gradient(180deg, oklch(0.22 0.04 290 / 0.4), oklch(0.18 0.03 290 / 0.4))'
    : isCurrent
      ? 'oklch(0.18 0.04 150 / 0.2)'
      : 'var(--d9-slate)';
  const cardBorder = isHighlighted
    ? '1.5px solid var(--d9-accent)'
    : isCurrent
      ? '1px solid var(--d9-ok)'
      : '1px solid var(--d9-hairline)';
  const cardShadow = isHighlighted
    ? '0 8px 28px -8px rgba(124, 92, 255, 0.4)'
    : 'none';

  return (
    <div
      style={{
        position: 'relative',
        padding: '20px 18px 16px',
        background: cardBg,
        border: cardBorder,
        borderRadius: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        minHeight: 240,
        boxShadow: cardShadow,
        transform: isHighlighted ? 'translateY(-4px)' : 'none',
        transition: 'transform 200ms var(--d9-ease)',
      }}
    >
      {isHighlighted && !isCurrent && (
        <div
          style={{
            position: 'absolute',
            top: -11,
            left: '50%',
            transform: 'translateX(-50%)',
            padding: '3px 12px',
            fontSize: 10,
            fontWeight: 600,
            fontFamily: 'var(--d9-font-mono)',
            textTransform: 'uppercase',
            letterSpacing: 0.8,
            background: 'linear-gradient(135deg, var(--d9-accent) 0%, var(--d9-cyan) 100%)',
            color: 'white',
            borderRadius: 12,
            boxShadow: '0 2px 8px rgba(124, 92, 255, 0.5)',
            whiteSpace: 'nowrap',
          }}
        >
          ⭐ Популярный
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontSize: 16, fontWeight: 700, fontFamily: 'var(--d9-font-display)' }}>{plan.displayName}</span>
        {isCurrent && (
          <span
            style={{
              fontSize: 10,
              fontFamily: 'var(--d9-font-mono)',
              textTransform: 'uppercase',
              padding: '2px 8px',
              borderRadius: 10,
              background: 'rgba(52, 199, 89, 0.18)',
              color: 'var(--d9-ok)',
              letterSpacing: 0.5,
            }}
          >
            текущий
          </span>
        )}
      </div>

      <div
        style={{
          fontSize: 22,
          fontWeight: 700,
          fontFamily: 'var(--d9-font-display)',
          background: isHighlighted
            ? 'linear-gradient(135deg, var(--d9-accent) 0%, var(--d9-cyan) 100%)'
            : 'transparent',
          WebkitBackgroundClip: isHighlighted ? 'text' : undefined,
          WebkitTextFillColor: isHighlighted ? 'transparent' : 'var(--d9-ink)',
          backgroundClip: isHighlighted ? 'text' : undefined,
        }}
      >
        {plan.priceLabel}
      </div>

      <div style={{ fontSize: 12.5, color: 'var(--d9-ink-dim)', lineHeight: 1.5, minHeight: 18 }}>{plan.tagline}</div>

      <ul style={{ margin: '6px 0 0', padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {plan.bullets.map((b, i) => (
          <li
            key={i}
            style={{
              display: 'flex',
              gap: 8,
              fontSize: 12.5,
              color: 'var(--d9-ink)',
              lineHeight: 1.5,
            }}
          >
            <span style={{ color: isHighlighted ? 'var(--d9-accent)' : 'var(--d9-ok)', flexShrink: 0, marginTop: 2 }}>
              <IconCheck size={12} />
            </span>
            <span>{b}</span>
          </li>
        ))}
      </ul>

      <div style={{ flex: 1 }} />

      {/* CTA: highlighted plan → gradient button с glow.
          Disabled state когда subscribeURL пустой → показываем «Скоро»
          вместо обычного "Текущий план", чтобы юзер понимал что план
          существует но платёжная интеграция не настроена операторами. */}
      {isCurrent ? (
        <Button size="md" variant="secondary" disabled>
          Текущий план
        </Button>
      ) : !hasSubscribe ? (
        <Button size="md" variant="secondary" disabled>
          Скоро доступно
        </Button>
      ) : (
        <button
          onClick={() => void openExternal(plan.subscribeUrl)}
          style={{
            padding: '10px 16px',
            background: isHighlighted
              ? 'linear-gradient(135deg, var(--d9-accent) 0%, var(--d9-cyan) 100%)'
              : 'var(--d9-ink)',
            color: isHighlighted ? 'white' : 'var(--d9-bg)',
            border: 0,
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 600,
            fontFamily: 'inherit',
            cursor: 'pointer',
            transition: 'transform 120ms, box-shadow 120ms',
            boxShadow: isHighlighted
              ? '0 4px 14px rgba(124, 92, 255, 0.35)'
              : '0 2px 6px rgba(0, 0, 0, 0.2)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'translateY(-1px)';
            e.currentTarget.style.boxShadow = isHighlighted
              ? '0 6px 18px rgba(124, 92, 255, 0.5)'
              : '0 4px 10px rgba(0, 0, 0, 0.3)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'translateY(0)';
            e.currentTarget.style.boxShadow = isHighlighted
              ? '0 4px 14px rgba(124, 92, 255, 0.35)'
              : '0 2px 6px rgba(0, 0, 0, 0.2)';
          }}
        >
          {plan.ctaLabel}
        </button>
      )}
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
