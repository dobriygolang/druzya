// Step 2: paste JD text OR a job-board URL. Backend ParseJD handles
// both — URL fetching is best-effort and we surface a clear hint when
// the host blocks bots (LinkedIn does, hh.ru sometimes does).

import { useInterviewPrepStore } from '../../stores/interview-prep';
import { btnPrimary, Card, DataRow, textarea } from './UploadCVStep';

export function UploadJDStep() {
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

      <Card title="Источник" subtitle="Текст приоритетнее URL">
        <label
          style={{
            fontSize: 11,
            color: 'var(--d9-ink-mute)',
            fontFamily: 'var(--d9-font-mono)',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
          }}
        >
          Текст вакансии
        </label>
        <textarea
          value={jdText}
          onChange={(e) => setJDText(e.target.value)}
          placeholder="Senior Backend Engineer · Go · L4…"
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
            или ссылка на вакансию
          </label>
          <input
            type="url"
            value={jdURL}
            onChange={(e) => setJDURL(e.target.value)}
            placeholder="https://hh.ru/vacancy/12345"
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
            Иногда сайты блокируют запросы — если ссылка не подтянется, вставь
            текст вручную в поле выше.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
          <button
            type="button"
            disabled={!canParse || jdParsing}
            onClick={() => void parseJD()}
            style={btnPrimary(canParse && !jdParsing)}
          >
            {jdParsing ? 'Распознаю…' : 'Распознать'}
          </button>
          {jdParseError && (
            <span style={{ fontSize: 11.5, color: 'var(--d9-ink-mute)', maxWidth: 360 }}>
              {jdParseError}
            </span>
          )}
        </div>
      </Card>

      {parsedReady && (
        <Card title="Что я узнал о вакансии" subtitle="Проверь на следующем шаге">
          <DataRow k="Компания" v={parsedJD.company} />
          <DataRow k="Роль" v={parsedJD.role} />
          <DataRow k="Уровень" v={parsedJD.seniority} />
          <DataRow k="Ключевые навыки" v={parsedJD.keySkills.join(' · ')} />
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
                Кратко
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
  return (
    <div>
      <h2 style={{ margin: 0, fontWeight: 700, fontSize: 22, letterSpacing: '-0.02em' }}>
        Опиши вакансию
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
        Cue прицельно подберёт ответы под эту конкретную роль — компания,
        уровень, требуемые навыки. Так подсказки будут на месте, а не как из
        учебника.
      </p>
    </div>
  );
}
