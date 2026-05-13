// Settings — preferences surface для Hone.
//
// Phase K Wave 15 redesign: одно длинное полотно разбито на 8 вкладок
// + global search-фильтр. Логика существующих секций не тронута;
// фильтр и группировка живут только в этом index'е. Поиск ищет в
// `title` / `hint` каждой Section: если ни одна не match'ится, юзер
// видит «Ничего не найдено». При непустом query вкладки игнорируются —
// показываем все matches across all tabs (предсказуемо).
//
// Tab layout:
//   - Account      — Sign-in, usage, sign out
//   - Appearance   — Theme + Identity (ecosystem cards)
//   - Focus        — Pomodoro / daily-goal / audio / notifications /
//                    macOS Focus mode integration / ambient music
//   - Memory       — Vault (E2E for sensitive notes)
//   - Storage      — Quota bar + archive control
//   - Devices      — Active sessions table
//   - Analytics    — Product-analytics consent
//   - Advanced     — Resource library, dev tools, shortcuts,
//                    onboarding replay
//
// Persistence:
//   - Theme отдельно: localStorage 'hone:theme' (App.tsx читает его на mount).
//   - Settings JSON-блоб: 'hone:settings'.
//   - Focus-shortcut name: 'hone:focus:macos-mode-name'
//     (см. ./sections/FocusModeSection.tsx).
import { useEffect, useMemo, useState } from 'react';

import { useT } from '@d9-i18n';

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
import { Section, SectionHead } from './primitives/SectionGroup';
import { Slider } from './primitives/Slider';
import { Toggle } from './primitives/Toggle';
import { ThemeCard } from './primitives/ThemeCard';
import { ShortcutRow } from './primitives/ShortcutRow';
import { SettingsTabs, type TabDef } from './primitives/SettingsTabs';
import { SubscriptionUsageSection } from './sections/SubscriptionUsageSection';
import { StorageSection } from './sections/StorageSection';
import { DevicesSection } from './sections/DevicesSection';
import { SignOutSection } from './sections/SignOutSection';
import { AnalyticsConsentSection } from './sections/AnalyticsConsentSection';
import { EcosystemSection } from './sections/EcosystemSection';
import { LanguageSection } from './sections/LanguageSection';
import { VaultSection } from './sections/VaultSection';
import { FocusModeSection } from './sections/FocusModeSection';
// Phase K Wave 15 — Quick Capture + Day Shutdown ritual.
import { QuickCaptureSection } from './sections/QuickCaptureSection';
import { DayShutdownSection } from './sections/DayShutdownSection';
// Phase K Wave 16 — soft energy-check nudge (3-hour interval).
import { EnergyNudgeSection } from './sections/EnergyNudgeSection';

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

type TabId =
  | 'account'
  | 'appearance'
  | 'focus'
  | 'memory'
  | 'storage'
  | 'devices'
  | 'analytics'
  | 'advanced';

// Tab labels resolved at render-time via t() so they reflect the active locale.
function useTabs(): ReadonlyArray<TabDef<TabId>> {
  const t = useT();
  return [
    { id: 'account', label: t('hone.settings.tab.account') },
    { id: 'appearance', label: t('hone.settings.tab.appearance') },
    { id: 'focus', label: t('hone.settings.tab.focus') },
    { id: 'memory', label: t('hone.settings.tab.memory') },
    { id: 'storage', label: t('hone.settings.tab.storage') },
    { id: 'devices', label: t('hone.settings.tab.devices') },
    { id: 'analytics', label: t('hone.settings.tab.analytics') },
    { id: 'advanced', label: t('hone.settings.tab.advanced') },
  ];
}

// SectionDef — declarative spec for a single tile inside a tab. `body`
// — render function чтобы можно было прокидывать state в каждую Section.
// `keywords` — extra search hits (например русские синонимы английских
// labels) чтобы фильтр находил «помодоро» по input'у «помодоро».
interface SectionDef {
  tab: TabId;
  title: string;
  hint?: string;
  keywords?: string;
  render: () => React.ReactNode;
}

export function SettingsPage({ theme, onThemeChange, onPomoChange }: SettingsPageProps) {
  const t = useT();
  const TABS = useTabs();
  const [settings, setSettings] = useState<HoneSettings>(() => readSettings());
  const [tab, setTab] = useState<TabId>('account');
  const [query, setQuery] = useState('');

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
  const setAskResistance = (b: boolean) =>
    setSettings((s) => ({ ...s, askResistanceBeforeFocus: b }));

  // Sync ambient toggle с audio bus'ом — start/stop loop track когда юзер
  // flip'ает switch. Lazy import чтобы bundle ambient-bus только при
  // открытии Settings.
  useEffect(() => {
    void import('../../audio/ambient-music').then((m) => {
      if (settings.ambientMusic) m.startAmbient();
      else m.stopAmbient();
    });
  }, [settings.ambientMusic]);

  // ── Build declarative section list. Render functions capture
  // current state via closure, so React re-mounts them on each
  // settings change automatically (no useMemo / useCallback gymnastics).
  const sections: SectionDef[] = [
    // ── account ────────────────────────────────────────────────────
    {
      tab: 'account',
      title: 'USAGE',
      hint: 'Where you stand against your tier limits.',
      keywords: 'tier free seeker ascended subscription',
      render: () => <SubscriptionUsageSection />,
    },
    {
      tab: 'account',
      title: 'ECOSYSTEM',
      hint: 'Hone — daily focus. druz9.online — practice + mocks. Cue — live interview copilot.',
      keywords: 'druz9 cue identity',
      render: () => <EcosystemSection />,
    },
    {
      tab: 'account',
      title: 'SIGN OUT',
      hint: 'Wipe local session token. Notes / boards / today data stays on device until you log back in.',
      keywords: 'logout выход',
      render: () => <SignOutSection />,
    },
    // ── appearance ─────────────────────────────────────────────────
    {
      tab: 'appearance',
      title: 'INTERFACE LANGUAGE',
      hint: 'Applies immediately. Syncs with web and Cue via your account.',
      keywords: 'language locale ru en язык',
      render: () => <LanguageSection />,
    },
    {
      tab: 'appearance',
      title: 'BACKGROUND THEME',
      hint: 'Ambient motion behind your work.',
      keywords: 'тема фон bg theme',
      render: () => (
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
      ),
    },
    // ── focus ──────────────────────────────────────────────────────
    {
      tab: 'focus',
      title: 'POMODORO',
      hint: 'Default focus session length.',
      keywords: 'помодоро длительность таймер',
      render: () => (
        <Slider
          min={5}
          max={90}
          step={5}
          value={settings.pomodoroMinutes}
          onChange={setPomo}
          unit="min"
        />
      ),
    },
    {
      tab: 'focus',
      title: 'DAILY FOCUS GOAL',
      hint: 'Target focused time per day. Shown as the goal meter in Stats.',
      keywords: 'цель дневная норма',
      render: () => (
        <Slider
          min={15}
          max={480}
          step={15}
          value={settings.dailyGoalMin}
          onChange={setDailyGoal}
          unit="min"
        />
      ),
    },
    {
      tab: 'focus',
      title: 'DISTRACTION BLOCKING',
      hint: 'Auto-trigger macOS Focus mode when a pomodoro starts. Hone runs your pre-configured shortcut at start/stop.',
      keywords: 'блокировка отвлечений focus shortcuts macos',
      render: () => <FocusModeSection />,
    },
    {
      tab: 'focus',
      title: 'QUICK CAPTURE',
      hint: 'Global hotkey ⌘⇧Space to drop a thought into your Inbox from any app.',
      keywords: 'quick capture быстрый захват инбокс inbox hotkey shortcut',
      render: () => <QuickCaptureSection />,
    },
    {
      tab: 'focus',
      title: 'DAY SHUTDOWN RITUAL',
      hint: 'Evening prompt (~21:00) to write down what shipped / what hangs / tomorrow.',
      keywords: 'shutdown evening ритуал вечер день daily',
      render: () => <DayShutdownSection />,
    },
    {
      tab: 'focus',
      title: 'ENERGY CHECK',
      hint: 'Soft nudge every 3 hours: "как энергия сейчас?" Тихие часы 00–08.',
      keywords: 'energy энергия nudge напоминание fatigue усталость 3 часа',
      render: () => <EnergyNudgeSection />,
    },
    {
      tab: 'focus',
      title: 'PRE-FOCUS PULSE',
      hint:
        'Ask «what is hard right now?» before each pomodoro start (10-second optional). Сохраняется в журнал сопротивления — коуч раз в неделю видит паттерны.',
      keywords: 'resistance pulse journal сопротивление журнал',
      render: () => (
        <Toggle
          value={settings.askResistanceBeforeFocus}
          onChange={setAskResistance}
          label={settings.askResistanceBeforeFocus ? 'On' : 'Off'}
        />
      ),
    },
    {
      tab: 'focus',
      title: 'AUDIO',
      hint: 'Default ambient sound volume.',
      keywords: 'громкость sound',
      render: () => (
        <Slider min={0} max={100} step={5} value={settings.defaultVolume} onChange={setVol} unit="%" />
      ),
    },
    {
      tab: 'focus',
      title: 'NOTIFICATIONS',
      hint: 'System notification when a session ends.',
      keywords: 'уведомления notify',
      render: () => (
        <Toggle value={settings.notifications} onChange={setNotif} label={settings.notifications ? 'On' : 'Off'} />
      ),
    },
    {
      tab: 'focus',
      title: 'AMBIENT COSMIC MUSIC',
      hint: 'Looping space-themed background track. Volume controlled by the Dock slider — same bus as podcasts.',
      keywords: 'музыка ambient sfx',
      render: () => (
        <Toggle
          value={settings.ambientMusic}
          onChange={setAmbient}
          label={settings.ambientMusic ? 'On' : 'Off'}
        />
      ),
    },
    // ── memory ─────────────────────────────────────────────────────
    {
      tab: 'memory',
      title: 'PRIVATE VAULT',
      hint: "End-to-end encryption for sensitive notes. Server can't read them — but coach memory, search, and publish-to-web won't work for encrypted notes. No password recovery.",
      keywords: 'vault e2e шифрование пароль',
      render: () => <VaultSection />,
    },
    // ── storage ────────────────────────────────────────────────────
    {
      tab: 'storage',
      title: 'STORAGE',
      hint: "Live notes & whiteboards (archived items don't count).",
      keywords: 'хранилище место бекап',
      render: () => <StorageSection />,
    },
    // ── devices ────────────────────────────────────────────────────
    {
      tab: 'devices',
      title: 'DEVICES',
      hint: 'Active sign-ins. Free tier: 1 device. Seeker+: unlimited.',
      keywords: 'устройства sessions revoke',
      render: () => <DevicesSection />,
    },
    // ── analytics ──────────────────────────────────────────────────
    {
      tab: 'analytics',
      title: 'PRODUCT ANALYTICS',
      hint: 'Anonymous usage events help us prioritise features. No PII collected. Toggle off anytime.',
      keywords: 'analytics телеметрия consent',
      render: () => <AnalyticsConsentSection />,
    },
    // ── advanced ───────────────────────────────────────────────────
    {
      tab: 'advanced',
      title: 'KEYBOARD SHORTCUTS',
      hint: 'Press from any non-text surface.',
      keywords: 'shortcuts hotkeys клавиши',
      render: () => (
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
      ),
    },
    {
      tab: 'advanced',
      title: 'LEARNING RESOURCES',
      hint: 'External URLs you saved — AI uses these to tune your plan and auto-link notes.',
      keywords: 'resources bookmarks ссылки',
      render: () => <ResourceLibrarySection />,
    },
    {
      tab: 'advanced',
      title: 'DEVELOPER TOOLS',
      hint: 'Power-user feature: standalone collaboration rooms (code + whiteboard).',
      keywords: 'dev tools collab rooms',
      render: () => <DeveloperToolsSection />,
    },
    {
      tab: 'advanced',
      title: 'ONBOARDING',
      hint: 'Replay the 3-step wizard (stack · mode · shortcuts).',
      keywords: 'wizard intro onboarding',
      render: () => (
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
      ),
    },
  ];

  // Filter logic: case-insensitive substring match in title / hint /
  // keywords. Пустой query → filter no-op, остаётся tab-based grouping.
  // Непустой query → ignoring tab, показываем все matches со всех вкладок.
  const trimmedQuery = query.trim().toLowerCase();
  const visible = useMemo(() => {
    if (!trimmedQuery) {
      return sections.filter((s) => s.tab === tab);
    }
    return sections.filter((s) => {
      const hay = `${s.title} ${s.hint ?? ''} ${s.keywords ?? ''}`.toLowerCase();
      return hay.includes(trimmedQuery);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trimmedQuery, tab, settings, theme]);

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
        <h1 style={{ margin: '8px 0 24px', fontSize: 28, fontWeight: 500, letterSpacing: '-0.015em' }}>
          {t('hone.settings.heading')}
        </h1>

        {/* Search input — фильтрует все секции (across all tabs).
            Пустой query = классическая tab-based group view. */}
        <input
          type="search"
          placeholder={t('hone.settings.search_placeholder')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          spellCheck={false}
          aria-label="Search settings"
          style={{
            width: '100%',
            padding: '10px 14px',
            fontSize: 13,
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 10,
            color: 'var(--ink-90)',
            outline: 'none',
            fontFamily: 'inherit',
            marginBottom: 14,
          }}
        />

        {/* Tabs — скрываем когда query не пустой; в search-mode tab
            irrelevant'ы (мы показываем matches со всех). */}
        {trimmedQuery === '' && (
          <div style={{ margin: '0 0 28px' }}>
            <SettingsTabs<TabId> tabs={TABS} current={tab} onChange={setTab} />
          </div>
        )}

        {trimmedQuery !== '' && (
          <div
            className="mono"
            style={{
              fontSize: 10,
              letterSpacing: '0.08em',
              color: 'var(--ink-40)',
              margin: '0 0 24px',
            }}
          >
            {visible.length === 0
              ? t('hone.settings.search.zero_results', { q: query.trim().toUpperCase() })
              : t('hone.settings.search.results_count', { n: visible.length, q: query.trim().toUpperCase() })}
          </div>
        )}

        {/* Body — выбранные секции (либо tab content, либо search results). */}
        {visible.length === 0 && trimmedQuery !== '' ? (
          <div
            style={{
              padding: '32px 16px',
              fontSize: 13,
              color: 'var(--ink-40)',
              textAlign: 'center',
              border: '1px dashed rgba(255,255,255,0.06)',
              borderRadius: 12,
            }}
          >
            {t('hone.settings.search.empty_help')}
          </div>
        ) : (
          visible.map((s) => (
            <Section key={`${s.tab}:${s.title}`} title={s.title} hint={s.hint}>
              {s.render()}
            </Section>
          ))
        )}
      </div>
    </div>
  );
}
