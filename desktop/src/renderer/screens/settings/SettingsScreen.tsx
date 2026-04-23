// Settings — sidebar + active tab. Four tabs for MVP: General, Hotkeys,
// AI Providers, About. Subscription / Paywall live in their own window.
//
// All values come from DesktopConfig / server state. Writing to hotkeys
// calls hotkeys.update; other tabs are read-only for now.

import { useEffect, useState } from 'react';

import { BrandMark, IconKey, IconSettings, IconShield, IconSparkles } from '../../components/icons';
import { Button, Kbd, StatusDot } from '../../components/primitives';
import { useConfig } from '../../hooks/use-config';
import { useAuthStore } from '../../stores/auth';
import { useQuotaStore } from '../../stores/quota';
import type { ProviderModel } from '@shared/types';

type Tab = 'general' | 'hotkeys' | 'providers' | 'about';

const tabs: Array<{ id: Tab; label: string; icon: React.ReactNode }> = [
  { id: 'general', label: 'Общее', icon: <IconSettings size={14} /> },
  { id: 'hotkeys', label: 'Горячие клавиши', icon: <IconKey size={14} /> },
  { id: 'providers', label: 'AI провайдеры', icon: <IconSparkles size={14} /> },
  { id: 'about', label: 'О программе', icon: <IconShield size={14} /> },
];

export function SettingsScreen() {
  const [tab, setTab] = useState<Tab>('general');
  const { config } = useConfig();
  const session = useAuthStore((s) => s.session);
  const bootstrap = useAuthStore((s) => s.bootstrap);
  const quota = useQuotaStore((s) => s.quota);
  const refreshQuota = useQuotaStore((s) => s.refresh);

  useEffect(() => {
    const unsub = bootstrap();
    void refreshQuota();
    return unsub;
  }, [bootstrap, refreshQuota]);

  return (
    <div style={{ display: 'flex', height: '100vh', background: 'var(--d-bg-0)' }}>
      {/* Sidebar */}
      <div
        style={{
          width: 200,
          borderRight: '1px solid var(--d-line)',
          padding: '18px 10px',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 8px' }}>
          <BrandMark size={26} />
          <span style={{ fontSize: 13, fontWeight: 600 }}>Druz9</span>
        </div>
        <nav style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 10px',
                fontSize: 12.5,
                color: tab === t.id ? 'var(--d-text)' : 'var(--d-text-2)',
                background: tab === t.id ? 'var(--d-accent-soft)' : 'transparent',
                border: 'none',
                borderRadius: 6,
                textAlign: 'left',
                cursor: 'pointer',
                transition: 'background 120ms, color 120ms',
              }}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '28px 32px' }}>
        {tab === 'general' && <GeneralTab session={session} quota={quota} />}
        {tab === 'hotkeys' && <HotkeysTab />}
        {tab === 'providers' && <ProvidersTab models={config?.models ?? []} />}
        {tab === 'about' && <AboutTab />}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────

function SectionTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <h2 style={{ fontSize: 18, margin: 0, fontFamily: 'var(--f-display)' }}>{title}</h2>
      {subtitle && (
        <p style={{ fontSize: 12.5, color: 'var(--d-text-3)', margin: '4px 0 0' }}>{subtitle}</p>
      )}
    </div>
  );
}

function Row({
  title,
  hint,
  control,
}: {
  title: string;
  hint?: string;
  control: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        padding: '14px 16px',
        background: 'var(--d-bg-2)',
        border: '1px solid var(--d-line)',
        borderRadius: 10,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500 }}>{title}</div>
        {hint && <div style={{ fontSize: 11, color: 'var(--d-text-3)', marginTop: 2 }}>{hint}</div>}
      </div>
      {control}
    </div>
  );
}

function GeneralTab({
  session,
  quota,
}: {
  session: ReturnType<typeof useAuthStore.getState>['session'];
  quota: ReturnType<typeof useQuotaStore.getState>['quota'];
}) {
  const logout = useAuthStore((s) => s.logout);
  return (
    <>
      <SectionTitle title="Общее" subtitle="Аккаунт и план" />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Row
          title={session ? 'Аккаунт Druz9' : 'Не выполнен вход'}
          hint={session ? session.userId : 'Войди через онбординг'}
          control={
            session ? (
              <Button variant="secondary" size="sm" onClick={() => void logout()}>
                Выйти
              </Button>
            ) : (
              <Button
                variant="primary"
                size="sm"
                onClick={() => void window.druz9.windows.show('onboarding')}
              >
                Войти
              </Button>
            )
          }
        />
        <Row
          title="План"
          hint={
            quota
              ? `${quota.plan || '—'} · ${quota.requestsUsed}/${
                  quota.requestsCap < 0 ? '∞' : quota.requestsCap
                } запросов`
              : 'загрузка…'
          }
          control={
            <Button variant="secondary" size="sm" disabled>
              Обновить план
            </Button>
          }
        />
        <Row
          title="Stealth при демонстрации экрана"
          hint="Скрывает окно от Zoom, Meet и Chrome."
          control={<StatusDot state="ready" size={8} />}
        />
      </div>
    </>
  );
}

function HotkeysTab() {
  const { config } = useConfig();
  const bindings = config?.defaultHotkeys ?? [];
  const labels: Record<string, string> = {
    screenshot_area: 'Скриншот области',
    screenshot_full: 'Скриншот экрана',
    voice_input: 'Голосовой ввод',
    toggle_window: 'Показать/скрыть окно',
    quick_prompt: 'Быстрый вопрос',
    clear_conversation: 'Очистить диалог',
  };
  return (
    <>
      <SectionTitle
        title="Горячие клавиши"
        subtitle="Клавиши работают в любом приложении. Перезапись — в будущей версии."
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {bindings.map((b) => (
          <Row
            key={b.action}
            title={labels[b.action] ?? b.action}
            control={<Kbd>{b.accelerator}</Kbd>}
          />
        ))}
      </div>
    </>
  );
}

function ProvidersTab({ models }: { models: ProviderModel[] }) {
  return (
    <>
      <SectionTitle
        title="AI провайдеры"
        subtitle="Модель по умолчанию задаёт Druz9 Cloud; ключи «принеси свой» — в будущей версии."
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {models.map((m) => (
          <div
            key={m.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 14,
              padding: '12px 16px',
              background: 'var(--d-bg-2)',
              border: '1px solid var(--d-line)',
              borderRadius: 10,
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 500 }}>
                {m.displayName}{' '}
                <span style={{ color: 'var(--d-text-3)', fontSize: 11, fontFamily: 'var(--f-mono)' }}>
                  {m.id}
                </span>
              </div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 11,
                  color: 'var(--d-text-3)',
                  marginTop: 3,
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
                fontFamily: 'var(--f-mono)',
                textTransform: 'uppercase',
                padding: '2px 8px',
                borderRadius: 10,
                background: m.availableOnCurrentPlan
                  ? 'rgba(52, 199, 89, 0.12)'
                  : 'var(--d-accent-2-soft)',
                color: m.availableOnCurrentPlan ? 'var(--d-green)' : 'var(--d-accent-2)',
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

function AboutTab() {
  return (
    <>
      <SectionTitle title="О программе" subtitle="Druz9 Copilot" />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Row title="Версия" control={<span style={{ fontFamily: 'var(--f-mono)' }}>0.1.0</span>} />
        <Row
          title="Обратная связь"
          hint="Telegram-канал проекта"
          control={
            <Button variant="secondary" size="sm" disabled>
              Написать
            </Button>
          }
        />
      </div>
    </>
  );
}
