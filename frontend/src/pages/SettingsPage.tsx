import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AppShell } from '../components/AppShell'
import {
  Panel,
  PanelHead,
  PageHeader,
  Button,
  InsetGroove,
} from '../components/chrome'
import {
  useNotifyPreferencesQuery,
  useUpdateNotifyPreferences,
  useUpdateUserSettings,
  type NotifyPreferences,
  type UserSettings,
} from '../lib/queries/settings'

const DEFAULT_NOTIFY: NotifyPreferences = {
  email_weekly: true,
  email_calendar: true,
  telegram_daily: false,
  push_arena_invite: true,
  push_guild_war: true,
  quiet_hours_start: '23:00',
  quiet_hours_end: '08:00',
}

export default function SettingsPage() {
  const { t, i18n } = useTranslation()
  const { data: remotePrefs } = useNotifyPreferencesQuery()
  const updateNotify = useUpdateNotifyPreferences()
  const updateSettings = useUpdateUserSettings()

  const [prefs, setPrefs] = useState<NotifyPreferences>(DEFAULT_NOTIFY)
  useEffect(() => {
    if (remotePrefs) setPrefs(remotePrefs)
  }, [remotePrefs])

  const [settings, setSettings] = useState<UserSettings>({
    locale: i18n.language === 'en' ? 'en' : 'ru',
    theme: 'dark',
    motion: 'on',
    public_profile: true,
  })

  const onSave = () => {
    updateNotify.mutate(prefs)
    updateSettings.mutate(settings)
    void i18n.changeLanguage(settings.locale)
    document.documentElement.dataset.motion = settings.motion
  }

  return (
    <AppShell>
      <PageHeader
        title={t('settings.title')}
        subtitle={t('settings.subtitle')}
        right={
          <Button tone="primary" onClick={onSave}>
            {t('settings.save')}
          </Button>
        }
      />
      <div
        data-stagger
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 20,
          alignItems: 'flex-start',
        }}
      >
        <Panel>
          <PanelHead subtitle="NOTIFICATIONS">
            {t('settings.notifications')}
          </PanelHead>
          <div
            style={{
              padding: 20,
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            <Toggle
              label={t('settings.email_weekly')}
              checked={prefs.email_weekly}
              onChange={(v) => setPrefs({ ...prefs, email_weekly: v })}
            />
            <Toggle
              label={t('settings.email_calendar')}
              checked={prefs.email_calendar}
              onChange={(v) => setPrefs({ ...prefs, email_calendar: v })}
            />
            <Toggle
              label={t('settings.telegram_daily')}
              checked={prefs.telegram_daily}
              onChange={(v) => setPrefs({ ...prefs, telegram_daily: v })}
            />
            <Toggle
              label={t('settings.push_arena')}
              checked={prefs.push_arena_invite}
              onChange={(v) => setPrefs({ ...prefs, push_arena_invite: v })}
            />
            <Toggle
              label={t('settings.push_guild')}
              checked={prefs.push_guild_war}
              onChange={(v) => setPrefs({ ...prefs, push_guild_war: v })}
            />
            <InsetGroove>
              <div
                className="caps"
                style={{ color: 'var(--gold-dim)', marginBottom: 6 }}
              >
                {t('settings.quiet_hours')}
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <input
                  type="time"
                  value={prefs.quiet_hours_start}
                  onChange={(e) =>
                    setPrefs({ ...prefs, quiet_hours_start: e.target.value })
                  }
                  style={timeInput}
                />
                <span style={{ color: 'var(--text-mid)' }}>—</span>
                <input
                  type="time"
                  value={prefs.quiet_hours_end}
                  onChange={(e) =>
                    setPrefs({ ...prefs, quiet_hours_end: e.target.value })
                  }
                  style={timeInput}
                />
              </div>
            </InsetGroove>
          </div>
        </Panel>

        <Panel>
          <PanelHead subtitle="APPEARANCE">
            {t('settings.appearance')}
          </PanelHead>
          <div
            style={{
              padding: 20,
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            <InsetGroove>
              <div
                className="caps"
                style={{ color: 'var(--gold-dim)', marginBottom: 6 }}
              >
                {t('settings.language')}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {(['ru', 'en'] as const).map((l) => (
                  <button
                    key={l}
                    className={`btn btn-sm ${
                      settings.locale === l ? 'btn-primary' : ''
                    }`}
                    onClick={() => setSettings({ ...settings, locale: l })}
                  >
                    {l.toUpperCase()}
                  </button>
                ))}
              </div>
            </InsetGroove>
            <InsetGroove>
              <div
                className="caps"
                style={{ color: 'var(--gold-dim)', marginBottom: 6 }}
              >
                {t('settings.motion')}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {(['on', 'off'] as const).map((m) => (
                  <button
                    key={m}
                    className={`btn btn-sm ${
                      settings.motion === m ? 'btn-primary' : ''
                    }`}
                    onClick={() => setSettings({ ...settings, motion: m })}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </InsetGroove>
            <Toggle
              label={t('settings.privacy')}
              checked={settings.public_profile}
              onChange={(v) => setSettings({ ...settings, public_profile: v })}
            />
          </div>
        </Panel>
      </div>
    </AppShell>
  )
}

const timeInput = {
  background: 'var(--bg-inset)',
  border: '1px solid var(--gold-dim)',
  color: 'var(--gold-bright)',
  fontFamily: 'var(--font-code)',
  padding: '4px 8px',
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <InsetGroove>
      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: 'pointer',
        }}
      >
        <span style={{ fontSize: 12, color: 'var(--text-bright)' }}>
          {label}
        </span>
        <span
          onClick={() => onChange(!checked)}
          role="switch"
          aria-checked={checked}
          style={{
            width: 40,
            height: 20,
            background: checked ? 'var(--gold)' : '#16181c',
            border: `1px solid ${checked ? 'var(--gold-bright)' : 'var(--ink-mute)'}`,
            borderRadius: 10,
            position: 'relative',
            transition: 'background 160ms, border-color 160ms, box-shadow 160ms',
            boxShadow: checked
              ? '0 0 6px 0 color-mix(in srgb, var(--gold) 55%, transparent) inset'
              : 'inset 0 1px 2px rgba(0,0,0,0.6)',
          }}
        >
          <span
            style={{
              position: 'absolute',
              top: 2,
              left: checked ? 22 : 2,
              width: 14,
              height: 14,
              borderRadius: 7,
              background: checked ? 'var(--bg-void)' : 'var(--ink-dim)',
              transition: 'left 160ms, background 160ms',
              boxShadow: checked ? '0 0 4px var(--gold-bright)' : 'none',
            }}
          />
        </span>
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          style={{ display: 'none' }}
        />
      </label>
    </InsetGroove>
  )
}
