// Settings — sidebar + active tab. Four tabs for MVP: General, Hotkeys,
// AI Providers, About. Subscription / Paywall live in their own window.
//
// All values come from DesktopConfig / server state. Writing to hotkeys
// calls hotkeys.update; other tabs are read-only for now.

import { useCallback, useEffect, useRef, useState } from 'react';

import { HotkeyRecorder } from '../../components/HotkeyRecorder';
import { useLocaleStore } from '../../i18n';
import {
  IconDocument,
  IconKey,
  IconPalette,
  IconSettings,
  IconShield,
  IconSparkles,
  IconTrash,
} from '../../components/icons';
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
  type Document,
  type MasqueradePreset,
  type MasqueradePresetInfo,
  type PermissionKind,
  type PermissionState,
  type UpdateStatus,
} from '@shared/ipc';
import type { HotkeyBinding, ProviderModel } from '@shared/types';

type Tab = 'general' | 'hotkeys' | 'providers' | 'documents' | 'appearance' | 'permissions' | 'about';

const tabs: Array<{ id: Tab; label: string; icon: React.ReactNode }> = [
  { id: 'general', label: 'Общее', icon: <IconSettings size={14} /> },
  { id: 'hotkeys', label: 'Горячие клавиши', icon: <IconKey size={14} /> },
  { id: 'providers', label: 'AI провайдеры', icon: <IconSparkles size={14} /> },
  { id: 'documents', label: 'Документы', icon: <IconDocument size={14} /> },
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
          background: 'var(--d9-obsidian)',
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
            Cue
          </span>
        </div>
        <nav style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              // Active tab owns a stronger highlight; inactive rows get
              // the d9-row-hover fade-in. We keep the active style
              // inline (wins over the class rule by specificity once
              // :hover releases — CSS-var-only backgrounds don't fight
              // inline styles here since we set background via class).
              className={tab === t.id ? undefined : 'd9-row-hover'}
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
                background: tab === t.id ? 'rgba(255,255,255,0.06)' : 'transparent',
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
        {tab === 'documents' && <DocumentsTab />}
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
          title={session ? 'Аккаунт Cue' : 'Не выполнен вход'}
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

// ─────────────────────────────────────────────────────────────────────────
// Documents
// ─────────────────────────────────────────────────────────────────────────

/**
 * DocumentsTab — upload CV / JD / notes and manage the user's document
 * library. Attached documents get injected as RAG context into every
 * turn of the user's live copilot session (see backend
 * services/copilot/app/analyze.go for the inject path).
 *
 * MVP scope:
 *   - drag-n-drop + click-to-browse upload;
 *   - status pill per row ('pending' while embedder runs, 'ready' once
 *     the document is usable);
 *   - delete with cascade to chunks (backend FK ON DELETE CASCADE).
 *
 * Not here (next iterations): paste-URL ingestion, PDF/DOCX support,
 * per-session attach toggle UI (need a session picker first).
 *
 * Auth: relies on the bearer saved in keychain. Unauthenticated users
 * see the "войди" hint and no list.
 */
function DocumentsTab() {
  const session = useAuthStore((s) => s.session);
  const [docs, setDocs] = useState<Document[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [urlDraft, setUrlDraft] = useState('');
  // Attached-to-session id set + liveSessionId so the UI can show an
  // attach/detach toggle per row when the user has a live copilot
  // session open. Without a live session the toggles are disabled —
  // there's nothing meaningful to attach to.
  const [liveSessionId, setLiveSessionId] = useState<string | null>(null);
  const [attachedIds, setAttachedIds] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    try {
      const out = await window.druz9.documents.list('', 50);
      setDocs(out.documents);
      setError('');
    } catch (e) {
      setError(humanizeError(e));
    } finally {
      setLoading(false);
    }
  }, [session]);

  const refreshAttached = useCallback(async () => {
    if (!session) return;
    try {
      const s = await window.druz9.sessions.current();
      if (!s || !s.id) {
        setLiveSessionId(null);
        setAttachedIds(new Set());
        return;
      }
      setLiveSessionId(s.id);
      const ids = await window.druz9.documents.listAttachedToSession(s.id);
      setAttachedIds(new Set(ids));
    } catch {
      // Silent — no live session is a common state, not an error.
      setLiveSessionId(null);
      setAttachedIds(new Set());
    }
  }, [session]);

  useEffect(() => {
    void refresh();
    void refreshAttached();
  }, [refresh, refreshAttached]);

  const toggleAttach = async (docId: string, nextAttached: boolean) => {
    if (!liveSessionId) return;
    setError('');
    // Optimistic update — flip locally, roll back on failure.
    setAttachedIds((prev) => {
      const next = new Set(prev);
      if (nextAttached) next.add(docId);
      else next.delete(docId);
      return next;
    });
    try {
      if (nextAttached) {
        await window.druz9.documents.attachToSession(liveSessionId, docId);
      } else {
        await window.druz9.documents.detachFromSession(liveSessionId, docId);
      }
    } catch (e) {
      setAttachedIds((prev) => {
        const next = new Set(prev);
        if (nextAttached) next.delete(docId);
        else next.add(docId);
        return next;
      });
      setError(humanizeError(e));
    }
  };

  const uploadOne = async (file: File) => {
    // Enforce the 10MB server-side cap at the UI to give a clear error
    // before we waste a round-trip.
    if (file.size > 10 * 1024 * 1024) {
      setError(`${file.name}: файл больше 10 МБ`);
      return;
    }
    setUploading(true);
    setError('');
    try {
      const buf = await file.arrayBuffer();
      await window.druz9.documents.upload({
        filename: file.name,
        mime: file.type || guessMIME(file.name),
        content: new Uint8Array(buf),
      });
      await refresh();
    } catch (e) {
      setError(humanizeError(e));
    } finally {
      setUploading(false);
    }
  };

  const onFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    // Upload sequentially — the Ollama embedder is single-threaded per
    // request and 3 parallel uploads of 50 chunks each would saturate
    // the sidecar. Users uploading batches accept the latency.
    for (let i = 0; i < files.length; i++) {
      await uploadOne(files[i]);
    }
  };

  const onDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    await onFiles(e.dataTransfer.files);
  };

  const onImportURL = async () => {
    const url = urlDraft.trim();
    if (!url) return;
    setUploading(true);
    setError('');
    try {
      await window.druz9.documents.uploadFromURL(url);
      setUrlDraft('');
      await refresh();
    } catch (e) {
      setError(humanizeError(e));
    } finally {
      setUploading(false);
    }
  };

  const onDelete = async (id: string) => {
    setError('');
    try {
      await window.druz9.documents.delete(id);
      setDocs((prev) => prev.filter((d) => d.id !== id));
    } catch (e) {
      setError(humanizeError(e));
    }
  };

  if (!session) {
    return (
      <>
        <SectionTitle title="Документы" subtitle="RAG-контекст для copilot" />
        <div style={emptyStyle}>Войди через онбординг — после авторизации здесь появится твоя библиотека документов.</div>
      </>
    );
  }

  return (
    <>
      <SectionTitle
        title="Документы"
        subtitle="Загрузи CV, описание вакансии или заметки — copilot будет подтягивать релевантные куски в ответы внутри активной сессии."
      />

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => fileInputRef.current?.click()}
        style={{
          padding: '28px 20px',
          borderRadius: 12,
          textAlign: 'center',
          cursor: uploading ? 'wait' : 'pointer',
          background: dragging ? 'oklch(1 0 0 / 0.06)' : 'oklch(1 0 0 / 0.03)',
          border: dragging
            ? '1px solid var(--d9-accent)'
            : '1px dashed var(--d9-hairline)',
          color: 'var(--d9-ink-mute)',
          fontSize: 12.5,
          letterSpacing: '-0.005em',
          lineHeight: 1.5,
          marginBottom: 16,
          transition: 'background 120ms var(--d9-ease), border-color 120ms var(--d9-ease)',
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={[
            // text formats
            '.txt', '.md', '.markdown', '.html', '.htm',
            'text/plain', 'text/markdown', 'text/html',
            // office formats (pdf + docx). Some browsers report docx
            // as application/msword; the backend routes both to the
            // docx extractor and sniffs the zip magic to reject real
            // legacy .doc OLE files.
            '.pdf', '.docx',
            'application/pdf',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/msword',
          ].join(',')}
          style={{ display: 'none' }}
          onChange={(e) => {
            void onFiles(e.target.files);
            // Reset so selecting the same file again re-triggers onChange.
            e.currentTarget.value = '';
          }}
        />
        {uploading ? (
          'Загрузка…'
        ) : (
          <>
            <div style={{ color: 'var(--d9-ink)', fontWeight: 500, marginBottom: 4 }}>
              Перетащи файл сюда или нажми для выбора
            </div>
            <div style={{ fontSize: 11, color: 'var(--d9-ink-ghost)' }}>
              .txt, .md, .html, .pdf, .docx — до 10 МБ. Сканы без OCR не
              распознаются.
            </div>
          </>
        )}
      </div>

      {/* URL import — paste a JD/blog/Habr link and we fetch + readability-
          extract on the server side. Sits BELOW the drop-zone because the
          primary flow for users is still "drop CV.pdf here". */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          marginBottom: 16,
          alignItems: 'stretch',
        }}
      >
        <input
          type="url"
          placeholder="Или вставь ссылку на вакансию / статью …"
          value={urlDraft}
          onChange={(e) => setUrlDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !uploading && urlDraft.trim()) {
              e.preventDefault();
              void onImportURL();
            }
          }}
          disabled={uploading}
          spellCheck={false}
          style={{
            flex: 1,
            height: 32,
            padding: '0 12px',
            fontSize: 12,
            fontFamily: 'inherit',
            color: 'var(--d9-ink)',
            background: 'var(--d9-slate)',
            border: '0.5px solid var(--d9-hairline)',
            borderRadius: 8,
            outline: 'none',
          }}
        />
        <Button
          size="sm"
          variant="secondary"
          onClick={() => void onImportURL()}
          disabled={uploading || !urlDraft.trim()}
        >
          Загрузить ссылку
        </Button>
      </div>

      {error && (
        <div
          style={{
            padding: '10px 14px',
            borderRadius: 9,
            background: 'oklch(0.6 0.2 25 / 0.12)',
            border: '0.5px solid oklch(0.6 0.2 25 / 0.35)',
            color: 'oklch(0.75 0.18 25)',
            fontSize: 11.5,
            letterSpacing: '-0.005em',
            marginBottom: 14,
          }}
        >
          {error}
        </div>
      )}

      {loading && docs.length === 0 ? (
        <div style={emptyStyle}>Загружаем…</div>
      ) : docs.length === 0 ? (
        <div style={emptyStyle}>
          Пока нет документов. Загрузи файл выше — появится здесь с статусом индексации.
        </div>
      ) : (
        <>
          {liveSessionId ? (
            <div
              style={{
                fontSize: 11,
                color: 'var(--d9-ink-ghost)',
                margin: '4px 0 10px',
                letterSpacing: '-0.005em',
              }}
            >
              Есть активная сессия — отметь документы, которые copilot должен учитывать в ответах.
            </div>
          ) : (
            <div
              style={{
                fontSize: 11,
                color: 'var(--d9-ink-ghost)',
                margin: '4px 0 10px',
                letterSpacing: '-0.005em',
              }}
            >
              Чтобы прикрепить документ к сессии, сначала открой чат и нажми «Начать сессию».
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {docs.map((d) => (
              <DocumentRow
                key={d.id}
                doc={d}
                onDelete={onDelete}
                attached={attachedIds.has(d.id)}
                canAttach={!!liveSessionId && d.status === 'ready'}
                onToggleAttach={(next) => toggleAttach(d.id, next)}
              />
            ))}
          </div>
        </>
      )}
    </>
  );
}

function DocumentRow({
  doc,
  onDelete,
  attached,
  canAttach,
  onToggleAttach,
}: {
  doc: Document;
  onDelete: (id: string) => void;
  attached: boolean;
  canAttach: boolean;
  onToggleAttach: (next: boolean) => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '14px 0',
        borderBottom: '0.5px solid var(--d9-hairline)',
      }}
    >
      <IconDocument size={16} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 12.5,
            fontWeight: 500,
            color: 'var(--d9-ink)',
            letterSpacing: '-0.005em',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={doc.filename}
        >
          {doc.filename}
        </div>
        <div
          style={{
            fontSize: 11,
            color: 'var(--d9-ink-mute)',
            marginTop: 3,
            fontFamily: 'var(--d9-font-mono)',
            display: 'flex',
            gap: 6,
            alignItems: 'center',
          }}
        >
          <span>{formatBytes(doc.sizeBytes)}</span>
          {doc.status === 'ready' && (
            <>
              <span>·</span>
              <span>
                {doc.chunkCount} чанк{doc.chunkCount === 1 ? '' : 'ов'}
              </span>
            </>
          )}
          {doc.status === 'failed' && doc.errorMessage && (
            <>
              <span>·</span>
              <span title={doc.errorMessage} style={{ color: 'oklch(0.75 0.18 25)' }}>
                ошибка
              </span>
            </>
          )}
        </div>
      </div>
      <StatusPill status={doc.status} />
      {(canAttach || attached) && (
        <Button
          size="sm"
          variant={attached ? 'primary' : 'secondary'}
          onClick={() => onToggleAttach(!attached)}
        >
          {attached ? 'В сессии' : 'Прикрепить'}
        </Button>
      )}
      <button
        type="button"
        onClick={() => onDelete(doc.id)}
        title="Удалить документ"
        className="d9-icon-hover"
        style={{
          background: 'transparent',
          border: 0,
          color: 'var(--d9-ink-ghost)',
          cursor: 'pointer',
          padding: 6,
          borderRadius: 6,
          display: 'inline-flex',
          alignItems: 'center',
          transition: 'background 120ms, color 120ms',
        }}
      >
        <IconTrash size={14} />
      </button>
    </div>
  );
}

function StatusPill({ status }: { status: Document['status'] }) {
  // Map status → (label, tone). Pending/extracting/embedding all render
  // as "индексируем" to keep the surface simple; users don't benefit
  // from distinguishing the sub-stages at this stage of the product.
  const label: Record<Document['status'], string> = {
    pending: 'индексируем',
    extracting: 'индексируем',
    embedding: 'индексируем',
    ready: 'готов',
    failed: 'ошибка',
    deleting: 'удаляется',
  };
  const isReady = status === 'ready';
  const isFailed = status === 'failed';
  return (
    <span
      style={{
        fontSize: 10,
        fontFamily: 'var(--d9-font-mono)',
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        padding: '3px 9px',
        borderRadius: 999,
        background: isReady
          ? 'oklch(0.8 0.17 150 / 0.12)'
          : isFailed
            ? 'oklch(0.6 0.2 25 / 0.12)'
            : 'var(--d9-accent-glow)',
        color: isReady
          ? 'var(--d9-ok)'
          : isFailed
            ? 'oklch(0.75 0.18 25)'
            : 'var(--d9-accent-hi)',
        border: `0.5px solid ${
          isReady
            ? 'oklch(0.8 0.17 150 / 0.28)'
            : isFailed
              ? 'oklch(0.6 0.2 25 / 0.35)'
              : 'rgba(255, 59, 48, 0.35)'
        }`,
        whiteSpace: 'nowrap',
      }}
    >
      {label[status]}
    </span>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} Б`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} КБ`;
  return `${(n / (1024 * 1024)).toFixed(1)} МБ`;
}

function guessMIME(filename: string): string {
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  switch (ext) {
    case 'md':
    case 'markdown':
      return 'text/markdown';
    case 'html':
    case 'htm':
      return 'text/html';
    case 'pdf':
      return 'application/pdf';
    case 'docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    default:
      return 'text/plain';
  }
}

function humanizeError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  // Surface the server's message verbatim if it's present after the
  // status code, otherwise a generic fallback.
  const parts = msg.split(':');
  return parts[parts.length - 1]?.trim() || 'Ошибка запроса';
}

const emptyStyle: React.CSSProperties = {
  padding: '24px 20px',
  textAlign: 'center',
  borderRadius: 10,
  background: 'oklch(1 0 0 / 0.03)',
  border: '0.5px dashed var(--d9-hairline)',
  color: 'var(--d9-ink-mute)',
  fontSize: 12.5,
  letterSpacing: '-0.005em',
  lineHeight: 1.5,
};

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
        subtitle="Прозрачность окон Cue и размер окна чата"
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
        subtitle="Выдать сейчас или позже — без них Cue всё равно работает, но часть функций недоступна."
      />

      {needsRestart && (
        <div
          style={{
            padding: '10px 14px',
            borderRadius: 9,
            background: 'var(--d9-accent-glow)',
            border: '0.5px solid rgba(255, 59, 48, 0.35)',
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
      <SectionTitle title="О программе" subtitle="Cue" />
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
