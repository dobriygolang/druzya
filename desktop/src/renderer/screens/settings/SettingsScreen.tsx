// Settings — sidebar + active tab. Four tabs for MVP: General, Hotkeys,
// AI Providers, About. Subscription / Paywall live in their own window.
//
// All values come from DesktopConfig / server state. Writing to hotkeys
// calls hotkeys.update; other tabs are read-only for now.

import { useEffect, useState } from 'react';

import { HotkeyRecorder } from '../../components/HotkeyRecorder';
import { useLocaleStore } from '../../i18n';
import { BrandMark, IconKey, IconSettings, IconShield, IconSparkles } from '../../components/icons';
import { Button, StatusDot } from '../../components/primitives';
import { useConfig } from '../../hooks/use-config';
import { useAuthStore } from '../../stores/auth';
import { useHotkeyOverridesStore } from '../../stores/hotkey-overrides';
import { usePaywallStore } from '../../stores/paywall';
import { useQuotaStore } from '../../stores/quota';
import {
  eventChannels,
  type MasqueradePreset,
  type MasqueradePresetInfo,
  type UpdateStatus,
} from '@shared/ipc';
import type { HotkeyBinding, ProviderModel } from '@shared/types';

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
        <PlanRow quota={quota} />
        <Row
          title="Stealth при демонстрации экрана"
          hint="Скрывает окно от Zoom, Meet и Chrome."
          control={<StatusDot state="ready" size={8} />}
        />
        <LocaleRow />
        <MasqueradeRow />
      </div>
    </>
  );
}

/**
 * PlanRow — shows the current plan + lets the user open the paywall.
 * Pro/Team users see "Управлять подпиской" leading back to the same
 * Boosty CTA; free users see "Обновить план".
 */
function PlanRow({ quota }: { quota: ReturnType<typeof useQuotaStore.getState>['quota'] }) {
  const showPaywall = usePaywallStore((s) => s.show);
  const isPaid = !!quota && quota.plan !== 'free' && quota.plan !== '';
  return (
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
        <Button
          variant={isPaid ? 'secondary' : 'primary'}
          size="sm"
          onClick={() => showPaywall()}
        >
          {isPaid ? 'Управлять подпиской' : 'Обновить план'}
        </Button>
      }
    />
  );
}

function LocaleRow() {
  const locale = useLocaleStore((s) => s.locale);
  const setLocale = useLocaleStore((s) => s.setLocale);
  return (
    <Row
      title="Язык"
      hint="Интерфейс. Ответы модели остаются на языке твоего запроса."
      control={
        <select
          value={locale}
          onChange={(e) => setLocale(e.target.value as 'ru' | 'en')}
          style={{
            height: 28,
            padding: '0 10px',
            fontSize: 12,
            color: 'var(--d-text)',
            background: 'var(--d-bg-1)',
            border: '1px solid var(--d-line-strong)',
            borderRadius: 6,
          }}
        >
          <option value="ru">Русский</option>
          <option value="en">English</option>
        </select>
      }
    />
  );
}

/**
 * MasqueradeRow — lets the user swap the Dock icon and window titles.
 * The process name in Activity Monitor is pinned by the bundle; we
 * surface that caveat inline so users aren't surprised.
 */
function MasqueradeRow() {
  const [presets, setPresets] = useState<MasqueradePresetInfo[]>([]);
  const [current, setCurrent] = useState<MasqueradePreset>('druz9');

  useEffect(() => {
    let disposed = false;
    void (async () => {
      try {
        const [list, got] = await Promise.all([
          window.druz9.masquerade.list(),
          window.druz9.masquerade.get(),
        ]);
        if (disposed) return;
        setPresets(list);
        setCurrent(got);
      } catch {
        /* feature flag may be off; row stays hidden via presets.length === 0 */
      }
    })();
    return () => {
      disposed = true;
    };
  }, []);

  if (presets.length === 0) return null;

  return (
    <div
      style={{
        padding: '14px 16px',
        background: 'var(--d-bg-2)',
        border: '1px solid var(--d-line)',
        borderRadius: 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 500 }}>Маскировка</div>
          <div style={{ fontSize: 11, color: 'var(--d-text-3)', marginTop: 2 }}>
            Меняет иконку в Dock и заголовки окон. Имя в Activity Monitor фиксируется при сборке —
            выбери другой билд (Notes.app, Xcode.app), если нужно полное переименование.
          </div>
        </div>
        <select
          value={current}
          onChange={async (e) => {
            const next = e.target.value as MasqueradePreset;
            setCurrent(next);
            await window.druz9.masquerade.apply(next);
          }}
          style={{
            height: 28,
            padding: '0 10px',
            fontSize: 12,
            color: 'var(--d-text)',
            background: 'var(--d-bg-1)',
            border: '1px solid var(--d-line-strong)',
            borderRadius: 6,
          }}
        >
          {presets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.displayName}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

function HotkeysTab() {
  const { config } = useConfig();
  const overrides = useHotkeyOverridesStore((s) => s.overrides);
  const setOverride = useHotkeyOverridesStore((s) => s.set);
  const clearOverride = useHotkeyOverridesStore((s) => s.clear);
  const merge = useHotkeyOverridesStore((s) => s.merge);

  // Local fallback that mirrors the bindings main/index.ts registers on
  // startup — so the Settings list is populated and usable even before
  // the user logs in (DesktopConfig.defaultHotkeys is server-supplied).
  const LOCAL_DEFAULTS: HotkeyBinding[] = [
    { action: 'screenshot_area', accelerator: 'CommandOrControl+Shift+S' },
    { action: 'screenshot_full', accelerator: 'CommandOrControl+Shift+A' },
    { action: 'voice_input', accelerator: 'CommandOrControl+Shift+V' },
    { action: 'toggle_window', accelerator: 'CommandOrControl+Shift+D' },
    { action: 'quick_prompt', accelerator: 'CommandOrControl+Shift+Q' },
    { action: 'clear_conversation', accelerator: 'CommandOrControl+Shift+K' },
    { action: 'cursor_freeze_toggle', accelerator: 'CommandOrControl+Shift+Y' },
  ];
  const defaults = config?.defaultHotkeys?.length ? config.defaultHotkeys : LOCAL_DEFAULTS;

  // Whenever defaults or overrides change, push the merged bindings to
  // main so the globalShortcut registry re-registers under the new
  // accelerators. This also runs on first mount, re-applying user
  // overrides that were persisted from a previous session.
  useEffect(() => {
    if (defaults.length === 0) return;
    const merged = merge(defaults);
    void window.druz9.hotkeys.update(merged);
  }, [defaults, overrides, merge]);

  const labels: Record<string, string> = {
    screenshot_area: 'Скриншот области',
    screenshot_full: 'Скриншот экрана',
    voice_input: 'Голосовой ввод',
    toggle_window: 'Показать / скрыть окно',
    quick_prompt: 'Быстрый вопрос',
    clear_conversation: 'Очистить диалог',
    cursor_freeze_toggle: 'Заморозить курсор',
  };

  return (
    <>
      <SectionTitle
        title="Горячие клавиши"
        subtitle="Клавиши работают в любом приложении. Клик по сочетанию — перезапись."
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {defaults.map((b) => {
          const override = overrides[b.action];
          const accelerator = override ?? b.accelerator;
          return (
            <Row
              key={b.action}
              title={labels[b.action] ?? b.action}
              control={
                <HotkeyRecorder
                  action={b.action}
                  accelerator={accelerator}
                  isOverridden={!!override}
                  onSave={(accel) => setOverride(b.action, accel)}
                  onReset={() => clearOverride(b.action)}
                />
              }
            />
          );
        })}
      </div>
    </>
  );
}

function ProvidersTab({ models }: { models: ProviderModel[] }) {
  return (
    <>
      <SectionTitle
        title="AI провайдеры"
        subtitle="Каталог моделей, доступных через Druz9 Cloud."
      />

      <div style={{ fontSize: 11, color: 'var(--d-text-3)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10, fontFamily: 'var(--f-mono)' }}>
        Каталог моделей
      </div>
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
        <UpdateRow />
        <Row
          title="Обратная связь"
          hint="Telegram-канал проекта"
          control={
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void window.druz9.shell.openExternal('https://t.me/druz9_community')}
            >
              Написать
            </Button>
          }
        />
        <Row
          title="Сайт"
          hint="druz9.online"
          control={
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void window.druz9.shell.openExternal('https://druz9.online')}
            >
              Открыть
            </Button>
          }
        />
      </div>
    </>
  );
}

/**
 * UpdateRow — surfaces electron-updater state and lets the user force a
 * check or install a downloaded update. Silent when auto-update is
 * disabled (dev build or no feed URL).
 */
function UpdateRow() {
  const [status, setStatus] = useState<UpdateStatus>({ kind: 'idle' });

  useEffect(() => {
    let disposed = false;
    void (async () => {
      const s = await window.druz9.updater.status();
      if (!disposed) setStatus(s);
    })();
    const unsub = window.druz9.on<UpdateStatus>(eventChannels.updateStatus, (s) => {
      if (!disposed) setStatus(s);
    });
    return () => {
      disposed = true;
      unsub();
    };
  }, []);

  const [checking, setChecking] = useState(false);
  const onCheck = async () => {
    setChecking(true);
    try {
      await window.druz9.updater.check();
    } finally {
      // Let the push events land naturally; release our local spinner.
      setTimeout(() => setChecking(false), 600);
    }
  };

  return (
    <Row
      title="Обновления"
      hint={describe(status)}
      control={
        status.kind === 'ready' ? (
          <Button size="sm" variant="primary" onClick={() => void window.druz9.updater.install()}>
            Установить и перезапустить
          </Button>
        ) : status.kind === 'checking' || status.kind === 'downloading' || checking ? (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 12,
              color: 'var(--d-text-2)',
              fontFamily: 'var(--f-mono)',
            }}
          >
            <StatusDot state="thinking" size={8} />
            {status.kind === 'downloading' ? `${status.percent}%` : 'проверка…'}
          </span>
        ) : (
          <Button size="sm" variant="secondary" onClick={() => void onCheck()}>
            Проверить
          </Button>
        )
      }
    />
  );
}

function describe(s: UpdateStatus): string {
  switch (s.kind) {
    case 'idle':
      return 'Обновления не проверялись';
    case 'checking':
      return 'Проверяю…';
    case 'available':
      return `Доступна версия ${s.version} — скачивается`;
    case 'downloading':
      return `Скачивание ${s.percent}%`;
    case 'ready':
      return `Версия ${s.version} готова к установке`;
    case 'not-available':
      return 'У тебя последняя версия';
    case 'error':
      return `Ошибка: ${s.message.slice(0, 80)}`;
  }
}
