// Subscribes to 'event:hotkey-fired' pushed by the main process when a
// globalShortcut triggers. The screen decides what to do with the action.

import { useEffect } from 'react';

import { eventChannels, type HotkeyFiredEvent } from '@shared/ipc';
import type { HotkeyAction } from '@shared/types';

export function useHotkeyEvents(handler: (action: HotkeyAction) => void) {
  useEffect(() => {
    return window.druz9.on<HotkeyFiredEvent>(eventChannels.hotkeyFired, (payload) => {
      handler(payload.action);
    });
  }, [handler]);
}
