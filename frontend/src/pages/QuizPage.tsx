// QuizPage — short-form Q&A drill page for /quiz.
//
// Two screens in one component:
//   1. Source/topic picker → POST /api/v1/quiz/start
//   2. Question list with answer textareas → POST /api/v1/quiz/{id}/submit
// On submit we render per-question correct/wrong flags + the LLM
// explanation (or fuzzy-grader rationale).
//
// State machine is pulled out to a small reducer: idle → starting →
// answering → submitting → result. Server is the source of truth for the
// session — we don't persist anything client-side beyond the in-memory
// session id.
import { useCallback, useState } from 'react';
import { Loader2 } from 'lucide-react';

import { AppShellV2 } from '../components/AppShell';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { readAccessToken, API_BASE } from '../lib/apiClient';

type Source = 'codex' | 'mock_interview' | 'mixed';

interface Question {
  id: string;
  source: Source;
  topic?: string;
  questionMd: string;
  answerHint?: string;
  readingLink?: string;
}

interface Judgement {
  questionId: string;
  correct: boolean;
  explanation?: string;
}

interface StartResp {
  sessionId: string;
  source: Source;
  questions: Question[];
  expiresAt: number;
}

interface SubmitResp {
  sessionId: string;
  source: Source;
  total: number;
  correct: number;
  judgements: Judgement[];
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'starting' }
  | { kind: 'answering'; session: StartResp; answers: Record<string, string> }
  | { kind: 'submitting'; session: StartResp; answers: Record<string, string> }
  | { kind: 'result'; session: StartResp; result: SubmitResp; answers: Record<string, string> }
  | { kind: 'error'; message: string };

const inputCls =
  'w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-text-primary focus:outline-none';

export default function QuizPage(): JSX.Element {
  const token = readAccessToken() ?? '';
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [source, setSource] = useState<Source>('codex');
  const [topic, setTopic] = useState('');

  const start = useCallback(async () => {
    setPhase({ kind: 'starting' });
    try {
      const resp = await fetch(`${API_BASE}/api/v1/quiz/start`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ source, topic, count: 5 }),
      });
      if (!resp.ok) {
        if (resp.status === 404) throw new Error('Нет вопросов по этой теме');
        throw new Error(`Ошибка ${resp.status}`);
      }
      const session = (await resp.json()) as StartResp;
      const seed: Record<string, string> = {};
      for (const q of session.questions) seed[q.id] = '';
      setPhase({ kind: 'answering', session, answers: seed });
    } catch (e) {
      setPhase({ kind: 'error', message: (e as Error).message });
    }
  }, [token, source, topic]);

  const submit = useCallback(async () => {
    if (phase.kind !== 'answering') return;
    setPhase({ kind: 'submitting', session: phase.session, answers: phase.answers });
    try {
      const resp = await fetch(
        `${API_BASE}/api/v1/quiz/${phase.session.sessionId}/submit`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ answers: phase.answers }),
        },
      );
      if (!resp.ok) throw new Error(`Submit ${resp.status}`);
      const result = (await resp.json()) as SubmitResp;
      setPhase({ kind: 'result', session: phase.session, result, answers: phase.answers });
    } catch (e) {
      setPhase({ kind: 'error', message: (e as Error).message });
    }
  }, [phase, token]);

  return (
    <AppShellV2>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-10">
        <header className="flex flex-col gap-1">
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-text-muted">
            QUIZ
          </p>
          <h1 className="font-display text-3xl font-semibold">Короткий drill</h1>
          <p className="text-[13px] text-text-secondary">
            5 коротких вопросов по выбранной теме. Ответы судит fuzzy-grader + LLM
            на бесплатном tier'е.
          </p>
        </header>

        {(phase.kind === 'idle' || phase.kind === 'error') && (
          <Card className="flex-col gap-4 p-5" interactive={false}>
            {phase.kind === 'error' && (
              <p className="text-[13px] text-danger">{phase.message}</p>
            )}
            <label className="flex flex-col gap-1.5">
              <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-muted">
                Источник
              </span>
              <select
                className={inputCls}
                value={source}
                onChange={(e) => setSource(e.target.value as Source)}
              >
                <option value="codex">Codex</option>
                <option value="mock_interview">Mock interview</option>
                <option value="mixed">Mixed</option>
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-muted">
                Topic (optional)
              </span>
              <input
                className={inputCls}
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="algorithms / sql / system_design"
              />
            </label>
            <div>
              <Button type="button" onClick={start}>
                Start quiz
              </Button>
            </div>
          </Card>
        )}

        {(phase.kind === 'starting' || phase.kind === 'submitting') && (
          <Card className="flex-row items-center gap-3 p-5" interactive={false}>
            <Loader2 className="h-4 w-4 animate-spin text-text-muted" />
            <span className="text-[13px] text-text-secondary">
              {phase.kind === 'starting' ? 'Подбираем вопросы…' : 'Проверяем ответы…'}
            </span>
          </Card>
        )}

        {phase.kind === 'answering' && (
          <>
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-text-muted">
              {phase.session.source} · {phase.session.questions.length} вопросов
            </p>
            <ol className="flex flex-col gap-3">
              {phase.session.questions.map((q, idx) => (
                <li key={q.id}>
                  <Card className="flex-col gap-2 p-4" interactive={false}>
                    <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
                      Q{idx + 1}
                    </p>
                    <p className="whitespace-pre-wrap text-[14px] font-medium text-text-primary">
                      {q.questionMd}
                    </p>
                    <textarea
                      className={`${inputCls} font-mono`}
                      rows={3}
                      value={phase.answers[q.id] ?? ''}
                      onChange={(e) => {
                        const val = e.target.value;
                        setPhase((p) =>
                          p.kind === 'answering'
                            ? { ...p, answers: { ...p.answers, [q.id]: val } }
                            : p,
                        );
                      }}
                    />
                    {q.readingLink && (
                      <a
                        href={q.readingLink}
                        className="self-start font-mono text-[11px] text-text-secondary underline hover:text-text-primary"
                        target="_blank"
                        rel="noreferrer"
                      >
                        Читать материал →
                      </a>
                    )}
                  </Card>
                </li>
              ))}
            </ol>
            <div>
              <Button type="button" onClick={submit}>
                Submit
              </Button>
            </div>
          </>
        )}

        {phase.kind === 'result' && (
          <ResultView phase={phase} onReset={() => setPhase({ kind: 'idle' })} />
        )}
      </div>
    </AppShellV2>
  );
}

function ResultView({
  phase,
  onReset,
}: {
  phase: Extract<Phase, { kind: 'result' }>;
  onReset: () => void;
}) {
  const score = `${phase.result.correct} / ${phase.result.total}`;
  const passed = phase.result.correct >= Math.ceil(phase.result.total * 0.7);
  return (
    <>
      <Card className="flex-col gap-2 p-5" interactive={false}>
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
          Result
        </p>
        <p className="font-display text-2xl font-semibold">
          {score}{' '}
          <span
            className={`font-mono text-[12px] uppercase tracking-[0.18em] ${
              passed ? 'text-success' : 'text-danger'
            }`}
          >
            {passed ? 'passed' : 'retry'}
          </span>
        </p>
        <p className="text-[13px] text-text-secondary">
          {passed
            ? 'Зачёт. Сессия отправлена в твою TaskBoard.'
            : 'Меньше 70% — пересмотри материал и пройди ещё раз.'}
        </p>
      </Card>
      <ol className="flex flex-col gap-3">
        {phase.session.questions.map((q, idx) => {
          const j = phase.result.judgements.find((x) => x.questionId === q.id);
          return (
            <li key={q.id}>
              <Card className="flex-col gap-2 p-4" interactive={false}>
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
                    Q{idx + 1}
                  </span>
                  <span
                    className={`font-mono text-[11px] ${j?.correct ? 'text-success' : 'text-danger'}`}
                  >
                    {j?.correct ? '✓ correct' : '✗ wrong'}
                  </span>
                </div>
                <p className="whitespace-pre-wrap text-[14px] font-medium text-text-primary">
                  {q.questionMd}
                </p>
                <p className="whitespace-pre-wrap text-[13px] text-text-secondary">
                  <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-text-muted">
                    Твой ответ:
                  </span>{' '}
                  {phase.answers[q.id] || '(пусто)'}
                </p>
                {j?.explanation && (
                  <p className="text-[12px] text-text-muted">{j.explanation}</p>
                )}
              </Card>
            </li>
          );
        })}
      </ol>
      <div>
        <Button type="button" variant="ghost" onClick={onReset}>
          Ещё раз
        </Button>
      </div>
    </>
  );
}
