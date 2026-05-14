// Step 3: side-by-side recap of parsed CV + JD with a single CTA
// "Запустить подготовку". On click → backend StartInterviewPrep →
// active prep stored → next step = Launch.

import { useT } from '@d9-i18n';
import { useInterviewPrepStore } from '../../stores/interview-prep';
import { btnPrimary, Card, DataRow } from './UploadCVStep';

export function ReviewStep() {
  const t = useT();
  const parsedCV = useInterviewPrepStore((s) => s.parsedCV);
  const parsedJD = useInterviewPrepStore((s) => s.parsedJD);
  const starting = useInterviewPrepStore((s) => s.starting);
  const startError = useInterviewPrepStore((s) => s.startError);
  const start = useInterviewPrepStore((s) => s.start);
  const setStep = useInterviewPrepStore((s) => s.setStep);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 720, margin: '0 auto' }}>
      <Intro />

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: 14,
        }}
      >
        <Card title={t('cue.prep.review.cv_title')} subtitle={t('cue.prep.review.cv_subtitle')}>
          <DataRow k={t('cue.prep.cv.field.name')} v={parsedCV.name} />
          <DataRow k={t('cue.prep.cv.field.current_role')} v={parsedCV.currentRole} />
          <DataRow
            k={t('cue.prep.cv.field.experience')}
            v={parsedCV.experienceYears > 0 ? t('cue.prep.cv.field.experience_years', { n: parsedCV.experienceYears }) : ''}
          />
          <DataRow k={t('cue.prep.cv.field.top_skills')} v={parsedCV.topSkills.join(' · ')} />
          <DataRow k={t('cue.prep.cv.field.education')} v={parsedCV.education} />
          {parsedCV.summary && (
            <div style={{ marginTop: 8 }}>
              <p style={{ margin: 0, fontSize: 12.5, color: 'var(--d9-ink)', lineHeight: 1.5 }}>
                {parsedCV.summary}
              </p>
            </div>
          )}
          <button
            type="button"
            onClick={() => setStep('cv')}
            style={{
              marginTop: 12,
              background: 'transparent',
              border: 'none',
              color: 'var(--d9-ink-mute)',
              fontSize: 11.5,
              cursor: 'pointer',
              padding: 0,
              textDecoration: 'underline',
              textUnderlineOffset: 2,
            }}
          >
            {t('cue.prep.review.edit_cv')}
          </button>
        </Card>

        <Card title={t('cue.prep.review.jd_title')} subtitle={t('cue.prep.review.jd_subtitle')}>
          <DataRow k={t('cue.prep.jd.field.company')} v={parsedJD.company} />
          <DataRow k={t('cue.prep.jd.field.role')} v={parsedJD.role} />
          <DataRow k={t('cue.prep.jd.field.seniority')} v={parsedJD.seniority} />
          <DataRow k={t('cue.prep.jd.field.key_skills')} v={parsedJD.keySkills.join(' · ')} />
          {parsedJD.descriptionSummary && (
            <div style={{ marginTop: 8 }}>
              <p style={{ margin: 0, fontSize: 12.5, color: 'var(--d9-ink)', lineHeight: 1.5 }}>
                {parsedJD.descriptionSummary}
              </p>
            </div>
          )}
          <button
            type="button"
            onClick={() => setStep('jd')}
            style={{
              marginTop: 12,
              background: 'transparent',
              border: 'none',
              color: 'var(--d9-ink-mute)',
              fontSize: 11.5,
              cursor: 'pointer',
              padding: 0,
              textDecoration: 'underline',
              textUnderlineOffset: 2,
            }}
          >
            {t('cue.prep.review.edit_jd')}
          </button>
        </Card>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 6 }}>
        <button
          type="button"
          disabled={starting}
          onClick={() => {
            void start().catch(() => {
              /* error surfaced via startError */
            });
          }}
          style={btnPrimary(!starting)}
        >
          {starting ? t('cue.prep.review.starting') : t('cue.prep.review.start_cta')}
        </button>
        {startError && (
          <span style={{ fontSize: 11.5, color: 'var(--d9-ink-mute)' }}>{startError}</span>
        )}
      </div>
    </div>
  );
}

function Intro() {
  const t = useT();
  return (
    <div>
      <h2 style={{ margin: 0, fontWeight: 700, fontSize: 22, letterSpacing: '-0.02em' }}>
        {t('cue.prep.review.title')}
      </h2>
      <p
        style={{
          margin: '6px 0 0',
          fontSize: 13,
          color: 'var(--d9-ink-mute)',
          lineHeight: 1.5,
          letterSpacing: '-0.005em',
        }}
      >
        {t('cue.prep.review.body')}
      </p>
    </div>
  );
}
