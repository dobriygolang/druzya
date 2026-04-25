// api/intelligence.ts — typed wrappers around IntelligenceService.
//
// Two RPCs:
//   getDailyBrief(force?) — returns the (cached or freshly synthesised)
//                           morning brief. force=true rate-limited 1/h
//                           backend-side.
//   askNotes(question)    — RAG over the user's notes corpus with
//                           citation parsing.
import { createPromiseClient } from '@connectrpc/connect';
import { IntelligenceService } from '@generated/pb/druz9/v1/intelligence_connect';
import { BriefRecommendationKind } from '@generated/pb/druz9/v1/intelligence_pb';

import { transport } from './transport';

// ─── Domain-shaped POJOs ────────────────────────────────────────────────────

export type RecommendationKind = 'tiny_task' | 'schedule' | 'review_note' | 'unblock';

export interface Recommendation {
  kind: RecommendationKind;
  title: string;
  rationale: string;
  // targetId is opaque: note_id for "review_note", plan_item_id for
  // "unblock", empty otherwise.
  targetId: string;
}

export interface DailyBrief {
  briefId: string;
  headline: string;
  narrative: string;
  recommendations: Recommendation[];
  generatedAt: Date | null;
}

export interface MemoryStats {
  total30d: number;
  byKind: Record<string, number>;
}

export interface Citation {
  noteId: string;
  title: string;
  snippet: string;
}

export interface AskAnswer {
  answerMd: string;
  citations: Citation[];
}

// ─── Internals ──────────────────────────────────────────────────────────────

const client = createPromiseClient(IntelligenceService, transport);

function protoTs(ts: { seconds: bigint; nanos: number } | undefined): Date | null {
  if (!ts) return null;
  const ms = Number(ts.seconds) * 1000 + Math.floor(ts.nanos / 1_000_000);
  return new Date(ms);
}

function unwrapKind(k: BriefRecommendationKind): RecommendationKind {
  switch (k) {
    case BriefRecommendationKind.TINY_TASK:
      return 'tiny_task';
    case BriefRecommendationKind.SCHEDULE:
      return 'schedule';
    case BriefRecommendationKind.REVIEW_NOTE:
      return 'review_note';
    case BriefRecommendationKind.UNBLOCK:
      return 'unblock';
    default:
      return 'tiny_task';
  }
}

// ─── Daily Brief ────────────────────────────────────────────────────────────

export async function getDailyBrief(force = false): Promise<DailyBrief> {
  const resp = await client.getDailyBrief({ force });
  return {
    briefId: resp.briefId,
    headline: resp.headline,
    narrative: resp.narrative,
    recommendations: resp.recommendations.map((r) => ({
      kind: unwrapKind(r.kind),
      title: r.title,
      rationale: r.rationale,
      targetId: r.targetId,
    })),
    generatedAt: protoTs(resp.generatedAt as unknown as { seconds: bigint; nanos: number } | undefined),
  };
}

// ─── Memory feedback ────────────────────────────────────────────────────────

export async function ackRecommendation(briefId: string, index: number, followed: boolean): Promise<void> {
  if (!briefId) return; // Phase A briefs (без memory) — пропускаем
  await client.ackRecommendation({ briefId, index, followed });
}

export async function getMemoryStats(): Promise<MemoryStats> {
  const resp = await client.getMemoryStats({});
  const byKind: Record<string, number> = {};
  for (const [k, v] of Object.entries(resp.byKind ?? {})) {
    byKind[k] = Number(v);
  }
  return { total30d: resp.total30d, byKind };
}

// ─── Ask Notes ──────────────────────────────────────────────────────────────

export async function askNotes(question: string): Promise<AskAnswer> {
  const resp = await client.askNotes({ question });
  return {
    answerMd: resp.answerMd,
    citations: resp.citations.map((c) => ({
      noteId: c.noteId,
      title: c.title,
      snippet: c.snippet,
    })),
  };
}
