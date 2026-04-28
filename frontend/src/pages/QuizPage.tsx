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

export default function QuizPage(): JSX.Element {
  const token = readAccessToken() ?? "";
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

  if (phase.kind === 'idle' || phase.kind === 'error') {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <h1 className="text-2xl font-semibold mb-4">Quiz</h1>
        {phase.kind === 'error' && (
          <p className="text-red-500 mb-3">{phase.message}</p>
        )}
        <div className="grid gap-3">
          <label className="text-sm">
            Источник:
            <select
              className="ml-2 border rounded p-1"
              value={source}
              onChange={(e) => setSource(e.target.value as Source)}
            >
              <option value="codex">Codex</option>
              <option value="mock_interview">Mock interview</option>
              <option value="mixed">Mixed</option>
            </select>
          </label>
          <label className="text-sm">
            Topic (optional):
            <input
              className="ml-2 border rounded p-1"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="algorithms / sql / system_design"
            />
          </label>
          <button
            type="button"
            onClick={start}
            className="self-start px-4 py-2 bg-black text-white rounded"
          >
            Start quiz
          </button>
        </div>
      </div>
    );
  }

  if (phase.kind === 'starting' || phase.kind === 'submitting') {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <p className="text-sm text-gray-500">
          {phase.kind === 'starting' ? 'Подбираем вопросы…' : 'Проверяем ответы…'}
        </p>
      </div>
    );
  }

  if (phase.kind === 'answering') {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <h1 className="text-2xl font-semibold mb-4">Quiz · {phase.session.source}</h1>
        <ol className="grid gap-6">
          {phase.session.questions.map((q, idx) => (
            <li key={q.id}>
              <p className="text-sm text-gray-500 mb-1">Q{idx + 1}</p>
              <p className="font-medium mb-2 whitespace-pre-wrap">{q.questionMd}</p>
              <textarea
                className="w-full border rounded p-2 font-mono text-sm"
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
                  className="text-xs text-blue-600 underline mt-1 inline-block"
                  target="_blank"
                  rel="noreferrer"
                >
                  Читать материал
                </a>
              )}
            </li>
          ))}
        </ol>
        <button
          type="button"
          onClick={submit}
          className="mt-6 px-4 py-2 bg-black text-white rounded"
        >
          Submit
        </button>
      </div>
    );
  }

  // phase.kind === 'result'
  const score = `${phase.result.correct} / ${phase.result.total}`;
  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="text-2xl font-semibold mb-2">Result · {score}</h1>
      <p className="text-sm text-gray-500 mb-6">
        {phase.result.correct >= Math.ceil(phase.result.total * 0.7)
          ? 'Зачёт. Сессия отправлена в твою TaskBoard.'
          : 'Меньше 70% — пересмотри материал и пройди ещё раз.'}
      </p>
      <ol className="grid gap-4">
        {phase.session.questions.map((q, idx) => {
          const j = phase.result.judgements.find((x) => x.questionId === q.id);
          return (
            <li key={q.id} className="border rounded p-3">
              <div className="flex items-baseline gap-2 mb-1">
                <span className="text-xs text-gray-500">Q{idx + 1}</span>
                <span
                  className={`text-xs ${j?.correct ? 'text-green-600' : 'text-red-500'}`}
                >
                  {j?.correct ? '✓' : '✗'}
                </span>
              </div>
              <p className="font-medium mb-1 whitespace-pre-wrap">{q.questionMd}</p>
              <p className="text-sm text-gray-700 whitespace-pre-wrap">
                <strong>Твой ответ:</strong> {phase.answers[q.id] || '(пусто)'}
              </p>
              {j?.explanation && (
                <p className="text-xs text-gray-500 mt-2">{j.explanation}</p>
              )}
            </li>
          );
        })}
      </ol>
      <button
        type="button"
        onClick={() => setPhase({ kind: 'idle' })}
        className="mt-6 px-4 py-2 bg-black text-white rounded"
      >
        Ещё раз
      </button>
    </div>
  );
}
