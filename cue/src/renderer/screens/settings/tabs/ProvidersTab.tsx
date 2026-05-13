// AI Providers tab — read-only catalog of models exposed via Cue Cloud.

import type { ProviderModel } from '@shared/types';
import { SectionTitle } from '../lib/shared';

export function ProvidersTab({ models }: { models: ProviderModel[] }) {
  return (
    <>
      <SectionTitle
        title="AI провайдеры"
        subtitle="Каталог моделей, доступных через Cue Cloud."
      />

      <div
        style={{
          fontSize: 10,
          color: 'var(--d9-ink-ghost)',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          marginBottom: 12,
          fontFamily: 'var(--d9-font-mono)',
        }}
      >
        Каталог моделей
      </div>
      {models.length === 0 && (
        <div
          style={{
            padding: '24px 20px',
            textAlign: 'center',
            borderRadius: 'var(--radius-outer)',
            background: 'rgba(255, 255, 255, 0.03)',
            border: '0.5px dashed var(--d9-hairline)',
            color: 'var(--d9-ink-mute)',
            fontSize: 12.5,
            letterSpacing: '-0.005em',
            lineHeight: 1.5,
          }}
        >
          Каталог пуст. Войди через онбординг — после авторизации здесь
          появятся модели, доступные на твоём плане.
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {models.map((m) => (
          <div
            key={m.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 14,
              padding: '14px 0',
              borderBottom: '0.5px solid var(--d9-hairline)',
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 12.5,
                  fontWeight: 500,
                  color: 'var(--d9-ink)',
                  letterSpacing: '-0.005em',
                }}
              >
                {m.displayName}{' '}
                <span
                  style={{
                    color: 'var(--d9-ink-ghost)',
                    fontSize: 11,
                    fontFamily: 'var(--d9-font-mono)',
                    marginLeft: 4,
                  }}
                >
                  {m.id}
                </span>
              </div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 11,
                  color: 'var(--d9-ink-mute)',
                  marginTop: 3,
                  fontFamily: 'var(--d9-font-mono)',
                }}
              >
                <span>{m.providerName}</span>
                <span>·</span>
                <span>{m.typicalLatencyMs} мс</span>
                {m.supportsVision && (
                  <>
                    <span>·</span>
                    <span>vision</span>
                  </>
                )}
              </div>
            </div>
            <div
              style={{
                fontSize: 10,
                fontFamily: 'var(--d9-font-mono)',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                padding: '3px 9px',
                borderRadius: 999,
                background: m.availableOnCurrentPlan
                  ? 'rgba(255, 255, 255, 0.04)'
                  : 'var(--d9-accent-glow)',
                color: m.availableOnCurrentPlan ? 'var(--d9-ink)' : 'var(--d9-accent-hi)',
                border: `0.5px solid ${
                  m.availableOnCurrentPlan
                    ? 'var(--d9-hairline-b)'
                    : 'rgba(255, 59, 48, 0.35)'
                }`,
              }}
            >
              {m.availableOnCurrentPlan ? 'доступна' : 'pro'}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
