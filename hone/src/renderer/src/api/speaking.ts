// api/speaking.ts — Phase J / H4 Speaking modality API client.
// Mirrors the pattern в api/reading.ts / api/listening.ts / api/writing.ts —
// module-private Connect client, named async wrappers return POJOs так
// что UI never sees proto-message classes.
import { createPromiseClient } from '@connectrpc/connect';
import { HoneService } from '@generated/pb/druz9/v1/hone_connect';

import { transport } from './transport';

// ─── Domain-shaped POJOs ───────────────────────────────────────────────────

export type SpeakingLevel = 'B1' | 'B2' | 'C1';

export interface SpeakingExercise {
  id: string;
  level: SpeakingLevel;
  topic: string;
  prompt: string;
  audioUrl: string;
}

export type WordDiffStatus = 'match' | 'miss' | 'extra' | 'substitute';

export interface WordDiff {
  status: WordDiffStatus;
  expected: string;
  actual: string;
}

export interface SpeakingGradeResult {
  id: string;
  userTranscript: string;
  pronunciationScore: number; // 0..100
  fluencyScore: number; // 0..100
  coachFeedback: string;
  wordDiffs: WordDiff[];
  createdAt: Date | null;
}

export interface SpeakingSession {
  id: string;
  exerciseId: string;
  prompt: string;
  userTranscript: string;
  pronunciationScore: number;
  fluencyScore: number;
  coachFeedback: string;
  createdAt: Date | null;
}

const client = createPromiseClient(HoneService, transport);

function normalizeLevel(v: string): SpeakingLevel {
  switch (v) {
    case 'B1':
    case 'B2':
    case 'C1':
      return v;
    default:
      return 'B2';
  }
}

function normalizeStatus(v: string): WordDiffStatus {
  switch (v) {
    case 'match':
    case 'miss':
    case 'extra':
    case 'substitute':
      return v;
    default:
      return 'match';
  }
}

// ─── Exercise catalog ─────────────────────────────────────────────────────

export async function listSpeakingExercises(level?: SpeakingLevel): Promise<SpeakingExercise[]> {
  const resp = await client.listSpeakingExercises({ level: level ?? '' });
  return resp.items.map((ex) => ({
    id: ex.id,
    level: normalizeLevel(ex.level),
    topic: ex.topic,
    prompt: ex.prompt,
    audioUrl: ex.audioUrl,
  }));
}

// ─── Grade a recording ────────────────────────────────────────────────────

export interface GradeSpeakingArgs {
  exerciseId: string;
  clientSessionId: string; // client-generated UUID v4
  audioBlob: Blob; // webm/opus from MediaRecorder
  durationMs: number;
}

/** blobToBase64 — strips the `data:...;base64,` prefix, returning raw base64. */
async function blobToBase64(blob: Blob): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const r = reader.result;
      if (typeof r !== 'string') {
        reject(new Error('FileReader returned non-string'));
        return;
      }
      const idx = r.indexOf('base64,');
      resolve(idx >= 0 ? r.slice(idx + 'base64,'.length) : r);
    };
    reader.onerror = () => reject(reader.error ?? new Error('FileReader error'));
    reader.readAsDataURL(blob);
  });
}

export async function gradeSpeaking(args: GradeSpeakingArgs): Promise<SpeakingGradeResult> {
  const audioBase64 = await blobToBase64(args.audioBlob);
  const mimeType = args.audioBlob.type || 'audio/webm';
  const resp = await client.gradeSpeaking({
    exerciseId: args.exerciseId,
    clientSessionId: args.clientSessionId,
    audioBase64,
    mimeType,
    durationMs: args.durationMs,
  });
  return {
    id: resp.id,
    userTranscript: resp.userTranscript,
    pronunciationScore: resp.pronunciationScore,
    fluencyScore: resp.fluencyScore,
    coachFeedback: resp.coachFeedback,
    wordDiffs: resp.wordDiffs.map((d) => ({
      status: normalizeStatus(d.status),
      expected: d.expected,
      actual: d.actual,
    })),
    createdAt: resp.createdAt ? resp.createdAt.toDate() : null,
  };
}

// ─── History ──────────────────────────────────────────────────────────────

export async function listSpeakingHistory(limit = 14): Promise<SpeakingSession[]> {
  const resp = await client.listSpeakingHistory({ limit });
  return resp.items.map((s) => ({
    id: s.id,
    exerciseId: s.exerciseId,
    prompt: s.prompt,
    userTranscript: s.userTranscript,
    pronunciationScore: s.pronunciationScore,
    fluencyScore: s.fluencyScore,
    coachFeedback: s.coachFeedback,
    createdAt: s.createdAt ? s.createdAt.toDate() : null,
  }));
}
