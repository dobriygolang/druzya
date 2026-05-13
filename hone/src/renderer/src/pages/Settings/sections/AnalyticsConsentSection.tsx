import { useState } from 'react';

import { analytics } from '../../../lib/analytics';
import { Toggle } from '../primitives/Toggle';

// AnalyticsConsentSection — Phase J / X3 (P1) opt-in toggle.
// Reads current state from the analytics SDK (which hydrated from
// localStorage on App.tsx init), writes via setOptedIn() which mirrors
// to localStorage + best-effort backend SetConsent для cross-device sync.
export function AnalyticsConsentSection() {
  const [opted, setOpted] = useState<boolean>(() => analytics.isOptedIn());
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <Toggle
        value={opted}
        onChange={(v) => {
          setOpted(v);
          analytics.setOptedIn(v);
        }}
        label="Share anonymous usage events"
      />
      <p
        style={{
          margin: 0,
          fontSize: 11,
          color: 'var(--ink-50, rgba(255,255,255,0.5))',
          maxWidth: 540,
          lineHeight: 1.5,
        }}
      >
        No PII. Tracks aggregate signals like «focus session started» so we
        can prioritise the features you actually use. Toggle off anytime —
        we drop unsent events from memory immediately.
      </p>
    </div>
  );
}
