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
import { BriefRecommendationKind, InsightSeverity } from '@generated/pb/druz9/v1/intelligence_pb';

import { API_BASE_URL, DEV_BEARER_TOKEN } from './config';
import { useSessionStore } from '../stores/session';
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

// CoachSeverity — Phase 4.4 wire enum mirror.
export type CoachSeverity = 'cruise' | 'nudge' | 'warn' | 'critical';

export interface DailyBrief {
  briefId: string;
  headline: string;
  narrative: string;
  recommendations: Recommendation[];
  generatedAt: Date | null;
  severity: CoachSeverity;
  severityReason: string;
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

function unwrapSeverity(s: InsightSeverity): CoachSeverity {
  switch (s) {
    case InsightSeverity.CRITICAL:
      return 'critical';
    case InsightSeverity.WARN:
      return 'warn';
    case InsightSeverity.NUDGE:
      return 'nudge';
    default:
      return 'cruise';
  }
}

// ─── Daily Brief ────────────────────────────────────────────────────────────

// In-flight dedup + 429-backoff: HomePage / DailyBriefPanel могут
// перерендерить mount/unmount подряд (React StrictMode dev / route flips
// / focus-listener'ы), и Connect-RPC начинает спамить getDailyBrief →
// backend rate-limit (429). Делаем idempotent на client-side:
//   - inflightBrief: Promise<DailyBrief> | null — параллельные вызовы
//     без force получают тот же promise.
//   - rateLimitedUntilMs: при 429-ответе блокируем new requests на 60s;
//     возвращаем sentinel-error который caller обработает (cache stays).
let inflightBrief: Promise<DailyBrief> | null = null;
let rateLimitedUntilMs = 0;
const DAILY_BRIEF_CACHE_PREFIX = 'hone:daily-brief:cache:';

export function invalidateDailyBriefCache(): void {
  inflightBrief = null;
  if (typeof window === 'undefined') return;
  try {
    for (let i = window.localStorage.length - 1; i >= 0; i--) {
      const key = window.localStorage.key(i);
      if (key?.startsWith(DAILY_BRIEF_CACHE_PREFIX)) {
        window.localStorage.removeItem(key);
      }
    }
  } catch {
    /* localStorage unavailable — cache invalidation is best-effort */
  }
}

export async function getDailyBrief(force = false): Promise<DailyBrief> {
  // Если backend рейтлимитнул — короткий cooldown без RPC, чтобы не
  // превратить page-flip в storm 429-ов.
  const now = Date.now();
  if (now < rateLimitedUntilMs) {
    throw new Error('intelligence.getDailyBrief: rate-limited (cooling down)');
  }
  // Dedup: одновременные mount'ы получают тот же in-flight promise.
  // force=true намеренно идёт мимо dedup'а — юзер явно нажал Refresh,
  // ждём свежий ответ.
  if (!force && inflightBrief) return inflightBrief;

  const p = (async () => {
    try {
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
        severity: unwrapSeverity(resp.severity),
        severityReason: resp.severityReason,
      };
    } catch (err) {
      // Connect-RPC мапит HTTP 429 в ResourceExhausted (Code=8). Если
      // backend сказал «too many» — выставляем 60s cooldown, чтобы
      // уменьшить нагрузку и дать backend'у успокоиться.
      const msg = (err as Error)?.message ?? '';
      if (/429|resource_exhausted|rate.?limit/i.test(msg)) {
        rateLimitedUntilMs = Date.now() + 60_000;
      }
      throw err;
    }
  })();

  if (!force) {
    inflightBrief = p;
    // Освобождаем in-flight после resolve/reject — следующий mount
    // попадёт в свежий call (нормальное поведение через ~100ms).
    void p.then(() => {
      if (inflightBrief === p) inflightBrief = null;
    }, () => {
      if (inflightBrief === p) inflightBrief = null;
    });
  }
  return p;
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

// ─── Recent briefs feed (Phase 5) ───────────────────────────────────────

export interface RecentBrief {
  briefId: string;
  headline: string;
  narrative: string;
  recommendations: Recommendation[];
  generatedAt: Date | null;
  severity: CoachSeverity;
  severityReason: string;
}

interface RecentBriefsWire {
  items: Array<{
    brief_id: string;
    headline: string;
    narrative: string;
    generated_at: string;
    severity: string;
    severity_reason: string;
    recommendations: Array<{
      kind: string;
      title: string;
      rationale: string;
      target_id?: string;
    }>;
  }>;
}

function severityFromString(s: string): CoachSeverity {
  const v = (s ?? '').toLowerCase();
  if (v.includes('critical')) return 'critical';
  if (v.includes('warn')) return 'warn';
  if (v.includes('nudge')) return 'nudge';
  return 'cruise';
}

function recKindFromString(s: string): RecommendationKind {
  switch (s) {
    case 'tiny_task':
    case 'schedule':
    case 'review_note':
    case 'unblock':
      return s;
    default:
      return 'tiny_task';
  }
}

// listRecentBriefs — Hone /coach feed source. Fetch /intelligence/briefs/
// recent?days=N с Bearer-токеном из sessionStore. Backend hard-cap'ит
// limit на 60; days clamped к [1,60] на сервере.
export async function listRecentBriefs(days = 30): Promise<RecentBrief[]> {
  const token = useSessionStore.getState().accessToken ?? DEV_BEARER_TOKEN;
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  try {
    const resp = await fetch(
      `${API_BASE_URL}/api/v1/intelligence/briefs/recent?days=${encodeURIComponent(String(days))}`,
      { headers },
    );
    if (!resp.ok) {
      // 401 / 5xx — feed не критичен, возвращаем пустой массив.
      return [];
    }
    const body = (await resp.json()) as RecentBriefsWire;
    return (body.items ?? []).map((b) => ({
      briefId: b.brief_id ?? '',
      headline: b.headline ?? '',
      narrative: b.narrative ?? '',
      generatedAt: b.generated_at ? new Date(b.generated_at) : null,
      severity: severityFromString(b.severity ?? ''),
      severityReason: b.severity_reason ?? '',
      recommendations: (b.recommendations ?? []).map((r) => ({
        kind: recKindFromString(r.kind),
        title: r.title ?? '',
        rationale: r.rationale ?? '',
        targetId: r.target_id ?? '',
      })),
    }));
  } catch {
    return [];
  }
}
