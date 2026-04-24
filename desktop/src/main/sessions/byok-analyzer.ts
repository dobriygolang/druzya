// BYOK local analyzer — mirror of backend LLMAnalyzer but runs inside
// the Electron main process, using the user's own OpenAI key. Keeps
// the "nothing on our server" promise when the user is in BYOK mode.
//
// Input: the Session (which we only use for metadata — id, kind) plus
// the renderer's accumulated conversation content for that session.
// Output: a SessionAnalysis matching the server-side shape exactly, so
// the renderer can display server and BYOK reports with the same UI.
//
// Transcript source: in BYOK mode the renderer's conversation store
// owns the turns (server never sees them). Main asks the renderer for
// them via a dedicated IPC ("sessions:export-local-transcript") that's
// added alongside this module.

import type { Session, SessionAnalysis } from '@shared/types';

import { OpenAIProvider } from '../api/providers/openai';
import { loadKey } from '../auth/byok-keychain';

export interface LocalTranscript {
  /** Free-form Markdown of the session's turns — the renderer builds
   *  this and passes it in. We don't parse individual turns here. */
  markdown: string;
}

/**
 * Run a local LLM pass over a session's transcript. Uses the user's
 * OpenAI BYOK key and gpt-4o-mini for cost. Throws on missing key so
 * the UI can hint the user to add one.
 */
export async function runByokAnalysis(
  session: Session,
  transcript: LocalTranscript,
): Promise<SessionAnalysis> {
  const apiKey = await loadKey('openai');
  if (!apiKey) {
    throw new Error('BYOK-анализ требует OpenAI-ключ. Добавь его в Настройки → AI провайдеры.');
  }
  const provider = new OpenAIProvider(apiKey);

  const ctrl = new AbortController();
  const messages = [
    {
      role: 'system' as const,
      content:
        'Ты — технический тренер по собеседованиям. Возвращай СТРОГО JSON без префиксов, ' +
        'с полями overall_score (int 0..100), section_scores (map string→int 0..100), ' +
        'weaknesses (array of strings), recommendations (array of strings), ' +
        'report_markdown (string). Отвечай по-русски.',
    },
    {
      role: 'user' as const,
      content:
        'Ниже — транскрипт подсказок AI-копайлота, которые пользователь запрашивал во время ' +
        'собеседования. Проанализируй и выдай JSON-отчёт.\n\n' +
        transcript.markdown,
    },
  ];

  let raw = '';
  const stream = await provider.stream({
    model: 'openai/gpt-4o-mini',
    messages,
    signal: ctrl.signal,
  });
  for await (const ev of stream) {
    if (ev.type === 'delta') raw += ev.text;
    if (ev.type === 'error') throw new Error(`BYOK-анализ: ${ev.message}`);
    if (ev.type === 'done') break;
  }

  return parseAnalysisJSON(raw, session.id);
}

function parseAnalysisJSON(raw: string, sessionID: string): SessionAnalysis {
  // Strip ```json fences if the model wrapped the response.
  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?/, '').replace(/```$/, '').trim();
  }
  let parsed: {
    overall_score?: number;
    section_scores?: Record<string, number>;
    weaknesses?: string[];
    recommendations?: string[];
    report_markdown?: string;
  };
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(`BYOK-анализ: не удалось распарсить JSON: ${(err as Error).message}`);
  }

  const clamp = (n: number): number => Math.max(0, Math.min(100, Math.round(n)));
  const sectionScores: Record<string, number> = {};
  for (const [k, v] of Object.entries(parsed.section_scores ?? {})) {
    sectionScores[k] = clamp(Number(v));
  }

  const now = new Date().toISOString();
  return {
    sessionId: sessionID,
    status: 'ready',
    overallScore: clamp(Number(parsed.overall_score ?? 0)),
    sectionScores,
    weaknesses: parsed.weaknesses ?? [],
    recommendations: parsed.recommendations ?? [],
    links: [],
    reportMarkdown: parsed.report_markdown ?? '',
    reportUrl: '', // BYOK reports stay local
    errorMessage: '',
    startedAt: now,
    finishedAt: now,
  };
}
