// Final step shown after StartInterviewPrep succeeds. Confirms the user
// is set up, gives them the entry point to Cue's main compact window,
// and explains what just got activated.

import { useEffect, useState } from 'react';

import { useT, useLocaleStore } from '@d9-i18n';
import { useInterviewPrepStore } from '../../stores/interview-prep';
import { Card, DataRow } from './UploadCVStep';

export function LaunchStep() {
  const t = useT();
  const locale = useLocaleStore((s) => s.locale);
  const active = useInterviewPrepStore((s) => s.active);
  const reset = useInterviewPrepStore((s) => s.reset);
  const [closing, setClosing] = useState(false);

  // Auto-close the wizard a few seconds after the user reads the
  // success state — gives them time to glance at the confirmation
  // without an explicit "X" press. Cancel on any interaction.
  useEffect(() => {
    const t = setTimeout(() => {
      // No auto-close — Sergey wants explicit control. Wizard stays
      // open until user dismisses it. (Comment kept so the
      // anti-pattern is intentional.)
      void t;
    }, 10_000);
    return () => clearTimeout(t);
  }, []);

  const onLaunchCompact = () => {
    setClosing(true);
    void window.druz9.windows.show('compact');
    // Hide the wizard. We don't close (destroy) so reopening is instant.
    void window.druz9.windows.hide('interview-prep');
    reset();
  };

  return (
    <div style={{ maxWidth: 560, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 18, paddingTop: 12 }}>
      <div style={{ textAlign: 'center' }}>
        <div
          aria-hidden="true"
          style={{
            width: 56,
            height: 56,
            border: '0.5px solid var(--d9-hairline)',
            borderRadius: '50%',
            margin: '0 auto 14px',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--d9-ink)',
          }}
        >
          <Check />
        </div>
        <h2 style={{ margin: 0, fontWeight: 700, fontSize: 22, letterSpacing: '-0.02em' }}>
          {t('cue.prep.launch.title')}
        </h2>
        <p
          style={{
            margin: '6px auto 0',
            fontSize: 13,
            color: 'var(--d9-ink-mute)',
            lineHeight: 1.5,
            maxWidth: 440,
          }}
        >
          {t('cue.prep.launch.body')}
        </p>
      </div>

      <Card title={t('cue.prep.launch.active_title')} subtitle={active.startedAt ? new Date(active.startedAt).toLocaleString(locale === 'ru' ? 'ru-RU' : 'en-US') : ''}>
        <DataRow k={t('cue.prep.jd.field.company')} v={active.company || active.parsedJD.company} />
        <DataRow k={t('cue.prep.jd.field.role')} v={active.role || active.parsedJD.role} />
        <DataRow k={t('cue.prep.jd.field.seniority')} v={active.parsedJD.seniority} />
        <DataRow k={t('cue.prep.launch.field.experience')} v={active.parsedCV.experienceYears > 0 ? t('cue.prep.cv.field.experience_years', { n: active.parsedCV.experienceYears }) : ''} />
        <DataRow k={t('cue.prep.cv.field.top_skills')} v={active.parsedCV.topSkills.slice(0, 6).join(' · ')} />
      </Card>

      <div style={{ display: 'flex', justifyContent: 'center', gap: 12 }}>
        <button
          type="button"
          disabled={closing}
          onClick={onLaunchCompact}
          style={{
            background: 'var(--d9-ink)',
            color: 'var(--d9-obsidian)',
            border: '0.5px solid var(--d9-hairline)',
            borderRadius: 7,
            padding: '10px 18px',
            fontSize: 13,
            fontWeight: 600,
            cursor: closing ? 'not-allowed' : 'pointer',
            fontFamily: 'inherit',
          }}
        >
          {closing ? t('cue.prep.launch.opening') : t('cue.prep.launch.open_cue')}
        </button>
      </div>
    </div>
  );
}

function Check() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
      <path
        d="M5 11.5 9.5 16 17 6.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
