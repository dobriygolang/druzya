// Global paywall mount. Included in every window's root render so the
// modal pops wherever the user is when a quota-exhausted error arrives
// (compact, expanded, settings — all valid triggers).
//
// The area-overlay window deliberately does not include this portal:
// it is purely a drag-select UI and a modal over it would be confusing.

import { PaywallModal } from './PaywallModal';
import { useConfig } from '../hooks/use-config';
import { useQuotaStore } from '../stores/quota';
import { usePaywallStore } from '../stores/paywall';

export function PaywallPortal() {
  const { config } = useConfig();
  const open = usePaywallStore((s) => s.open);
  const reason = usePaywallStore((s) => s.reason);
  const hide = usePaywallStore((s) => s.hide);
  const quota = useQuotaStore((s) => s.quota);
  const refreshQuota = useQuotaStore((s) => s.refresh);

  if (!open || !config) return null;

  return (
    <PaywallModal
      copy={config.paywall}
      currentPlan={quota?.plan ?? ''}
      reason={reason}
      onClose={hide}
      onRefresh={async () => {
        await refreshQuota();
        // If the plan flipped to a paid tier after the refresh, close the
        // modal automatically so the user isn't stranded on it.
        const fresh = useQuotaStore.getState().quota;
        if (fresh && fresh.plan !== 'free' && fresh.plan !== '') hide();
      }}
    />
  );
}
