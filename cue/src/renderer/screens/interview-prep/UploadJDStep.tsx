// Step 2: paste JD text OR a job-board URL. Backend ParseJD handles
// both — URL fetching is best-effort and we surface a clear hint when
// the host blocks bots (LinkedIn does, hh.ru sometimes does).

import { useT } from '@d9-i18n';
import { useInterviewPrepStore } from '../../stores/interview-prep';
import { btnPrimary, Card, DataRow, textarea } from './UploadCVStep';

export function UploadJDStep() {
  const t = useT();
  const jdText = useInterviewPrepStore((s) => s.jdText);
  const jdURL = useInterviewPrepStore((s) => s.jdURL);
  const parsedJD = useInterviewPrepStore((s) => s.parsedJD);
  const jdParseError = useInterviewPrepStore((s) => s.jdParseError);
  const jdParsing = useInterviewPrepStore((s) => s.jdParsing);
  const setJDText = useInterviewPrepStore((s) => s.setJDText);
  const setJDURL = useInterviewPrepStore((s) => s.setJDURL);
  const parseJD = useInterviewPrepStore((s) => s.parseJD);

  const parsedReady =
    parsedJD.company.trim().length > 0 ||
    parsedJD.role.trim().length > 0 ||
    parsedJD.keySkills.length > 0;

  const canParse = jdText.trim().length > 0 || jdURL.trim().length > 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 640, margin: '0 auto' }}>
      <Intro />

      <Card title={t('cue.prep.jd.source_title')} subtitle={t('cue.prep.jd.source_subtitle')}>
        <label
          style={{
            fontSize: 11,
            color: 'var(--d9-ink-mute)',
            fontFamily: 'var(--d9-font-mono)',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
          }}
        >
          {t('cue.prep.jd.text_label')}
        </label>
        <textarea
          value={jdText}
          onChange={(e) => setJDText(e.target.value)}
          placeholder={t('cue.prep.jd.text_placeholder')}
          rows={8}
          style={textarea}
        />

        <div style={{ marginTop: 12 }}>
          <label
            style={{
              fontSize: 11,
              color: 'var(--d9-ink-mute)',
              fontFamily: 'var(--d9-font-mono)',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
            }}
          >
            {t('cue.prep.jd.url_label')}
          </label>
          <input
            type="url"
            value={jdURL}
            onChange={(e) => setJDURL(e.target.value)}
            placeholder={t('cue.prep.jd.url_placeholder')}
            style={{
              width: '100%',
              marginTop: 6,
              fontFamily: 'inherit',
              fontSize: 12.5,
              padding: 10,
              background: 'rgba(0,0,0,0.3)',
              color: 'var(--d9-ink)',
              border: '0.5px solid var(--d9-hairline)',
              borderRadius: 8,
              outline: 'none',
            }}
          />
          <p
            style={{
              margin: '6px 0 0',
              fontSize: 11,
              color: 'var(--d9-ink-ghost)',
              lineHeight: 1.45,
            }}
          >
            {t('cue.prep.jd.url_hint')}
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
          <button
            type="button"
            disabled={!canParse || jdParsing}
            onClick={() => void parseJD()}
            style={btnPrimary(canParse && !jdParsing)}
          >
            {jdParsing ? t('cue.prep.jd.parsing') : t('cue.prep.jd.parse_cta')}
          </button>
          {jdParseError && (
            <span style={{ fontSize: 11.5, color: 'var(--d9-ink-mute)', maxWidth: 360 }}>
              {jdParseError}
            </span>
          )}
        </div>
      </Card>

      {parsedReady && (
        <Card title={t('cue.prep.jd.recognized_title')} subtitle={t('cue.prep.jd.recognized_hint')}>
          <DataRow k={t('cue.prep.jd.field.company')} v={parsedJD.company} />
          <DataRow k={t('cue.prep.jd.field.role')} v={parsedJD.role} />
          <DataRow k={t('cue.prep.jd.field.seniority')} v={parsedJD.seniority} />
          <DataRow k={t('cue.prep.jd.field.key_skills')} v={parsedJD.keySkills.join(' · ')} />
          {parsedJD.descriptionSummary && (
            <div style={{ marginTop: 8 }}>
              <label
                style={{
                  fontSize: 10.5,
                  color: 'var(--d9-ink-ghost)',
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  fontFamily: 'var(--d9-font-mono)',
                }}
              >
                {t('cue.prep.cv.field.summary')}
              </label>
              <p
                style={{
                  margin: '4px 0 0',
                  fontSize: 12.5,
                  color: 'var(--d9-ink)',
                  lineHeight: 1.55,
                }}
              >
                {parsedJD.descriptionSummary}
              </p>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

function Intro() {
  const t = useT();
  return (
    <div>
      <h2 style={{ margin: 0, fontWeight: 700, fontSize: 22, letterSpacing: '-0.02em' }}>
        {t('cue.prep.jd.title')}
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
        {t('cue.prep.jd.body')}
      </p>
    </div>
  );
}
