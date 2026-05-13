import {
  IdentityCard,
  PRODUCTS,
  type ProductInfo,
} from '../../../components/onboarding/IdentityCard';
import {
  resetIdentityIntroShown,
} from '../../../components/onboarding/IdentityIntroModal';
import { openCueInstall, openDruz9Web } from '../../../lib/cross-app-links';

// EcosystemSection — Phase J / X4 (P1) identity-discovery surface в Settings.
// Renders the same 3-card trio как IdentityIntroModal, плюс «Show intro
// again» button. PRODUCTS / IdentityCard — single source-of-truth, копия
// copy здесь не нужна.
export function EcosystemSection() {
  const products: ProductInfo[] = [
    { ...PRODUCTS.hone, current: true },
    {
      ...PRODUCTS.web,
      onCta: () => {
        openDruz9Web();
      },
    },
    {
      ...PRODUCTS.cue,
      onCta: () => {
        openCueInstall();
      },
    },
  ];
  return (
    <div>
      <div
        style={{
          display: 'flex',
          gap: 12,
          flexWrap: 'wrap',
          alignItems: 'stretch',
        }}
      >
        {products.map((p) => (
          <IdentityCard key={p.key} info={p} />
        ))}
      </div>
      <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={() => {
            // Clear flag + dispatch event — App.tsx subscribes and opens
            // modal без полного reload (отличается от Onboarding flow,
            // который reload'ит чтобы re-trigger profile wizard).
            resetIdentityIntroShown();
            window.dispatchEvent(new CustomEvent('hone:open-identity-intro'));
          }}
          className="mono focus-ring"
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
          show intro again
        </button>
        <span style={{ fontSize: 12, color: 'var(--ink-40)', lineHeight: 1.5 }}>
          Re-opens the first-run identity intro modal.
        </span>
      </div>
    </div>
  );
}
