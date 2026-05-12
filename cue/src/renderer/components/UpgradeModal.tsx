// UpgradeModal — context-aware Pro upgrade modal (Phase J / X2 P0).
//
// Mirror of hone/src/renderer/src/components/UpgradeModal.tsx — кодоген'ить
// мы не стали (YAGNI shared workspace), но контракт идентичный: фичу,
// которую юзер тыкнул, мы пишем как pre-filled callout, плюс рисуем
// per-feature lift-stat (placeholder сейчас), Free vs Pro comparison и
// BYOK alternative CTA.
//
// Different from Cue's existing PaywallModal (which is server-driven copy
// для Boosty rate-limit auto-pop). This one fires when юзер пытается
// конкретную Pro feature (premium persona / 8h session / unlimited LLM)
// — даём structured context вместо generic «Лимит исчерпан».
//
// Wiring: useQuotaStore.showUpgradeModal({ feature, label, benefit, ... });
// component reads from store, renders globally (mounted in app.tsx).

import { useCallback, useEffect, useState } from 'react';

import { useQuotaStore, type UpgradeContext } from '../stores/quota';
import { PRO_UPGRADE_URL_BASE, PRO_BYOK_URL } from '../lib/upgrade-config';
import { Modal } from './primitives/Modal';
import { motion as motionTokens } from '../lib/design-tokens';

// SupportedCurrency — keep in sync с frontend/hone. Backend env vars
// STRIPE_PRICE_ID_PRO_{RUB,USD,EUR}.
export type SupportedCurrency = 'RUB' | 'USD' | 'EUR';

// CURRENCY_DISPLAY — price labels per currency. Real Stripe price тянется
// из webhook; это placeholder для plans card UI.
const CURRENCY_DISPLAY: Record<SupportedCurrency, { symbol: string; price: string }> = {
  RUB: { symbol: '₽', price: '990₽' },
  USD: { symbol: '$', price: '$9' },
  EUR: { symbol: '€', price: '€9' },
};

// detectCurrency — best-effort из browser locale.
function detectCurrency(): SupportedCurrency {
  if (typeof navigator === 'undefined') return 'RUB';
  const lang = (navigator.language || 'en').toLowerCase();
  if (lang.startsWith('ru') || lang.startsWith('be') || lang.startsWith('kk')) return 'RUB';
  if (
    lang.startsWith('de') ||
    lang.startsWith('fr') ||
    lang.startsWith('es') ||
    lang.startsWith('it') ||
    lang.startsWith('nl') ||
    lang.startsWith('pt')
  )
    return 'EUR';
  return 'USD';
}

const COMPARISON: Array<{ label: string; free: string; pro: string }> = [
  { label: 'AI-coach unlimited chat', free: 'Yes', pro: 'Yes' },
  { label: 'Cue sessions', free: 'Up to 1 hour', pro: 'Up to 8 hours' },
  { label: 'Cue premium personas', free: '—', pro: 'Full library' },
  { label: 'LLM daily cap', free: '20 calls/day', pro: 'Unlimited' },
  { label: 'AI-mock pipelines (5-stage)', free: 'Manual mock only', pro: 'Unlimited' },
  { label: 'Google Calendar sync', free: '—', pro: 'Two-way' },
  { label: 'Deep readiness analytics', free: 'Basic', pro: 'Full radar + predictions' },
  { label: 'Priority LLM cascade', free: 'Best-effort', pro: 'Cerebras/Groq priority' },
];

export function UpgradeModal() {
  const ctx = useQuotaStore((s) => s.upgradeModalContext);
  const dismiss = useQuotaStore((s) => s.dismissUpgradeModal);
  const [open, setOpen] = useState(true);

  // Reset local open state каждый раз когда новый ctx появляется — иначе
  // повторный show после dismiss оставлял open=false и modal не показывался.
  useEffect(() => {
    if (ctx) setOpen(true);
  }, [ctx]);

  const close = useCallback(() => {
    setOpen(false);
    window.setTimeout(dismiss, motionTokens.dur.medium);
  }, [dismiss]);

  if (!ctx) return null;

  return (
    <Modal open={open} onClose={close} size="md">
      <ModalBody ctx={ctx} onClose={close} />
    </Modal>
  );
}

function ModalBody({ ctx, onClose }: { ctx: UpgradeContext; onClose: () => void }) {
  // Currency picker — auto-detect at mount, user can override before opening external.
  const [currency, setCurrency] = useState<SupportedCurrency>(detectCurrency());
  useEffect(() => {
    setCurrency(detectCurrency());
  }, []);
  const priceDisplay = CURRENCY_DISPLAY[currency].price;

  const handleUpgrade = () => {
    const url = `${PRO_UPGRADE_URL_BASE}?source=cue&feature=${encodeURIComponent(ctx.feature)}&currency=${currency}`;
    void window.druz9.shell.openExternal(url);
    onClose();
  };

  const handleBYOK = () => {
    void window.druz9.shell.openExternal(PRO_BYOK_URL);
    onClose();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* Header eyebrow с red stripe */}
      <div
        className="mono"
        style={{
          position: 'relative',
          fontSize: 10,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'var(--d9-ink-mute)',
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
            background: 'var(--d9-accent)',
          }}
        />
        Unlock Pro
      </div>

      {/* Pre-filled context callout */}
      <div>
        <h2
          style={{
            margin: 0,
            fontSize: 20,
            fontWeight: 500,
            letterSpacing: '-0.01em',
            color: 'var(--d9-ink)',
            lineHeight: 1.3,
            marginBottom: 8,
          }}
        >
          You tried {ctx.label}.
        </h2>
        <p
          style={{
            margin: 0,
            fontSize: 13.5,
            color: 'var(--d9-ink-mute)',
            lineHeight: 1.6,
          }}
        >
          {ctx.benefit}
        </p>
      </div>

      {/* Pricing */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          padding: '14px 16px',
          borderRadius: 10,
          border: '1px solid var(--d9-hairline-b)',
          background: 'var(--d9-slate)',
          minWidth: 0,
        }}
      >
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'baseline',
            gap: 10,
            minWidth: 0,
          }}
        >
          <span
            style={{
              fontSize: 28,
              fontWeight: 600,
              letterSpacing: '-0.02em',
              color: 'var(--d9-ink)',
              lineHeight: 1,
            }}
          >
            {priceDisplay}
          </span>
          <span style={{ fontSize: 13, color: 'var(--d9-ink-mute)' }}>/ month</span>
          <span style={{ fontSize: 12, color: 'var(--d9-ink-ghost)', marginLeft: 'auto' }}>
            cancel anytime
          </span>
        </div>
        {/* Currency picker — 3-button segmented, B/W only */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 6,
            alignItems: 'center',
          }}
        >
          <span
            className="mono"
            style={{
              fontSize: 10,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--d9-ink-ghost)',
              marginRight: 4,
            }}
          >
            Currency
          </span>
          {(['RUB', 'USD', 'EUR'] as SupportedCurrency[]).map((c) => {
            const active = c === currency;
            return (
              <button
                key={c}
                type="button"
                onClick={() => setCurrency(c)}
                className="mono"
                style={{
                  padding: '4px 10px',
                  borderRadius: 6,
                  border: '1px solid',
                  borderColor: active ? 'var(--d9-ink)' : 'var(--d9-hairline-b)',
                  background: active ? 'var(--d9-ink)' : 'transparent',
                  color: active ? '#000' : 'var(--d9-ink-mute)',
                  fontSize: 10,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  cursor: 'pointer',
                  font: 'inherit',
                  transition:
                    'border-color var(--motion-dur-small) var(--motion-ease-standard), background-color var(--motion-dur-small) var(--motion-ease-standard), color var(--motion-dur-small) var(--motion-ease-standard)',
                }}
              >
                {c}
              </button>
            );
          })}
        </div>
      </div>

      {/* Lift stat */}
      {ctx.liftStat && (
        <div
          style={{
            position: 'relative',
            paddingLeft: 12,
            fontSize: 12.5,
            color: 'var(--d9-ink-mute)',
            lineHeight: 1.5,
            fontStyle: 'italic',
          }}
        >
          <span
            aria-hidden="true"
            style={{
              position: 'absolute',
              left: 0,
              top: 3,
              bottom: 3,
              width: 1.5,
              background: 'var(--d9-accent)',
            }}
          />
          {ctx.liftStat}
        </div>
      )}

      {/* Feature comparison */}
      <div
        style={{
          border: '1px solid var(--d9-hairline-b)',
          borderRadius: 10,
          overflow: 'hidden',
        }}
      >
        <div
          className="mono"
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1.4fr) minmax(80px, 1fr) minmax(80px, 1fr)',
            fontSize: 10,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'var(--d9-ink-mute)',
            padding: '8px 12px',
            borderBottom: '1px solid var(--d9-hairline-b)',
            background: 'var(--d9-slate)',
          }}
        >
          <span>Feature</span>
          <span>Free</span>
          <span style={{ color: 'var(--d9-ink)' }}>Pro</span>
        </div>
        <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
          {COMPARISON.map((row, i) => (
            <li
              key={row.label}
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(0, 1.4fr) minmax(80px, 1fr) minmax(80px, 1fr)',
                fontSize: 12.5,
                padding: '8px 12px',
                borderTop: i === 0 ? 'none' : '1px solid var(--d9-hairline)',
                color: 'var(--d9-ink)',
                lineHeight: 1.4,
                minWidth: 0,
              }}
            >
              <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{row.label}</span>
              <span style={{ color: 'var(--d9-ink-mute)', minWidth: 0, overflowWrap: 'anywhere' }}>
                {row.free}
              </span>
              <span style={{ color: 'var(--d9-ink)', minWidth: 0, overflowWrap: 'anywhere' }}>
                {row.pro}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {/* CTAs */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 10,
          alignItems: 'center',
          justifyContent: 'flex-end',
          marginTop: 4,
        }}
      >
        <button
          onClick={onClose}
          style={{
            padding: '9px 14px',
            background: 'transparent',
            border: 0,
            color: 'var(--d9-ink-ghost)',
            fontSize: 13,
            cursor: 'pointer',
            transition: 'color var(--motion-dur-small) var(--motion-ease-standard)',
            font: 'inherit',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--d9-ink-mute)')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--d9-ink-ghost)')}
        >
          Maybe later
        </button>
        {ctx.byokAvailable !== false && (
          <button
            onClick={handleBYOK}
            title="Use your own API key — Pro features unlock, you cover provider cost"
            style={{
              padding: '9px 16px',
              borderRadius: 8,
              background: 'transparent',
              border: '1px solid var(--d9-hairline-b)',
              color: 'var(--d9-ink-mute)',
              fontSize: 13,
              cursor: 'pointer',
              font: 'inherit',
              transition:
                'background-color var(--motion-dur-small) var(--motion-ease-standard), color var(--motion-dur-small) var(--motion-ease-standard)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
              e.currentTarget.style.color = 'var(--d9-ink)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.color = 'var(--d9-ink-mute)';
            }}
          >
            Use my own key (BYOK)
          </button>
        )}
        <button
          onClick={handleUpgrade}
          autoFocus
          style={{
            padding: '9px 18px',
            borderRadius: 8,
            background: 'var(--d9-ink)',
            color: '#000',
            border: 'none',
            fontSize: 13,
            fontWeight: 500,
            cursor: 'pointer',
            font: 'inherit',
            transition: 'transform var(--motion-dur-small) var(--motion-ease-standard)',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.transform = 'translateY(-1px)')}
          onMouseLeave={(e) => (e.currentTarget.style.transform = 'translateY(0)')}
        >
          Upgrade to Pro →
        </button>
      </div>
    </div>
  );
}

// liftStats — placeholder per-feature numbers. TODO replace with real
// telemetry once X3 analytics ships.
export const LIFT_STATS: Record<string, string> = {
  unlimited_mock: 'Pro users complete 2.3× more mock pipelines (placeholder)',
  long_session: 'Pro users average 47 min per Cue session vs 12 min on free (placeholder)',
  premium_persona: 'Premium personas score 35% sharper on internal eval (placeholder)',
  calendar_sync: 'Pro users schedule 4× more focus sessions (placeholder)',
  cross_device_sync: 'Pro users keep 8× more synced notes (placeholder)',
  llm_unlimited: 'Pro users hit Cerebras path 5× faster (placeholder)',
  deep_analytics: 'Pro users iterate on weak axes 2.1× faster (placeholder)',
};

// Convenience helper — drops in liftStat from LIFT_STATS by feature key.
// Trigger sites call this instead of useQuotaStore.showUpgradeModal directly.
export function requestUpgrade(ctx: Omit<UpgradeContext, 'liftStat'>): void {
  useQuotaStore.getState().showUpgradeModal({
    ...ctx,
    liftStat: LIFT_STATS[ctx.feature],
  });
}
