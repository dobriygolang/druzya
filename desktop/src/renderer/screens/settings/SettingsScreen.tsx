// Settings — sidebar + active tab. Four tabs for MVP: General, Hotkeys,
// AI Providers, About. Subscription / Paywall live in their own window.
//
// All values come from DesktopConfig / server state. Writing to hotkeys
// calls hotkeys.update; other tabs are read-only for now.

import { useEffect, useState } from 'react';

import { HotkeyRecorder } from '../../components/HotkeyRecorder';
import { useLocaleStore } from '../../i18n';
import { IconKey, IconPalette, IconSettings, IconShield, IconSparkles } from '../../components/icons';
import { Button, StatusDot } from '../../components/primitives';
import { BrandMark, RangeSlider, Seg } from '../../components/d9';
import { useConfig } from '../../hooks/use-config';
import { useAuthStore } from '../../stores/auth';
import { useHotkeyOverridesStore } from '../../stores/hotkey-overrides';
import { useAppearanceStore } from '../../stores/appearance';
import { usePaywallStore } from '../../stores/paywall';
import { useQuotaStore } from '../../stores/quota';
import {
  eventChannels,
  type MasqueradePreset,
  type MasqueradePresetInfo,
  type PermissionKind,
  type PermissionState,
  type UpdateStatus,
} from '@shared/ipc';
import type { HotkeyBinding, ProviderModel } from '@shared/types';

type Tab = 'general' | 'hotkeys' | 'providers' | 'appearance' | 'permissions' | 'about';

const tabs: Array<{ id: Tab; label: string; icon: React.ReactNode }> = [
  { id: 'general', label: 'Общее', icon: <IconSettings size={14} /> },
  { id: 'hotkeys', label: 'Горячие клавиши', icon: <IconKey size={14} /> },
  { id: 'providers', label: 'AI провайдеры', icon: <IconSparkles size={14} /> },
  { id: 'appearance', label: 'Внешний вид', icon: <IconPalette size={14} /> },
  { id: 'permissions', label: 'Доступы macOS', icon: <IconShield size={14} /> },
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

  // Settings window stays opaque — transparent + default window frame
  // on macOS Tahoe (26.x) breaks the title bar (traffic lights + drag
  // region stop responding). The slider only affects the chat
  // (expanded) window where transparency doesn't conflict with window
  // chrome because expanded uses frame: false.

  return (
    <div
      className="d9-root"
      style={{
        display: 'flex',
        height: '100vh',
        background: 'var(--d9-obsidian)',
        color: 'var(--d9-ink)',
        fontFamily: 'var(--d9-font-sans)',
      }}
    >
      {/* Sidebar — design/windows.jsx SettingsWindow sidebar (180px) */}
      <div
        style={{
          width: 200,
          flex: 'none',
          borderRight: '0.5px solid var(--d9-hairline)',
          padding: '18px 10px',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          background: 'oklch(0.12 0.03 278)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 8px' }}>
          <BrandMark size={28} />
          <span
            style={{
              fontFamily: 'var(--d9-font-sans)',
              fontWeight: 700,
              fontSize: 15,
              letterSpacing: '-0.02em',
              color: 'var(--d9-ink)',
            }}
          >
            Druz9
          </span>
        </div>
        <nav style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '8px 12px',
                fontSize: 12.5,
                fontFamily: 'inherit',
                fontWeight: 500,
                letterSpacing: '-0.005em',
                color: tab === t.id ? 'var(--d9-ink)' : 'var(--d9-ink-mute)',
                background: tab === t.id ? 'oklch(1 0 0 / 0.06)' : 'transparent',
                boxShadow: tab === t.id ? 'inset 0 0.5px 0 rgba(255,255,255,0.08)' : 'none',
                border: 'none',
                borderRadius: 7,
                textAlign: 'left',
                cursor: 'pointer',
                transition: 'background 120ms var(--d9-ease), color 120ms var(--d9-ease)',
              }}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '28px 36px 40px' }}>
        {tab === 'general' && <GeneralTab session={session} quota={quota} />}
        {tab === 'hotkeys' && <HotkeysTab />}
        {tab === 'providers' && <ProvidersTab models={config?.models ?? []} />}
        {tab === 'appearance' && <AppearanceTab />}
        {tab === 'permissions' && <PermissionsTab />}
        {tab === 'about' && <AboutTab />}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────

function SectionTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div style={{ marginBottom: 22 }}>
      <h2
        style={{
          fontFamily: 'var(--d9-font-sans)',
          fontWeight: 700,
          fontSize: 22,
          letterSpacing: '-0.02em',
          margin: 0,
          color: 'var(--d9-ink)',
          lineHeight: 1.2,
        }}
      >
        {title}
      </h2>
      {subtitle && (
        <p
          style={{
            fontSize: 12.5,
            color: 'var(--d9-ink-mute)',
            margin: '6px 0 0',
            letterSpacing: '-0.005em',
          }}
        >
          {subtitle}
        </p>
      )}
    </div>
  );
}

// SettingRow — design/windows.jsx:446-456 SettingRow pattern.
// 180px label column + 1fr control; hairline separator below.
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
        display: 'grid',
        gridTemplateColumns: '200px 1fr',
        alignItems: 'center',
        gap: 24,
        padding: '14px 0',
        borderBottom: '0.5px solid var(--d9-hairline)',
      }}
    >
      <div>
        <div
          style={{
            fontSize: 12.5,
            color: 'var(--d9-ink)',
            fontWeight: 500,
            letterSpacing: '-0.005em',
          }}
        >
          {title}
        </div>
        {hint && (
          <div
            style={{
              fontSize: 11,
              color: 'var(--d9-ink-ghost)',
              marginTop: 3,
              lineHeight: 1.4,
              letterSpacing: '-0.002em',
            }}
          >
            {hint}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>{control}</div>
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
      <div style={{ display: 'flex', flexDirection: 'column' }}>
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
        <StealthRow />

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

/**
 * StealthRow — toggles setContentProtection on compact + expanded windows.
 * Stealth on (default): окна невидимы в Zoom/Meet/screenshot.
 * Stealth off: можно заскринить для отладки / чтобы прислать разработчику.
 */
function StealthRow() {
  const [on, setOn] = useState(true);
  return (
    <Row
      title="Stealth при демонстрации экрана"
      hint={
        on
          ? 'Скрывает окно от Zoom, Meet, Chrome и системных скриншотов. Выключи временно, чтобы заскринить UI для отладки.'
          : 'ВНИМАНИЕ: окно видно при демонстрации и на скриншотах. Включи обратно после отладки.'
      }
      control={
        <Toggle
          on={on}
          onChange={async (next) => {
            setOn(next);
            try {
              await window.druz9.windows.toggleStealth(next);
            } catch {
              // Revert UI if IPC fails.
              setOn(!next);
            }
          }}
        />
      }
    />
  );
}

/**
 * Toggle — d9-style pill switch. design/windows.jsx:485-501 Toggle mock.
 */
function Toggle({ on, onChange }: { on: boolean; onChange: (next: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      style={{
        width: 36,
        height: 20,
        borderRadius: 10,
        position: 'relative',
        background: on ? 'var(--d9-accent)' : 'oklch(1 0 0 / 0.1)',
        boxShadow: on ? '0 0 12px -2px var(--d9-accent-glow)' : 'none',
        border: 0,
        padding: 0,
        cursor: 'pointer',
        transition: 'background 120ms var(--d9-ease)',
        flex: 'none',
      }}
      aria-pressed={on}
    >
      <span
        style={{
          position: 'absolute',
          top: 2,
          left: on ? 18 : 2,
          width: 16,
          height: 16,
          borderRadius: '50%',
          background: 'white',
          boxShadow: '0 1px 2px rgba(0,0,0,0.25)',
          transition: 'left 120ms var(--d9-ease)',
        }}
      />
    </button>
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
        <Seg
          options={['Русский', 'English'] as const}
          value={locale === 'ru' ? 'Русский' : 'English'}
          onChange={(v) => setLocale(v === 'Русский' ? 'ru' : 'en')}
        />
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
    <Row
      title="Маскировка"
      hint="Меняет иконку в Dock и заголовки окон. Имя в Activity Monitor фиксируется при сборке — выбери другой билд (Notes.app, Xcode.app), если нужно полное переименование."
      control={
        <select
          value={current}
          onChange={async (e) => {
            const next = e.target.value as MasqueradePreset;
            setCurrent(next);
            await window.druz9.masquerade.apply(next);
          }}
          style={selectStyle}
        >
          {presets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.displayName}
            </option>
          ))}
        </select>
      }
    />
  );
}

// Consistent select styling — used across General/Masquerade/Locale rows.
const selectStyle: React.CSSProperties = {
  height: 30,
  padding: '0 12px',
  fontSize: 12,
  fontFamily: 'inherit',
  color: 'var(--d9-ink)',
  background: 'var(--d9-slate)',
  border: '0.5px solid var(--d9-hairline)',
  borderRadius: 8,
  outline: 'none',
  cursor: 'pointer',
};

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
  // Always iterate LOCAL_DEFAULTS for the UI — server may return
  // placeholders with numeric action strings which break the label
  // mapping. Accelerators from the server override per-action only when
  // the action name is a known one.
  const serverByAction = new Map(
    (config?.defaultHotkeys ?? []).map((b) => [b.action, b.accelerator] as const),
  );
  const defaults: HotkeyBinding[] = LOCAL_DEFAULTS.map((b) => ({
    action: b.action,
    accelerator: serverByAction.get(b.action) ?? b.accelerator,
  }));

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
      <div style={{ display: 'flex', flexDirection: 'column' }}>
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
            borderRadius: 10,
            background: 'oklch(1 0 0 / 0.03)',
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
                  ? 'oklch(0.8 0.17 150 / 0.12)'
                  : 'var(--d9-accent-glow)',
                color: m.availableOnCurrentPlan ? 'var(--d9-ok)' : 'var(--d9-accent-hi)',
                border: `0.5px solid ${
                  m.availableOnCurrentPlan
                    ? 'oklch(0.8 0.17 150 / 0.28)'
                    : 'oklch(0.72 0.23 300 / 0.35)'
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

function AppearanceTab() {
  const opacity = useAppearanceStore((s) => s.expandedOpacity);
  const bootstrap = useAppearanceStore((s) => s.bootstrap);
  const setOpacity = useAppearanceStore((s) => s.setExpandedOpacity);
  useEffect(() => {
    let unsub: (() => void) | null = null;
    void bootstrap().then((u) => {
      unsub = u;
    });
    return () => {
      if (unsub) unsub();
    };
  }, [bootstrap]);

  return (
    <>
      <SectionTitle
        title="Внешний вид"
        subtitle="Прозрачность окон Druz9 и размер окна чата"
      />
      <Row
        title="Прозрачность окон"
        hint="0% — виден blur рабочего стола (macOS vibrancy). 100% — плотный фон. Применяется к окнам чата и настроек в реальном времени."
        control={
          <RangeSlider
            value={opacity}
            min={0}
            max={100}
            onChange={(v) => void setOpacity(v)}
            suffix="%"
          />
        }
      />
      <Row
        title="Размер окна"
        hint="Окно чата (expanded) свободно ресайзится — тяни за любой край. Последний размер запоминается и восстанавливается при следующем открытии."
        control={
          <span
            style={{
              fontFamily: 'var(--d9-font-mono)',
              fontSize: 10.5,
              color: 'var(--d9-ink-ghost)',
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
            }}
          >
            авто
          </span>
        }
      />
    </>
  );
}

/**
 * PermissionsTab — same three macOS permissions as the onboarding step,
 * accessible post-onboarding from Settings. Users can skip the step on
 * first launch and come here when they actually need screenshots /
 * global hotkeys / voice input.
 */
function PermissionsTab() {
  const [perms, setPerms] = useState<PermissionState | null>(null);

  const refresh = async () => {
    try {
      setPerms(await window.druz9.permissions.check());
    } catch {
      /* noop */
    }
  };

  useEffect(() => {
    void refresh();
    const h = setInterval(refresh, 1500);
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(h);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  const needsRestart =
    perms?.screenRecording !== 'granted' || perms?.accessibility !== 'granted';

  return (
    <>
      <SectionTitle
        title="Доступы macOS"
        subtitle="Выдать сейчас или позже — без них Druz9 всё равно работает, но часть функций недоступна."
      />

      {needsRestart && (
        <div
          style={{
            padding: '10px 14px',
            borderRadius: 9,
            background: 'var(--d9-accent-glow)',
            border: '0.5px solid oklch(0.72 0.23 300 / 0.35)',
            fontSize: 11.5,
            color: 'var(--d9-accent-hi)',
            letterSpacing: '-0.005em',
            lineHeight: 1.45,
            marginBottom: 14,
          }}
        >
          <b>Если переключатель уже включён, а доступа «нет»</b> — macOS кэширует
          статус до рестарта процесса. Включи тоггл в Системных настройках → нажми
          «Рестарт».
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <PermRow
          title="Запись экрана"
          hint="Чтобы делать скриншоты для AI."
          kind="screen-recording"
          state={perms?.screenRecording}
          refresh={refresh}
        />
        <PermRow
          title="Универсальный доступ"
          hint="Чтобы глобальные хоткеи работали в любом приложении."
          kind="accessibility"
          state={perms?.accessibility}
          refresh={refresh}
        />
        <PermRow
          title="Микрофон"
          hint="Опционально — для голосового ввода."
          kind="microphone"
          state={perms?.microphone}
          refresh={refresh}
        />
      </div>
    </>
  );
}

function PermRow({
  title,
  hint,
  kind,
  state,
  refresh,
}: {
  title: string;
  hint: string;
  kind: PermissionKind;
  state: PermissionState[keyof PermissionState] | undefined;
  refresh: () => Promise<void>;
}) {
  const granted = state === 'granted';
  return (
    <Row
      title={title}
      hint={hint}
      control={
        granted ? (
          <StatusDot state="ready" size={8} />
        ) : (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {(kind === 'screen-recording' || kind === 'accessibility') && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void window.druz9.app.quit()}
                title="macOS кэширует статус до рестарта процесса"
              >
                Рестарт
              </Button>
            )}
            <Button
              size="sm"
              variant="secondary"
              onClick={async () => {
                await window.druz9.permissions.request(kind);
                await window.druz9.permissions.openSettings(kind);
                void refresh();
              }}
            >
              Разрешить
            </Button>
          </div>
        )
      }
    />
  );
}

function AboutTab() {
  return (
    <>
      <SectionTitle title="О программе" subtitle="Druz9 Copilot" />
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <Row title="Версия" control={<span style={{ fontFamily: 'var(--d9-font-mono)' }}>0.1.0</span>} />
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
              color: 'var(--d9-ink-dim)',
              fontFamily: 'var(--d9-font-mono)',
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
