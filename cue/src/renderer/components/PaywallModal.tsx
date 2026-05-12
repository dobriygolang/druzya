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

import { useState } from 'react';

import type { PaywallCopy, Quota } from '@shared/types';

import { IconCheck, IconClose, IconSparkles } from './icons';
import { Button } from './primitives';
import { Modal } from './primitives/Modal';
import { motion as motionTokens } from '../lib/design-tokens';

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
  const [open, setOpen] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  function close() {
    setOpen(false);
    window.setTimeout(onClose, motionTokens.dur.medium);
  }

  // Free plan row first, paid tiers after — the order DesktopConfig
  // gives us is expected to already match. We don't re-sort.
  return (
    <Modal open={open} onClose={close} size="lg">
      <div
        style={{
          margin: 'calc(var(--pad-container) * -1)',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: '80vh',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '20px 24px',
            borderBottom: '1px solid var(--d9-hairline)',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 14,
          }}
        >
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 'var(--radius-inner)',
              border: '1px solid var(--d9-hairline-b)',
              background: 'transparent',
              color: 'var(--d9-ink)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <IconSparkles size={18} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 16,
                fontWeight: 600,
                letterSpacing: '-0.012em',
                color: 'var(--d9-ink)',
              }}
            >
              {reason ?? 'Расширь возможности Cue'}
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--d9-ink-mute)', marginTop: 4, lineHeight: 1.55 }}>
              Или подключи свой OpenAI / Anthropic ключ в Настройках — инференс пойдёт напрямую,
              без подписки.
            </div>
          </div>
          <button
            onClick={close}
            title="Закрыть (Esc)"
            aria-label="Закрыть"
            className="focus-ring"
            style={{
              width: 28,
              height: 28,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--d9-ink-mute)',
              background: 'transparent',
              border: 0,
              borderRadius: 'var(--radius-inner)',
              cursor: 'pointer',
              transition:
                'background-color var(--motion-dur-small) var(--motion-ease-standard), color var(--motion-dur-small) var(--motion-ease-standard)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--d9-hairline)';
              e.currentTarget.style.color = 'var(--d9-ink)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.color = 'var(--d9-ink-mute)';
            }}
          >
            <IconClose size={14} />
          </button>
        </div>

        {/* Plans */}
        <div
          className="auto-fit-grid"
          style={{
            ['--auto-fit-min' as string]: '200px',
            ['--gap' as string]: '12px',
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
            className="flex-wrap-row"
            style={{
              padding: '14px 24px',
              borderTop: '1px solid var(--d9-hairline)',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
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
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────

function PlanCard({ plan, isCurrent }: { plan: PaywallCopy; isCurrent: boolean }) {
  const hasSubscribe = !!plan.subscribeUrl && !isCurrent;
  const isHighlighted = plan.planId === 'pro'; // "most popular"

  // Visual hierarchy (v2 — b/w + red rule):
  //   - highlighted (Pro): white border (strongest), card slightly elevated.
  //   - current: red signal border + ghost bg.
  //   - regular: hairline border, default slate.
  // Single red accent is sacred — used only for the "current plan" border to
  // signal the live/active state. Highlighted "popular" plan uses pure white
  // border (no chroma).
  const cardBg = isHighlighted
    ? 'var(--d9-hairline)'
    : isCurrent
      ? 'transparent'
      : 'var(--d9-slate)';
  const cardBorder = isHighlighted
    ? '1.5px solid rgba(255, 255, 255, 0.85)'
    : isCurrent
      ? '1px solid var(--d9-accent)'
      : '1px solid var(--d9-hairline)';
  const cardShadow = isHighlighted
    ? '0 8px 28px -8px rgba(0, 0, 0, 0.6)'
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
        transition: 'transform var(--motion-dur-medium) var(--motion-ease-standard)',
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
            letterSpacing: '0.08em',
            background: 'var(--d9-ink)',
            color: '#000',
            borderRadius: 999,
            whiteSpace: 'nowrap',
          }}
        >
          Популярный
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--pad-inline)' }}>
        <span style={{ fontSize: 16, fontWeight: 700, fontFamily: 'var(--d9-font-display)' }}>{plan.displayName}</span>
        {isCurrent && (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 10,
              fontFamily: 'var(--d9-font-mono)',
              textTransform: 'uppercase',
              padding: '2px 8px',
              borderRadius: 999,
              border: '1px solid var(--d9-hairline-b)',
              background: 'transparent',
              color: 'var(--d9-ink)',
              letterSpacing: '0.08em',
            }}
          >
            <span aria-hidden="true" style={{ display: 'inline-block', width: 5, height: 5, borderRadius: 999, background: 'var(--d9-accent)' }} />
            текущий
          </span>
        )}
      </div>

      <div
        style={{
          fontSize: 22,
          fontWeight: 700,
          letterSpacing: '-0.018em',
          color: 'var(--d9-ink)',
        }}
      >
        {plan.priceLabel}
      </div>

      <div style={{ fontSize: 12.5, color: 'var(--d9-ink-dim)', lineHeight: 1.5, minHeight: 18 }}>{plan.tagline}</div>

      <ul style={{ margin: '6px 0 0', padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 'var(--pad-inline)' }}>
        {plan.bullets.map((b, i) => (
          <li
            key={i}
            style={{
              display: 'flex',
              gap: 'var(--pad-inline)',
              fontSize: 12.5,
              color: 'var(--d9-ink)',
              lineHeight: 1.5,
            }}
          >
            <span style={{ color: 'var(--d9-ink-mute)', flexShrink: 0, marginTop: 2 }}>
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
            // b/w + red rule: highlighted plan = white ink button (strongest
            // hierarchy). Single red accent is reserved for the "current"
            // border. No chromatic gradient.
            background: 'var(--d9-ink)',
            color: '#000',
            border: 0,
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 600,
            fontFamily: 'inherit',
            cursor: 'pointer',
            transition:
              'transform var(--motion-dur-small) var(--motion-ease-standard), box-shadow var(--motion-dur-small) var(--motion-ease-standard)',
            boxShadow: isHighlighted
              ? '0 4px 14px rgba(0, 0, 0, 0.4)'
              : '0 2px 6px rgba(0, 0, 0, 0.2)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'translateY(-1px)';
            e.currentTarget.style.boxShadow = isHighlighted
              ? '0 6px 18px rgba(0, 0, 0, 0.55)'
              : '0 4px 10px rgba(0, 0, 0, 0.3)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'translateY(0)';
            e.currentTarget.style.boxShadow = isHighlighted
              ? '0 4px 14px rgba(0, 0, 0, 0.4)'
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
