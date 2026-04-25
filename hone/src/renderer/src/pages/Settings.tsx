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
}

const SETTINGS_KEY = 'hone:settings';
const THEME_KEY = 'hone:theme';

const DEFAULTS: HoneSettings = {
  pomodoroMinutes: 25,
  defaultVolume: 40,
  notifications: true,
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

        {/* ── Theme selector ───────────────────────────────────── */}
        <Section title="BACKGROUND THEME" hint="Choose the ambient motion that lives behind your work.">
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

        {/* ── Pomodoro ──────────────────────────────────────────── */}
        <Section title="POMODORO" hint="Default session length for the focus timer.">
          <Slider
            min={5}
            max={90}
            step={5}
            value={settings.pomodoroMinutes}
            onChange={setPomo}
            unit="min"
          />
        </Section>

        {/* ── Audio ────────────────────────────────────────────── */}
        <Section title="AUDIO" hint="Default volume when ambient sound starts.">
          <Slider min={0} max={100} step={5} value={settings.defaultVolume} onChange={setVol} unit="%" />
        </Section>

        {/* ── Storage ──────────────────────────────────────────── */}
        <Section
          title="STORAGE"
          hint="How much of your tier you've used. Free tier is single-device; Pro syncs across devices."
        >
          <StorageSection />
        </Section>

        {/* ── Devices ──────────────────────────────────────────── */}
        <Section
          title="DEVICES"
          hint="Devices that are currently signed in. Free tier supports 1 active device; Pro removes the limit."
        >
          <DevicesSection />
        </Section>

        {/* ── Private Vault ────────────────────────────────────── */}
        <Section
          title="PRIVATE VAULT"
          hint="End-to-end encryption for sensitive notes. Server can't read encrypted notes — but coach memory, search, and publish-to-web won't work for them either. There is no password recovery."
        >
          <VaultSection />
        </Section>

        {/* ── Notifications ────────────────────────────────────── */}
        <Section title="NOTIFICATIONS" hint="System notifications when a session ends.">
          <Toggle value={settings.notifications} onChange={setNotif} label={settings.notifications ? 'On' : 'Off'} />
        </Section>

        {/* ── Shortcuts ────────────────────────────────────────── */}
        <Section title="KEYBOARD SHORTCUTS" hint="Press from any non-text surface.">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 24px' }}>
            <ShortcutRow keys={['⌘', 'K']} label="Open command palette" />
            <ShortcutRow keys={['⌘', '⇧', 'Space']} label="Open Copilot" />
            <ShortcutRow keys={['T']} label="Today" />
            <ShortcutRow keys={['N']} label="Notes" />
            <ShortcutRow keys={['D']} label="Whiteboard" />
            <ShortcutRow keys={['B']} label="Shared boards" />
            <ShortcutRow keys={['E']} label="Code rooms" />
            <ShortcutRow keys={['V']} label="Events" />
            <ShortcutRow keys={['P']} label="Podcasts" />
            <ShortcutRow keys={['S']} label="Stats" />
            <ShortcutRow keys={[',']} label="Settings" />
            <ShortcutRow keys={['Esc']} label="Back / dismiss" />
          </div>
        </Section>
      </div>
    </div>
  );
}

// ─── Subcomponents ─────────────────────────────────────────────────────
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
            Sync across devices · Pro
          </div>
          <div style={{ fontSize: 12, color: 'var(--ink-60)', lineHeight: 1.45 }}>
            Free tier keeps data on this device only. Upgrade to sync notes,
            whiteboards and coach memory between desktop and other devices —
            10&nbsp;GB on Pro, 100&nbsp;GB on Pro+.
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

  const onSetUp = async () => {
    setError(null);
    const pwd = window.prompt(
      'Choose a Vault password (min 8 chars).\n\n' +
        'WARNING: there is no recovery. If you forget this password,\n' +
        'all encrypted notes are permanently lost.',
    );
    if (!pwd) return;
    if (pwd.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    const confirm = window.prompt('Confirm password:');
    if (confirm !== pwd) {
      setError('Passwords do not match');
      return;
    }
    setBusy(true);
    try {
      await initVault();
      await unlockVault(pwd);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onUnlock = async () => {
    setError(null);
    const pwd = window.prompt('Vault password:');
    if (!pwd) return;
    setBusy(true);
    try {
      await unlockVault(pwd);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onLock = () => {
    lockVault();
  };

  if (state === 'unknown') {
    return <div style={{ fontSize: 13, color: 'var(--ink-40)' }}>Loading…</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <VaultStatusBadge state={state} />
        {state === 'none' && (
          <VaultButton onClick={onSetUp} disabled={busy} primary>
            {busy ? 'Setting up…' : 'Set up Vault'}
          </VaultButton>
        )}
        {state === 'locked' && (
          <VaultButton onClick={onUnlock} disabled={busy} primary>
            {busy ? 'Unlocking…' : 'Unlock'}
          </VaultButton>
        )}
        {state === 'unlocked' && (
          <VaultButton onClick={onLock} disabled={busy}>
            Lock now
          </VaultButton>
        )}
      </div>
      {error ? (
        <div style={{ fontSize: 12.5, color: '#ff6a6a' }}>{error}</div>
      ) : (
        <div style={{ fontSize: 12, color: 'var(--ink-40)', lineHeight: 1.55 }}>
          {state === 'none' &&
            'After setup you can mark individual notes as encrypted from the three-dots menu.'}
          {state === 'locked' &&
            'Vault is set up. Unlock to read or write encrypted notes; they are unreadable while locked.'}
          {state === 'unlocked' &&
            'Vault is unlocked for this session. Closing the app or signing out re-locks automatically.'}
        </div>
      )}
    </div>
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
