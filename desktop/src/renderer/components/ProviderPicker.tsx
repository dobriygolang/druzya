// Provider picker modal — opens when the user clicks the model name in
// the compact/expanded header. Lists every model from DesktopConfig
// annotated with availability:
//   - "available" (green) — Druz9 Cloud allows it OR the user has a BYOK
//     key for its family.
//   - "pro" (purple) — locked behind a paid plan, no BYOK for family.
//
// Clicking an available model writes to the selected-model store; the
// next Analyze/Chat turn uses it. BYOK-backed rows show a small "ключ"
// badge so the user knows the request will go direct.

import { useEffect, useMemo, useState } from 'react';

import { eventChannels, type ByokPresence } from '@shared/ipc';
import type { ProviderModel } from '@shared/types';

import { IconCheck, IconKey, IconSparkles } from './icons';
import { StatusDot } from './primitives';
import { useSelectedModelStore } from '../stores/selected-model';

type Family = 'openai' | 'anthropic' | 'google' | 'other';

function familyOf(id: string): Family {
  if (id.startsWith('openai/')) return 'openai';
  if (id.startsWith('anthropic/')) return 'anthropic';
  if (id.startsWith('google/')) return 'google';
  return 'other';
}

export interface ProviderPickerProps {
  /** Full model catalogue from DesktopConfig. */
  models: ProviderModel[];
  /** Model id that's considered "current" if user has not picked one. */
  defaultModelId: string;
  /** Called when user clicks away or picks a model. */
  onClose: () => void;
}

export function ProviderPicker({ models, defaultModelId, onClose }: ProviderPickerProps) {
  const selected = useSelectedModelStore((s) => s.modelId);
  const setSelected = useSelectedModelStore((s) => s.setModel);
  const [byok, setByok] = useState<ByokPresence>({ openai: false, anthropic: false });
  const [query, setQuery] = useState('');

  useEffect(() => {
    let disposed = false;
    void (async () => {
      try {
        const p = await window.druz9.byok.list();
        if (!disposed) setByok(p);
      } catch {
        /* empty presence = no BYOK rows highlighted */
      }
    })();
    const unsub = window.druz9.on<ByokPresence>(eventChannels.byokChanged, (p) => {
      if (!disposed) setByok(p);
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      disposed = true;
      unsub();
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

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

  const byokFor = (fam: Family): boolean => {
    if (fam === 'openai') return byok.openai;
    if (fam === 'anthropic') return byok.anthropic;
    return false;
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 440,
          maxHeight: 520,
          background: 'var(--d-bg-1)',
          border: '1px solid var(--d-line-strong)',
          borderRadius: 12,
          boxShadow: 'var(--s-float)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--d-line)' }}>
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск модели…"
            style={{
              width: '100%',
              height: 30,
              padding: '0 10px',
              background: 'transparent',
              border: '1px solid var(--d-line)',
              borderRadius: 8,
              color: 'var(--d-text)',
              fontSize: 13,
              outline: 'none',
            }}
          />
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
          {grouped.length === 0 && models.length === 0 && (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--d-text-3)', fontSize: 12, lineHeight: 1.5 }}>
              <div style={{ fontSize: 13, color: 'var(--d-text)', marginBottom: 4 }}>
                Сначала нужно войти
              </div>
              Открой Настройки → Общее → Войти,
              <br />
              или добавь свой OpenAI / Anthropic ключ
              <br />
              в Настройки → AI провайдеры.
            </div>
          )}
          {grouped.length === 0 && models.length > 0 && (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--d-text-3)', fontSize: 12 }}>
              Ничего не найдено
            </div>
          )}
          {grouped.map(([provider, list]) => (
            <div key={provider}>
              <div
                style={{
                  padding: '8px 16px 4px',
                  fontSize: 10,
                  fontFamily: 'var(--f-mono)',
                  textTransform: 'uppercase',
                  letterSpacing: 0.5,
                  color: 'var(--d-text-3)',
                }}
              >
                {provider}
              </div>
              {list.map((m) => {
                const fam = familyOf(m.id);
                const hasByok = byokFor(fam);
                const available = m.availableOnCurrentPlan || hasByok;
                const chosen = m.id === effectiveSelected;
                return (
                  <button
                    key={m.id}
                    onClick={() => {
                      if (!available) return;
                      setSelected(m.id);
                      onClose();
                    }}
                    disabled={!available}
                    style={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '8px 16px',
                      background: chosen ? 'var(--d-accent-soft)' : 'transparent',
                      border: 'none',
                      color: available ? 'var(--d-text)' : 'var(--d-text-3)',
                      cursor: available ? 'pointer' : 'not-allowed',
                      textAlign: 'left',
                    }}
                    onMouseEnter={(e) => {
                      if (available && !chosen) e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
                    }}
                    onMouseLeave={(e) => {
                      if (!chosen) e.currentTarget.style.background = 'transparent';
                    }}
                  >
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
                            fontFamily: 'var(--f-mono)',
                            fontSize: 10,
                            color: 'var(--d-text-3)',
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
                          color: 'var(--d-text-3)',
                        }}
                      >
                        {m.supportsReasoning && <IconSparkles size={11} />}
                        <StatusDot state={m.speedClass === 'fast' ? 'ready' : 'thinking'} size={5} />
                        <span>{m.typicalLatencyMs} мс</span>
                      </div>
                    </div>

                    {hasByok ? (
                      <Badge tone="byok">
                        <IconKey size={10} /> ваш ключ
                      </Badge>
                    ) : m.availableOnCurrentPlan ? (
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
    </div>
  );
}

function Badge({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: 'byok' | 'plan' | 'locked';
}) {
  const tones: Record<typeof tone, { bg: string; fg: string }> = {
    byok: { bg: 'var(--d-accent-soft)', fg: 'var(--d-accent)' },
    plan: { bg: 'rgba(52, 199, 89, 0.12)', fg: 'var(--d-green)' },
    locked: { bg: 'var(--d-accent-2-soft)', fg: 'var(--d-accent-2)' },
  };
  const s = tones[tone];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        fontSize: 10,
        fontFamily: 'var(--f-mono)',
        textTransform: 'uppercase',
        padding: '2px 8px',
        borderRadius: 10,
        background: s.bg,
        color: s.fg,
        letterSpacing: 0.3,
      }}
    >
      {children}
    </span>
  );
}
