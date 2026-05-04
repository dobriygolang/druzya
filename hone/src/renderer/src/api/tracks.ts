// api/tracks.ts — Hone-side wrapper для curated learning tracks (Phase 2e).
//
// Используется только на чтение для Today chip: «Track: <name> · step
// N/M». Мутации (Join/Pause/Advance) живут на web /atlas/track/:slug —
// Hone не дублирует UI, чтобы оставаться lightweight surface'ом.
import { createPromiseClient } from '@connectrpc/connect';
import { TracksService } from '@generated/pb/druz9/v1/tracks_connect';

import { transport } from './transport';

export interface ActiveTrack {
  trackId: string;
  slug: string;
  name: string;
  accentColor: string;
  currentStep: number;
  stepsTotal: number;
}

const client = createPromiseClient(TracksService, transport);

// activeTrack — первый non-paused / non-completed enrolment. Подходит
// для chip, который показывает один статус: «вот этим я сейчас занят».
export async function activeTrack(): Promise<ActiveTrack | null> {
  try {
    const resp = await client.listUserTracks({});
    for (const item of resp.items) {
      const enrol = item.enrolment;
      if (!enrol) continue;
      if (enrol.pausedAt) continue;
      if (enrol.completedAt) continue;
      const tr = item.track;
      if (!tr) continue;
      return {
        trackId: tr.id,
        slug: tr.slug,
        name: tr.name,
        accentColor: tr.accentColor || '#A78BFA',
        currentStep: enrol.currentStep,
        stepsTotal: item.stepsTotal,
      };
    }
    return null;
  } catch {
    return null;
  }
}

// ── Phase 2 step UX (2026-05-04) ─────────────────────────────────────────

export interface StartCheckpointResult {
  stepTitle: string;
  skillKeys: string[];
  checkpointSkillKeys: string[];
  alreadyPassed: boolean;
  reflectionRequired: boolean;
  graduationMockSection: string;
}

export interface CheckpointAnswer {
  questionId: string;
  question: string;
  userAnswer: string;
  modelAnswer?: string;
}

export interface GradedAnswer {
  questionId: string;
  userAnswer: string;
  modelAnswer: string;
  correct: boolean;
  comment: string;
}

export interface SubmitCheckpointResult {
  score: number;
  passed: boolean;
  attempts: GradedAnswer[];
  attemptId: string;
  passedAt: Date | null;
}

export async function startCheckpoint(trackId: string, stepIndex: number): Promise<StartCheckpointResult> {
  const r = await client.startCheckpoint({ trackId, stepIndex });
  return {
    stepTitle: r.stepTitle ?? '',
    skillKeys: r.skillKeys ?? [],
    checkpointSkillKeys: r.checkpointSkillKeys ?? [],
    alreadyPassed: r.alreadyPassed ?? false,
    reflectionRequired: r.reflectionRequired ?? false,
    graduationMockSection: r.graduationMockSection ?? '',
  };
}

export async function submitCheckpoint(
  trackId: string,
  stepIndex: number,
  answers: CheckpointAnswer[],
): Promise<SubmitCheckpointResult> {
  const r = await client.submitCheckpoint({
    trackId,
    stepIndex,
    answers: answers.map((a) => ({
      questionId: a.questionId,
      question: a.question,
      userAnswer: a.userAnswer,
      modelAnswer: a.modelAnswer ?? '',
    })),
  });
  return {
    score: r.score ?? 0,
    passed: r.passed ?? false,
    attempts: (r.attempts ?? []).map((a) => ({
      questionId: a.questionId ?? '',
      userAnswer: a.userAnswer ?? '',
      modelAnswer: a.modelAnswer ?? '',
      correct: a.correct ?? false,
      comment: a.comment ?? '',
    })),
    attemptId: r.attemptId ?? '',
    passedAt: r.passedAt ? r.passedAt.toDate() : null,
  };
}
