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

import { type ThemeId, THEME_IDS } from '../../components/CanvasBg';
import {
  readPomodoroSeconds as readPomodoroSecondsFromPrefs,
  readDailyGoalMin as readDailyGoalMinFromPrefs,
  readStoredTheme as readStoredThemeFromPrefs,
} from '../../stores/prefs';
import { DeveloperToolsSection } from '../../components/DeveloperToolsSection';
import { ResourceLibrarySection } from '../../components/ResourceLibrarySection';

import {
  readSettings,
  SETTINGS_KEY,
  THEME_KEY,
  type HoneSettings,
} from './lib/settings-store';
import { Section, SectionGroup, SectionHead } from './primitives/SectionGroup';
import { Slider } from './primitives/Slider';
import { Toggle } from './primitives/Toggle';
import { ThemeCard } from './primitives/ThemeCard';
import { ShortcutRow } from './primitives/ShortcutRow';
import { SubscriptionUsageSection } from './sections/SubscriptionUsageSection';
import { StorageSection } from './sections/StorageSection';
import { DevicesSection } from './sections/DevicesSection';
import { SignOutSection } from './sections/SignOutSection';
import { AnalyticsConsentSection } from './sections/AnalyticsConsentSection';
import { EcosystemSection } from './sections/EcosystemSection';
import { VaultSection } from './sections/VaultSection';

/** Re-exported from stores/prefs so legacy import paths keep working. */
export const readPomodoroSeconds = readPomodoroSecondsFromPrefs;
export const readDailyGoalMin = readDailyGoalMinFromPrefs;
export const readStoredTheme = readStoredThemeFromPrefs;

interface SettingsPageProps {
  theme: ThemeId;
  onThemeChange: (t: ThemeId) => void;
  /** Called whenever the user changes the pomodoro duration. Seconds value. */
  onPomoChange?: (secs: number) => void;
}

export function SettingsPage({ theme, onThemeChange, onPomoChange }: SettingsPageProps) {
  const [settings, setSettings] = useState<HoneSettings>(() => readSettings());

  useEffect(() => {
    try {
      window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      /* ignore quota / privacy mode */
    }
  }, [settings]);

  const setPomo = (n: number) => {
    setSettings((s) => ({ ...s, pomodoroMinutes: n }));
    onPomoChange?.(n * 60);
  };
  const setDailyGoal = (n: number) => setSettings((s) => ({ ...s, dailyGoalMin: n }));
  const setVol = (n: number) => setSettings((s) => ({ ...s, defaultVolume: n }));
  const setNotif = (b: boolean) => setSettings((s) => ({ ...s, notifications: b }));
  const setAmbient = (b: boolean) => setSettings((s) => ({ ...s, ambientMusic: b }));

  // Sync ambient toggle с audio bus'ом — start/stop loop track когда юзер
  // flip'ает switch. Lazy import чтобы bundle ambient-bus только при
  // открытии Settings.
  useEffect(() => {
    void import('../../audio/ambient-music').then((m) => {
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
          <Section title="DAILY FOCUS GOAL" hint="Target focused time per day. Shown as the goal meter in Stats.">
            <Slider
              min={15}
              max={480}
              step={15}
              value={settings.dailyGoalMin}
              onChange={setDailyGoal}
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

        {/* LEARNING MODULES section removed 2026-05-13 (Phase K Wave 8) —
            English vertical (Reading/Writing/Listening/Speaking + vocab SRS)
            migrated to web /lingua. Hone теперь pure focus cockpit. */}

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
            ECOSYSTEM — Phase J / X4 (P1) identity discovery. Trio of
            druz9 surfaces: Hone / web / Cue. Source-of-truth для copy
            живёт в components/onboarding/IdentityCard.tsx (PRODUCTS). */}
        <SectionGroup title="Ecosystem">
          <Section
            title="DRUZ9 SURFACES"
            hint="Hone — daily focus. druz9.online — practice + mocks. Cue — live interview copilot."
          >
            <EcosystemSection />
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

          <Section
            title="PRODUCT ANALYTICS"
            hint="Anonymous usage events help us prioritise features. No PII collected. Toggle off anytime."
          >
            <AnalyticsConsentSection />
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

          <ResourceLibrarySection />

          <DeveloperToolsSection />

          <Section title="ONBOARDING" hint="Replay the 3-step wizard (stack · mode · shortcuts).">
            <button
              type="button"
              onClick={() => {
                try {
                  window.localStorage.removeItem('hone:onboarded:v2');
                } catch {
                  /* ignore */
                }
                window.location.reload();
              }}
              className="mono"
              style={{
                padding: '6px 12px',
                background: 'transparent',
                border: '1px solid rgba(255,255,255,0.12)',
                color: 'rgba(255,255,255,0.7)',
                borderRadius: 5,
                fontSize: 11,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              open onboarding again
            </button>
          </Section>
        </SectionGroup>
      </div>
    </div>
  );
}
