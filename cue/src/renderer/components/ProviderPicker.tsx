// Provider picker modal — opens when the user clicks the model name in
// the compact/expanded header. Lists every model from DesktopConfig
// annotated with availability:
//   - "available" — Druz9 Cloud allows it on the user's plan.
//   - "pro" — locked behind a paid plan.
//
// Clicking an available model writes to the selected-model store; the
// next Analyze/Chat turn uses it. Every call goes through the backend
// — the BYOK "bring your own key" path was removed, so there is no
// "ваш ключ" badge anymore.
//
// 2026-05-12: migrated to foundation Modal primitive (focus trap, ESC,
// scroll lock, restore focus, smooth in/out). Badge green tint removed
// per b/w + red rule (memory/feedback_color_rule.md).

import { useMemo, useRef, useState } from 'react';

import type { ProviderModel } from '@shared/types';

import { IconCheck, IconSparkles } from './icons';
import { StatusDot } from './primitives';
import { Modal } from './primitives/Modal';
import { motion as motionTokens } from '../lib/design-tokens';
import { useAuthStore } from '../stores/auth';
import { useSelectedModelStore } from '../stores/selected-model';

export interface ProviderPickerProps {
  /** Full model catalogue from DesktopConfig. */
  models: ProviderModel[];
  /** Model id that's considered "current" if user has not picked one. */
  defaultModelId: string;
  /** Called when user clicks away or picks a model. */
  onClose: () => void;
}

export function ProviderPicker({ models, defaultModelId, onClose }: ProviderPickerProps) {
  const [open, setOpen] = useState(true);
  const selected = useSelectedModelStore((s) => s.modelId);
  const setSelected = useSelectedModelStore((s) => s.setModel);
  const session = useAuthStore((s) => s.session);
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Smooth exit: flip open → Modal exit anim → parent unmounts.
  function close() {
    setOpen(false);
    window.setTimeout(onClose, motionTokens.dur.medium);
  }

  const effectiveSelected = selected || defaultModelId;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return models;
    return models.filter(
      (m) =>
        m.displayName.toLowerCase().includes(q) ||
        m.providerName.toLowerCase().includes(q) ||
        m.id.toLowerCase().includes(q),
    );
  }, [models, query]);

  const grouped = useMemo(() => {
    const by: Record<string, ProviderModel[]> = {};
    for (const m of filtered) {
      (by[m.providerName] ??= []).push(m);
    }
    return Object.entries(by);
  }, [filtered]);

  return (
    <Modal open={open} onClose={close} size="sm" initialFocusRef={inputRef as React.RefObject<HTMLElement>}>
      <div
        style={{
          margin: 'calc(var(--pad-container) * -1)',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: 'min(520px, 80vh)',
        }}
      >
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--d9-hairline)' }}>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск модели…"
            aria-label="Поиск модели"
            style={{
              width: '100%',
              padding: '6px 0',
              background: 'transparent',
              border: 0,
              borderBottom: '1px solid var(--d9-hairline-b)',
              color: 'var(--d9-ink)',
              fontSize: 13,
              outline: 'none',
              transition: 'border-color var(--motion-dur-small) var(--motion-ease-decelerate)',
            }}
            onFocus={(e) => (e.currentTarget.style.borderBottomColor = 'var(--d9-ink)')}
            onBlur={(e) => (e.currentTarget.style.borderBottomColor = 'var(--d9-hairline-b)')}
          />
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--pad-inline) 0' }}>
          {grouped.length === 0 && models.length === 0 && !session && (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--d9-ink-mute)', fontSize: 12, lineHeight: 1.5 }}>
              <div style={{ fontSize: 13, color: 'var(--d9-ink)', marginBottom: 4 }}>
                Сначала нужно войти
              </div>
              Открой Настройки → Общее → Войти.
            </div>
          )}
          {grouped.length === 0 && models.length === 0 && session && (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--d9-ink-mute)', fontSize: 12, lineHeight: 1.5 }}>
              <div style={{ fontSize: 13, color: 'var(--d9-ink)', marginBottom: 4 }}>
                Каталог моделей не загрузился
              </div>
              Сервер недоступен или вернул ошибку.
              <br />
              Попробуй ещё раз через минуту.
            </div>
          )}
          {grouped.length === 0 && models.length > 0 && (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--d9-ink-mute)', fontSize: 12 }}>
              Ничего не найдено
            </div>
          )}
          {grouped.map(([provider, list]) => (
            <div key={provider}>
              <div
                style={{
                  padding: 'var(--pad-inline) var(--pad-container) 4px',
                  fontSize: 10,
                  fontFamily: 'var(--d9-font-mono)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  color: 'var(--d9-ink-mute)',
                }}
              >
                {provider}
              </div>
              {list.map((m) => {
                const available = m.availableOnCurrentPlan;
                const chosen = m.id === effectiveSelected;
                return (
                  <button
                    key={m.id}
                    aria-pressed={chosen}
                    onClick={() => {
                      if (!available) return;
                      setSelected(m.id);
                      onClose();
                    }}
                    disabled={!available}
                    style={{
                      position: 'relative',
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: 'var(--pad-inline) var(--pad-container)',
                      background: chosen ? 'var(--d9-accent-glow)' : 'transparent',
                      border: 'none',
                      color: available ? 'var(--d9-ink)' : 'var(--d9-ink-mute)',
                      cursor: available ? 'pointer' : 'not-allowed',
                      textAlign: 'left',
                      transition: 'background-color var(--motion-dur-small) var(--motion-ease-standard)',
                    }}
                    onMouseEnter={(e) => {
                      if (available && !chosen) e.currentTarget.style.background = 'var(--d9-hairline)';
                    }}
                    onMouseLeave={(e) => {
                      if (!chosen) e.currentTarget.style.background = 'transparent';
                    }}
                  >
                    {chosen && (
                      <span
                        aria-hidden
                        style={{
                          position: 'absolute',
                          left: 0,
                          top: '50%',
                          transform: 'translateY(-50%)',
                          width: 1.5,
                          height: 24,
                          background: 'var(--d9-accent)',
                          borderRadius: 1,
                          pointerEvents: 'none',
                        }}
                      />
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 500,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                        }}
                      >
                        {m.displayName}
                        <span
                          style={{
                            fontFamily: 'var(--d9-font-mono)',
                            fontSize: 10,
                            color: 'var(--d9-ink-mute)',
                            fontWeight: 400,
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
                          marginTop: 2,
                          fontSize: 10.5,
                          color: 'var(--d9-ink-mute)',
                        }}
                      >
                        {m.supportsReasoning && <IconSparkles size={11} />}
                        <StatusDot state={m.speedClass === 'fast' ? 'ready' : 'thinking'} size={5} />
                        <span>{m.typicalLatencyMs} мс</span>
                      </div>
                    </div>

                    {m.availableOnCurrentPlan ? (
                      <Badge tone="plan">доступно</Badge>
                    ) : (
                      <Badge tone="locked">pro</Badge>
                    )}

                    {chosen && <IconCheck size={14} />}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}

function Badge({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: 'plan' | 'locked';
}) {
  // b/w + red rule: replaced green "plan" tint with hairline ghost + tiny
  // red signal dot. "locked" stays neutral.
  const isPlan = tone === 'plan';
  return (
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
      {isPlan && (
        <span aria-hidden="true" style={{ display: 'inline-block', width: 5, height: 5, borderRadius: 999, background: 'var(--d9-accent)' }} />
      )}
      {children}
    </span>
  );
}
