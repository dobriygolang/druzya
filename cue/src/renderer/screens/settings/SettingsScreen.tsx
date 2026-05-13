// Settings — sidebar + active tab. Seven tabs: General, Hotkeys,
// AI Providers, Documents, Appearance, Permissions, About. Each tab
// lives in `./tabs/*` so this file stays a thin shell + sidebar
// chrome. Subscription / Paywall live in their own window.
//
// All values come from DesktopConfig / server state. Writing to hotkeys
// calls hotkeys.update; other tabs are read-only for now.

import { useEffect, useState } from 'react';

import {
  IconDocument,
  IconInfo,
  IconKey,
  IconPalette,
  IconSettings,
  IconShield,
  IconSparkles,
} from '../../components/icons';
import { BrandMark } from '../../components/d9';
import { useConfig } from '../../hooks/use-config';
import { useAuthStore } from '../../stores/auth';
import { useQuotaStore } from '../../stores/quota';
import { AboutTab } from './tabs/AboutTab';
import { AppearanceTab } from './tabs/AppearanceTab';
import { DocumentsTab } from './tabs/DocumentsTab';
import { GeneralTab } from './tabs/GeneralTab';
import { HotkeysTab } from './tabs/HotkeysTab';
import { PermissionsTab } from './tabs/PermissionsTab';
import { ProvidersTab } from './tabs/ProvidersTab';

type Tab = 'general' | 'hotkeys' | 'providers' | 'documents' | 'appearance' | 'permissions' | 'about';

const tabs: Array<{ id: Tab; label: string; icon: React.ReactNode }> = [
  { id: 'general', label: 'Общее', icon: <IconSettings size={14} /> },
  { id: 'hotkeys', label: 'Горячие клавиши', icon: <IconKey size={14} /> },
  { id: 'providers', label: 'AI провайдеры', icon: <IconSparkles size={14} /> },
  { id: 'documents', label: 'Документы', icon: <IconDocument size={14} /> },
  { id: 'appearance', label: 'Внешний вид', icon: <IconPalette size={14} /> },
  { id: 'permissions', label: 'Доступы macOS', icon: <IconShield size={14} /> },
  { id: 'about', label: 'О программе', icon: <IconInfo size={14} /> },
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
              aria-current={tab === t.id ? 'page' : undefined}
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
                padding: 'var(--pad-inline) 12px',
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
                transition:
                  'background var(--motion-dur-small) var(--motion-ease-standard), color var(--motion-dur-small) var(--motion-ease-standard)',
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
