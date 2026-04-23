// Compact floating window — placeholder pending Phase 4. Once the design
// components land, this renders the input row + hotkey hints + status dot.

import { useConfig } from '../../hooks/use-config';
import { useHotkeyEvents } from '../../hooks/use-hotkey-events';

export function CompactScreen() {
  const { config } = useConfig();
  useHotkeyEvents((action) => {
    // Route hotkey fires into the right action. Phase 4 fills this in.
    // eslint-disable-next-line no-console
    console.log('hotkey fired:', action);
  });

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        borderRadius: 'var(--r-window)',
        background: 'var(--d-bg-1)',
        border: '1px solid var(--d-line)',
        boxShadow: 'var(--s-window)',
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--sp-3)',
        padding: '0 var(--sp-3)',
        WebkitAppRegion: 'drag',
      } as React.CSSProperties}
    >
      <div
        style={{
          width: 28,
          height: 28,
          borderRadius: 14,
          background: 'var(--d-gradient-hero)',
        }}
      />
      <div style={{ flex: 1, fontSize: 13, color: 'var(--d-text-2)' }}>
        {config ? 'Druz9 Copilot готов' : 'Загрузка…'}
      </div>
      <div style={{ fontSize: 11, color: 'var(--d-text-3)', fontFamily: 'var(--f-mono)' }}>
        ⌘⇧S
      </div>
    </div>
  );
}
