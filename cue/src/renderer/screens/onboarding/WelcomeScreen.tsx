// Step 1 — Welcome. Brand mark + one-line tagline + Next CTA.
//
// Kept deliberately sparse: this is the first screen a user sees after
// install. The whole point is to set the tone (stealth, quiet, B/W)
// without making them read three paragraphs about features they
// don't yet understand. Feature details land later — on PermissionsScreen
// (where each capability is named in context) and CompleteScreen
// (which lists the hotkeys they'll actually use).

import { useT } from '@d9-i18n';
import { BrandMark } from '../../components/d9';
import { Button } from '../../components/primitives';

interface Props {
  onNext: () => void;
}

export function WelcomeScreen({ onNext }: Props) {
  const t = useT();
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        padding: '0 40px',
        // maxWidth keeps copy lines short on wide displays; flex-wrap
        // up the tree handles the narrow case. See feedback_responsive_rule.
        maxWidth: 480,
        gap: 0,
      }}
    >
      <BrandMark size={72} />

      <h1
        style={{
          fontFamily: 'var(--d9-font-display)',
          fontSize: 36,
          fontWeight: 400,
          letterSpacing: '-0.02em',
          margin: '24px 0 12px',
          lineHeight: 1.05,
          color: 'var(--d9-ink)',
        }}
      >
        {t('cue.onboarding.welcome.title')}
      </h1>

      <p
        style={{
          fontSize: 13.5,
          lineHeight: 1.55,
          color: 'var(--d9-ink-dim)',
          margin: '0 0 8px',
          letterSpacing: '-0.005em',
        }}
      >
        {t('cue.onboarding.welcome.body')}
        <br />
        {t('cue.onboarding.welcome.body_followup')}
      </p>

      <div style={{ marginBottom: 32 }} />

      <Button variant="primary" size="md" onClick={onNext} autoFocus>
        {t('cue.onboarding.welcome.cta')}
      </Button>

      <p
        style={{
          marginTop: 18,
          fontSize: 10.5,
          color: 'var(--d9-ink-ghost)',
          fontFamily: 'var(--d9-font-mono)',
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
        }}
      >
        {t('cue.onboarding.welcome.note')}
      </p>
    </div>
  );
}
