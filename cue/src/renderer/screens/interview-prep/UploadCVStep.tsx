// Step 1 of the wizard. Two paths:
//   1. Native file picker → Cue main extracts text (.pdf / .md / .txt).
//   2. Manual paste textarea (fallback when extraction fails on a
//      scanned CV, or the user prefers to type).
//
// After the source text is available, "Распознать" sends it to backend
// ParseCV. The parsed summary card shows what the LLM extracted so the
// user can verify before advancing.

import { useEffect } from 'react';

import { useInterviewPrepStore } from '../../stores/interview-prep';

export function UploadCVStep() {
  const cvText = useInterviewPrepStore((s) => s.cvText);
  const cvFilename = useInterviewPrepStore((s) => s.cvFilename);
  const parsedCV = useInterviewPrepStore((s) => s.parsedCV);
  const cvParseError = useInterviewPrepStore((s) => s.cvParseError);
  const cvParsing = useInterviewPrepStore((s) => s.cvParsing);
  const setCV = useInterviewPrepStore((s) => s.setCV);
  const parseCV = useInterviewPrepStore((s) => s.parseCV);
  const pickCVFile = useInterviewPrepStore((s) => s.pickCVFile);
  const active = useInterviewPrepStore((s) => s.active);

  // "Use last CV" affordance — when the user has prior active prep with
  // CV text, prefill on first mount unless they've already typed.
  useEffect(() => {
    if (active.active && !cvText && active.parsedCV.summary) {
      // We don't have raw text from a prior prep here (server stores
      // it but doesn't expose via getActive — would inflate the
      // payload). The summary alone is enough to mark "parsed" state:
      // user can re-confirm on the review step.
      // Strictly: leave as-is to encourage a fresh source.
    }
  }, [active, cvText]);

  const parsedReady =
    parsedCV.summary.trim().length > 0 ||
    parsedCV.topSkills.length > 0 ||
    parsedCV.currentRole.trim().length > 0 ||
    parsedCV.name.trim().length > 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 640, margin: '0 auto' }}>
      <Intro />

      <Card title="Источник" subtitle={cvFilename || 'Файл не выбран'}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => void pickCVFile()}
            style={btnSecondary}
          >
            Выбрать файл…
          </button>
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 11, color: 'var(--d9-ink-ghost)' }}>
            PDF · Markdown · TXT, до 5MB
          </span>
        </div>

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
            или вставьте текст резюме
          </label>
          <textarea
            value={cvText}
            onChange={(e) => setCV(e.target.value, cvFilename)}
            placeholder="Senior Backend Engineer, 6+ years…"
            rows={8}
            style={textarea}
          />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
          <button
            type="button"
            disabled={!cvText.trim() || cvParsing}
            onClick={() => void parseCV()}
            style={btnPrimary(Boolean(cvText.trim()) && !cvParsing)}
          >
            {cvParsing ? 'Распознаю…' : 'Распознать'}
          </button>
          {cvParseError && (
            <span style={{ fontSize: 11.5, color: 'var(--d9-ink-mute)' }}>{cvParseError}</span>
          )}
        </div>
      </Card>

      {parsedReady && (
        <Card title="Что я узнал из резюме" subtitle="Можно поправить вручную в следующем шаге">
          <DataRow k="Имя" v={parsedCV.name} />
          <DataRow k="Текущая роль" v={parsedCV.currentRole} />
          <DataRow
            k="Опыт"
            v={parsedCV.experienceYears > 0 ? `${parsedCV.experienceYears} лет` : ''}
          />
          <DataRow k="Топ-навыки" v={parsedCV.topSkills.join(' · ')} />
          <DataRow k="Образование" v={parsedCV.education} />
          {parsedCV.summary && (
            <div style={{ marginTop: 8 }}>
              <label style={dataLabel}>Кратко</label>
              <p style={summaryParagraph}>{parsedCV.summary}</p>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

function Intro() {
  return (
    <div>
      <h2 style={{ margin: 0, fontWeight: 700, fontSize: 22, letterSpacing: '-0.02em' }}>
        Загрузите резюме
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
        Cue будет учитывать ваш реальный опыт и стек в подсказках на интервью —
        STAR-ответы и технические объяснения подгоняются под вашу карьеру, а не
        под обобщённого кандидата.
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Shared building blocks
// ─────────────────────────────────────────────────────────────────────────

export function Card({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      style={{
        border: '0.5px solid var(--d9-hairline)',
        borderRadius: 10,
        padding: '16px 18px',
        background: 'rgba(255,255,255,0.02)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0, fontSize: 13.5, fontWeight: 600, letterSpacing: '-0.005em' }}>{title}</h3>
        {subtitle && (
          <span
            style={{
              fontSize: 11,
              color: 'var(--d9-ink-ghost)',
              fontFamily: 'var(--d9-font-mono)',
              letterSpacing: '0.04em',
            }}
          >
            {subtitle}
          </span>
        )}
      </div>
      {children}
    </section>
  );
}

const dataLabel: React.CSSProperties = {
  fontSize: 10.5,
  color: 'var(--d9-ink-ghost)',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  fontFamily: 'var(--d9-font-mono)',
};

const summaryParagraph: React.CSSProperties = {
  margin: '4px 0 0',
  fontSize: 12.5,
  color: 'var(--d9-ink)',
  lineHeight: 1.55,
};

export function DataRow({ k, v }: { k: string; v: string }) {
  if (!v) return null;
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '140px 1fr',
        gap: 12,
        padding: '4px 0',
        fontSize: 12.5,
      }}
    >
      <span style={{ color: 'var(--d9-ink-mute)', letterSpacing: '-0.005em' }}>{k}</span>
      <span style={{ color: 'var(--d9-ink)', letterSpacing: '-0.005em', wordBreak: 'break-word' }}>{v}</span>
    </div>
  );
}

export const btnSecondary: React.CSSProperties = {
  background: 'transparent',
  border: '0.5px solid var(--d9-hairline)',
  borderRadius: 7,
  padding: '8px 14px',
  fontSize: 12.5,
  cursor: 'pointer',
  color: 'var(--d9-ink)',
  fontFamily: 'inherit',
};

export function btnPrimary(enabled: boolean): React.CSSProperties {
  return {
    background: enabled ? 'var(--d9-ink)' : 'rgba(255,255,255,0.04)',
    color: enabled ? 'var(--d9-obsidian)' : 'var(--d9-ink-ghost)',
    border: '0.5px solid var(--d9-hairline)',
    borderRadius: 7,
    padding: '8px 16px',
    fontSize: 12.5,
    fontWeight: 600,
    cursor: enabled ? 'pointer' : 'not-allowed',
    fontFamily: 'inherit',
  };
}

export const textarea: React.CSSProperties = {
  width: '100%',
  marginTop: 6,
  fontFamily: 'inherit',
  fontSize: 12.5,
  lineHeight: 1.5,
  padding: 10,
  background: 'rgba(0,0,0,0.3)',
  color: 'var(--d9-ink)',
  border: '0.5px solid var(--d9-hairline)',
  borderRadius: 8,
  resize: 'vertical',
  outline: 'none',
  minHeight: 120,
};
