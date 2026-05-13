// Step 3: side-by-side recap of parsed CV + JD with a single CTA
// "Запустить подготовку". On click → backend StartInterviewPrep →
// active prep stored → next step = Launch.

import { useInterviewPrepStore } from '../../stores/interview-prep';
import { btnPrimary, Card, DataRow } from './UploadCVStep';

export function ReviewStep() {
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
        <Card title="Резюме" subtitle="То что попадёт в Cue">
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
            Поправить резюме
          </button>
        </Card>

        <Card title="Вакансия" subtitle="То что попадёт в Cue">
          <DataRow k="Компания" v={parsedJD.company} />
          <DataRow k="Роль" v={parsedJD.role} />
          <DataRow k="Уровень" v={parsedJD.seniority} />
          <DataRow k="Ключевые навыки" v={parsedJD.keySkills.join(' · ')} />
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
            Поправить вакансию
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
          {starting ? 'Запускаю…' : 'Запустить подготовку'}
        </button>
        {startError && (
          <span style={{ fontSize: 11.5, color: 'var(--d9-ink-mute)' }}>{startError}</span>
        )}
      </div>
    </div>
  );
}

function Intro() {
  return (
    <div>
      <h2 style={{ margin: 0, fontWeight: 700, fontSize: 22, letterSpacing: '-0.02em' }}>
        Проверь и запусти
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
        После запуска Cue будет учитывать эти данные при каждой подсказке —
        пока вы не закроете режим подготовки.
      </p>
    </div>
  );
}
