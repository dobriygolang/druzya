// Hotkeys tab — overrides for global hotkey bindings. Pushes merged
// bindings to main on mount and after every override change.

import { useEffect } from 'react';

import { useT } from '@d9-i18n';
import { HotkeyRecorder } from '../../../components/HotkeyRecorder';
import { useConfig } from '../../../hooks/use-config';
import { useHotkeyOverridesStore } from '../../../stores/hotkey-overrides';
import type { HotkeyBinding } from '@shared/types';
import { Row, SectionTitle } from '../lib/shared';

export function HotkeysTab() {
  const t = useT();
  const { config } = useConfig();
  const overrides = useHotkeyOverridesStore((s) => s.overrides);
  const setOverride = useHotkeyOverridesStore((s) => s.set);
  const clearOverride = useHotkeyOverridesStore((s) => s.clear);
  const merge = useHotkeyOverridesStore((s) => s.merge);
  const hydrate = useHotkeyOverridesStore((s) => s.hydrate);

  // Mount: re-pull persisted overrides from main so renderer reflects
  // userData/hotkeys.json (survives DevTools storage wipe / fresh install).
  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  // Local fallback that mirrors the bindings main/index.ts registers on
  // startup — so the Settings list is populated and usable even before
  // the user logs in (DesktopConfig.defaultHotkeys is server-supplied).
  const LOCAL_DEFAULTS: HotkeyBinding[] = [
    { action: 'screenshot_area', accelerator: 'CommandOrControl+Shift+S' },
    { action: 'screenshot_full', accelerator: 'CommandOrControl+Shift+A' },
    { action: 'voice_input', accelerator: 'CommandOrControl+Shift+V' },
    { action: 'toggle_window', accelerator: 'CommandOrControl+Shift+D' },
    { action: 'quick_prompt', accelerator: 'CommandOrControl+Shift+Q' },
    { action: 'instant_assist', accelerator: 'CommandOrControl+Return' },
    { action: 'clear_conversation', accelerator: 'CommandOrControl+Shift+K' },
    { action: 'cursor_freeze_toggle', accelerator: 'CommandOrControl+Shift+Y' },
    // Cmd+Arrow конфликтует с macOS text-navigation (start/end of line),
    // поэтому move-window живёт на Cmd+Alt+Arrow.
    { action: 'move_window_left', accelerator: 'CommandOrControl+Alt+Left' },
    { action: 'move_window_right', accelerator: 'CommandOrControl+Alt+Right' },
    { action: 'move_window_up', accelerator: 'CommandOrControl+Alt+Up' },
    { action: 'move_window_down', accelerator: 'CommandOrControl+Alt+Down' },
    { action: 'english_polish', accelerator: 'CommandOrControl+Shift+L' },
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
    screenshot_area: t('cue.settings.hotkeys.action.screenshot_area'),
    screenshot_full: t('cue.settings.hotkeys.action.screenshot_full'),
    voice_input: t('cue.settings.hotkeys.action.voice_input'),
    toggle_window: t('cue.settings.hotkeys.action.toggle_window'),
    quick_prompt: t('cue.settings.hotkeys.action.quick_prompt'),
    instant_assist: t('cue.settings.hotkeys.action.instant_assist'),
    clear_conversation: t('cue.settings.hotkeys.action.clear_conversation'),
    cursor_freeze_toggle: t('cue.settings.hotkeys.action.cursor_freeze_toggle'),
    move_window_left: t('cue.settings.hotkeys.action.move_window_left'),
    move_window_right: t('cue.settings.hotkeys.action.move_window_right'),
    move_window_up: t('cue.settings.hotkeys.action.move_window_up'),
    move_window_down: t('cue.settings.hotkeys.action.move_window_down'),
    english_polish: t('cue.settings.hotkeys.action.english_polish'),
  };

  return (
    <>
      <SectionTitle
        title={t('cue.settings.hotkeys.section.title')}
        subtitle={t('cue.settings.hotkeys.section.subtitle')}
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
