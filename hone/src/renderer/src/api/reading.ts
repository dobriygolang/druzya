// api/reading.ts — Reading-модуль API client (Wave 4 of english.md).
// Library + reader sessions + Leitner SRS vocab. Same pattern as api/hone.ts —
// module-private Connect client, named async wrappers return POJOs так чтобы
// UI never sees proto-message classes.
import { createPromiseClient } from '@connectrpc/connect';
import { HoneService } from '@generated/pb/druz9/v1/hone_connect';

import { transport } from './transport';

// ─── Domain-shaped POJOs ───────────────────────────────────────────────────

export type ReadingSourceKind = 'paste' | 'url' | 'pdf' | 'epub' | 'book';

export interface ReadingMaterial {
  id: string;
  sourceKind: ReadingSourceKind;
  sourceUrl: string;
  title: string;
  bodyMd: string; // empty in list responses
  totalChars: number;
  archivedAt: Date | null;
  createdAt: Date | null;
  updatedAt: Date | null;
  // Book-only progress (Sergey 2026-05-03). null когда не задано.
  bookChapter: number | null;
  bookTotalChapters: number | null;
}

export interface ReadingSession {
  id: string;
  materialId: string;
  charsRead: number;
  charsTotal: number;
  startedAt: Date | null;
  endedAt: Date | null;
  aiSummaryScore: number | null; // null when not yet graded
  summaryMd: string;
}

export interface VocabEntry {
  word: string;
  translation: string;
  contextMd: string;
  sourceMaterial: string | null;
  box: number; // 0..5; 5 = graduated
  nextReviewAt: Date | null;
  reviewedCount: number;
  learnedAt: Date | null;
  createdAt: Date | null;
}

// ─── Internals ─────────────────────────────────────────────────────────────

const client = createPromiseClient(HoneService, transport);

function protoTs(ts: { seconds: bigint; nanos: number } | undefined): Date | null {
  if (!ts) return null;
  const ms = Number(ts.seconds) * 1000 + Math.floor(ts.nanos / 1_000_000);
  if (ms <= 0) return null; // backend leaves zero-stamp on "not set" fields
  return new Date(ms);
}

function normalizeSourceKind(k: string): ReadingSourceKind {
  switch (k) {
    case 'paste':
    case 'url':
    case 'pdf':
    case 'epub':
    case 'book':
      return k;
    default:
      return 'paste';
  }
}

type ProtoMaterial = {
  id: string;
  sourceKind: string;
  sourceUrl: string;
  title: string;
  bodyMd: string;
  totalChars: number;
  archivedAt?: { seconds: bigint; nanos: number };
  createdAt?: { seconds: bigint; nanos: number };
  updatedAt?: { seconds: bigint; nanos: number };
  bookChapter?: number;
  hasBookChapter?: boolean;
  bookTotalChapters?: number;
  hasBookTotal?: boolean;
};

function unwrapMaterial(m: ProtoMaterial): ReadingMaterial {
  return {
    id: m.id,
    sourceKind: normalizeSourceKind(m.sourceKind),
    sourceUrl: m.sourceUrl,
    title: m.title,
    bodyMd: m.bodyMd,
    totalChars: m.totalChars,
    archivedAt: protoTs(m.archivedAt),
    createdAt: protoTs(m.createdAt),
    updatedAt: protoTs(m.updatedAt),
    bookChapter: m.hasBookChapter ? (m.bookChapter ?? 0) : null,
    bookTotalChapters: m.hasBookTotal ? (m.bookTotalChapters ?? 0) : null,
  };
}

type ProtoSession = {
  id: string;
  materialId: string;
  charsRead: number;
  charsTotal: number;
  startedAt?: { seconds: bigint; nanos: number };
  endedAt?: { seconds: bigint; nanos: number };
  aiSummaryScore: number;
  hasScore: boolean;
  summaryMd: string;
};

function unwrapSession(s: ProtoSession): ReadingSession {
  return {
    id: s.id,
    materialId: s.materialId,
    charsRead: s.charsRead,
    charsTotal: s.charsTotal,
    startedAt: protoTs(s.startedAt),
    endedAt: protoTs(s.endedAt),
    aiSummaryScore: s.hasScore ? s.aiSummaryScore : null,
    summaryMd: s.summaryMd,
  };
}

type ProtoVocab = {
  word: string;
  translation: string;
  contextMd: string;
  sourceMaterial: string;
  box: number;
  nextReviewAt?: { seconds: bigint; nanos: number };
  reviewedCount: number;
  learnedAt?: { seconds: bigint; nanos: number };
  createdAt?: { seconds: bigint; nanos: number };
};

function unwrapVocab(v: ProtoVocab): VocabEntry {
  return {
    word: v.word,
    translation: v.translation,
    contextMd: v.contextMd,
    sourceMaterial: v.sourceMaterial.length > 0 ? v.sourceMaterial : null,
    box: v.box,
    nextReviewAt: protoTs(v.nextReviewAt),
    reviewedCount: v.reviewedCount,
    learnedAt: protoTs(v.learnedAt),
    createdAt: protoTs(v.createdAt),
  };
}

// ─── Materials ─────────────────────────────────────────────────────────────

export async function listReadingMaterials(limit = 100): Promise<ReadingMaterial[]> {
  const resp = await client.listReadingMaterials({ limit });
  return resp.items.map((m) => unwrapMaterial(m as unknown as ProtoMaterial));
}

export async function getReadingMaterial(id: string): Promise<ReadingMaterial> {
  const resp = await client.getReadingMaterial({ id });
  return unwrapMaterial(resp as unknown as ProtoMaterial);
}

export async function addReadingMaterial(args: {
  sourceKind: ReadingSourceKind;
  title: string;
  bodyMd: string;
  sourceUrl?: string;
  bookChapter?: number;
  bookTotalChapters?: number;
}): Promise<ReadingMaterial> {
  const resp = await client.addReadingMaterial({
    sourceKind: args.sourceKind,
    title: args.title,
    bodyMd: args.bodyMd,
    sourceUrl: args.sourceUrl ?? '',
    bookChapter: args.bookChapter ?? 0,
    hasBookChapter: typeof args.bookChapter === 'number',
    bookTotalChapters: args.bookTotalChapters ?? 0,
    hasBookTotal: typeof args.bookTotalChapters === 'number',
  });
  return unwrapMaterial(resp as unknown as ProtoMaterial);
}

export async function updateBookProgress(args: {
  id: string;
  bookChapter?: number;
  bookTotalChapters?: number;
}): Promise<ReadingMaterial> {
  const resp = await client.updateBookProgress({
    id: args.id,
    bookChapter: args.bookChapter ?? 0,
    hasBookChapter: typeof args.bookChapter === 'number',
    bookTotalChapters: args.bookTotalChapters ?? 0,
    hasBookTotal: typeof args.bookTotalChapters === 'number',
  });
  return unwrapMaterial(resp as unknown as ProtoMaterial);
}

export async function archiveReadingMaterial(id: string): Promise<void> {
  await client.archiveReadingMaterial({ id });
}

// ─── Sessions ─────────────────────────────────────────────────────────────

export async function startReadingSession(materialId: string): Promise<ReadingSession> {
  const resp = await client.startReadingSession({ materialId });
  return unwrapSession(resp as unknown as ProtoSession);
}

// endReadingSession returns the closed session, including ai_summary_score
// when the LLM grader finished within the request budget. If the grader
// is offline or timed out, `aiSummaryScore` is null and the caller should
// just treat the session as done-without-score.
export async function endReadingSession(args: {
  sessionId: string;
  charsRead: number;
  summaryMd?: string;
}): Promise<ReadingSession> {
  const resp = await client.endReadingSession({
    sessionId: args.sessionId,
    charsRead: args.charsRead,
    summaryMd: args.summaryMd ?? '',
  });
  if (!resp.session) {
    // Defensive: an old server (pre-4.3) returned an empty response. Synth
    // a stub so the caller's typed flow keeps working — they'll just see
    // no score, which matches the pre-4.3 UX.
    return {
      id: args.sessionId,
      materialId: '',
      charsRead: args.charsRead,
      charsTotal: 0,
      startedAt: null,
      endedAt: new Date(),
      aiSummaryScore: null,
      summaryMd: args.summaryMd ?? '',
    };
  }
  return unwrapSession(resp.session as unknown as ProtoSession);
}

// ─── Vocab queue ──────────────────────────────────────────────────────────

export async function addVocab(args: {
  word: string;
  translation?: string;
  contextMd?: string;
  sourceMaterial?: string;
}): Promise<VocabEntry> {
  const resp = await client.addVocab({
    word: args.word,
    translation: args.translation ?? '',
    contextMd: args.contextMd ?? '',
    sourceMaterial: args.sourceMaterial ?? '',
  });
  return unwrapVocab(resp as unknown as ProtoVocab);
}

export async function reviewVocab(word: string, correct: boolean): Promise<VocabEntry> {
  const resp = await client.reviewVocab({ word, correct });
  return unwrapVocab(resp as unknown as ProtoVocab);
}

/** Wave 4.2 — vocab entries saved from a specific source material.
 *  Powers the «words you've saved here» reader sidebar. */
export async function listVocabBySourceMaterial(materialId: string, limit = 50): Promise<VocabEntry[]> {
  const resp = await client.listVocabBySourceMaterial({ materialId, limit });
  return resp.items.map((v) => unwrapVocab(v as unknown as ProtoVocab));
}

export async function listVocabDue(limit = 20): Promise<VocabEntry[]> {
  const resp = await client.listVocabDue({ limit });
  return resp.items.map((v) => unwrapVocab(v as unknown as ProtoVocab));
}
