// Settings — preferences surface для Hone.
//
// Sections:
//   - Background theme: 5 selectable cards с live mini-preview каждой темы.
//   - Pomodoro: длительность сессии (минуты).
//   - Audio: дефолтная громкость (slider).
//   - Notifications: on/off toggle.
//   - Shortcuts: read-only обзор существующих хоткеев.
//
// Persistence:
//   - Theme отдельно: localStorage 'hone:theme' (App.tsx читает его на mount).
//   - Остальное: localStorage 'hone:settings' JSON-блоб (read once, write on
//     every change). На MVP-этапе значения здесь только декларативные (App
//     ещё не подписан на pomodoro-длительность / volume default), но Settings
//     уже сохраняет их — backend wiring будет отдельной задачей.
import { useEffect, useState } from 'react';

import { CanvasBg, type ThemeId, THEME_IDS } from '../components/CanvasBg';
import { QuotaUsageBar } from '../components/QuotaUsageBar';
import { useQuotaStore } from '../stores/quota';
import { useSessionStore } from '../stores/session';
import {
  getStorageQuota,
  formatBytes,
  tierLabel,
  archiveOldestNotes,
  listDevices,
  revokeDevice,
  type StorageQuota,
  type Device,
} from '../api/storage';
import {
  initVault,
  unlockVault,
  lockVault,
  isUnlocked,
  subscribe as subscribeVault,
  fetchSalt,
} from '../api/vault';

interface HoneSettings {
  pomodoroMinutes: number;
  defaultVolume: number;
  notifications: boolean;
  // Ambient cosmic music — looping background track. ON by default;
  // юзер тoggle'ит здесь. Volume управляется тем же Dock slider'ом
  // (vol / 100 → audio.volume), поскольку ambient & podcast делят
  // одно audio bus.
  ambientMusic: boolean;
}

const SETTINGS_KEY = 'hone:settings';
const THEME_KEY = 'hone:theme';

const DEFAULTS: HoneSettings = {
  pomodoroMinutes: 25,
  defaultVolume: 40,
  notifications: true,
  ambientMusic: true,
};

export function readStoredTheme(): ThemeId {
  if (typeof window === 'undefined') return 'winter';
  try {
    const v = window.localStorage.getItem(THEME_KEY);
    if (v && (THEME_IDS as readonly string[]).includes(v)) return v as ThemeId;
  } catch {
    /* ignore */
  }
  return 'winter';
}

function readSettings(): HoneSettings {
  if (typeof window === 'undefined') return DEFAULTS;
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw);
    return {
      pomodoroMinutes: clampInt(parsed?.pomodoroMinutes, 5, 90, DEFAULTS.pomodoroMinutes),
      defaultVolume: clampInt(parsed?.defaultVolume, 0, 100, DEFAULTS.defaultVolume),
      notifications: typeof parsed?.notifications === 'boolean' ? parsed.notifications : DEFAULTS.notifications,
      ambientMusic: typeof parsed?.ambientMusic === 'boolean' ? parsed.ambientMusic : DEFAULTS.ambientMusic,
    };
  } catch {
    return DEFAULTS;
  }
}

function clampInt(v: unknown, lo: number, hi: number, fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return Math.max(lo, Math.min(hi, Math.round(v)));
}

interface SettingsPageProps {
  theme: ThemeId;
  onThemeChange: (t: ThemeId) => void;
}

export function SettingsPage({ theme, onThemeChange }: SettingsPageProps) {
  const [settings, setSettings] = useState<HoneSettings>(() => readSettings());

  useEffect(() => {
    try {
      window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      /* ignore quota / privacy mode */
    }
  }, [settings]);

  const setPomo = (n: number) => setSettings((s) => ({ ...s, pomodoroMinutes: n }));
  const setVol = (n: number) => setSettings((s) => ({ ...s, defaultVolume: n }));
  const setNotif = (b: boolean) => setSettings((s) => ({ ...s, notifications: b }));
  const setAmbient = (b: boolean) => setSettings((s) => ({ ...s, ambientMusic: b }));

  // Sync ambient toggle с audio bus'ом — start/stop loop track когда юзер
  // flip'ает switch. Lazy import чтобы bundle ambient-bus только при
  // открытии Settings.
  useEffect(() => {
    void import('../audio/ambient-music').then((m) => {
      if (settings.ambientMusic) m.startAmbient();
      else m.stopAmbient();
    });
  }, [settings.ambientMusic]);

  return (
    <div
      className="slide-from-bottom"
      style={{
        position: 'absolute',
        inset: 0,
        overflowY: 'auto',
        padding: '72px 48px 80px',
      }}
    >
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        <SectionHead label="SETTINGS" />
        <h1 style={{ margin: '8px 0 36px', fontSize: 28, fontWeight: 500, letterSpacing: '-0.015em' }}>
          Preferences
        </h1>

        {/* ════════════════════════════════════════════════════════
            APPEARANCE — что окружает работу. Theme = ambient bg motion. */}
        <SectionGroup title="Appearance">
          <Section title="BACKGROUND THEME" hint="Ambient motion behind your work.">
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
                gap: 14,
              }}
            >
              {THEME_IDS.map((id) => (
                <ThemeCard
                  key={id}
                  id={id}
                  active={theme === id}
                  onPick={() => {
                    onThemeChange(id);
                    try {
                      window.localStorage.setItem(THEME_KEY, id);
                    } catch {
                      /* ignore */
                    }
                  }}
                />
              ))}
            </div>
          </Section>
        </SectionGroup>

        {/* ════════════════════════════════════════════════════════
            FOCUS — настройки фокус-сессии: длительность + аудио. */}
        <SectionGroup title="Focus">
          <Section title="POMODORO" hint="Default focus session length.">
            <Slider
              min={5}
              max={90}
              step={5}
              value={settings.pomodoroMinutes}
              onChange={setPomo}
              unit="min"
            />
          </Section>
          <Section title="AUDIO" hint="Default ambient sound volume.">
            <Slider min={0} max={100} step={5} value={settings.defaultVolume} onChange={setVol} unit="%" />
          </Section>
          <Section title="NOTIFICATIONS" hint="System notification when a session ends.">
            <Toggle value={settings.notifications} onChange={setNotif} label={settings.notifications ? 'On' : 'Off'} />
          </Section>
          <Section
            title="AMBIENT COSMIC MUSIC"
            hint="Looping space-themed background track. Volume controlled by the Dock slider — same bus as podcasts."
          >
            <Toggle
              value={settings.ambientMusic}
              onChange={setAmbient}
              label={settings.ambientMusic ? 'On' : 'Off'}
            />
          </Section>
        </SectionGroup>

        {/* ════════════════════════════════════════════════════════
            ACCOUNT — tier-quota, storage, devices. Всё что про лимиты
            аккаунта и cross-device синхронизацию. */}
        <SectionGroup title="Account">
          <Section
            title="USAGE"
            hint="Where you stand against your tier limits."
          >
            <SubscriptionUsageSection />
          </Section>
          <Section
            title="STORAGE"
            hint="Live notes & whiteboards (archived items don't count)."
          >
            <StorageSection />
          </Section>
          <Section
            title="DEVICES"
            hint="Active sign-ins. Free tier: 1 device. Seeker+: unlimited."
          >
            <DevicesSection />
          </Section>
          <Section
            title="SIGN OUT"
            hint="Wipe local session token. Notes / boards / today data stays on device until you log back in."
          >
            <SignOutSection />
          </Section>
        </SectionGroup>

        {/* ════════════════════════════════════════════════════════
            PRIVACY — vault E2E. Отдельной группой потому что есть
            уникальный «no recovery» tradeoff и стоит выделить. */}
        <SectionGroup title="Privacy">
          <Section
            title="PRIVATE VAULT"
            hint="End-to-end encryption for sensitive notes. Server can't read them — but coach memory, search, and publish-to-web won't work for encrypted notes. No password recovery."
          >
            <VaultSection />
          </Section>
        </SectionGroup>

        {/* ════════════════════════════════════════════════════════
            SYSTEM — клавиатурные ярлыки. Reference, не настройка. */}
        <SectionGroup title="System">
          <Section title="KEYBOARD SHORTCUTS" hint="Press from any non-text surface.">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 24px' }}>
              <ShortcutRow keys={['⌘', 'K']} label="Open command palette" />
              <ShortcutRow keys={['⌘', 'S']} label="Toggle sidebar" />
              <ShortcutRow keys={['T']} label="Today" />
              <ShortcutRow keys={['N']} label="Notes" />
              <ShortcutRow keys={['B']} label="Shared boards" />
              <ShortcutRow keys={['C']} label="Code rooms" />
              <ShortcutRow keys={['E']} label="Events" />
              <ShortcutRow keys={['P']} label="Podcasts" />
              <ShortcutRow keys={['S']} label="Stats" />
              <ShortcutRow keys={[',']} label="Settings" />
              <ShortcutRow keys={['Esc']} label="Back / dismiss" />
              <ShortcutRow keys={['↤', '2-finger']} label="Swipe left → Stats" />
              <ShortcutRow keys={['↦', '2-finger']} label="Swipe right → Close" />
            </div>
          </Section>
        </SectionGroup>
      </div>
    </div>
  );
}

// ─── Subcomponents ─────────────────────────────────────────────────────

// SectionGroup — крупный раздел Settings, объединяет логически связанные
// Section'ы (Appearance / Focus / Account / Privacy / System). Visual
// hierarchy: title крупным шрифтом + тонкая разделительная линия + отступ.
function SectionGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ margin: '0 0 56px' }}>
      <h2
        style={{
          fontSize: 22,
          fontWeight: 600,
          letterSpacing: '-0.01em',
          color: 'var(--ink)',
          margin: '0 0 4px',
        }}
      >
        {title}
      </h2>
      <div
        aria-hidden
        style={{
          height: 1,
          background: 'rgba(255,255,255,0.08)',
          margin: '0 0 28px',
        }}
      />
      {children}
    </div>
  );
}

function SectionHead({ label }: { label: string }) {
  return (
    <div className="mono" style={{ fontSize: 10, letterSpacing: '.24em', color: 'var(--ink-40)' }}>
      {label}
    </div>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section style={{ margin: '0 0 44px' }}>
      <div className="mono" style={{ fontSize: 10, letterSpacing: '.24em', color: 'var(--ink-60)' }}>
        {title}
      </div>
      {hint && (
        <div style={{ fontSize: 12, color: 'var(--ink-40)', margin: '6px 0 16px' }}>{hint}</div>
      )}
      <div style={{ marginTop: hint ? 0 : 14 }}>{children}</div>
    </section>
  );
}

function ThemeCard({
  id,
  active,
  onPick,
}: {
  id: ThemeId;
  active: boolean;
  onPick: () => void;
}) {
  return (
    <button
      onClick={onPick}
      className="surface lift"
      style={{
        position: 'relative',
        padding: 0,
        height: 120,
        borderRadius: 10,
        overflow: 'hidden',
        cursor: 'pointer',
        background: '#000',
        border: active ? '1px solid rgba(255,255,255,0.55)' : '1px solid rgba(255,255,255,0.08)',
        boxShadow: active
          ? '0 0 0 3px rgba(255,255,255,0.08), 0 8px 28px -10px rgba(255,255,255,0.18)'
          : '0 4px 14px -8px rgba(0,0,0,0.6)',
        textAlign: 'left',
      }}
    >
      <div style={{ position: 'absolute', inset: 0 }}>
        {/* Live mini-preview — one pass through CanvasBg, scaled down via container */}
        <div style={{ position: 'absolute', inset: 0 }}>
          <CanvasBg theme={id} mode="full" />
        </div>
        {/* Bottom-fade label */}
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            padding: '20px 12px 10px',
            background: 'linear-gradient(to top, rgba(0,0,0,0.85), transparent)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span
            className="mono"
            style={{
              fontSize: 10,
              letterSpacing: '.18em',
              color: active ? 'var(--ink)' : 'var(--ink-60)',
              textTransform: 'uppercase',
            }}
          >
            {labelFor(id)}
          </span>
          {active && (
            <span
              className="mono"
              style={{
                fontSize: 9,
                letterSpacing: '.16em',
                color: 'var(--ink)',
                padding: '2px 6px',
                borderRadius: 4,
                background: 'rgba(255,255,255,0.12)',
              }}
            >
              ACTIVE
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

function labelFor(id: ThemeId): string {
  switch (id) {
    case 'winter':
      return 'Winter';
    case 'aurora':
      return 'Aurora';
    case 'grid-rain':
      return 'Grid rain';
    case 'particles':
      return 'Particles';
    case 'abyss':
      return 'Abyss';
    case 'cosmic':
      return 'Cosmic';
  }
}

function Slider({
  min,
  max,
  step,
  value,
  onChange,
  unit,
}: {
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
  unit: string;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value, 10))}
        style={{ flex: 1, height: 4, accentColor: '#fff', cursor: 'pointer' }}
      />
      <span
        className="mono"
        style={{ fontSize: 12, color: 'var(--ink)', minWidth: 64, textAlign: 'right' }}
      >
        {value} {unit}
      </span>
    </div>
  );
}

function Toggle({
  value,
  onChange,
  label,
}: {
  value: boolean;
  onChange: (b: boolean) => void;
  label: string;
}) {
  return (
    <button
      onClick={() => onChange(!value)}
      className="focus-ring"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 12,
        cursor: 'pointer',
        padding: 0,
        background: 'transparent',
        border: 'none',
      }}
    >
      <span
        style={{
          position: 'relative',
          width: 38,
          height: 22,
          borderRadius: 999,
          background: value ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.1)',
          border: '1px solid rgba(255,255,255,0.12)',
          transition: 'background-color var(--t-fast)',
        }}
      >
        <span
          style={{
            position: 'absolute',
            top: 2,
            left: value ? 18 : 2,
            width: 16,
            height: 16,
            borderRadius: '50%',
            background: value ? '#000' : '#fff',
            transition: 'left var(--t-base), background-color var(--t-fast)',
          }}
        />
      </span>
      <span style={{ fontSize: 13, color: 'var(--ink-90)' }}>{label}</span>
    </button>
  );
}

function ShortcutRow({ keys, label }: { keys: string[]; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <span style={{ display: 'inline-flex', gap: 4 }}>
        {keys.map((k, i) => (
          <span key={i} className="kbd mono">
            {k}
          </span>
        ))}
      </span>
      <span style={{ fontSize: 12.5, color: 'var(--ink-60)' }}>{label}</span>
    </div>
  );
}

// SubscriptionUsageSection — bars для всех subscription resource'ов
// (synced notes, shared boards, shared rooms, AI calls). Источник —
// useQuotaStore (refresh'ится из App.tsx hourly + on signin). Free-tier
// показывает «10 / 10», Seeker «100 / 100», Ascended «∞» (unlimited).
function SubscriptionUsageSection() {
  const tier = useQuotaStore((s) => s.tier);
  const refresh = useQuotaStore((s) => s.refresh);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const tierLabel = tier === 'ascended' ? 'Ascended' : tier === 'seeker' ? 'Seeker' : 'Free';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div className="mono" style={{ fontSize: 10, letterSpacing: '0.2em', color: 'var(--ink-60)', marginBottom: 6 }}>
        TIER: {tierLabel.toUpperCase()}
      </div>
      <QuotaUsageBar resource="synced_notes" variant="full" />
      <QuotaUsageBar resource="active_shared_boards" variant="full" />
      <QuotaUsageBar resource="active_shared_rooms" variant="full" />
      <QuotaUsageBar resource="ai_this_month" variant="full" />
    </div>
  );
}

// StorageSection — usage-bar plus tier badge. Один fetch на mount;
// данные с бэкенда отстают до часа (cron — см. backend services/storage.go),
// поэтому realtime refresh не имеет смысла. Если backend упал или юзер
// не залогинен — показываем neutral placeholder, не фейлим страницу.
function StorageSection() {
  const [data, setData] = useState<StorageQuota | null>(null);
  const [errored, setErrored] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    setData(null);
    setErrored(false);
    void getStorageQuota()
      .then((q) => {
        if (live) setData(q);
      })
      .catch(() => {
        if (live) setErrored(true);
      });
    return () => {
      live = false;
    };
  }, [tick]);

  if (errored) {
    return (
      <div style={{ fontSize: 13, color: 'var(--ink-60)' }}>
        Storage usage unavailable right now.
      </div>
    );
  }
  if (!data) {
    return (
      <div style={{ fontSize: 13, color: 'var(--ink-40)' }}>Loading…</div>
    );
  }

  const pct = data.quotaBytes > 0 ? Math.min(100, (data.usedBytes / data.quotaBytes) * 100) : 0;
  const overSoft = pct >= 80;

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          marginBottom: 8,
        }}
      >
        <span style={{ fontSize: 13, color: 'var(--ink-90)' }}>
          {formatBytes(data.usedBytes)}{' '}
          <span style={{ color: 'var(--ink-40)' }}>
            / {formatBytes(data.quotaBytes)}
          </span>
        </span>
        <span
          className="mono"
          style={{
            fontSize: 10,
            letterSpacing: '0.18em',
            padding: '3px 8px',
            borderRadius: 999,
            border: '1px solid var(--ink-20)',
            color: 'var(--ink-60)',
          }}
        >
          {tierLabel(data.tier).toUpperCase()}
        </span>
      </div>
      <div
        style={{
          height: 6,
          borderRadius: 3,
          background: 'var(--ink-10)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            background: overSoft ? 'rgba(255,140,90,0.85)' : 'var(--ink-90)',
            transition: 'width 240ms ease, background-color 180ms ease',
          }}
        />
      </div>
      {/* Archive control — особенно полезно при overSoft. Не блокируем при
          ниже-cap'е: юзер может профилактически чистить старое. */}
      <ArchiveControl onDone={() => setTick((t) => t + 1)} />
      {data.tier === 'free' && (
        <div
          style={{
            marginTop: 14,
            padding: '12px 14px',
            borderRadius: 10,
            border: '1px solid var(--ink-10)',
            background: 'var(--surface)',
          }}
        >
          <div style={{ fontSize: 13, color: 'var(--ink-90)', marginBottom: 4 }}>
            Sync across devices · Seeker
          </div>
          <div style={{ fontSize: 12, color: 'var(--ink-60)', lineHeight: 1.45 }}>
            Free tier keeps data on this device only. Upgrade to sync notes,
            whiteboards and coach memory between desktop and other devices —
            10&nbsp;GB on Seeker, 100&nbsp;GB on Ascended.
          </div>
        </div>
      )}
    </div>
  );
}

// ArchiveControl — единственная кнопка «Archive 10 oldest notes».
// Без подтверждения: archive ≠ delete (recoverable), и UX-друже­люб­нее
// сразу выполнить. Если юзер кликнул случайно — open Notes → восстановить.
function ArchiveControl({ onDone }: { onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const onClick = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const n = await archiveOldestNotes(10);
      setMsg(n === 0 ? 'No active notes to archive.' : `Archived ${n} note${n === 1 ? '' : 's'}.`);
      onDone();
    } catch {
      setMsg('Archive failed — try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 12 }}>
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        className="focus-ring"
        style={{
          padding: '6px 12px',
          fontSize: 12.5,
          background: 'transparent',
          border: '1px solid var(--ink-20)',
          borderRadius: 8,
          color: 'var(--ink-90)',
          cursor: busy ? 'default' : 'pointer',
          opacity: busy ? 0.5 : 1,
          transition: 'opacity 150ms ease, background-color 150ms ease',
        }}
      >
        {busy ? 'Archiving…' : 'Archive 10 oldest notes'}
      </button>
      {msg ? <span style={{ fontSize: 12, color: 'var(--ink-60)' }}>{msg}</span> : null}
    </div>
  );
}

// DevicesSection — list active devices + revoke. Регистрация текущего
// устройства происходит автоматически в App-bootstrap'е (см. отдельную
// задачу — пока здесь только просмотр + revoke).
// SignOutSection — кнопка выхода. Wipe'ает access/refresh tokens из
// keychain'а и in-memory store'а. Local IndexedDB (notes, ydoc) НЕ
// трогаем — юзер может logout'ниться и снова login'ниться, его данные
// останутся доступны (и снова отсинкаются с server'ом). Это явный
// контракт: log out = forget who I am, не «wipe my data».
function SignOutSection() {
  const userId = useSessionStore((s) => s.userId);
  const status = useSessionStore((s) => s.status);
  const clear = useSessionStore((s) => s.clear);
  const [busy, setBusy] = useState(false);

  if (status !== 'signed_in') {
    return (
      <div style={{ fontSize: 13, color: 'var(--ink-60)' }}>
        You're signed out. Open the login screen to sign back in.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="mono" style={{ fontSize: 11, color: 'var(--ink-40)', letterSpacing: '0.06em' }}>
        Signed in as {userId ? `${userId.slice(0, 8)}…${userId.slice(-4)}` : 'unknown'}
      </div>
      <button
        onClick={async () => {
          if (busy) return;
          setBusy(true);
          try {
            await clear();
            // App.tsx subscribed на status; SignedOut → LoginScreen
            // отрисуется автоматом, manual reload не нужен.
          } finally {
            setBusy(false);
          }
        }}
        disabled={busy}
        style={{
          alignSelf: 'flex-start',
          padding: '8px 18px',
          fontSize: 12.5,
          fontWeight: 500,
          color: '#fff',
          background: busy ? 'rgba(255,106,106,0.4)' : '#ff6a6a',
          border: 'none',
          borderRadius: 8,
          cursor: busy ? 'default' : 'pointer',
          transition: 'background-color 160ms ease',
        }}
      >
        {busy ? 'Signing out…' : 'Sign out'}
      </button>
    </div>
  );
}

function DevicesSection() {
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [errored, setErrored] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    setDevices(null);
    setErrored(false);
    void listDevices()
      .then((d) => {
        if (live) setDevices(d);
      })
      .catch(() => {
        if (live) setErrored(true);
      });
    return () => {
      live = false;
    };
  }, [tick]);

  if (errored) {
    return (
      <div style={{ fontSize: 13, color: 'var(--ink-60)' }}>
        Device list unavailable right now.
      </div>
    );
  }
  if (!devices) {
    return <div style={{ fontSize: 13, color: 'var(--ink-40)' }}>Loading…</div>;
  }
  if (devices.length === 0) {
    return (
      <div style={{ fontSize: 13, color: 'var(--ink-60)' }}>
        No devices registered yet.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {devices.map((d) => (
        <DeviceRow key={d.id} device={d} onRevoke={() => setTick((t) => t + 1)} />
      ))}
    </div>
  );
}

function DeviceRow({ device, onRevoke }: { device: Device; onRevoke: () => void }) {
  const [busy, setBusy] = useState(false);
  const onClick = async () => {
    setBusy(true);
    try {
      await revokeDevice(device.id);
      onRevoke();
    } catch {
      setBusy(false);
    }
  };
  const seen = new Date(device.lastSeenAt);
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 12px',
        borderRadius: 10,
        border: '1px solid var(--ink-10)',
        background: 'var(--surface)',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, color: 'var(--ink-90)' }}>{device.name}</div>
        <div className="mono" style={{ fontSize: 11, color: 'var(--ink-40)', marginTop: 2 }}>
          {device.platform.toUpperCase()}
          {device.appVersion ? ` · v${device.appVersion}` : ''}
          {' · last seen '}
          {Number.isFinite(seen.getTime()) ? seen.toLocaleString() : '—'}
        </div>
      </div>
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        className="focus-ring"
        style={{
          padding: '5px 10px',
          fontSize: 12,
          background: 'transparent',
          border: '1px solid var(--ink-20)',
          borderRadius: 6,
          color: 'var(--ink-60)',
          cursor: busy ? 'default' : 'pointer',
        }}
      >
        {busy ? '…' : 'Revoke'}
      </button>
    </div>
  );
}

// VaultSection — Private Vault status + setup / unlock / lock controls.
// Three states:
//   1. Not initialised: «Set up Vault» button → POST /vault/init + prompt
//      password → unlockVault() → store key in memory.
//   2. Initialised + locked: «Unlock» button → password prompt →
//      unlockVault() (re-derive same key from same salt).
//   3. Initialised + unlocked: «Lock now» button + status badge.
function VaultSection() {
  // 'unknown' пока не определили (initial fetchSalt), 'none' = не initialised,
  // 'locked' = initialised но not unlocked, 'unlocked' = ready.
  const [state, setState] = useState<'unknown' | 'none' | 'locked' | 'unlocked'>('unknown');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Inline password inputs. window.prompt() в Electron renderer ВОЗВРАЩАЕТ
  // NULL без показа диалога (Chromium блокирует prompt по дефолту в Electron),
  // поэтому раньше клик Unlock молча ничего не делал. Используем inline form.
  const [pwd1, setPwd1] = useState('');
  const [pwd2, setPwd2] = useState('');
  const [showSetupForm, setShowSetupForm] = useState(false);
  const [showUnlockForm, setShowUnlockForm] = useState(false);

  // Sync with vault module state on subscribe.
  useEffect(() => {
    const refresh = async () => {
      if (isUnlocked()) {
        setState('unlocked');
        return;
      }
      try {
        const salt = await fetchSalt();
        setState(salt ? 'locked' : 'none');
      } catch {
        setState('locked'); // network blip — assume initialised
      }
    };
    void refresh();
    return subscribeVault((unlocked) => {
      if (unlocked) setState('unlocked');
      else void refresh();
    });
  }, []);

  // persistPassphraseSilently — сохраняем passphrase в OS keychain через
  // preload bridge. Безопасный no-op если safeStorage недоступен (Linux
  // без gnome-keyring) — юзер просто введёт passphrase следующий раз.
  const persistPassphraseSilently = async (pass: string) => {
    const bridge = typeof window !== 'undefined' ? window.hone : undefined;
    if (!bridge?.vault) return;
    try {
      await bridge.vault.passSave(pass);
    } catch {
      /* ignore */
    }
  };

  const resetForms = () => {
    setPwd1('');
    setPwd2('');
    setShowSetupForm(false);
    setShowUnlockForm(false);
    setError(null);
  };

  const onSetUp = async () => {
    setError(null);
    if (pwd1.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    if (pwd1 !== pwd2) {
      setError('Passwords do not match');
      return;
    }
    setBusy(true);
    try {
      await initVault();
      await unlockVault(pwd1);
      await persistPassphraseSilently(pwd1);
      resetForms();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onUnlock = async () => {
    setError(null);
    if (!pwd1) {
      setError('Enter your Vault password');
      return;
    }
    setBusy(true);
    try {
      await unlockVault(pwd1);
      // КРИТИЧНО: persist в Keychain ПОСЛЕ unlock — иначе следующий restart
      // снова попросит password (раньше Settings-flow не сохранял; только
      // VaultUnlockGate-flow сохранял).
      await persistPassphraseSilently(pwd1);
      resetForms();
    } catch (e) {
      setError(`Wrong password or vault corrupted: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const onLock = () => {
    lockVault();
    // Очищаем сохранённый passphrase из keychain — иначе при следующем
    // launch'е VaultUnlockGate auto-unlock'нет и юзер не сможет «оставаться
    // locked». Юзер явно сказал Lock — уважаем намерение.
    const bridge = typeof window !== 'undefined' ? window.hone : undefined;
    if (bridge?.vault) {
      void bridge.vault.passClear().catch(() => {
        /* ignore */
      });
    }
  };

  if (state === 'unknown') {
    return <div style={{ fontSize: 13, color: 'var(--ink-40)' }}>Loading…</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Большой объясняющий блок — что такое vault и зачем lock-icon
          в Notes. Юзер не должен идти в документацию чтобы понять. */}
      <div
        style={{
          display: 'flex',
          gap: 14,
          padding: '14px 16px',
          borderRadius: 12,
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid var(--ink-10)',
        }}
      >
        <div
          style={{
            width: 36,
            height: 36,
            flexShrink: 0,
            display: 'grid',
            placeItems: 'center',
            borderRadius: 10,
            background: 'rgba(255,255,255,0.04)',
            color: 'var(--ink-60)',
          }}
        >
          <LockIcon size={18} />
        </div>
        <div style={{ flex: 1, fontSize: 13, color: 'var(--ink-90)', lineHeight: 1.55 }}>
          <div style={{ marginBottom: 4, color: 'var(--ink)' }}>
            How encryption works
          </div>
          <div style={{ color: 'var(--ink-60)' }}>
            Once Vault is set up, every note in the sidebar gets a small{' '}
            <LockGlyph /> icon next to its three-dots menu. Click it on a sensitive
            note to encrypt the body before it reaches our servers. Encrypted notes
            stay readable to you on any of your devices (when Vault is unlocked),
            but invisible to coach AI, search, and publish-to-web.
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <VaultStatusBadge state={state} />
        {state === 'none' && !showSetupForm && (
          <VaultButton onClick={() => setShowSetupForm(true)} disabled={busy} primary>
            Set up Vault
          </VaultButton>
        )}
        {state === 'locked' && !showUnlockForm && (
          <VaultButton onClick={() => setShowUnlockForm(true)} disabled={busy} primary>
            Unlock
          </VaultButton>
        )}
        {state === 'unlocked' && (
          <VaultButton onClick={onLock} disabled={busy}>
            Lock now
          </VaultButton>
        )}
      </div>

      {/* Inline setup form — replaces window.prompt (broken in Electron).
          Two password fields: confirm + visible/hidden via type=password. */}
      {state === 'none' && showSetupForm && (
        <VaultPasswordForm
          mode="setup"
          pwd1={pwd1}
          pwd2={pwd2}
          onPwd1Change={setPwd1}
          onPwd2Change={setPwd2}
          onSubmit={onSetUp}
          onCancel={resetForms}
          busy={busy}
        />
      )}
      {state === 'locked' && showUnlockForm && (
        <VaultPasswordForm
          mode="unlock"
          pwd1={pwd1}
          pwd2=""
          onPwd1Change={setPwd1}
          onPwd2Change={() => undefined}
          onSubmit={onUnlock}
          onCancel={resetForms}
          busy={busy}
        />
      )}
      {error ? (
        <div style={{ fontSize: 12.5, color: '#ff6a6a' }}>{error}</div>
      ) : (
        <div style={{ fontSize: 12, color: 'var(--ink-40)', lineHeight: 1.55 }}>
          {state === 'none' &&
            'After setup, lock icons appear next to each note in the sidebar.'}
          {state === 'locked' &&
            'Vault is set up. Unlock with your password to read or encrypt notes.'}
          {state === 'unlocked' &&
            'Vault unlocked for this session. Auto-locks on close, sign-out, or app reload.'}
        </div>
      )}
    </div>
  );
}

// LockIcon — компактный SVG-замочек в нашем стиле (stroke-only, 1.6 thin).
// Используется и в explainer'е (большой 18px), и в three-dots Notes UI
// (маленький 12px) — после wire-up в Notes.tsx.
function LockIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

// LockGlyph — inline-glyph для текста (нативный em-size). Используется
// внутри предложения «click the [icon] to encrypt» чтобы юзер видел
// именно тот icon что в Notes UI.
function LockGlyph() {
  return (
    <span
      style={{
        display: 'inline-flex',
        verticalAlign: 'middle',
        margin: '0 2px',
        color: 'var(--ink)',
      }}
    >
      <LockIcon size={13} />
    </span>
  );
}

// VaultPasswordForm — inline replacement для window.prompt() который
// в Electron renderer не работает (Chromium блокирует JS-prompt). Mode:
// 'setup' рендерит два поля + warning, 'unlock' — одно поле.
function VaultPasswordForm({
  mode,
  pwd1,
  pwd2,
  onPwd1Change,
  onPwd2Change,
  onSubmit,
  onCancel,
  busy,
}: {
  mode: 'setup' | 'unlock';
  pwd1: string;
  pwd2: string;
  onPwd1Change: (v: string) => void;
  onPwd2Change: (v: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  busy: boolean;
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        padding: 14,
        borderRadius: 10,
        background: 'rgba(255,255,255,0.02)',
        border: '1px solid var(--ink-10)',
      }}
    >
      {mode === 'setup' && (
        <div style={{ fontSize: 12, color: 'var(--ink-60)', lineHeight: 1.55, marginBottom: 4 }}>
          Choose a Vault password (min 8 chars). <strong style={{ color: '#ff9e7a' }}>No recovery</strong>{' '}
          — if you forget it, all encrypted notes are permanently lost.
        </div>
      )}
      <input
        type="password"
        value={pwd1}
        onChange={(e) => onPwd1Change(e.target.value)}
        placeholder={mode === 'setup' ? 'New password' : 'Vault password'}
        autoFocus
        autoComplete={mode === 'setup' ? 'new-password' : 'current-password'}
        style={{
          padding: '8px 12px',
          fontSize: 13,
          borderRadius: 8,
          border: '1px solid var(--ink-10)',
          background: 'rgba(255,255,255,0.03)',
          color: 'var(--ink)',
          outline: 'none',
        }}
      />
      {mode === 'setup' && (
        <input
          type="password"
          value={pwd2}
          onChange={(e) => onPwd2Change(e.target.value)}
          placeholder="Confirm password"
          autoComplete="new-password"
          style={{
            padding: '8px 12px',
            fontSize: 13,
            borderRadius: 8,
            border: '1px solid var(--ink-10)',
            background: 'rgba(255,255,255,0.03)',
            color: 'var(--ink)',
            outline: 'none',
          }}
        />
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
        <VaultButton onClick={onSubmit} disabled={busy} primary>
          {busy ? '…' : mode === 'setup' ? 'Set up' : 'Unlock'}
        </VaultButton>
        <VaultButton onClick={onCancel} disabled={busy}>
          Cancel
        </VaultButton>
      </div>
    </form>
  );
}

function VaultStatusBadge({ state }: { state: 'none' | 'locked' | 'unlocked' }) {
  const label = state === 'none' ? 'NOT SET UP' : state === 'locked' ? 'LOCKED' : 'UNLOCKED';
  const color = state === 'unlocked' ? '#7fd49b' : state === 'locked' ? 'var(--ink-60)' : 'var(--ink-40)';
  return (
    <span
      className="mono"
      style={{
        fontSize: 10,
        letterSpacing: '0.18em',
        padding: '4px 10px',
        borderRadius: 999,
        border: `1px solid ${color}`,
        color,
      }}
    >
      {label}
    </span>
  );
}

function VaultButton({
  children,
  onClick,
  disabled,
  primary = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="focus-ring"
      style={{
        padding: '7px 14px',
        fontSize: 12.5,
        background: primary ? 'rgba(255,255,255,0.08)' : 'transparent',
        border: '1px solid var(--ink-20)',
        borderRadius: 8,
        color: 'var(--ink-90)',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: 'background-color 160ms ease, opacity 160ms ease',
      }}
      onMouseEnter={(e) => {
        if (!disabled) e.currentTarget.style.background = 'rgba(255,255,255,0.12)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = primary ? 'rgba(255,255,255,0.08)' : 'transparent';
      }}
    >
      {children}
    </button>
  );
}
