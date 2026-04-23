// Pulls DesktopConfig from main on mount and subscribes to future
// config-updated events. Renderer uses this in every screen to drive
// model lists, hotkey defaults, paywall copy, etc. — so no hardcodes.

import { useEffect, useState } from 'react';

import { eventChannels } from '@shared/ipc';
import type { DesktopConfig } from '@shared/types';

export function useConfig() {
  const [config, setConfig] = useState<DesktopConfig | null>(null);

  useEffect(() => {
    let disposed = false;
    void (async () => {
      try {
        const raw = await window.druz9.config.get();
        if (!disposed) setConfig(raw as unknown as DesktopConfig);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('useConfig.get failed', err);
      }
    })();

    const unsub = window.druz9.on<DesktopConfig>(eventChannels.configUpdated, (payload) => {
      if (!disposed) setConfig(payload);
    });
    return () => {
      disposed = true;
      unsub();
    };
  }, []);

  return { config };
}
